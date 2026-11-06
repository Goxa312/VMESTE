"use client";
import { useEffect, useRef, useState } from "react";
import { siteName } from "@/lib/brand";
import { readLocal, saveLocal } from "@/lib/client";
import type { Person, RoomState } from "@/lib/shared";
import { useLanguage } from "./language";

const preference = "tt-break-alerts";

export function HostBreakAlerts({ room, people, active }: {room: RoomState; people: Person[]; active: boolean}) {
  const { t, locale } = useLanguage();
  const supported = typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";
  const [enabled, setEnabled] = useState<boolean>(() => supported && Notification.permission === "granted" && readLocal<boolean>(preference, false));
  const [asking, setAsking] = useState(false), [hint, setHint] = useState(false);
  const seen = useRef<Map<string, number> | null>(null), shown = useRef<Notification | null>(null);
  useEffect(() => {
    const sync = () => setEnabled(supported && Notification.permission === "granted" && readLocal<boolean>(preference, false));
    const changed = (event: StorageEvent) => { if (event.key === preference || !event.key) sync(); };
    window.addEventListener("focus", sync); window.addEventListener("storage", changed);
    return () => { window.removeEventListener("focus", sync); window.removeEventListener("storage", changed); };
  }, [supported]);
  useEffect(() => {
    const previous = seen.current;
    seen.current = new Map(people.map(p => [p.id, p.breakChangedAt]));
    if (!previous || !active || !enabled || !document.hidden || !supported || Notification.permission !== "granted") return;
    const changes = people.filter(p => p.id !== room.hostId && p.breakChangedAt > (previous.get(p.id) ?? 0));
    if (!changes.length) return;
    const away = changes.filter(p => p.onBreak).map(p => p.name).join(", ");
    const back = changes.filter(p => !p.onBreak).map(p => p.name).join(", ");
    try {
      const alert = new Notification(t(away ? "Просьба о паузе · {0}" : "Снова в комнате · {0}", siteName), {
        body: [away && t("На перерыве — {0}", away), back && t("Снова в комнате — {0}", back)].filter(Boolean).join("\n"),
        tag: "tt-break-" + room.id, silent: true, lang: locale,
      });
      shown.current = alert;
      alert.onclick = () => { window.focus(); alert.close(); };
    } catch { /* The notice and tab title also work when the OS suppresses notifications. */ }
  }, [people, room.hostId, room.id, active, enabled, supported, t, locale]);
  useEffect(() => () => { shown.current?.close(); shown.current = null; }, [active, enabled]);
  if (!supported) return null;
  async function toggle() {
    if (asking) return;
    setHint(false);
    if (enabled) { setEnabled(false); saveLocal(preference, false); return; }
    setAsking(true);
    try {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      const granted = permission === "granted";
      setEnabled(granted); setHint(!granted); saveLocal(preference, granted);
    } catch { setHint(true); }
    finally { setAsking(false); }
  }
  return <div className="break-alert-setting">
    <label className="sound-option"><input type="checkbox" checked={enabled} disabled={asking} onChange={() => void toggle()}/>
      {t("Уведомлять о перерывах в других вкладках")}</label>
    {hint && <small role="status">{t("Для уведомлений поверх вкладок разрешите их в настройках сайта.")}</small>}
  </div>;
}
