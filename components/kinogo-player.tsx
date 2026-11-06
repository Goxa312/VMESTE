"use client";
import { useLanguage } from "./language";
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { EXTENSION_VERSION, extensionRequest, needsExtensionUpdate } from "@/lib/kinogo-bridge";
import { useKinogoExtension } from "@/hooks/use-kinogo-extension";
import { playbackPosition, type RoomState } from "@/lib/shared";
import { Spinner } from "./ui";

export function KinogoPlayer({ room, isHost, offset, connected, onControl, onRefresh, onChooseSource }: {
  room: RoomState; isHost: boolean; offset: number; connected: boolean;
  onControl: (playing: boolean, position: number) => Promise<void>;
  onRefresh: () => Promise<{ room: RoomState; offset: number }>;
  onChooseSource: () => void;
}) {
  const { t,notice } = useLanguage();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef({ room, isHost, offset, connected, onControl, onRefresh });
  useEffect(() => { current.current = { room, isHost, offset, connected, onControl, onRefresh }; }, [room, isHost, offset, connected, onControl, onRefresh]);
  function state() {
    const s = current.current, now = Date.now();
    return { roomId: s.room.id, sourceUrl: s.room.videoUrl, isHost: s.isHost, connected: s.connected,
      playing: s.room.playing, position: playbackPosition(s.room, now + s.offset), revision: s.room.revision, sampledAt: now };
  }
  const { extension, setExtension, checking, reachable, connectionError, check } = useKinogoExtension(state);
  const updateRequired = extension.installed && needsExtensionUpdate(extension.version, "0.2.0");
  useEffect(() => {
    let alive = true;
    const receive = async (event: MessageEvent) => {
      const message = event.data, s = current.current;
      if (event.source !== window || event.origin !== window.location.origin || message?.channel !== "vmeste-extension" ||
          !["control", "refresh"].includes(message.type) || typeof message.requestId !== "string") return;
      if (message.type === "refresh") {
        try {
          if (message.roomId !== s.room.id || message.sourceUrl !== s.room.videoUrl) throw new Error("Источник комнаты изменился");
          const fresh = await s.onRefresh(), now = Date.now();
          window.postMessage({ channel: "vmeste-app", type: "refresh-result", requestId: message.requestId, ok: true,
            state: { roomId: fresh.room.id, sourceUrl: fresh.room.videoUrl, isHost: s.isHost, connected: true,
              playing: fresh.room.playing, position: playbackPosition(fresh.room, now + fresh.offset), revision: fresh.room.revision, sampledAt: now } }, window.location.origin);
        } catch { window.postMessage({ channel: "vmeste-app", type: "refresh-result", requestId: message.requestId, ok: false, error: "Нет связи с комнатой" }, window.location.origin); }
        return;
      }
      let failure = "";
      try {
        if (!s.isHost || !s.connected || message.roomId !== s.room.id || message.sourceUrl !== s.room.videoUrl ||
            typeof message.playing !== "boolean" || !Number.isFinite(message.position) || message.position < 0 || message.position > 604800) throw new Error("Команда не относится к активной комнате ведущего");
        await s.onControl(message.playing, message.position);
      } catch (e) { failure = e instanceof Error ? e.message : "Не удалось передать действие"; if (alive) setError(failure); }
      window.postMessage({ channel: "vmeste-app", type: "control-result", requestId: message.requestId, ok: !failure, error: failure }, window.location.origin);
    };
    window.addEventListener("message", receive);
    return () => { alive = false; window.removeEventListener("message", receive); };
  }, []);
  async function connect() {
    setBusy(true); setError("");
    try { setExtension(await extensionRequest("connect", state(), 10000)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось подключить Киного"); }
    finally { setBusy(false); }
  }
  return <section className="player kinogo-player" aria-label={t("Совместный просмотр Киного")}>
    <h2>{t("Плеер комнаты")}</h2>
    <p>{isHost ? t("Подключите видео один раз. Друзья смогут смотреть его в этой комнате по приглашению.") : t("Когда ведущий подключит видео, плеер появится здесь автоматически.")}</p>
    {isHost && <button className="button primary" onClick={onChooseSource}>{t("Смотреть в комнате")}</button>}
    <details className="kinogo-external" open={extension.connected || undefined}><summary>{t("Просмотр на Киного через расширение")}</summary>
    <div className="kinogo-external-controls">
    <p>{t("Запустите фильм на Киного — длинное видео подключится автоматически. Комнату оставьте открытой для связи и чата.")}</p>
    <div className="kinogo-steps" aria-label={t("Подключение просмотра")}>
      <span className={reachable ? "done" : ""}>{reachable ? <Check size={15}/> : "1"}{t(" Расширение")}</span>
      <span className={extension.connected && reachable ? "done" : ""}>{extension.connected && reachable ? <Check size={15}/> : "2"}{t(" Киного")}</span>
      <span className={extension.hasPlayer && reachable ? "done" : ""}>{extension.hasPlayer && reachable ? <Check size={15}/> : "3"}{t(" Синхронизация")}</span>
    </div>
    <p className="kinogo-status" role="status" aria-live="polite">{checking && !reachable ? t("Проверяем связь с расширением…") : !reachable ? extension.installed ? t("Связь с расширением прервалась") : t("Расширение пока не подключилось к этому сайту") : updateRequired ? t("Доступна новая версия {0}", EXTENSION_VERSION) : extension.connected ? extension.hasPlayer ? t("Плеер подключён · синхронизация включена") : extension.recovering ? t("Восстанавливаем загрузку Киного…") : extension.pageTimedOut ? t("Киного пока не ответил") : extension.pageReady ? t("Запустите фильм во вкладке Киного") : t("Ждём загрузку Киного…") : t("Расширение {0} готово", extension.version ?? "—")}</p>
    {reachable && !updateRequired ? <>
      <button className="button primary" disabled={busy || !connected || extension.recovering} onClick={() => void connect()}>{busy || extension.recovering ? <Spinner/> : <ExternalLink size={17}/>} {extension.recovering ? t("Восстанавливаем Киного…") : extension.pageTimedOut ? t("Повторить загрузку Киного") : extension.connected ? t("К фильму") : t("Смотреть на Киного")}</button>
      {!connected && <small>{t("Восстанавливаем связь с комнатой…")}</small>}
      {extension.connected && <button className="text-button" onClick={() => void extensionRequest("disconnect").then(setExtension).catch(e => setError(e.message))}><Unplug size={15}/>{t("Отключить просмотр")}</button>}
    </> : <div className="kinogo-actions">
      <button className="button subtle" disabled={checking} onClick={check}>{checking ? <Spinner/> : <RefreshCw size={16}/>}{t("Проверить подключение")}</button>
      <a className={`button ${updateRequired ? "primary" : "subtle"}`} href="/kinogo-extension" target="_blank" rel="noreferrer">{updateRequired ? t("Обновить до {0}", EXTENSION_VERSION) : t("Установка и помощь")}<ExternalLink size={16}/></a>
    </div>}
    {!reachable && !checking && <p className="kinogo-hint">{t("Уже установлено? Откройте расширение для Киного в Chrome и нажмите «Восстановить связь». Для старой копии из папки проекта нажмите ↻ на странице расширений.")}</p>}
    <details className="kinogo-help"><summary>{t("Если что-то не подключается")}</summary>
      <p>{t("Если Киного остаётся пустым при повторном открытии, обновите расширение до ")}{EXTENSION_VERSION}{t(", откройте его значок и один раз включите «Автовосстановление Киного». При зависании оно сбросит данные только Киного и повторит загрузку. Возможен выход из аккаунта Киного.")}</p>
      <p>{t("Обе вкладки должны быть в одном профиле Chrome или Edge. Для инкогнито нужно отдельно разрешить работу расширения. На другом компьютере расширение тоже нужно установить.")}</p>
      <p>{t("Короткий ролик или другой плеер выберите кнопкой «Подключить это видео» после рекламы. У всех участников должны совпадать фильм и перевод.")}</p>
      <a className="text-button" href={room.videoUrl} target="_blank" rel="noreferrer">{t("Открыть исходную страницу Киного ")}<ExternalLink size={14}/></a>
      {!reachable && connectionError && <small>{notice(connectionError)}</small>}
    </details>
    {(error || extension.error) && <p className="error" role="alert">{notice(error || extension.error || "")}</p>}
    <small>{isHost ? t("Ваши запуск, пауза и перемотка на Киного передаются участникам.") : t("Воспроизведением управляет ведущий. Громкость меняется только у вас.")}</small>
    </div></details>
  </section>;
}
