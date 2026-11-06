"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";
import { translate, translateNotice, type Locale } from "@/lib/i18n";

const Language = createContext<{locale: Locale; change: (value: Locale) => void}>({locale:"ru",change:()=>{}});
export function LanguageProvider({initial,children}: { initial: Locale; children: ReactNode }) {
  const [locale,setLocale] = useState(initial);
  function change(value: Locale) {
    document.cookie = "tt-lang="+value+"; Path=/; Max-Age=31536000; SameSite=Lax";
    try { localStorage.setItem("tt-lang", value); } catch { /* Keep the preference for this page. */ }
    setLocale(value);
  }
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === "tt-lang" && (event.newValue === "ru" || event.newValue === "en")) setLocale(event.newValue);
    }
    window.addEventListener("storage",sync);
    return () => window.removeEventListener("storage",sync);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale,"{0} — личный кинозал","Together Tonight");
    document.querySelector('meta[name="description"]')?.setAttribute("content",translate(locale,"Смотрите фильмы с друзьями по приглашению. Добавьте ссылку, покажите вкладку или загрузите свой фильм."));
  }, [locale]);
  return <Language.Provider value={{locale,change}}>{children}</Language.Provider>;
}
export function useLanguage() {
  const {locale,change} = useContext(Language);
  return { locale, change, t:(text:string,...values:(string|number)[])=>translate(locale,text,...values),
    notice:(message:string)=>translateNotice(locale,message) };
}
export function LanguageSwitch() {
  const {locale,change} = useContext(Language);
  const target = locale === "ru" ? "en" : "ru";
  const label = target === "en" ? "Switch to English" : "Переключить на русский";
  return <button type="button" className="language-switch" lang={target} aria-label={label} title={label} onClick={()=>change(target)}>
    <Globe2 size={17} aria-hidden="true"/><span className="language-name">{target === "en" ? "English" : "Русский"}</span><span className="language-short">{target.toUpperCase()}</span>
  </button>;
}
