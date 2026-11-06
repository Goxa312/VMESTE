"use client";
import { useLanguage } from "./language";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { Modal, Spinner } from "./ui";
import { PasswordField } from "./password-field";

export function RecoveryDialog({mode,code = "",onClose}: {mode:"saved"|"manage"|"reset"; code?:string; onClose:()=>void}) {
  const { t,notice } = useLanguage();
  const [issued,setIssued] = useState(code), [copied,setCopied] = useState(false);
  const [identifier,setIdentifier] = useState(""), [entry,setEntry] = useState("");
  const [password,setPassword] = useState(""), [repeat,setRepeat] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const display = useRef<HTMLTextAreaElement>(null);
  const resetting = mode === "reset";
  async function copy() {
    try { await navigator.clipboard.writeText(issued); setCopied(true); }
    catch { display.current?.focus(); display.current?.select(); setError("Выделите и скопируйте код вручную."); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (resetting && password !== repeat) { setError("Пароли не совпадают."); return; }
    setBusy(true);
    try {
      const data = resetting ? {action:"reset-password",identifier,code:entry,password,passwordConfirmation:repeat} : {action:"issue-recovery-code",password};
      const result = await api<{recoveryCode:string}>("/api/account",undefined,data);
      setIssued(result.recoveryCode); setPassword(""); setRepeat(""); setEntry("");
    } catch (e) { setError(e instanceof Error ? e.message : "Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  if (issued) return <Modal title={resetting ? t("Пароль изменён") : t("Сохраните резервный код")} onClose={onClose}
    caption={resetting ? t("Сохраните новый резервный код. Предыдущий код больше не действует. Затем войдите с новым паролем.") : t("Скопируйте код в менеджер паролей. Он позволит задать новый пароль, если вы забудете старый.")}>
    <div className="stack-form"><label>{t("Резервный код")}<textarea className="recovery-code" dir="ltr" rows={2} ref={display} value={issued} readOnly spellCheck={false} autoComplete="off" onFocus={e=>e.target.select()}/></label>
      <button type="button" className="button outline" onClick={()=>void copy()}>{copied ? t("Код скопирован") : t("Копировать код")}</button>
      {error && <p className="error" role="alert">{notice(error)}</p>}
      <button className="button primary" onClick={onClose}>{t("Я сохранил код")}</button></div></Modal>;
  return <Modal title={resetting ? t("Восстановление пароля") : t("Новый резервный код")} onClose={onClose} busy={busy}
    caption={resetting ? t("Введите логин или почту, резервный код и новый пароль.") : t("Введите текущий пароль, чтобы получить резервный код. Прежний код перестанет действовать.")}>
    <form className="stack-form auth-form" onSubmit={submit}>
      {resetting && <><label>{t("Логин или почта")}<input required name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={identifier} onChange={e=>setIdentifier(e.target.value)}/></label>
        <label>{t("Резервный код")}<input required name="code" className="recovery-entry" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={64} dir="ltr" value={entry} onChange={e=>setEntry(e.target.value)}/></label>
        <details className="recovery-help"><summary>{t("Где найти код?")}</summary><p>{t("Код выдаётся при регистрации. Если вы уже вошли на другом устройстве и помните текущий пароль, откройте меню профиля и выберите «Резервный код».")}</p></details></>}
      <PasswordField label={resetting ? t("Новый пароль") : t("Пароль")} registering={resetting} value={password} onChange={setPassword} busy={busy}/>
      {resetting && <PasswordField repeat registering value={repeat} onChange={setRepeat} busy={busy}/>}
      {error && <p className="error" role="alert">{notice(error)}</p>}
      <button className="button primary" disabled={busy}>{busy ? <Spinner/> : resetting ? t("Сменить пароль") : t("Получить новый код")}</button>
      {resetting && <button type="button" className="text-button" disabled={busy} onClick={onClose}>{t("Вернуться ко входу")}</button>}
    </form></Modal>;
}
