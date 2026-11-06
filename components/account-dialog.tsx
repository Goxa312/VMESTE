"use client";
import { useLanguage } from "./language";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "./password-field";
import { RecoveryDialog } from "./recovery-dialog";
import { api } from "@/lib/client";
import { Modal, Spinner } from "./ui";


export function AccountDialog({ initial, onClose, onSuccess }: { initial: "login" | "register"; onClose:()=>void; onSuccess:()=>void }) {
  const { t,notice } = useLanguage();
  const [mode, setMode] = useState(initial), [email, setEmail] = useState(""), [login, setLogin] = useState("");
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState(""), [checked, setChecked] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [recover, setRecover] = useState(false), [issued, setIssued] = useState("");
  const registering = mode === "register";
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus({preventScroll:true}); }, [mode,recover,issued]);
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
    try {
      const result = await api<{recoveryCode?:string}>("/api/account", undefined, { action:mode, login, password, ...(registering && { email, passwordConfirmation:repeat }) });
      setPassword(""); setRepeat("");
      if (result.recoveryCode) setIssued(result.recoveryCode);
      else onSuccess();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  if (issued) return <RecoveryDialog mode="saved" code={issued} onClose={onSuccess}/>;
  if (recover) return <RecoveryDialog mode="reset" onClose={()=>{setRecover(false);setMode("login");}}/>;
  return <Modal title={registering ? t("Регистрация") : t("Вход")} caption={t("Ваши комнаты и сохранённые фильмы на любом устройстве.")} onClose={onClose} busy={busy}>
    <form className="stack-form auth-form" onSubmit={submit}>
      <div className="source-tabs" role="group" aria-label={t("Доступ к профилю")}>{(["login","register"] as const).map(tab=>
        <button key={tab} type="button" aria-pressed={tab===mode} disabled={busy} onClick={()=>switchMode(tab)}>{tab==="login"?t("Вход"):t("Регистрация")}</button>)}</div>
      {registering && <label>{t("Электронная почта")}<input ref={firstField} required name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>}
      <div className="auth-field"><label htmlFor="account-login">{t("Логин")}</label>
        <input id="account-login" name="username" ref={registering ? undefined : firstField} required minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-describedby={registering ? "login-hint" : undefined} value={login} disabled={busy} onChange={e=>setLogin(e.target.value)}/>
        {registering && <small id="login-hint">{t("От 3 до 24 символов. Можно по-русски.")}</small>}</div>
      <PasswordField key={mode} registering={registering} value={password} onChange={setPassword} busy={busy}/>
      {!registering && <button className="forgot-link" type="button" disabled={busy} onClick={()=>{setPassword("");setError("");setRecover(true);}}>{t("Забыли пароль?")}</button>}
      {registering && <PasswordField repeat registering value={repeat} onChange={setRepeat} busy={busy}
        onBlur={()=>{if (repeat) setChecked(true);}} invalid={checked && repeat !== password}/>}
      {error && <p className="error" role="alert">{notice(error)}</p>}
      <button className="button primary full" disabled={busy}>{busy?<Spinner/>:registering?t("Создать аккаунт"):t("Войти")}</button>
    </form></Modal>;
}
