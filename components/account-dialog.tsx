"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/client";
import { Modal, Spinner } from "./ui";

function PasswordField({ repeat = false, registering, value, onChange, onBlur, invalid, busy }: {
  repeat?: boolean; registering: boolean; value: string; onChange: (value: string) => void;
  onBlur?: () => void; invalid?: boolean; busy: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = repeat ? "account-password-repeat" : "account-password";
  const action = (visible ? "Скрыть " : "Показать ") + (repeat ? "повтор пароля" : "пароль");
  return <div className="auth-field">
    <label htmlFor={id}>{repeat ? "Повторите пароль" : "Пароль"}</label>
    <div className="password-entry">
      <input id={id} name={repeat ? "passwordConfirmation" : "password"} type={visible ? "text" : "password"}
        required minLength={registering && !repeat ? 10 : 1} maxLength={128} autoComplete={registering ? "new-password" : "current-password"}
        autoCapitalize="none" spellCheck={false} disabled={busy} value={value} onChange={e=>onChange(e.target.value)} onBlur={onBlur}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? "repeat-password-error" : registering && !repeat ? "password-hint" : undefined}/>
      <button type="button" className="password-eye" title={action} aria-label={action} aria-controls={id} aria-pressed={visible}
        disabled={busy} onClick={()=>setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
    </div>
    {registering && !repeat && <small id="password-hint">Не менее 10 символов.</small>}
    {invalid && <p className="field-error" id="repeat-password-error" role="alert">Пароли не совпадают.</p>}
  </div>;
}

export function AccountDialog({ initial, onClose, onSuccess }: { initial: "login" | "register"; onClose:()=>void; onSuccess:()=>void }) {
  const [mode, setMode] = useState(initial), [email, setEmail] = useState(""), [login, setLogin] = useState("");
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState(""), [checked, setChecked] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const registering = mode === "register";
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus({preventScroll:true}); }, [mode]);
  function switchMode(tab: typeof mode) {
    if (tab === mode) return;
    setMode(tab); setPassword(""); setRepeat(""); setChecked(false); setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (registering && repeat !== password) {
      setChecked(true); event.currentTarget.querySelector<HTMLInputElement>("#account-password-repeat")?.focus(); return;
    }
    setBusy(true); setError("");
    try { await api("/api/account", undefined, { action:mode, login, password, ...(registering && { email, passwordConfirmation:repeat }) }); onSuccess(); }
    catch (e) { setError(e instanceof Error ? e.message : "Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <Modal title={registering ? "Регистрация" : "Вход"} caption="Ваши комнаты и сохранённые фильмы на любом устройстве." onClose={onClose} busy={busy}>
    <form className="stack-form auth-form" onSubmit={submit}>
      <div className="source-tabs" role="group" aria-label="Доступ к профилю">{(["login","register"] as const).map(tab=>
        <button key={tab} type="button" aria-pressed={tab===mode} disabled={busy} onClick={()=>switchMode(tab)}>{tab==="login"?"Вход":"Регистрация"}</button>)}</div>
      {registering && <label>Электронная почта<input ref={firstField} required name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>}
      <div className="auth-field"><label htmlFor="account-login">Логин</label>
        <input id="account-login" name="username" ref={registering ? undefined : firstField} required minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-describedby={registering ? "login-hint" : undefined} value={login} disabled={busy} onChange={e=>setLogin(e.target.value)}/>
        {registering && <small id="login-hint">От 3 до 24 символов. Можно по-русски.</small>}</div>
      <PasswordField key={mode} registering={registering} value={password} onChange={setPassword} busy={busy}/>
      {registering && <PasswordField repeat registering value={repeat} onChange={setRepeat} busy={busy}
        onBlur={()=>{if (repeat) setChecked(true);}} invalid={checked && repeat !== password}/>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy?<Spinner/>:registering?"Создать аккаунт":"Войти"}</button>
    </form></Modal>;
}
