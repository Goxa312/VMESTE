"use client";
import { useEffect, useState } from "react";
import { api, readLocal, RequestError, type RecentRoom } from "@/lib/client";
import type { Snapshot } from "@/lib/shared";
import { Modal, Spinner } from "./ui";

export type Removal = "delete" | "leave" | "forget" | "gone";

export function RoomRemovalDialog({ room, signed, onClose, onRemoved }: {
  room: RecentRoom; signed: boolean; onClose: () => void; onRemoved: (result: Removal) => void;
}) {
  const path = "/api/rooms/" + room.id;
  const token = signed ? undefined : readLocal(`vm-room-${room.id}`, "");
  const [mode, setMode] = useState<Exclude<Removal,"gone"> | null>(
    !signed && !token ? "forget" : room.isHost === undefined ? null : room.isHost ? "delete" : "leave");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  // Guest histories saved before roles were recorded need one lookup before offering a destructive action.
  useEffect(() => {
    if (mode !== null) return;
    const controller = new AbortController();
    api<Snapshot>(path, token, undefined, "GET", controller.signal).then(data => {
      if (!controller.signal.aborted) setMode(data.me === data.room.hostId ? "delete" : "leave");
    }).catch(e => {
      if (controller.signal.aborted) return;
      if (!signed && e instanceof RequestError && [401,404,410].includes(e.status)) setMode("forget");
      else setError("Не удалось проверить доступ к комнате. Попробуйте ещё раз.");
    });
    return () => controller.abort();
  }, [mode, path, token, signed, attempt]);

  async function confirm() {
    if (busy || !mode) return;
    if (mode === "forget") { onRemoved(mode); return; }
    setError(""); setBusy(true);
    try { await api(path, token, { action:mode }, "DELETE"); onRemoved(mode); }
    catch (e) {
      if (e instanceof RequestError && [404,410].includes(e.status)) { onRemoved("gone"); return; }
      if (!signed && e instanceof RequestError && e.status === 401) { setMode("forget"); return; }
      setError(e instanceof Error ? e.message : "Не удалось изменить комнату. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  }
  const title = mode === "delete" ? "Удалить комнату для всех?" : mode ? "Убрать из моих комнат?" : "Проверяем комнату";
  return <Modal title={title} onClose={onClose} busy={busy}>
    <div className="room-removal">
      <div className="removal-summary"><strong>{room.title}</strong><span>{room.videoTitle} · {room.id}</span></div>
      {mode === "delete" ? <p>Просмотр завершится у всех участников. Приглашение перестанет работать, чат и загруженный фильм будут удалены.</p> :
        mode === "leave" ? <p>Комната исчезнет из вашего списка. Друзья смогут смотреть дальше, а вы — вернуться по приглашению.</p> :
        mode === "forget" ? <p>У этого браузера больше нет доступа к комнате. Можно убрать запись из списка на этом устройстве.</p> :
        !error && <p role="status"><Spinner/> Проверяем ваши права…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="removal-actions"><button type="button" autoFocus className="button outline" disabled={busy} onClick={onClose}>Отмена</button>
        {mode ? <button type="button" className={"button " + (mode === "delete" ? "delete-confirm" : "primary")} disabled={busy} onClick={()=>void confirm()}>
          {busy && <Spinner/>}{mode === "delete" ? "Удалить комнату" : "Убрать из списка"}</button> :
          error && <button type="button" className="button primary" onClick={()=>{setError("");setAttempt(n=>n+1);}}>Повторить</button>}</div>
    </div>
  </Modal>;
}
