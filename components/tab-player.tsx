"use client";
import { useLanguage } from "./language";
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
  const { t,notice } = useLanguage();
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
  const [relay, setRelay] = useState<{ session: string; url: string } | null>(null);
  const [preferRelay, setPreferRelay] = useState(false);
  const [audio, setAudio] = useState(false), [retry, setRetry] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const displayed = useRef<MediaStream | string | null>(null);
  const [lastHttp,setLastHttp] = useState<number>();
  const blocked = useRef(false), sawBroadcast = useRef(false);
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
    if (!session || (host && !local)) return;
    sawBroadcast.current = true;
    setLastHttp(undefined);
    setStatus(host ? "Ждём зрителей…" : "Подключаемся к показу…");
    return connectTab(room.id, session, token, host ? local : null, {
      onStream: stream => setIncoming(stream ? { session, stream } : null),
      onRelaySource: url => setRelay(url ? { session, url } : null), preferRoomRelay: preferRelay,
      onStatus: setStatus, onHttpError:setLastHttp, onSessionChanged,
      playback: source => {
        const v = player.current;
        if (!v || (typeof source === "string" ? v.getAttribute("src") !== source : v.srcObject !== source)) return "waiting";
        if (blocked.current) return "blocked";
        if (typeof v.requestVideoFrameCallback === "function") return displayed.current === source ? "playing" : "waiting";
        return v.readyState >= 2 && v.videoWidth > 0 && (v.currentTime > 0 || (v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) > 0) ? "playing" : "waiting";
      },
      onConnected: () => {
        if (!fromFile || !host || !waitingForViewer.current) return;
        waitingForViewer.current = false;
        void source.current?.play().catch(() => setError("Нажмите воспроизведение на плеере файла."));
      },
    });
  }, [room.id, room.shareId, host, local, token, retry, preferRelay, fromFile, onSessionChanged]);

  const stream = host ? local : incoming?.session === room.shareId ? incoming?.stream ?? null : null;
  const relayUrl = !host && relay?.session === room.shareId ? relay?.url : undefined;
  const showing = Boolean(stream || relayUrl);
  function allowPlayback(video: HTMLVideoElement) {
    const expectedStream = video.srcObject, expectedUrl = video.getAttribute("src");
    const ranges=video.buffered;
    if(expectedUrl && ranges.length && ranges.end(ranges.length-1)-video.currentTime>8) video.currentTime=ranges.end(ranges.length-1)-1.5;
    void video.play().catch(reason => {
      if (video !== player.current || video.srcObject !== expectedStream || video.getAttribute("src") !== expectedUrl) return;
      if (reason instanceof DOMException && reason.name === "NotAllowedError") { blocked.current = true; setNeedsGesture(true); }
    });
  }
  useEffect(() => {
    blocked.current = false; displayed.current = null; setNeedsGesture(false);
    const video = player.current;
    if (!video) return;
    if (relayUrl) { video.srcObject = null; video.src = relayUrl; }
    else { video.removeAttribute("src"); video.srcObject = stream; }
    const source = relayUrl || stream;
    if (!source) return;
    const frame = video.requestVideoFrameCallback?.(() => {
      displayed.current = source;
      if (!host) setStatus(relayUrl ? "В эфире · через комнату" : "В эфире");
    });
    allowPlayback(video);
    return () => { if (frame !== undefined) video.cancelVideoFrameCallback(frame); displayed.current=null; };
  }, [stream, relayUrl, host]);

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
  else if (sawBroadcast.current) guestTitle = "Ждём следующего показа";

  return <section className="live-stage" data-last-http={lastHttp} aria-label={fromFile ? t("Показ файла") : t("Просмотр вкладки")}>
    {fromFile && host && fileUrl && <video className="live-video" ref={source} src={fileUrl} controls muted playsInline preload="auto" onError={() => setError("Браузер не может декодировать этот файл. Выберите MP4 или WebM с поддерживаемым кодеком.")}/>}
    {showing && !(fromFile && host) && <video className="live-video" ref={player} controls={!host} autoPlay muted playsInline disableRemotePlayback={Boolean(relayUrl)}
      onPlaying={e => { blocked.current = false; setNeedsGesture(false); if (relayUrl && typeof e.currentTarget.requestVideoFrameCallback !== "function") setStatus("В эфире · через комнату"); }}
      onProgress={e => {
        const video = e.currentTarget, b = video.buffered;
        if (relayUrl && !video.paused && b.length && b.end(b.length - 1) - video.currentTime > 8) video.currentTime = Math.max(0, b.end(b.length - 1) - 1.5);
      }} />}
    <div className={showing ? "live-tools" : "live-intro"}>
      <h2>{showing ? (fromFile ? t("Показ файла") : t("Показ вкладки")) : host ? (fromFile ? t("Показать свой файл") : t("Показать фильм из вкладки")) : t(guestTitle)}</h2>
      {!showing && (host || !room.shareId) && <p>{host ? fromFile ? t("Фильм начнётся, когда подключится первый зритель. Оставьте комнату открытой. Если прямая связь не пройдёт, файл будет передаваться через сервер комнаты.") : t("Откройте страницу с фильмом, запустите его и выберите эту вкладку для показа. Друзья увидят фильм здесь. Если прямая связь не пройдёт, показ пойдёт через сервер комнаты.") : t("Просмотр начнётся автоматически, когда ведущий включит показ.")}</p>}
      {host && !local && fromFile && <><label className="button subtle file-picker"><FolderOpen size={17}/>{t("Выбрать файл")}<input type="file" accept="video/*,.mkv" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) { setFilm(chosen); setError(""); } }}/></label><button className="button primary" disabled={!fileUrl || busy || !connected} onClick={() => void start()}>{t("Начать показ файла")}</button></>}
      {host && !local && !fromFile && <><div className="live-buttons"><a className="button subtle" href={room.videoUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{t("Открыть сайт")}</a><button className="button primary" disabled={busy || !connected} onClick={() => void start()}>{t("Показать вкладку")}</button></div>
        <label className="sound-option"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)}/>{t("Передавать звук вкладки")}</label></>}
      {host && local && capture && <button className="button subtle" onClick={() => void stop(capture)}><Square size={14}/>{t("Завершить показ")}</button>}
      {!host && room.shareId && <div className="live-buttons">
        {needsGesture && <button className="button primary" onClick={()=>{if(player.current) allowPlayback(player.current);}}>{t("Разрешить воспроизведение")}</button>}
        <button className="text-button" onClick={() => { setPreferRelay(false); setIncoming(null); setRetry(r => r + 1); }}>{t("Переподключиться")}</button>
        {!relayUrl && <button className="text-button" onClick={() => { setPreferRelay(true); setIncoming(null); setRetry(r => r + 1); }}>{t("Смотреть через комнату")}</button>}
      </div>}
      {room.shareId && (local || !host) && <small role="status">{fromFile && status === "Идёт показ вкладки" ? t("Идёт показ файла") : notice(status)}</small>}
      {host && !local && room.shareId && <small role="status">{t("В этой вкладке показ не идёт. Начните показ здесь, чтобы заменить текущий.")}</small>}
      {error && <p className="error" role="alert">{notice(error)}</p>}
    </div>
    {!showing && children}
  </section>;
}
