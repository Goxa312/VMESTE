"use client";
import { useLanguage } from "./language";
import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
import { siteName } from "@/lib/brand";
export function Logo() {
  const { t } = useLanguage();
  return <a className="brand" href="/" aria-label={t("{0} — на главную", siteName)}><span>together</span>{" "}<span>tonight</span></a>;
}
export function Spinner() { return <LoaderCircle size={18} className="spin" />; }
export function Modal({ title, caption, children, onClose, busy = false, focusTitle = false }: { title: string; caption?: string; children: ReactNode; onClose: () => void; busy?: boolean; focusTitle?: boolean }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { dialog.current?.showModal(); if (focusTitle) heading.current?.focus({preventScroll:true}); const before = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = before; }; }, [focusTitle]);
  return <dialog ref={dialog} aria-label={title} className="modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (!busy && e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><button className="icon-button modal-close" aria-label={t("Закрыть")} disabled={busy} onClick={onClose}><X size={21} /></button><h2 ref={heading} tabIndex={focusTitle ? -1 : undefined}>{title}</h2>{caption && <p className="muted">{caption}</p>}{children}</div></dialog>;
}
export function Empty({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) { return <div className="empty"><h3>{title}</h3><p>{text}</p>{action && <button className="button primary" onClick={onClick}>{action}</button>}</div>; }
