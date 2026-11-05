"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, Play, LoaderCircle, ArrowUpRight } from "lucide-react";
export function Logo() { return <a className="brand" href="/" aria-label="Вместе — на главную"><span className="brand-mark"><Play size={19} fill="currentColor" /></span>вместе<span className="brand-dot">.</span></a>; }
export function Spinner() { return <LoaderCircle size={18} className="spin" />; }
export function Modal({ title, caption, children, onClose }: { title: string; caption?: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); const before = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = before; }; }, []);
  return <dialog ref={dialog} aria-label={title} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><button className="icon-button modal-close" aria-label="Закрыть" onClick={onClose}><X size={21} /></button><h2>{title}</h2>{caption && <p className="muted">{caption}</p>}{children}</div></dialog>;
}
export function Empty({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) { return <div className="empty"><span className="empty-icon"><Play size={25} /></span><h3>{title}</h3><p>{text}</p>{action && <button className="button primary" onClick={onClick}>{action}<ArrowUpRight size={17}/></button>}</div>; }
