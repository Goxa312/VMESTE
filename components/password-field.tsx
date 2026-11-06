"use client";
import { useLanguage } from "./language";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField({ repeat = false, label, registering, value, onChange, onBlur, invalid, busy }: {
  repeat?: boolean; label?: string; registering: boolean; value: string; onChange: (value: string) => void;
  onBlur?: () => void; invalid?: boolean; busy: boolean;
}) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const id = repeat ? "account-password-repeat" : "account-password";
  const action = repeat ? (visible ? "Скрыть повтор пароля" : "Показать повтор пароля") : (visible ? "Скрыть пароль" : "Показать пароль");
  return <div className="auth-field">
    <label htmlFor={id}>{label || (repeat ? t("Повторите пароль") : t("Пароль"))}</label>
    <div className="password-entry">
      <input id={id} name={repeat ? "passwordConfirmation" : "password"} type={visible ? "text" : "password"}
        required minLength={registering && !repeat ? 10 : 1} maxLength={128} autoComplete={registering ? "new-password" : "current-password"}
        autoCapitalize="none" spellCheck={false} disabled={busy} value={value} onChange={e=>onChange(e.target.value)} onBlur={onBlur}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? "repeat-password-error" : registering && !repeat ? "password-hint" : undefined}/>
      <button type="button" className="password-eye" title={t(action)} aria-label={t(action)} aria-controls={id} aria-pressed={visible}
        disabled={busy} onClick={()=>setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
    </div>
    {registering && !repeat && <small id="password-hint">{t("Не менее 10 символов.")}</small>}
    {invalid && <p className="field-error" id="repeat-password-error" role="alert">{t("Пароли не совпадают.")}</p>}
  </div>;
}
