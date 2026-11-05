"use client";
import { useEffect, useRef, useState } from "react";
import { extensionRequest, needsExtensionUpdate } from "@/lib/kinogo-bridge";
import { attachRoomMedia } from "@/lib/media-playback";
import { formatTime, playbackPosition, type RoomState } from "@/lib/shared";
import { directSourceError, isKinogoPage, mediaFormat, type DirectSource } from "@/lib/video-source";
import { Modal, Spinner } from "./ui";

function Preview({ source, onReady, onTryAnother }: { source: DirectSource; onReady: (ready: boolean) => void; onTryAnother?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Загружаем первый кадр…");
  const [failed, setFailed] = useState(false), [slow, setSlow] = useState(false);
  useEffect(() => {
    const element = video.current!;
    let terminal = false, verified = false;
    setMessage("Загружаем первый кадр…");
    setFailed(false); setSlow(false);
    onReady(false);
    function reportFailure(text: string) {
      terminal = true;
      clearTimeout(timer);
      setFailed(true); setSlow(false);
      onReady(false);
      setMessage(text);
    }
    function check() {
      if (terminal || element.error || element.readyState < 2) return;
      if (!element.videoWidth || !element.videoHeight || !Number.isFinite(element.duration) || element.duration <= 0) {
        verified = false;
        onReady(false);
        setMessage("Ждём видеокадр и длительность фильма…");
        return;
      }
      verified = true;
      clearTimeout(timer);
      setSlow(false);
      onReady(true);
      setMessage(`Видео открылось · ${formatTime(element.duration)}. Проверьте фильм и озвучку.`);
    }
    const timer = setTimeout(() => setSlow(true), 15000);
    element.addEventListener("loadeddata", check);
    element.addEventListener("canplay", check);
    element.addEventListener("durationchange", check);
    element.addEventListener("resize", check);
    const detach = attachRoomMedia(element, source, reportFailure, text => {
      if (!terminal && !verified) setMessage(text);
    });
    return () => {
      clearTimeout(timer);
      element.removeEventListener("loadeddata", check);
      element.removeEventListener("canplay", check);
      element.removeEventListener("durationchange", check);
      element.removeEventListener("resize", check);
      detach();
    };
  }, [source, onReady]);
  return <div className="source-preview"><video ref={video} controls playsInline preload="auto" aria-label="Проверка фильма"/>
    <p role="status">{message}{slow && " Загрузка занимает больше обычного."}</p>
    {(failed || slow) && onTryAnother && <button type="button" className="button subtle" onClick={onTryAnother}>Проверить другой найденный поток</button>}
  </div>;
}

type Props = {
  room: RoomState; offset: number; connected: boolean; onClose: () => void;
  onApply: (source: DirectSource | null) => Promise<void>;
};
export function RoomSourceDialog({ room, offset, connected, onClose, onApply }: Props) {
  const [url, setUrl] = useState(room.nativeSource?.url || "");
  const [format, setFormat] = useState<"auto" | DirectSource["format"]>(room.nativeSource?.format || "auto");
  const [preview, setPreview] = useState<DirectSource | null>(null);
  const [ready, setReady] = useState(false), [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(""), [candidates, setCandidates] = useState<DirectSource[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function check(source: DirectSource) {
    setReady(false); setNotice("");
    const error = directSourceError(source.url);
    if (error) { setPreview(null); setNotice(error); return; }
    setPreview(source);
  }
  function select(source: DirectSource) {
    setUrl(source.url); setFormat(source.format); check(source);
  }
  async function importFilm() {
    if (working) return;
    setWorking(true); setNotice(""); setCandidates([]); setPreview(null); setReady(false);
    try {
      const status = await extensionRequest("ping");
      if (!alive.current) return;
      if (needsExtensionUpdate(status.version, "0.4.0")) throw new Error("Для получения ссылки из Киного обновите расширение ведущего до версии 0.4.0 или новее.");
      if (!status.hasPlayer) {
        const now = Date.now();
        await extensionRequest("connect", { roomId: room.id, sourceUrl: room.videoUrl, isHost: true, connected,
          playing: room.playing, position: playbackPosition(room, now + offset), revision: room.revision, sampledAt: now }, 10000);
        if (alive.current) setNotice("Запустите фильм на Киного. Когда появится «Вместе · ведущий», вернитесь сюда и снова нажмите «Взять из Киного».");
        return;
      }
      const result = await extensionRequest("media-sources", { sourceUrl: room.videoUrl }, 4500);
      if (!alive.current) return;
      const found = (result.candidates || []).filter(item => ["hls", "file"].includes(item.format) && !directSourceError(item.url));
      if (!found.length) throw new Error(result.error || "Плеер не предоставил прямую ссылку. Вставьте адрес файла или плейлиста вручную.");
      if (found.length === 1) select(found[0]);
      else { setCandidates(found); setNotice("Найдено несколько потоков. Выберите нужный и проверьте его."); }
    } catch (error) {
      if (alive.current) setNotice(error instanceof Error ? error.message : "Не удалось получить адрес видео.");
    } finally { if (alive.current) setWorking(false); }
  }
  async function apply(source: DirectSource | null) {
    if (working || (source && !ready)) return;
    setWorking(true); setNotice("");
    try { await onApply(source); if (alive.current) onClose(); }
    catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : "Не удалось сменить плеер."); }
    finally { if (alive.current) setWorking(false); }
  }
  const previewIndex = candidates.findIndex(item => item.url === preview?.url);
  const nextCandidate = candidates.length > 1 && previewIndex >= 0 ? candidates[(previewIndex + 1) % candidates.length] : undefined;
  return <Modal title="Смотреть в комнате" caption="Проверьте кадр фильма перед тем, как включить общий плеер." onClose={onClose}>
    <div className="stack-form">
      {!room.nativeSource && isKinogoPage(room.videoUrl) && <div className="source-import"><button className="button subtle" disabled={working || !connected} onClick={() => void importFilm()}>Взять из Киного</button>
        <small>Использует запущенный фильм и <a href="/kinogo-extension" target="_blank" rel="noreferrer">расширение ведущего</a>. Прямую ссылку можно вставить ниже.</small></div>}
      {candidates.length > 1 && <label>Найденные потоки<select value={candidates.findIndex(x => x.url === url)} onChange={e => { const item = candidates[Number(e.target.value)]; if (item) select(item); }}>
        <option value={-1}>Выберите поток</option>{candidates.map((item, index) => <option key={item.url} value={index}>{index + 1}. {item.format === "hls" ? "HLS" : "Видео"} · {new URL(item.url).hostname} · {new URL(item.url).pathname.split("/").pop()?.slice(0, 48)}</option>)}</select></label>}
      <label>Прямая ссылка на видео<input type="url" disabled={working} value={url} maxLength={4000} placeholder="https://…/film.mp4 или playlist.m3u8" onChange={e => {
        setUrl(e.target.value); setPreview(null); setReady(false); setNotice("");
      }}/></label>
      <label>Формат<select disabled={working} value={format} onChange={e => { setFormat(e.target.value as typeof format); setPreview(null); setReady(false); }}>
        <option value="auto">Определить по ссылке</option><option value="file">Видеофайл (MP4, WebM)</option><option value="hls">Плейлист HLS</option></select></label>
      <button className="button subtle" disabled={working || !url.trim()} onClick={() => check({ url: url.trim(), format: format === "auto" ? mediaFormat(url.trim()) : format })}>Проверить видео</button>
      {preview && <Preview key={preview.format + preview.url} source={preview} onReady={setReady}
        onTryAnother={nextCandidate ? () => select(nextCandidate) : undefined}/>}
      {notice && <p className="source-notice" role="status">{notice}</p>}
      <button className="button primary full" disabled={!ready || !preview || working || !connected} onClick={() => void apply(preview)}>{working ? <Spinner/> : "Открыть для всех"}</button>
      {room.nativeSource && <button className="text-button" disabled={working || !connected} onClick={() => void apply(null)}>Вернуться к показу страницы</button>}
    </div>
  </Modal>;
}
