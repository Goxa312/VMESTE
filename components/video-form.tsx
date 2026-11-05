"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { api, libraryKey, readLocal, rememberRoom, saveLocal } from "@/lib/client";
import { demos, kinds, type Kind, type Snapshot, type Video } from "@/lib/shared";
import { videoUrlError } from "@/lib/video-source";
import { Modal, Spinner } from "./ui";
export function VideoForm({ mode, selected, onClose, onSaved, onChangeVideo }: { mode: "create" | "add" | "change"; selected?: Video; onClose: () => void; onSaved?: (v: Video) => void; onChangeVideo?: (v: Partial<Video>) => Promise<void> }) {
  const [name, setName] = useState(() => typeof window !== "undefined" ? readLocal("vm-name", "") : "");
  const [title, setTitle] = useState(selected?.title || ""), [url, setUrl] = useState(selected?.url || ""), [kind, setKind] = useState<Kind>(selected?.kind || "film"), [roomTitle, setRoomTitle] = useState("Киновечер с друзьями");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault();
    const urlError = videoUrlError(url);
    if (urlError) { setError(urlError); return; }
    setBusy(true); setError("");
    try {
      const v = { title, url, kind, poster: selected?.url === url ? selected.poster : demos.find(d => d.url === url)?.poster || "" };
      if (mode === "create") {
        const result = await api<Snapshot & { token: string }>("/api/rooms", undefined, { ...v, name, roomTitle });
        saveLocal("vm-name", name); rememberRoom(result); window.location.href = `/room/${result.room.id}`;
      } else if (mode === "add") { const result = await api<{ video: Video }>("/api/library", libraryKey(), v); onSaved?.(result.video); onClose(); }
      else { await onChangeVideo?.(v); onClose(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить"); setBusy(false); }
  }
  return <Modal title={mode === "create" ? "Ваш личный кинозал" : mode === "add" ? "Добавить в библиотеку" : "Что смотрим дальше?"} caption={mode === "create" ? "Выберите видео и отправьте друзьям приглашение." : "Вставьте ссылку на фильм с kinogo.my или на MP4, WebM, HLS."} onClose={onClose}>
    <form onSubmit={submit} className="stack-form">
      {mode === "create" && <div className="form-row"><label>Ваше имя<input autoFocus required maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="Как вас зовут?" /></label><label>Название комнаты<input required maxLength={80} value={roomTitle} onChange={e => setRoomTitle(e.target.value)} /></label></div>}
      <label>Название видео<input autoFocus={mode !== "create"} required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, любимый фильм" /></label>
      <label>Ссылка на видео или страницу Киного<div className="input-icon"><Link2 size={17}/><input type="url" required maxLength={4000} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/movie.mp4" /></div></label>
      <p className="field-hint">Прямое видео откроется в комнате. Для страницы Киного ведущий сможет подключить видеопоток кнопкой «Смотреть в комнате».</p>
      <label>Раздел<select value={kind} onChange={e => setKind(e.target.value as Kind)}>{Object.entries(kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {(mode === "change" || (!selected && mode === "create")) && <button className="demo-pick" type="button" disabled={busy} onClick={() => { setTitle(demos[0].title); setUrl(demos[0].url); setKind("film"); setError(""); }}>Нет ссылки под рукой? <span>Включить демофильм →</span></button>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? <Spinner/> : <>{mode === "create" ? "Создать комнату" : mode === "add" ? "Сохранить видео" : "Сменить видео"}<ArrowRight size={18}/></>}</button>
      {mode === "create" && <p className="form-foot">До 12 человек · Комната доступна 7 дней</p>}
      {mode === "add" && <p className="form-foot">Доступ к библиотеке привязан к этому браузеру.</p>}
    </form>
  </Modal>;
}
