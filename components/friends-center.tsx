"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Link2, UserRound, UserRoundPlus } from "lucide-react";
import { api } from "@/lib/client";
import type { Friend, FriendsView, RoomInvite } from "@/lib/friends";
import { useLanguage } from "./language";
import { Modal, Spinner } from "./ui";

type Props = {
  open: boolean; onOpen: () => void; onClose: () => void;
  room?: string; copyLink?: () => void; copied?: boolean;
};
const endpoint = "/api/account/friends";

function PersonRow({person, children}: {person: Friend; children: ReactNode}) {
  return <li className="friend-row">
    <span className="friend-initial" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
    <span className="friend-name">{person.name}</span><div className="friend-actions">{children}</div>
  </li>;
}

export function FriendsCenter({open, onOpen, onClose, room, copyLink, copied}: Props) {
  const {t, notice} = useLanguage();
  const router = useRouter();
  const url = open ? endpoint + (room ? "?room=" + encodeURIComponent(room) : "") : endpoint + "?inbox=1";
  const [snapshot, setSnapshot] = useState<{url:string; data:FriendsView}>();
  const [loadError, setLoadError] = useState(""), [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState(""), [login, setLogin] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const reading = useRef<AbortController | null>(null), writing = useRef(false);
  const refresh = useCallback(async (force = false) => {
    if (reading.current && !force) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    try {
      const data = await api<FriendsView>(url, undefined, undefined, "GET", controller.signal);
      if (!controller.signal.aborted) { setSnapshot({url, data}); setLoadError(""); }
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить друзей.");
    } finally { if (reading.current === controller) reading.current = null; }
  }, [url]);
  useEffect(() => {
    const update = () => { if (!document.hidden && !writing.current) void refresh(); };
    const changed = (e: StorageEvent) => { if (e.key === "tt-friends-change") update(); };
    update();
    const timer = window.setInterval(update, 10000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update); window.addEventListener("pageshow", update); window.addEventListener("storage", changed);
    return () => {
      clearInterval(timer); reading.current?.abort(); reading.current = null;
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); window.removeEventListener("storage", changed);
    };
  }, [refresh]);

  const data = snapshot?.data;
  const incoming = data?.people.filter(p => p.state === "incoming") ?? [];
  const friends = data?.people.filter(p => p.state === "friend") ?? [];
  const outgoing = data?.people.filter(p => p.state === "outgoing") ?? [];
  const invitations = data?.invitations ?? [];
  const firstInvite = invitations[0], firstRequest = incoming[0];

  async function perform(action: string, fields: Record<string, string>) {
    if (writing.current) return;
    writing.current = true; setBusy(true); reading.current?.abort(); setActionError(""); setFeedback("");
    let navigating = false;
    try {
      if (action === "join") {
        await api("/api/rooms/" + fields.room, undefined, { invitationId: fields.id });
        navigating = fields.room !== room;
        onClose(); router.push("/room/" + fields.room);
        return;
      }
      const result = await api<{notice:string}>(endpoint, undefined, { action, ...fields });
      setFeedback(result.notice); setConfirm("");
      if (action === "request") setLogin("");
      try { localStorage.setItem("tt-friends-change", crypto.randomUUID()); } catch { /* Polling also updates other tabs. */ }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось выполнить запрос");
    } finally {
      writing.current = false; setBusy(false); if (!navigating) await refresh(true);
    }
  }
  function request(e: FormEvent) { e.preventDefault(); void perform("request", {login}); }
  function close() { setConfirm(""); setFeedback(""); setActionError(""); onClose(); }
  function join(invite: RoomInvite) { void perform("join", {id:invite.id, room:invite.room}); }

  if (!open) return <>
    {(firstInvite || firstRequest) && <aside className="friend-notice" aria-label={t("Уведомления друзей")}>
      <UserRoundPlus size={19} aria-hidden="true"/>
      <span>{firstInvite ? t("{0} приглашает в комнату «{1}»", firstInvite.sender, firstInvite.title) : t("{0} хочет добавить вас в друзья", firstRequest.name)}
        {firstInvite && firstInvite.film !== firstInvite.title && <small>{firstInvite.film}</small>}</span>
      {firstInvite && <button className="button outline" disabled={busy} onClick={() => join(firstInvite)}>{t("Войти в комнату")} <ArrowRight size={15}/></button>}
      <button className="text-link" disabled={busy} onClick={onOpen}>{firstInvite ? t("Все приглашения") : t("Посмотреть заявку")}</button>
    </aside>}
    {actionError && <p className="error" role="alert">{notice(actionError)}</p>}
  </>;

  return <Modal title={t(room ? "Пригласить друга" : "Друзья")} busy={busy} focusTitle onClose={close}>
    <div className="friends-panel">
      {loadError && <div className="notice" role="alert">{notice(loadError)}<button onClick={() => void refresh(true)}>{t("Повторить")}</button></div>}
      {actionError && <p className="error" role="alert">{notice(actionError)}</p>}
      {feedback && <p className="friend-feedback" role="status"><Check size={15}/>{notice(feedback)}</p>}
      {snapshot?.url !== url ? !loadError && <p className="loading-small"><Spinner/>{t("Загружаем список…")}</p> : <>
        {invitations.length > 0 && <section><h3>{t("Приглашения в комнату")}</h3>
          <ul>{invitations.map(i => <li className="friend-invite-row" key={i.id}>
            <div><strong>{i.title}</strong>{i.film !== i.title && <span>{i.film}</span>}<span>{t("Приглашает {0}", i.sender)}</span></div>
            <div className="friend-actions"><button className="button primary" disabled={busy} onClick={() => join(i)}>{t("Войти в комнату")}</button>
              <button className="text-button" disabled={busy} onClick={() => void perform("dismiss", {id:i.id})}>{t("Отклонить")}</button></div>
          </li>)}</ul></section>}
        {incoming.length > 0 && <section><h3>{t("Заявки в друзья")}</h3><ul>{incoming.map(p =>
          <PersonRow key={p.id} person={p}>
            <button className="button primary" disabled={busy} onClick={() => void perform("accept", {id:p.id})}>{t("Принять")}</button>
            <button className="text-button" disabled={busy} onClick={() => void perform("decline", {id:p.id})}>{t("Отклонить")}</button>
          </PersonRow>)}</ul></section>}
        <section><h3>{t("Мои друзья")} <span>{friends.length}</span></h3>
          {friends.length ? <ul>{friends.map(p => <PersonRow key={p.id} person={p}>
            {room ? <button className="button outline" disabled={busy || !!p.invited} onClick={() => void perform("invite", {id:p.id, room})}>
              {p.invited ? <><Check size={15}/>{t("Приглашён")}</> : t("Пригласить")}
            </button> : confirm === p.id ? <>
              <button className="text-button" disabled={busy} onClick={() => void perform("remove", {id:p.id})}>{t("Да, убрать")}</button>
              <button className="text-button" disabled={busy} onClick={() => setConfirm("")}>{t("Отмена")}</button>
            </> : <button className="text-button" disabled={busy} onClick={() => setConfirm(p.id)}>{t("Убрать из друзей")}</button>}
          </PersonRow>)}</ul> : <p className="friends-empty"><UserRound size={19}/>{t("Добавьте друга по логину, чтобы приглашать его в комнату.")}</p>}
        </section>
        <form className="stack-form friend-search" onSubmit={request}>
          <label>{t("Логин друга")}<input value={login} onChange={e => setLogin(e.target.value)} required maxLength={24} autoCapitalize="none" autoComplete="off" spellCheck={false}/></label>
          <button className="button outline" disabled={busy || !login.trim()}>{t("Отправить заявку")}</button>
        </form>
        {outgoing.length > 0 && <section><h3>{t("Отправленные заявки")}</h3><ul>{outgoing.map(p =>
          <PersonRow key={p.id} person={p}><button className="text-button" disabled={busy} onClick={() => void perform("cancel", {id:p.id})}>{t("Отозвать")}</button></PersonRow>)}</ul></section>}
      </>}
      {copyLink && <div className="friend-copy"><button className="text-button" onClick={copyLink}>{copied ? <Check size={16}/> : <Link2 size={16}/>}
        {t(copied ? "Ссылка скопирована" : "Скопировать ссылку")}</button></div>}
    </div>
  </Modal>;
}
