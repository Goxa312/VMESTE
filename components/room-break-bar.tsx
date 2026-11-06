"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Coffee } from "lucide-react";
import { siteName } from "@/lib/brand";
import type { Snapshot } from "@/lib/shared";
import { useLanguage } from "./language";
import { Spinner } from "./ui";

type Props = {
  snapshot: Snapshot; connected: boolean; capture: "tab" | "file" | null;
  onChange: (away: boolean, previousChange: number) => Promise<void>; children: ReactNode;
};

export function RoomBreakBar({ snapshot, connected, capture, onChange, children }: Props) {
  const { t, notice } = useLanguage();
  const { participants, me, serverTime } = snapshot;
  const self = participants.find(p => p.id === me);
  const away = participants.filter(p => p.onBreak);
  const back = participants.filter(p => !p.onBreak && p.breakChangedAt > 0 && serverTime - p.breakChangedAt < 30000);
  const host = me === snapshot.room.hostId;
  const requested = host && capture !== null && away.some(p => p.id !== me);
  const tabTitle = requested ? t("Просьба о паузе · {0}", siteName) :
    host && capture && back.some(p => p.id !== me) ? t("Снова в комнате · {0}", siteName) : "";
  const normalTitle = t("{0} — личный кинозал", siteName);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{text: string; version: number} | null>(null);

  // A broadcaster often has the movie tab in front of the room.
  useEffect(() => {
    if (!tabTitle) return;
    let active = true;
    queueMicrotask(() => { if (active) document.title = tabTitle; });
    return () => { active = false; if (document.title === tabTitle) document.title = normalTitle; };
  }, [tabTitle, normalTitle]);

  function names(group: typeof participants) {
    const first = group.slice(0, 3).map(p => p.name).join(", ");
    return group.length > 3 ? t("{0} и ещё {1}", first, group.length - 3) : first;
  }
  async function toggle() {
    if (!self || !connected || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await onChange(!self.onBreak, self.breakChangedAt); }
    catch (e) { setError({text: e instanceof Error ? e.message : "Не удалось сообщить о перерыве.", version: self.breakChangedAt}); }
    finally { pending.current = false; setBusy(false); }
  }

  return <div className="room-break-bar">
    <button type="button" className="break-toggle" data-away={self?.onBreak || undefined} disabled={!self || busy || !connected}
      onClick={() => void toggle()}>
      {busy ? <Spinner/> : self?.onBreak ? <Check size={16} aria-hidden="true"/> : <Coffee size={16} aria-hidden="true"/>}
      {t(self?.onBreak ? "Я вернулся" : "На минутку")}
    </button>
    <div className="break-notes" role="status" aria-live="polite" aria-atomic="true">
      {away.length > 0 && <p>{away.length === 1 && self?.onBreak ? t("Вы на перерыве.") : t("На перерыве — {0}", names(away))}</p>}
      {requested && <p className="break-request">{t(capture === "file" ? "Поставьте файл на паузу." : "Поставьте фильм на паузу в его вкладке.")}</p>}
      {back.length > 0 && <p>{back.length === 1 && back[0].id === me ? t("Вы снова в комнате.") : t("Снова в комнате — {0}", names(back))}</p>}
    </div>
    {children}
    {error && error.version === self?.breakChangedAt && <p className="error" role="alert">{notice(error.text)}</p>}
  </div>;
}
