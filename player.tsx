"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, RotateCw, RefreshCw, AlertCircle, Radio } from "lucide-react";
import { formatTime, playbackPosition, type RoomState } from "@/lib/shared";
import { videoUrlError } from "@/lib/video-source";
import { Spinner } from "./ui";
export function Player({ room, isHost, offset, busy, connected, onControl, onChangeVideo }: { room: RoomState; isHost: boolean; offset: number; busy: boolean; connected: boolean; onControl: (playing: boolean, position: number) => Promise<void>; onChangeVideo: () => void }) {
  const video = useRef<HTMLVideoElement>(null), shell = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false), [duration, setDuration] = useState(0), [time, setTime] = useState(0), [volume, setVolume] = useState(.8), [muted, setMuted] = useState(false), [error, setError] = useState(""), [buffering, setBuffering] = useState(false), [retry, setRetry] = useState(0), [blocked, setBlocked] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); const scrubbing = useRef(false);
  const sourceError = videoUrlError(room.videoUrl), playerError = sourceError || error;
  const stateRef = useRef({ room, offset, ready, busy }); stateRef.current = { room, offset, ready, busy };
  useEffect(() => {
    const v = video.current!; let hls: Hls | undefined;
    setError(""); setDuration(0); setTime(0); setBuffering(false);
    if (sourceError) return;
    const url = new URL(room.videoUrl);
    if (/\.m3u8$/i.test(url.pathname)) {
      if (v.canPlayType("application/vnd.apple.mpegurl")) v.src = room.videoUrl;
      else if (Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 30 }); hls.loadSource(room.videoUrl); hls.attachMedia(v);
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError("Не удалось открыть HLS. Проверьте ссылку и разрешение CORS на стороне источника."); });
      } else setError("Этот браузер не поддерживает HLS. Откройте комнату в современном браузере.");
    } else v.src = room.videoUrl;
    v.load();
    return () => { hls?.destroy(); v.pause(); v.removeAttribute("src"); v.load(); };
  }, [room.videoUrl, retry, sourceError]);
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
      if (s.room.playing && v.paused && !v.ended) v.play().then(() => { if (alive) setBlocked(false); }).catch(() => { if (alive) setBlocked(true); });
      if (!s.room.playing && !v.paused) v.pause();
    };
    sync(); const id = setInterval(sync, 350); return () => { alive = false; clearInterval(id); };
  }, []);
  function unlock() {
    const v = video.current; if (!v) return;
    setReady(true); setBlocked(false);
    if (v.readyState >= 1) v.currentTime = Math.min(playbackPosition(room, Date.now() + offset), Number.isFinite(v.duration) ? Math.max(0, v.duration - .03) : Infinity);
    v.play().then(() => { if (!stateRef.current.room.playing) v.pause(); }).catch(() => setBlocked(true));
  }
  async function control(playing: boolean, position = video.current?.currentTime || 0) {
    if (!isHost || busy || !connected || playerError || !video.current) return;
    setReady(true); setBlocked(false);
    if (playing) void video.current.play().catch(() => setBlocked(true)); else video.current.pause();
    await onControl(playing, position);
  }
  async function seek(value: number) { scrubbing.current = false; setScrub(null); if (video.current) video.current.currentTime = value; await control(room.playing, value); }
  return <div className="player" ref={shell}>
    <div className="video-stage"><video ref={video} playsInline preload="metadata" poster={room.poster || "/images/hero.jpg"} onLoadedMetadata={() => setDuration(video.current?.duration || 0)} onDurationChange={() => setDuration(video.current?.duration || 0)} onTimeUpdate={() => setTime(video.current?.currentTime || 0)} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)} onError={() => setError("Видео недоступно. Проверьте, что ссылка открывает видеофайл без авторизации и что браузер поддерживает его формат.")} onEnded={() => { if (isHost && !busy) void onControl(false, video.current?.duration || time); }} aria-label={room.videoTitle}/>
    {!ready && !playerError && <div className="player-overlay"><button className="enter-play" aria-label="Войти в просмотр со звуком" onClick={unlock}><Play size={29} fill="currentColor"/></button><h3>Ваш киновечер начинается</h3><p>Нажмите, чтобы войти в просмотр со звуком</p><button className="button primary" onClick={unlock}>Войти в просмотр</button></div>}
    {ready && blocked && !playerError && <div className="player-overlay"><button className="button primary" onClick={unlock}><Play size={18}/>Разрешить воспроизведение</button></div>}
    {ready && buffering && !playerError && !blocked && <span className="buffering"><Spinner/>Загрузка видео</span>}
    {playerError && <div className="player-overlay player-error" role="alert"><AlertCircle size={29}/><h3>{sourceError ? "Нужна прямая ссылка на видео" : "Видео не открылось"}</h3><p>{playerError}</p>{isHost ? <button className="button primary" onClick={onChangeVideo}>Заменить ссылку</button> : <p>Попросите ведущего заменить ссылку.</p>}{!sourceError && <button className="button subtle" onClick={() => setRetry(r => r + 1)}><RefreshCw size={16}/>Попробовать снова</button>}</div>}
    <div className="player-top"><span><span className={connected ? "green-dot" : "amber-dot"}/>{connected ? "В одной комнате" : "Восстанавливаем связь"}</span><span className="video-format">{room.videoUrl.includes(".m3u8") ? "HLS" : "VIDEO"}</span></div></div>
    <div className="player-controls"><input className="timeline" type="range" aria-label="Позиция воспроизведения" min={0} max={Number.isFinite(duration) ? duration : 0} step={.1} value={scrub ?? Math.min(time, Number.isFinite(duration) ? duration : time)} disabled={!isHost || !ready || busy || !connected || !duration || !Number.isFinite(duration)} onPointerDown={() => { scrubbing.current = true; }} onChange={e => setScrub(Number(e.target.value))} onPointerUp={e => void seek(Number(e.currentTarget.value))} onPointerCancel={() => { scrubbing.current = false; setScrub(null); }} onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void seek(Number(e.currentTarget.value)); }} style={{ "--progress": `${duration ? (scrub ?? time) / duration * 100 : 0}%` } as React.CSSProperties}/>
    <div className="controls-row"><button className="icon-button play-toggle" disabled={!isHost || busy || !connected || !!playerError} title={isHost ? undefined : "Воспроизведением управляет ведущий"} aria-label={room.playing ? "Пауза для всех" : "Запустить для всех"} onClick={() => void control(!room.playing)}>{busy ? <Spinner/> : room.playing ? <Pause size={21} fill="currentColor"/> : <Play size={21} fill="currentColor"/>}</button><button className="icon-button skip" aria-label="Назад на 10 секунд" disabled={!isHost || !ready || busy || !connected || !!playerError} onClick={() => void seek(Math.max(0, time - 10))}><RotateCcw size={18}/><small>10</small></button><button className="icon-button skip" aria-label="Вперёд на 10 секунд" disabled={!isHost || !ready || busy || !connected || !!playerError} onClick={() => void seek(Math.min(duration || time + 10, time + 10))}><RotateCw size={18}/><small>10</small></button><span className="video-time">{formatTime(scrub ?? time)}<i>/</i>{formatTime(duration)}</span><div className="control-spacer"/><span className="host-control-label"><Radio size={14}/>{isHost ? "Вы управляете просмотром" : "Управляет ведущий"}</span><button className="icon-button" aria-label={muted ? "Включить звук" : "Выключить звук"} onClick={() => setMuted(!muted)}>{muted || volume === 0 ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button><input aria-label="Громкость" className="volume-range" type="range" min="0" max="1" step=".05" value={muted ? 0 : volume} onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}/><button className="icon-button" aria-label="Полноэкранный режим" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void shell.current?.requestFullscreen().catch(() => setError("Полноэкранный режим недоступен в этом браузере.")); }}><Maximize size={19}/></button></div></div>
  </div>;
}
