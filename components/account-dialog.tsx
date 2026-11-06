"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { Modal, Spinner } from "./ui";

export function AccountDialog({ initial, onClose, onSuccess }: { initial: "login" | "register"; onClose:()=>void; onSuccess:()=>void }) {
  const [mode, setMode] = useState(initial), [login, setLogin] = useState(""), [password, setPassword] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const registering = mode === "register";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await api("/api/account", undefined, { action:mode, login, password }); onSuccess(); }
    catch (e) { setError(e instanceof Error ? e.message : "Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <Modal title={registering ? "Регистрация" : "Вход"} caption="Ваши комнаты и сохранённые фильмы на любом устройстве." onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <div className="source-tabs" role="group" aria-label="Доступ к профилю">{(["login","register"] as const).map(tab=>
        <button key={tab} type="button" aria-pressed={tab===mode} disabled={busy} onClick={()=>{setMode(tab);setPassword("");setError("");}}>{tab==="login"?"Вход":"Регистрация"}</button>)}</div>
      <label>Логин<input autoFocus required minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} disabled={busy} onChange={e=>setLogin(e.target.value)}/></label>
      {registering && <p className="field-hint">От 3 до 24 символов. Можно использовать русские буквы.</p>}
      <label>Пароль<input key={mode} required type="password" minLength={registering?10:1} maxLength={128} autoComplete={registering?"new-password":"current-password"} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
      {registering && <p className="field-hint">Не менее 10 символов.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy?<Spinner/>:registering?"Создать аккаунт":"Войти"}</button>
    </form></Modal>;
}
