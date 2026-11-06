"use client";
import { useLanguage } from "./language";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Ellipsis, RotateCcw, RefreshCw, AlertCircle } from "lucide-react";
import { formatTime, playbackPosition, playbackUrl, type RoomState } from "@/lib/shared";
import { directSourceError, mediaFormat, videoUrlError } from "@/lib/video-source";
import { attachRoomMedia } from "@/lib/media-playback";
import { Spinner } from "./ui";
const seekKeys = new Set(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"]);
export function Player({ room, isHost, offset, busy, connected, onControl, onChangeVideo, footer }: { footer: ReactNode; room: RoomState; isHost: boolean; offset: number; busy: boolean; connected: boolean; onControl: (playing: boolean, position: number) => Promise<void>; onChangeVideo: () => void }) {
  const { t,notice } = useLanguage();
  const video = useRef<HTMLVideoElement>(null), shell = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(!isHost || room.playing), [duration, setDuration] = useState(0), [time, setTime] = useState(0), [volume, setVolume] = useState(.8), [muted, setMuted] = useState(true), [error, setError] = useState(""), [buffering, setBuffering] = useState(false), [retry, setRetry] = useState(0), [blocked, setBlocked] = useState(false);
  const [screenNotice, setScreenNotice] = useState("");
  const [livePlaylist,setLivePlaylist] = useState(false);
  const live = livePlaylist || duration === Infinity;
  const [stalled, setStalled] = useState(false);
  const retriedAfterStall = useRef(false);
  const [scrub, setScrub] = useState<number | null>(null); const scrubbing = useRef(false);
  const keyboardSeek = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(()=>()=>clearTimeout(keyboardSeek.current),[]);
  const autoplayBlocked = useRef(false);
  const playAttempt = useRef(0);
  const playPending = useRef(false);
  const lastSeek = useRef({ at: -Infinity, revision: -1 });
  const sourceUrl = playbackUrl(room);
  const sourceFormat = room.nativeSource?.format ?? mediaFormat(sourceUrl);
  const sourceError = room.sourceMode === "upload" ? null : room.nativeSource ? directSourceError(sourceUrl) : videoUrlError(sourceUrl);
  const playerError = sourceError || error;
  const atEnd = Number.isFinite(duration) && duration > 0 && time >= duration - .25;
  const stateRef = useRef({ room, offset, ready, busy, live }); stateRef.current = { room, offset, ready, busy, live };
  useEffect(() => {
    setError(""); setDuration(0); setTime(0); setBuffering(false); setBlocked(false); setLivePlaylist(false);
    autoplayBlocked.current = false;
    lastSeek.current = { at:-Infinity, revision:-1 };
    if (!sourceError && video.current) {
      const detach = attachRoomMedia(video.current, { url: sourceUrl, format: sourceFormat }, setError, undefined, setLivePlaylist);
      return () => { playAttempt.current++; playPending.current = false; detach(); };
    }
  }, [sourceUrl, sourceFormat, retry, sourceError]);
  useEffect(() => { const v = video.current; if (v) { v.volume = volume; v.muted = muted; } }, [volume, muted]);
  useEffect(() => {
    setStalled(false);
    if (!ready || !room.playing || blocked || playerError || !connected) return;
    const v = video.current;
    if (!v) return;
    let lastProgress = performance.now(), lastFrames = -1;
    const receiving = () => { lastProgress=performance.now(); setStalled(false); };
    v.addEventListener("progress",receiving);
    const check = setInterval(() => {
      const decoded = v.getVideoPlaybackQuality?.().totalVideoFrames ?? v.currentTime;
      if (document.hidden || v.ended || scrubbing.current || decoded !== lastFrames) {
        lastFrames = decoded; lastProgress = performance.now(); setStalled(false); return;
      }
      if (performance.now()-lastProgress < 16000) return;
      // A new request can recover a stalled connection. Never loop on an unavailable source.
      if (!retriedAfterStall.current) { retriedAfterStall.current = true; setRetry(n=>n+1); }
      else setStalled(true);
    },1000);
    return () => {clearInterval(check);v.removeEventListener("progress",receiving);};
  },[ready,room.playing,blocked,playerError,connected,retry]);
  function play(video: HTMLVideoElement) {
    if (playPending.current) return;
    const attempt = ++playAttempt.current;
    playPending.current = true;
    void video.play().catch((reason: unknown) => {
      if (attempt !== playAttempt.current) return;
      // Seeking, changing source or a host pause may cancel a pending play. Only a policy refusal needs a gesture.
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        autoplayBlocked.current = true; setBlocked(true);
      }
    }).finally(() => { if (attempt === playAttempt.current) playPending.current = false; });
  }
  useEffect(() => {
    const sync = () => {
      const v = video.current, s = stateRef.current;
      if (!v || !s.ready || v.readyState < 1 || s.busy || scrubbing.current) return;
      if (s.live) {
        // The room clock starts at zero. A live playlist has a moving window on its own clock.
        v.playbackRate = 1;
        if (!s.room.playing) { if (!v.paused) v.pause(); return; }
        if (v.paused && !autoplayBlocked.current) {
          const ranges=v.seekable;
          if(ranges.length && ranges.end(ranges.length-1)-v.currentTime>8) v.currentTime=Math.max(ranges.start(ranges.length-1),ranges.end(ranges.length-1)-3);
          play(v);
        }
        return;
      }
      const target = Math.min(playbackPosition(s.room, Date.now() + s.offset), Number.isFinite(v.duration) ? v.duration : Infinity);
      const drift = target - v.currentTime;
      const previous = lastSeek.current, now = performance.now();
      if (!v.seeking && v.readyState >= 2 && (Math.abs(drift) > 1 || (!s.room.playing && Math.abs(drift) > .12)) &&
          (previous.revision !== s.room.revision || (v.readyState >= 3 && now - previous.at > 2000))) {
        v.currentTime = target;
        lastSeek.current = {at:now,revision:s.room.revision};
      }
      v.playbackRate = s.room.playing && Math.abs(drift) > .18 && Math.abs(drift) <= .8 ? (drift > 0 ? 1.03 : .97) : 1;
      if (s.room.playing && v.paused && !v.ended && !autoplayBlocked.current) play(v);
      if (!s.room.playing && !v.paused) v.pause();
    };
    sync(); const id = setInterval(sync, 350); return () => clearInterval(id);
  }, []);
  function unlock() {
    const v = video.current; if (!v) return;
    autoplayBlocked.current = false;
    setReady(true); setBlocked(false);
    const position = Math.min(playbackPosition(room, Date.now() + offset), Number.isFinite(v.duration) ? Math.max(0, v.duration - .03) : Infinity);
    if (v.readyState >= 1 && !live) v.currentTime = position;
    if (isHost && !room.playing) { void control(true, position); return; }
    play(v);
  }
  async function control(playing: boolean, position = video.current?.currentTime || 0) {
    if (!isHost || busy || !connected || playerError || !video.current) return;
    autoplayBlocked.current = false;
    setReady(true); setBlocked(false);
    if (!live && playing && !room.playing && Number.isFinite(video.current.duration) && position >= video.current.duration - .25) {
      position = 0; video.current.currentTime = 0;
    }
    if (playing) play(video.current); else video.current.pause();
    await onControl(playing, live ? 0 : position);
  }
  async function seek(value: number) { scrubbing.current = false; setScrub(null); if (video.current) video.current.currentTime = value; await control(room.playing, value); }
  return <div className="player" ref={shell}>
    <div className="video-stage"><video ref={video} playsInline muted={muted} preload={isHost && !ready ? "metadata" : "auto"} poster={room.poster || undefined} onLoadedMetadata={() => setDuration(video.current?.duration || 0)} onDurationChange={() => setDuration(video.current?.duration || 0)} onTimeUpdate={() => setTime(video.current?.currentTime || 0)} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)} onEnded={() => { if (isHost && room.playing && !busy && !live) void onControl(false, video.current?.duration || time); }} aria-label={room.videoTitle}/>
    {!ready && !playerError && <div className="player-overlay"><h3>{room.videoTitle}</h3>
      <button className="button primary" disabled={isHost && (!connected || busy)} onClick={unlock}><Play size={18} fill="currentColor"/>{isHost && !room.playing ? t("Запустить для всех") : t("Войти в просмотр")}</button></div>}
    {ready && blocked && !playerError && <div className="player-overlay"><button className="button primary" onClick={unlock}><Play size={18}/>{t("Разрешить воспроизведение")}</button></div>}
    {ready && buffering && room.playing && !stalled && !playerError && !blocked && <span className="buffering"><Spinner/>{t("Загрузка видео")}</span>}
    {stalled && !playerError && <div className="player-overlay" role="status"><p>{t("Загрузка остановилась. Проверьте соединение или повторите попытку.")}</p><button className="button subtle" onClick={()=>setRetry(n=>n+1)}>{t("Попробовать снова")}</button></div>}
    {!isHost && !room.playing && !playerError && !blocked && connected && <div className="player-top"><span>{t("Фильм на паузе")}</span></div>}
    {playerError && <div className="player-overlay player-error" role="alert"><AlertCircle size={29}/><h3>{sourceError ? t("Нужна прямая ссылка на видео") : t("Видео не открылось")}</h3><p>{notice(playerError)}</p>{isHost ? <button className="button primary" onClick={onChangeVideo}>{t("Заменить ссылку")}</button> : <p>{t("Попросите ведущего показать вкладку или выбрать другой источник.")}</p>}{!sourceError && <button className="button subtle" onClick={() => setRetry(r => r + 1)}><RefreshCw size={16}/>{t("Попробовать снова")}</button>}</div>}
    {!connected && <div className="player-top" role="status"><span><i className="amber-dot"/>{t("Восстанавливаем связь")}</span></div>}</div>
    <div className="player-controls">
      <button className="icon-button play-toggle" disabled={!isHost || busy || !connected || !!playerError} title={isHost ? undefined : t("Воспроизведением управляет ведущий")}
        aria-label={room.playing ? t("Пауза для всех") : atEnd ? t("Смотреть сначала") : t("Запустить для всех")} onClick={() => void control(!room.playing)}>
        {busy ? <Spinner/> : room.playing ? <Pause size={20} fill="currentColor"/> : atEnd ? <RotateCcw size={19}/> : <Play size={19} fill="currentColor"/>}
      </button>
      <span className="video-time">{live ? t("Прямой эфир") : <>{formatTime(scrub ?? time)} <i>/</i> {formatTime(duration)}</>}</span>
      <input className="timeline" type="range" hidden={live} aria-label={t("Позиция воспроизведения")} min={0} max={Number.isFinite(duration) ? duration : 0} step={.1}
        value={scrub ?? Math.min(time, Number.isFinite(duration) ? duration : time)}
        disabled={!isHost || !ready || busy || !connected || !duration || !Number.isFinite(duration)}
        onPointerDown={e => { clearTimeout(keyboardSeek.current); scrubbing.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onChange={e => setScrub(Number(e.target.value))}
        onPointerUp={e => void seek(Number(e.currentTarget.value))} onPointerCancel={() => { scrubbing.current = false; setScrub(null); }}
        onKeyDown={e=>{if(seekKeys.has(e.key)){clearTimeout(keyboardSeek.current);scrubbing.current=true;}}}
        onKeyUp={e=>{if(seekKeys.has(e.key)){const position=Number(e.currentTarget.value);clearTimeout(keyboardSeek.current);keyboardSeek.current=setTimeout(()=>void seek(position),160);}}}
        style={{ "--progress": `${duration ? (scrub ?? time) / duration * 100 : 0}%` } as React.CSSProperties}/>
      <button className="icon-button" aria-label={muted ? t("Включить звук") : t("Выключить звук")} onClick={() => setMuted(!muted)}>
        {muted || volume === 0 ? <VolumeX size={19}/> : <Volume2 size={19}/>}
      </button>
      <button className="icon-button" aria-label={t("Полноэкранный режим")} onClick={async () => {
        setScreenNotice("");
        const element = video.current as (HTMLVideoElement & {webkitEnterFullscreen?:()=>void}) | null;
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else if (document.fullscreenEnabled && shell.current?.requestFullscreen) await shell.current.requestFullscreen();
          else if (element?.webkitEnterFullscreen) element.webkitEnterFullscreen();
          else setScreenNotice("Полноэкранный режим недоступен в этом браузере.");
        } catch { setScreenNotice("Полноэкранный режим недоступен в этом браузере."); }
      }}><Maximize size={18}/></button>
      <details className="play-options">
        <summary aria-label={t("Настройки плеера")}><Ellipsis size={18}/></summary>
        <div className="play-menu">
          <label>{t("Громкость")}<input aria-label={t("Громкость")} className="volume-range" type="range" min="0" max="1" step=".05" value={muted ? 0 : volume} onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}/></label>
          {isHost && !live && <div>
            <button aria-label={t("Назад на 10 секунд")} disabled={!ready || busy || !connected || !!playerError} onClick={() => void seek(Math.max(0,time-10))}>{t("−10 сек")}</button>
            <button aria-label={t("Вперёд на 10 секунд")} disabled={!ready || busy || !connected || !!playerError} onClick={() => void seek(Math.min(duration || time+10,time+10))}>{t("+10 сек")}</button>
          </div>}
        </div>
      </details>
    </div>
    {footer}
    {screenNotice && <p className="player-local-notice" role="status">{notice(screenNotice)}</p>}
  </div>;
}
