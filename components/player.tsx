"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Ellipsis, RotateCcw, RefreshCw, AlertCircle } from "lucide-react";
import { formatTime, playbackPosition, type RoomState } from "@/lib/shared";
import { directSourceError, mediaFormat, videoUrlError } from "@/lib/video-source";
import { attachRoomMedia } from "@/lib/media-playback";
import { Spinner } from "./ui";
export function Player({ room, isHost, offset, busy, connected, onControl, onChangeVideo, viewControl }: { viewControl: ReactNode; room: RoomState; isHost: boolean; offset: number; busy: boolean; connected: boolean; onControl: (playing: boolean, position: number) => Promise<void>; onChangeVideo: () => void }) {
  const video = useRef<HTMLVideoElement>(null), shell = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false), [duration, setDuration] = useState(0), [time, setTime] = useState(0), [volume, setVolume] = useState(.8), [muted, setMuted] = useState(true), [error, setError] = useState(""), [buffering, setBuffering] = useState(false), [retry, setRetry] = useState(0), [blocked, setBlocked] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); const scrubbing = useRef(false);
  const autoplayBlocked = useRef(false);
  const sourceUrl = room.nativeSource?.url ?? room.videoUrl;
  const sourceFormat = room.nativeSource?.format ?? mediaFormat(sourceUrl);
  const sourceError = room.sourceMode === "upload" ? null : room.nativeSource ? directSourceError(sourceUrl) : videoUrlError(sourceUrl);
  const playerError = sourceError || error;
  const atEnd = Number.isFinite(duration) && duration > 0 && time >= duration - .25;
  const stateRef = useRef({ room, offset, ready, busy }); stateRef.current = { room, offset, ready, busy };
  useEffect(() => {
    setError(""); setDuration(0); setTime(0); setBuffering(false);
    if (!sourceError && video.current) {
      return attachRoomMedia(video.current, { url: sourceUrl, format: sourceFormat }, setError);
    }
  }, [sourceUrl, sourceFormat, retry, sourceError]);
  useEffect(() => { const v = video.current; if (v) { v.volume = volume; v.muted = muted; } }, [volume, muted]);
  useEffect(() => {
    let alive = true;
    const sync = () => {
      const v = video.current, s = stateRef.current;
      if (!v || !s.ready || v.readyState < 1 || s.busy || scrubbing.current) return;
      const target = Math.min(playbackPosition(s.room, Date.now() + s.offset), Number.isFinite(v.duration) ? Math.max(0, v.duration - .03) : Infinity);
      const drift = target - v.currentTime;
      if (Math.abs(drift) > .8 || (!s.room.playing && Math.abs(drift) > .12)) v.currentTime = target;
      v.playbackRate = s.room.playing && Math.abs(drift) > .18 && Math.abs(drift) <= .8 ? (drift > 0 ? 1.03 : .97) : 1;
      if (s.room.playing && v.paused && !v.ended && !autoplayBlocked.current) v.play().catch(() => {
        if (alive) { autoplayBlocked.current = true; setBlocked(true); }
      });
      if (!s.room.playing && !v.paused) v.pause();
    };
    sync(); const id = setInterval(sync, 350); return () => { alive = false; clearInterval(id); };
  }, []);
  function unlock() {
    const v = video.current; if (!v) return;
    autoplayBlocked.current = false;
    setReady(true); setBlocked(false);
    const position = Math.min(playbackPosition(room, Date.now() + offset), Number.isFinite(v.duration) ? Math.max(0, v.duration - .03) : Infinity);
    if (v.readyState >= 1) v.currentTime = position;
    if (isHost && !room.playing) { void control(true, position); return; }
    v.play().then(() => { if (!stateRef.current.room.playing) v.pause(); }).catch(() => { autoplayBlocked.current = true; setBlocked(true); });
  }
  async function control(playing: boolean, position = video.current?.currentTime || 0) {
    if (!isHost || busy || !connected || playerError || !video.current) return;
    autoplayBlocked.current = false;
    setReady(true); setBlocked(false);
    if (playing && !room.playing && Number.isFinite(video.current.duration) && position >= video.current.duration - .25) {
      position = 0; video.current.currentTime = 0;
    }
    if (playing) void video.current.play().catch(() => { autoplayBlocked.current = true; setBlocked(true); }); else video.current.pause();
    await onControl(playing, position);
  }
  async function seek(value: number) { scrubbing.current = false; setScrub(null); if (video.current) video.current.currentTime = value; await control(room.playing, value); }
  return <div className="player" ref={shell}>
    <div className="video-stage"><video ref={video} playsInline preload="metadata" poster={room.poster || undefined} onLoadedMetadata={() => setDuration(video.current?.duration || 0)} onDurationChange={() => setDuration(video.current?.duration || 0)} onTimeUpdate={() => setTime(video.current?.currentTime || 0)} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)} onEnded={() => { if (isHost && !busy) void onControl(false, video.current?.duration || time); }} aria-label={room.videoTitle}/>
    {!ready && !playerError && <div className="player-overlay"><h3>{room.videoTitle}</h3>
      <button className="button primary" disabled={isHost && (!connected || busy)} onClick={unlock}><Play size={18} fill="currentColor"/>{isHost && !room.playing ? "Запустить для всех" : "Войти в просмотр"}</button></div>}
    {ready && blocked && !playerError && <div className="player-overlay"><button className="button primary" onClick={unlock}><Play size={18}/>Разрешить воспроизведение</button></div>}
    {ready && buffering && !playerError && !blocked && <span className="buffering"><Spinner/>Загрузка видео</span>}
    {playerError && <div className="player-overlay player-error" role="alert"><AlertCircle size={29}/><h3>{sourceError ? "Нужна прямая ссылка на видео" : "Видео не открылось"}</h3><p>{playerError}</p>{isHost ? <button className="button primary" onClick={onChangeVideo}>Заменить ссылку</button> : <p>Попросите ведущего заменить ссылку.</p>}{!sourceError && <button className="button subtle" onClick={() => setRetry(r => r + 1)}><RefreshCw size={16}/>Попробовать снова</button>}</div>}
    {!connected && <div className="player-top" role="status"><span><i className="amber-dot"/>Восстанавливаем связь</span></div>}</div>
    <div className="player-controls">
      <button className="icon-button play-toggle" disabled={!isHost || busy || !connected || !!playerError} title={isHost ? undefined : "Воспроизведением управляет ведущий"}
        aria-label={room.playing ? "Пауза для всех" : atEnd ? "Смотреть сначала" : "Запустить для всех"} onClick={() => void control(!room.playing)}>
        {busy ? <Spinner/> : room.playing ? <Pause size={20} fill="currentColor"/> : atEnd ? <RotateCcw size={19}/> : <Play size={19} fill="currentColor"/>}
      </button>
      <span className="video-time">{formatTime(scrub ?? time)} <i>/</i> {formatTime(duration)}</span>
      <input className="timeline" type="range" aria-label="Позиция воспроизведения" min={0} max={Number.isFinite(duration) ? duration : 0} step={.1}
        value={scrub ?? Math.min(time, Number.isFinite(duration) ? duration : time)}
        disabled={!isHost || !ready || busy || !connected || !duration || !Number.isFinite(duration)}
        onPointerDown={() => { scrubbing.current = true; }} onChange={e => setScrub(Number(e.target.value))}
        onPointerUp={e => void seek(Number(e.currentTarget.value))} onPointerCancel={() => { scrubbing.current = false; setScrub(null); }}
        onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void seek(Number(e.currentTarget.value)); }}
        style={{ "--progress": `${duration ? (scrub ?? time) / duration * 100 : 0}%` } as React.CSSProperties}/>
      <button className="icon-button" aria-label={muted ? "Включить звук" : "Выключить звук"} onClick={() => setMuted(!muted)}>
        {muted || volume === 0 ? <VolumeX size={19}/> : <Volume2 size={19}/>}
      </button>
      <button className="icon-button" aria-label="Полноэкранный режим" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void shell.current?.requestFullscreen().catch(() => setError("Полноэкранный режим недоступен в этом браузере."));
      }}><Maximize size={18}/></button>
      <details className="play-options">
        <summary aria-label="Настройки плеера"><Ellipsis size={18}/></summary>
        <div className="play-menu">
          <label>Громкость<input aria-label="Громкость" className="volume-range" type="range" min="0" max="1" step=".05" value={muted ? 0 : volume} onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}/></label>
          {isHost && <div>
            <button aria-label="Назад на 10 секунд" disabled={!ready || busy || !connected || !!playerError} onClick={() => void seek(Math.max(0,time-10))}>−10 сек</button>
            <button aria-label="Вперёд на 10 секунд" disabled={!ready || busy || !connected || !!playerError} onClick={() => void seek(Math.min(duration || time+10,time+10))}>+10 сек</button>
          </div>}
        </div>
      </details>
      {viewControl}
    </div>
  </div>;
}
