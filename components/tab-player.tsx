"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FolderUp, MonitorPlay, Radio, Square } from "lucide-react";
import { releaseFilm, takeFilm } from "@/lib/local-film";
import { connectTab } from "@/lib/tab-stream";
import type { RoomState } from "@/lib/shared";

export function TabPlayer({ room, token, host, hostOnline, connected, onAction, children }: {
  room: RoomState; token: string; host: boolean; hostOnline: boolean; connected: boolean;
  onAction: (data: Record<string, unknown>) => Promise<void>; children?: ReactNode;
}) {
  const fromFile = room.sourceMode === "local";
  const [film, setFilm] = useState<File | undefined>(() => fromFile && host ? takeFilm(room.id) : undefined);
  const [fileUrl, setFileUrl] = useState("");
  const source = useRef<HTMLVideoElement>(null), waitingForViewer = useRef(false);
  useEffect(() => {
    if (!film) return;
    const url = URL.createObjectURL(film); setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [film]);
  useEffect(() => { if (film) releaseFilm(room.id); }, [room.id, film]);
  const player = useRef<HTMLVideoElement>(null), held = useRef<MediaStream | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null), [incoming, setIncoming] = useState<MediaStream | null>(null);
  const [audio, setAudio] = useState(false), [watch, setWatch] = useState(false), [retry, setRetry] = useState(0);
  const [status, setStatus] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const current = useRef({ room, onAction }); current.current = { room, onAction };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; held.current?.getTracks().forEach(t => t.stop()); }; }, []);
  useEffect(() => {
    if (!room.shareId || (host ? !local : !watch || !hostOnline)) { setIncoming(null); return; }
    setStatus(host ? "Ждём зрителей…" : "Подключаемся к ведущему…");
    return connectTab(room.id, room.shareId, token, host ? local : null, { onStream: setIncoming, onStatus: setStatus,
      onConnected: () => {
        if (!fromFile || !host || !waitingForViewer.current) return;
        waitingForViewer.current = false;
        void source.current?.play().catch(() => setError("Нажмите воспроизведение на плеере файла."));
      },
    });
  }, [room.id, room.shareId, host, hostOnline, local, watch, token, retry, fromFile]);
  const stream = host ? local : incoming;
  useEffect(() => { const video = player.current; if (video) { video.srcObject = stream; if (stream) void video.play().catch(() => {}); } }, [stream]);

  async function stop() {
    held.current?.getTracks().forEach(t => t.stop()); held.current = null; waitingForViewer.current = false; setLocal(null); if (fromFile) source.current?.pause();
    const { room: latest, onAction: act } = current.current;
    if (latest.shareId) await act({ action: "share-stop", pageUrl: latest.videoUrl, session: latest.shareId }).catch(() => {});
  }
  async function start() {
    setError(""); setBusy(true);
    let captured: MediaStream | undefined;
    try {
      if (fromFile) {
        const video = source.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
        if (!video?.captureStream) throw new Error("Откройте файл в Chrome или Edge на компьютере.");
        const startAt = video.ended ? 0 : video.currentTime;
        await video.play();
        captured = video.captureStream();
        video.pause(); video.currentTime = startAt; waitingForViewer.current = true;
        if (!captured.getVideoTracks().length) throw new Error("Браузер не смог прочитать видеодорожку файла.");
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Для показа вкладки откройте комнату в Chrome или Edge на компьютере.");
        captured = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser", frameRate: { ideal: 30 } }, audio,
          selfBrowserSurface: "exclude", monitorTypeSurfaces: "exclude",
        } as DisplayMediaStreamOptions);
        const selected = captured.getVideoTracks()[0], surface = selected?.getSettings().displaySurface;
        if (!selected || (surface && surface !== "browser")) throw new Error("Выберите именно вкладку с фильмом в окне браузера.");
      }
      const track = captured.getVideoTracks()[0];
      if (!alive.current) { captured.getTracks().forEach(t => t.stop()); return; }
      await onAction({ action: "share-start", pageUrl: room.videoUrl });
      if (!alive.current) { captured.getTracks().forEach(t => t.stop()); return; }
      held.current = captured; setLocal(captured);
      track.onended = () => { if (alive.current) void stop(); };
      if (!fromFile && audio && !captured.getAudioTracks().length) setError("Браузер передаёт только изображение. Чтобы добавить звук, выберите вкладку заново и разрешите передачу аудио.");
    } catch (e) {
      captured?.getTracks().forEach(t => t.stop());
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Показ отменён. Можно снова выбрать вкладку." : e instanceof Error ? e.message : "Не удалось начать показ.");
    } finally { if (alive.current) setBusy(false); }
  }
  return <section className="live-stage" aria-label={fromFile ? "Показ файла" : "Просмотр вкладки"}>
    {fromFile && host && fileUrl && <video className="live-video" ref={source} src={fileUrl} controls muted playsInline preload="auto" onError={() => setError("Браузер не может декодировать этот файл. Выберите MP4 или WebM с поддерживаемым кодеком.")}/>}
    {stream && !(fromFile && host) && <video className="live-video" ref={player} controls={!host} autoPlay muted playsInline />}
    <div className={stream ? "live-tools" : "live-intro"}>
      {!stream && <span className="source-symbol"><MonitorPlay size={30}/></span>}
      <h2>{stream ? (fromFile ? "Показ файла" : "Показ вкладки") : host ? (fromFile ? "Показать свой файл" : "Показать фильм из вкладки") : room.shareId && hostOnline ? "Ведущий начал показ" : "Ждём фильм от ведущего"}</h2>
      {!stream && <p>{host ? fromFile ? "Фильм начнётся, когда подключится первый зритель. Управляйте воспроизведением здесь и оставьте комнату открытой." : "Откройте страницу с фильмом, запустите его и выберите эту вкладку для показа. Друзья увидят фильм здесь." : "Оставьте комнату открытой. Когда ведущий выберет вкладку, вы сможете присоединиться."}</p>}
      {host && !local && fromFile && <><label className="button subtle file-picker"><FolderUp size={16}/>Выбрать файл<input type="file" accept="video/*,.mkv" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) { setFilm(chosen); setError(""); } }}/></label><button className="button primary" disabled={!fileUrl || busy || !connected} onClick={() => void start()}>Начать показ файла</button></>}
      {host && !local && !fromFile && <><div className="live-buttons"><a className="button subtle" href={room.videoUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Открыть сайт</a><button className="button primary" disabled={busy || !connected} onClick={() => void start()}><Radio size={17}/>Показать вкладку</button></div>
        <label className="sound-option"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)}/>Передавать звук вкладки</label></>}
      {host && local && <button className="button subtle" onClick={() => void stop()}><Square size={14}/>Завершить показ</button>}
      {!host && hostOnline && room.shareId && <button className={watch ? "text-button" : "button primary"} onClick={() => { setWatch(true); setIncoming(null); setRetry(r => r+1); }}>{watch ? "Переподключиться" : "Смотреть трансляцию"}</button>}
      {room.shareId && (local || watch) && <small role="status">{fromFile && status === "Идёт показ вкладки" ? "Идёт показ файла" : status}</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    {!stream && children}
  </section>;
}
