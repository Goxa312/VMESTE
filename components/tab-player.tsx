"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FolderOpen, Square } from "lucide-react";
import { releaseFilm, takeFilm } from "@/lib/local-film";
import { connectTab } from "@/lib/tab-stream";
import type { RoomState, Snapshot } from "@/lib/shared";

type Capture = { session: string; pageUrl: string; revision: number; stream: MediaStream };
type Props = {
  room: RoomState; token: string; host: boolean; hostOnline: boolean; connected: boolean;
  onAction: (data: Record<string, unknown>) => Promise<Snapshot & { startedShare?: string }>;
  onSessionChanged: () => Promise<unknown>;
  children?: ReactNode;
};

function release(capture: Capture) {
  for (const track of capture.stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

function stopOnExit(code: string, token: string, capture: Capture) {
  // This request may outlive the document. The server only stops this exact session.
  void fetch(`/api/rooms/${code}/actions`, {
    method: "POST", keepalive: true,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "share-stop", session: capture.session, pageUrl: capture.pageUrl }),
  }).catch(() => {});
}

export function TabPlayer({ room, token, host, hostOnline, connected, onAction, onSessionChanged, children }: Props) {
  const fromFile = room.sourceMode === "local";
  const [film, setFilm] = useState<File | undefined>(() => fromFile && host ? takeFilm(room.id) : undefined);
  const [fileUrl, setFileUrl] = useState("");
  const source = useRef<HTMLVideoElement>(null), waitingForViewer = useRef(false);
  useEffect(() => {
    if (!film) return;
    const url = URL.createObjectURL(film);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [film]);
  useEffect(() => { if (film) releaseFilm(room.id); }, [room.id, film]);

  const player = useRef<HTMLVideoElement>(null), held = useRef<Capture | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [incoming, setIncoming] = useState<{ session: string; stream: MediaStream } | null>(null);
  const [audio, setAudio] = useState(false), [watch, setWatch] = useState(false), [retry, setRetry] = useState(0);
  const [status, setStatus] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const exit = () => {
      const owned = held.current;
      if (!owned) return;
      held.current = null;
      release(owned);
      stopOnExit(room.id, token, owned);
    };
    const pageHide = () => { exit(); setCapture(null); };
    window.addEventListener("pagehide", pageHide);
    return () => { alive.current = false; window.removeEventListener("pagehide", pageHide); exit(); };
  }, [room.id, token]);

  useEffect(() => {
    if (!capture || room.revision < capture.revision || room.shareId === capture.session || held.current !== capture) return;
    held.current = null;
    release(capture);
    setCapture(null);
    waitingForViewer.current = false;
    if (fromFile) source.current?.pause();
    setStatus(room.shareId ? "Показ начат в другой вкладке ведущего." : "Показ завершён.");
  }, [capture, room.shareId, room.revision, fromFile]);

  const local = capture?.session === room.shareId ? capture?.stream ?? null : null;
  useEffect(() => {
    const session = room.shareId;
    if (!session || (host ? !local : !watch)) return;
    setStatus(host ? "Ждём зрителей…" : "Подключаемся к показу…");
    return connectTab(room.id, session, token, host ? local : null, {
      onStream: stream => setIncoming(stream ? { session, stream } : null),
      onStatus: setStatus, onSessionChanged,
      onConnected: () => {
        if (!fromFile || !host || !waitingForViewer.current) return;
        waitingForViewer.current = false;
        void source.current?.play().catch(() => setError("Нажмите воспроизведение на плеере файла."));
      },
    });
  }, [room.id, room.shareId, host, local, watch, token, retry, fromFile, onSessionChanged]);

  const stream = host ? local : incoming?.session === room.shareId ? incoming?.stream ?? null : null;
  useEffect(() => {
    const video = player.current;
    if (video) { video.srcObject = stream; if (stream) void video.play().catch(() => {}); }
  }, [stream]);

  async function stop(owned: Capture) {
    if (held.current !== owned) return;
    held.current = null;
    release(owned);
    waitingForViewer.current = false;
    setCapture(null);
    if (fromFile) source.current?.pause();
    try {
      await onAction({ action: "share-stop", pageUrl: owned.pageUrl, session: owned.session });
    } catch {
      stopOnExit(room.id, token, owned);
    }
  }

  async function start() {
    if (busy || held.current) return;
    setError(""); setBusy(true);
    let captured: MediaStream | undefined;
    try {
      if (fromFile) {
        const video = source.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
        if (!video?.captureStream) throw new Error("Откройте файл в Chrome или Edge на компьютере.");
        const position = video.ended ? 0 : video.currentTime;
        await video.play();
        captured = video.captureStream();
        video.pause(); video.currentTime = position;
        waitingForViewer.current = true;
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
      if (!alive.current) { captured.getTracks().forEach(t => t.stop()); return; }
      const result = await onAction({ action: "share-start", pageUrl: room.videoUrl });
      if (!result.startedShare || result.startedShare !== result.room.shareId) throw new Error("В другой вкладке уже начат новый показ.");
      const owned = { session: result.startedShare, pageUrl: room.videoUrl, stream: captured, revision: result.room.revision };
      const track = captured.getVideoTracks()[0];
      if (!alive.current || track.readyState === "ended") {
        release(owned);
        stopOnExit(room.id, token, owned);
        return;
      }
      held.current = owned;
      setCapture(owned);
      track.onended = () => { if (alive.current) void stop(owned); };
      if (!fromFile && audio && !captured.getAudioTracks().length) setError("Браузер передаёт только изображение. Чтобы добавить звук, выберите вкладку заново и разрешите передачу аудио.");
    } catch (e) {
      captured?.getTracks().forEach(t => t.stop());
      if (alive.current) setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Показ отменён. Можно снова выбрать вкладку." : e instanceof Error ? e.message : "Не удалось начать показ.");
    } finally { if (alive.current) setBusy(false); }
  }

  let guestTitle = "Ждём фильм от ведущего";
  if (room.shareId) guestTitle = hostOnline ? "Ведущий начал показ" : "Ждём связи с ведущим";
  else if (watch) guestTitle = "Ждём следующего показа";

  return <section className="live-stage" aria-label={fromFile ? "Показ файла" : "Просмотр вкладки"}>
    {fromFile && host && fileUrl && <video className="live-video" ref={source} src={fileUrl} controls muted playsInline preload="auto" onError={() => setError("Браузер не может декодировать этот файл. Выберите MP4 или WebM с поддерживаемым кодеком.")}/>}
    {stream && !(fromFile && host) && <video className="live-video" ref={player} controls={!host} autoPlay muted playsInline />}
    <div className={stream ? "live-tools" : "live-intro"}>
      <h2>{stream ? (fromFile ? "Показ файла" : "Показ вкладки") : host ? (fromFile ? "Показать свой файл" : "Показать фильм из вкладки") : guestTitle}</h2>
      {!stream && (host || !watch || !room.shareId) && <p>{host ? fromFile ? "Фильм начнётся, когда подключится первый зритель. Управляйте воспроизведением здесь и оставьте комнату открытой." : "Откройте страницу с фильмом, запустите его и выберите эту вкладку для показа. Друзья увидят фильм здесь." : watch ? "Оставьте комнату открытой. Когда ведущий начнёт новый показ, вы подключитесь автоматически." : "Оставьте комнату открытой. Когда ведущий выберет вкладку, вы сможете присоединиться."}</p>}
      {host && !local && fromFile && <><label className="button subtle file-picker"><FolderOpen size={17}/>Выбрать файл<input type="file" accept="video/*,.mkv" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) { setFilm(chosen); setError(""); } }}/></label><button className="button primary" disabled={!fileUrl || busy || !connected} onClick={() => void start()}>Начать показ файла</button></>}
      {host && !local && !fromFile && <><div className="live-buttons"><a className="button subtle" href={room.videoUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Открыть сайт</a><button className="button primary" disabled={busy || !connected} onClick={() => void start()}>Показать вкладку</button></div>
        <label className="sound-option"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)}/>Передавать звук вкладки</label></>}
      {host && local && capture && <button className="button subtle" onClick={() => void stop(capture)}><Square size={14}/>Завершить показ</button>}
      {!host && room.shareId && <button className={watch ? "text-button" : "button primary"} onClick={() => { setWatch(true); setIncoming(null); setRetry(r => r + 1); }}>{watch ? "Переподключиться" : "Смотреть трансляцию"}</button>}
      {room.shareId && (local || watch) && <small role="status">{fromFile && status === "Идёт показ вкладки" ? "Идёт показ файла" : status}</small>}
      {host && !local && room.shareId && <small role="status">В этой вкладке показ не идёт. Начните показ здесь, чтобы заменить текущий.</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    {!stream && children}
  </section>;
}
