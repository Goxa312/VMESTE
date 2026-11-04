"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, MonitorPlay, Unplug } from "lucide-react";
import { extensionRequest, type ExtensionStatus } from "@/lib/kinogo-bridge";
import { playbackPosition, type RoomState } from "@/lib/shared";
import { Spinner } from "./ui";

export function KinogoPlayer({ room, isHost, offset, connected, onControl, onRefresh }: {
  room: RoomState; isHost: boolean; offset: number; connected: boolean;
  onControl: (playing: boolean, position: number) => Promise<void>;
  onRefresh: () => Promise<{ room: RoomState; offset: number }>;
}) {
  const [extension, setExtension] = useState<ExtensionStatus>({ installed: false, connected: false, hasPlayer: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const updateRequired = extension.version === "0.1.0";
  const current = useRef({ room, isHost, offset, connected, onControl, onRefresh });
  useEffect(() => { current.current = { room, isHost, offset, connected, onControl, onRefresh }; }, [room, isHost, offset, connected, onControl, onRefresh]);
  function state() {
    const s = current.current, now = Date.now();
    return { roomId: s.room.id, sourceUrl: s.room.videoUrl, isHost: s.isHost, connected: s.connected,
      playing: s.room.playing, position: playbackPosition(s.room, now + s.offset), revision: s.room.revision, sampledAt: now };
  }
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    async function update() {
      try { const result = await extensionRequest("state", state()); if (alive) setExtension(result); }
      catch { if (alive) setExtension(previous => previous.installed ? { ...previous, error: "Расширение не отвечает. Обновите вкладку комнаты после обновления расширения." } : previous); }
      if (alive) timer = setTimeout(update, 1000);
    }
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
    void update();
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("message", receive); void extensionRequest("disconnect").catch(() => {}); };
  }, []);
  async function connect() {
    setBusy(true); setError("");
    try { setExtension(await extensionRequest("connect", state(), 10000)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось подключить Киного"); }
    finally { setBusy(false); }
  }
  return <section className="player kinogo-player" aria-label="Совместный просмотр Киного">
    <span className="eyebrow">КИНОГО · ЧЕРЕЗ РАСШИРЕНИЕ</span><MonitorPlay size={42}/>
    <h2>Смотрим на Киного, остаёмся вместе</h2>
    <p>Фильм откроется в отдельной вкладке. Оставьте эту комнату открытой для синхронизации и чата.</p>
    <ol><li>Установите расширение в Chrome или Edge у каждого участника.</li><li>Откройте Киного кнопкой ниже и запустите фильм.</li><li>В плеере нажмите «Подключить это видео» после рекламы.</li></ol>
    {extension.installed ? <><p className="kinogo-status" role="status">{extension.connected ? extension.hasPlayer ? "Плеер подключён к комнате" : extension.pageReady ? "Ожидаем выбора видео во вкладке Киного" : "Подключаем расширение во вкладке Киного…" : "Расширение готово"}</p>
      {updateRequired && <p className="error" role="alert">Установлена версия 0.1.0. Обновите расширение до 0.1.1 — исправлено повторное открытие Киного. <a href="/kinogo-extension" target="_blank" rel="noreferrer">Как обновить</a></p>}
      <button className="button primary" disabled={busy || !connected || updateRequired} onClick={() => void connect()}>{busy ? <Spinner/> : <ExternalLink size={17}/>} {extension.connected ? "Перейти к Киного" : "Открыть Киного и подключить"}</button>
      {extension.connected && !extension.pageReady && !updateRequired && <small>Если Киного долго загружается, обновите саму вкладку Киного. Кнопка выше вернёт вас в уже открытую вкладку.</small>}
      {extension.connected && <button className="text-button" onClick={() => void extensionRequest("disconnect").then(setExtension).catch(e => setError(e.message))}><Unplug size={15}/>Отключить просмотр</button>}</> :
      <a className="button primary" href="/kinogo-extension" target="_blank" rel="noreferrer">Установить расширение <ExternalLink size={17}/></a>}
    <a className="text-button" href={room.videoUrl} target="_blank" rel="noreferrer">Проверить исходную страницу Киного</a>
    {(error || extension.error) && <p className="error" role="alert">{error || extension.error}</p>}
    <small>{isHost ? "Ваши запуск, пауза и перемотка на Киного передаются участникам." : "Воспроизведением управляет ведущий. Громкость меняется только у вас."}</small>
  </section>;
}
