"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, MonitorPlay, RefreshCw, Unplug } from "lucide-react";
import { EXTENSION_VERSION, extensionRequest, needsExtensionUpdate } from "@/lib/kinogo-bridge";
import { useKinogoExtension } from "@/hooks/use-kinogo-extension";
import { playbackPosition, type RoomState } from "@/lib/shared";
import { Spinner } from "./ui";

export function KinogoPlayer({ room, isHost, offset, connected, onControl, onRefresh }: {
  room: RoomState; isHost: boolean; offset: number; connected: boolean;
  onControl: (playing: boolean, position: number) => Promise<void>;
  onRefresh: () => Promise<{ room: RoomState; offset: number }>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef({ room, isHost, offset, connected, onControl, onRefresh });
  useEffect(() => { current.current = { room, isHost, offset, connected, onControl, onRefresh }; }, [room, isHost, offset, connected, onControl, onRefresh]);
  function state() {
    const s = current.current, now = Date.now();
    return { roomId: s.room.id, sourceUrl: s.room.videoUrl, isHost: s.isHost, connected: s.connected,
      playing: s.room.playing, position: playbackPosition(s.room, now + s.offset), revision: s.room.revision, sampledAt: now };
  }
  const { extension, setExtension, checking, reachable, connectionError, check } = useKinogoExtension(state);
  const updateRequired = extension.installed && needsExtensionUpdate(extension.version);
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
  return <section className="player kinogo-player" aria-label="Совместный просмотр Киного">
    <span className="eyebrow">КИНОГО · СОВМЕСТНЫЙ ПРОСМОТР</span><MonitorPlay size={42}/>
    <h2>{extension.hasPlayer && reachable ? "Вы смотрите вместе" : "Один клик — и можно смотреть"}</h2>
    <p>Запустите фильм на Киного — длинное видео подключится автоматически. Комнату оставьте открытой для связи и чата.</p>
    <div className="kinogo-steps" aria-label="Подключение просмотра">
      <span className={reachable ? "done" : ""}>{reachable ? <Check size={15}/> : "1"} Расширение</span>
      <span className={extension.connected && reachable ? "done" : ""}>{extension.connected && reachable ? <Check size={15}/> : "2"} Киного</span>
      <span className={extension.hasPlayer && reachable ? "done" : ""}>{extension.hasPlayer && reachable ? <Check size={15}/> : "3"} Синхронизация</span>
    </div>
    <p className="kinogo-status" role="status" aria-live="polite">{checking && !reachable ? "Проверяем связь с расширением…" : !reachable ? extension.installed ? "Связь с расширением прервалась" : "Расширение пока не подключилось к этому сайту" : updateRequired ? `Доступна новая версия ${EXTENSION_VERSION}` : extension.connected ? extension.hasPlayer ? "Плеер подключён · синхронизация включена" : extension.pageReady ? "Запустите фильм во вкладке Киного" : "Ждём загрузку Киного…" : `Расширение ${extension.version} готово`}</p>
    {reachable && !updateRequired ? <>
      <button className="button primary" disabled={busy || !connected} onClick={() => void connect()}>{busy ? <Spinner/> : <ExternalLink size={17}/>} {extension.connected ? "К фильму" : "Смотреть на Киного"}</button>
      {!connected && <small>Восстанавливаем связь с комнатой…</small>}
      {extension.connected && <button className="text-button" onClick={() => void extensionRequest("disconnect").then(setExtension).catch(e => setError(e.message))}><Unplug size={15}/>Отключить просмотр</button>}
    </> : <div className="kinogo-actions">
      <button className="button subtle" disabled={checking} onClick={check}>{checking ? <Spinner/> : <RefreshCw size={16}/>}Проверить подключение</button>
      <a className={`button ${updateRequired ? "primary" : "subtle"}`} href="/kinogo-extension" target="_blank" rel="noreferrer">{updateRequired ? `Обновить до ${EXTENSION_VERSION}` : "Установка и помощь"}<ExternalLink size={16}/></a>
    </div>}
    {!reachable && !checking && <p className="kinogo-hint">Уже установлено? Откройте значок «Вместе» в Chrome и нажмите «Восстановить связь». Для старой копии из папки проекта нажмите ↻ на странице расширений.</p>}
    <details className="kinogo-help"><summary>Если что-то не подключается</summary>
      <p>Обе вкладки должны быть в одном профиле Chrome или Edge. Для инкогнито нужно отдельно разрешить работу расширения. На другом компьютере расширение тоже нужно установить.</p>
      <p>Короткий ролик или другой плеер выберите кнопкой «Подключить это видео» после рекламы. У всех участников должны совпадать фильм и перевод.</p>
      <a className="text-button" href={room.videoUrl} target="_blank" rel="noreferrer">Открыть исходную страницу Киного <ExternalLink size={14}/></a>
      {!reachable && connectionError && <small>{connectionError}</small>}
    </details>
    {(error || extension.error) && <p className="error" role="alert">{error || extension.error}</p>}
    <small>{isHost ? "Ваши запуск, пауза и перемотка на Киного передаются участникам." : "Воспроизведением управляет ведущий. Громкость меняется только у вас."}</small>
  </section>;
}
