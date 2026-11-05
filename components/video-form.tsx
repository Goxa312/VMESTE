"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, FileVideo, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { holdFilm } from "@/lib/local-film";
import { api, libraryKey, readLocal, rememberRoom, saveLocal } from "@/lib/client";
import { demos, kinds, type Kind, type Snapshot, type Video } from "@/lib/shared";
import { directSourceError, linkMode, videoUrlError } from "@/lib/video-source";
import { fileSize, videoMime } from "@/lib/upload-format";
import { uploadFilm, type UploadTarget } from "@/lib/upload-client";
import { Modal, Spinner } from "./ui";

type Tab = "link" | "file";
type Props = { mode: "create" | "add" | "change"; selected?: Video; initialTab?: Tab; initialUrl?: string; uploadTarget?: UploadTarget;
  onClose: () => void; onSaved?: (v: Video) => void; onFileRoom?: () => void; onChangeVideo?: (v: Partial<Video>) => Promise<void> };
export function VideoForm({ mode, selected, initialTab, initialUrl, uploadTarget, onClose, onSaved, onChangeVideo, onFileRoom }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab || ((selected?.sourceMode === "upload" || selected?.sourceMode === "local") ? "file" : "link"));
  const [name, setName] = useState(() => typeof window !== "undefined" ? readLocal("vm-name", "") : "");
  const [title, setTitle] = useState(selected?.title || ""), [url, setUrl] = useState((selected?.sourceMode === "upload" || selected?.sourceMode === "local") ? "" : selected?.url || initialUrl || "");
  const [editSource, setEditSource] = useState(false);
  const hasInitialSource = Boolean(initialUrl?.trim() || selected?.url);
  const reviewSource = mode === "create" && tab === "link" && hasInitialSource && !editSource && !videoUrlError(url);
  const [kind, setKind] = useState<Kind>(selected?.kind || "film"), [roomTitle, setRoomTitle] = useState("Киновечер с друзьями");
  const [format, setFormat] = useState<"auto" | "direct" | "page">(selected?.sourceMode === "direct" || selected?.sourceMode === "page" ? selected.sourceMode : "auto");
  const [file, setFile] = useState<File>(), [limit, setLimit] = useState<number>(), [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null), created = useRef<UploadTarget | null>(null), picker = useRef<HTMLInputElement>(null);
  useEffect(() => { const controller = new AbortController();
    if (mode !== "add") void fetch("/api/media-options", { signal: controller.signal }).then(r => r.json() as Promise<{ maxSize: number }>).then(r => setLimit(r.maxSize)).catch(() => {});
    return () => { controller.abort(); abort.current?.abort(); };
  }, [mode]);
  const liveFile = !!file && !!limit && file.size > limit;
  function choose(file?: File) {
    if (!file) return;
    setError(""); setFile(undefined);
    if (!videoMime(file.name)) { setError("Выберите видео в формате MP4, WebM или MOV."); return; }
    setFile(file); if (!selected || selected.url || !title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 100));
  }
  function close() { abort.current?.abort(); onClose(); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const sourceMode = tab === "file" ? liveFile ? "local" : "upload" : format === "auto" ? linkMode(url.trim()) : format;
    const invalid = tab === "file" ? !file ? "Выберите фильм с компьютера." : null :
      sourceMode === "direct" ? directSourceError(url.trim()) : videoUrlError(url.trim());
    if (invalid) { setError(invalid); return; }
    const videoTitle = title.trim() || (tab === "link" ? new URL(url).hostname : "Мой фильм");
    const poster = (selected && (!selected.url || (tab === "link" && selected.url === url.trim())) ? selected.poster : "") || (tab === "link" ? demos.find(d => d.url === url.trim())?.poster : "") || "";
    const video = { title: videoTitle, url: tab === "file" ? "" : url.trim(), kind, sourceMode, poster } as const;
    setBusy(true); setError(""); const controller = new AbortController(); abort.current = controller;
    try {
      const reusingRoom = !!created.current;
      let target = uploadTarget || created.current;
      if (mode === "create" && !created.current) {
        const result = await api<Snapshot & { token: string }>("/api/rooms", undefined, { ...video, name, roomTitle });
        saveLocal("vm-name", name); rememberRoom(result);
        target = created.current = { code: result.room.id, token: result.token, revision: result.room.revision };
      }
      if (liveFile && tab === "file" && file && target) {
        holdFilm(target.code, file);
        if (mode === "change") await onChangeVideo?.(video);
        else if (reusingRoom) await api(`/api/rooms/${target.code}/actions`, target.token, { ...video, action: "video", revision: target.revision });
      } else if (tab === "file" && file && target) {
        setProgress(0); await uploadFilm(target, file, videoTitle, controller.signal, setProgress);
      } else if (mode === "add") {
        const result = await api<{ video: Video }>("/api/library", libraryKey(), video); onSaved?.(result.video);
      } else if (mode === "change") await onChangeVideo?.(video);
      else if (mode === "create" && reusingRoom && !controller.signal.aborted && target) {
        await api(`/api/rooms/${target.code}/actions`, target.token, { ...video, action: "video", revision: target.revision });
      }
      if (controller.signal.aborted) return;
      if (mode === "create" && target) { if (liveFile) router.push("/room/" + target.code); else window.location.assign("/room/" + target.code); } else onClose();
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Не удалось сохранить фильм."); }
    finally { if (!controller.signal.aborted) { setBusy(false); setProgress(null); } }
  }
  const needsFilm = mode === "create" && selected && !selected.url;
  return <Modal title={needsFilm ? selected.title : mode === "create" ? "Новая комната" : mode === "add" ? "Добавить в библиотеку" : "Выбрать фильм"} caption={needsFilm ? "Добавьте ссылку на этот фильм или выберите видео с компьютера. Затем пригласите друзей в комнату." : mode === "add" ? "Сохраните ссылку, чтобы вернуться к фильму позже." : mode === "change" ? "Новый фильм появится у всех в этой комнате." : "После создания комнаты вы получите ссылку для друзей."} onClose={close}>
    <form onSubmit={submit} className="stack-form source-form">
      {mode !== "add" && !reviewSource && <div className="source-tabs" role="group" aria-label="Источник фильма">
        <button type="button" aria-pressed={tab === "link"} disabled={busy} onClick={() => { setTab("link"); setError(""); }}>По ссылке</button>
        <button type="button" aria-pressed={tab === "file"} disabled={busy} onClick={() => { setTab("file"); setError(""); }}>С компьютера</button></div>}
      {reviewSource ? <div className="source-review">
        <div><small>Источник фильма</small><strong>{selected?.url === url ? selected.title : new URL(url).hostname}</strong></div>
        <button type="button" className="text-link" disabled={busy} onClick={() => setEditSource(true)}>Изменить</button>
      </div> : tab === "link" ? <><label>Ссылка на фильм<input type="url" required maxLength={4000} value={url} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
        <p className="field-hint">{url && linkMode(url) === "direct" ? "Этот адрес откроется в общем плеере." : "Прямая ссылка откроется в плеере. Страницу с фильмом можно показать из вкладки."}</p></> :
        <><input className="visually-hidden" type="file" ref={picker} accept=".mp4,.m4v,.webm,.mov" aria-label="Выбрать видеофайл" tabIndex={-1} onChange={e => choose(e.target.files?.[0])}/>
        <button type="button" disabled={busy} className={`file-drop ${dragging ? "dragging" : ""}`} onClick={() => picker.current?.click()}
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) choose(e.dataTransfer.files[0]); }}>
          {file ? <FileVideo size={22} aria-hidden="true"/> : <FolderOpen size={22} aria-hidden="true"/>}<span className="file-description"><strong>{file ? file.name : "Выбрать файл"}</strong><small>{file ? `${fileSize(file.size)} · Нажмите, чтобы заменить` : "Или перетащите видео сюда"}</small></span></button>
        {!file && <p className="field-hint file-formats">MP4, WebM, MOV{limit ? ` · загрузка до ${fileSize(limit)}, более крупные файлы — из браузера` : ""}</p>}
        {liveFile && limit && <p className="field-hint" role="status">Файл больше лимита загрузки ({fileSize(limit)}). Вы можете показать его из своего браузера. Оставьте комнату открытой до конца просмотра.</p>}
        {progress !== null && <div className="upload-progress" role="status"><progress max={100} value={progress}/><span>Загружено {progress}%</span></div>}</>}
      <div className={mode === "create" ? "form-row" : ""}>{mode === "create" && <label>Ваше имя<input autoFocus={reviewSource} required disabled={busy} maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="Как к вам обращаться?"/></label>}
        {!reviewSource && <label>Название фильма<input disabled={busy} maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Можно оставить пустым"/></label>}</div>
      <details className="form-options"><summary>{mode === "create" ? "Настройки комнаты и фильма" : "Настройки фильма"} <ChevronDown size={15}/></summary>
        {reviewSource && <label>Название фильма<input maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Можно оставить пустым"/></label>}
        {mode === "create" && <label>Название комнаты<input maxLength={80} value={roomTitle} onChange={e => setRoomTitle(e.target.value)}/></label>}
        {tab === "link" && <label>Как открыть ссылку<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="auto">Определить автоматически</option><option value="direct">Прямой адрес видео</option><option value="page">Показ вкладки с сайтом</option></select></label>}
        <label>Раздел<select value={kind} onChange={e => setKind(e.target.value as Kind)}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></details>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy || (tab === "file" && !file)}>{busy ? <Spinner/> : <>{mode === "add" ? "Сохранить ссылку" : tab === "file" ? liveFile ? "Показать файл из браузера" : "Загрузить фильм" : mode === "create" ? "Создать комнату" : "Сменить фильм"}</>}</button>
      {busy && tab === "file" && <button className="text-button" type="button" onClick={close}>Отменить загрузку</button>}
      {mode === "add" && onFileRoom && <button type="button" className="text-button" onClick={onFileRoom}><FolderOpen size={16}/>Загрузить файл в комнату</button>}
    </form></Modal>;
}
