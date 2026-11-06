import { relayFormats, relayMaxPacket } from "./relay-format";

type Events = {
  status: (text: string) => void;
  changed: () => Promise<unknown>;
};
type Link = { message: (ws: WebSocket, data: string | ArrayBuffer) => void; reset: () => void; open?: (ws:WebSocket) => void; exhausted?:()=>void };

// The short-lived, HttpOnly room cookie is set by the authenticated ICE request.
// No participant credential or movie URL goes into the socket address.
function roomSocket(code: string, session: string, events: Events, hooks: Link, signal: AbortSignal, profile: "auto" | "mp4", publisher = false) {
  let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, failures = 0;
  const retryConnection = () => {
    if (++failures <= 5) {
      events.status("Восстанавливаем соединение с сервером комнаты…");
      retry = setTimeout(dial, Math.min(8000, 600 * 2 ** failures));
    } else {
      events.status("Не удалось связаться с сервером комнаты. Попробуйте переподключиться или попросите ведущего загрузить файл.");
      hooks.exhausted?.();
      signal.removeEventListener("abort",stop);
    }
  };
  const dial = () => {
    if (signal.aborted) return;
    const url = new URL(`/api/rooms/${code}/relay/${session}`, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (profile === "mp4") url.searchParams.set("format", "mp4");
    if (publisher) url.searchParams.set("profiles", "2");
    let ws: WebSocket;
    try { ws = socket = new WebSocket(url); }
    catch { retryConnection(); return; }
    ws.binaryType = "arraybuffer";
    let openedAt = 0;
    ws.onopen = () => { openedAt = Date.now(); if (!signal.aborted) hooks.open?.(ws); };
    ws.onmessage = e => {
      if (signal.aborted || ws !== socket) return;
      hooks.message(ws, e.data);
    };
    ws.onclose = e => {
      if (signal.aborted || ws !== socket) return;
      hooks.reset();
      if (openedAt && Date.now() - openedAt > 30000) failures = 0;
      if (e.code === 4004) {
        events.status("Показ завершён. Проверяем комнату…");
        void events.changed().catch(() => {});
      } else if (e.code === 4009) events.status("Просмотр открыт в другой вкладке.");
      else if (e.code === 4003) { /* The format error is already visible. */ }
      else retryConnection();
    };
  };
  const stop = () => {
    clearTimeout(retry);
    if (socket) {
      socket.onopen = socket.onclose = socket.onmessage = null;
      socket.close(); socket = undefined;
    }
    hooks.reset();
  };
  signal.addEventListener("abort", stop, { once: true });
  dial();
}

export function serveRoomRelay(code: string, session: string, stream: MediaStream, signal: AbortSignal, events: Events & {
  audience: (watching: boolean) => void;
}) {
  const active = new Set<string>();
  let servingMp4 = false;
  function publish(profile: "auto" | "mp4") {
    let recorder: MediaRecorder | undefined;
    const reset = () => {
      if (recorder) {
        recorder.ondataavailable = recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorder = undefined;
      }
      active.delete(profile);
      events.audience(active.size > 0);
    };
    roomSocket(code, session, events, { reset, exhausted:()=>{if(profile==="mp4")servingMp4=false;}, message(ws, data) {
      if (data === "need-mp4" && profile === "auto") {
        if (!servingMp4) { servingMp4 = true; publish("mp4"); }
        return;
      }
      if (data === "idle") { reset(); return; }
      if (data !== "start") return;
      reset();
      const audio = stream.getAudioTracks().some(track => track.readyState === "live");
      const mime = relayFormats.find(f => (profile === "auto" || f.startsWith("video/mp4")) &&
        (f.includes("opus") || f.includes("mp4a")) === audio &&
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(f));
      if (!mime) { ws.send("unsupported"); events.status("Этот браузер не может передать вкладку через комнату. Откройте её в Chrome или Edge."); return; }
      try {
        const options = { mimeType: mime, videoBitsPerSecond: 2400000, audioBitsPerSecond: 96000, videoKeyFrameIntervalDuration: 1000 };
        const rec = recorder = new MediaRecorder(stream, options);
        rec.ondataavailable = e => {
          if (rec !== recorder || ws.readyState !== WebSocket.OPEN || !e.data.size) return;
          if (e.data.size > relayMaxPacket || ws.bufferedAmount > relayMaxPacket) { ws.close(4010, "Upload fell behind"); return; }
          ws.send(e.data);
        };
        rec.onerror = () => { if (ws.readyState === WebSocket.OPEN) ws.send("unsupported"); reset(); };
        ws.send("format:" + mime);
        rec.start(500);
        active.add(profile);
        events.audience(true);
        events.status("Идёт показ через комнату");
      } catch { ws.send("unsupported"); reset(); }
    } }, signal, profile, true);
  }
  publish("auto");
}

export function watchRoomRelay(code: string, session: string, signal: AbortSignal, events: Events & {
  source: (value: string | null) => void;
  playback: (url: string) => "waiting" | "playing" | "blocked";
}) {
  let media: MediaSource | undefined, objectUrl: string | undefined;
  let buffer: SourceBuffer | undefined, queue: ArrayBuffer[] = [], pendingAppend = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(watchdog);
    if (buffer) { buffer.onupdateend = buffer.onerror = null; }
    buffer = undefined;
    if (media) media.onsourceopen = null;
    media = undefined; queue = []; pendingAppend = false;
    if (objectUrl) { events.source(null); URL.revokeObjectURL(objectUrl); objectUrl = undefined; }
  };
  const unsupported = "Браузер не поддерживает формат этого показа. Обновите браузер или попросите ведущего загрузить фильм в комнату.";
  const managed = (globalThis as typeof globalThis & {ManagedMediaSource?: typeof MediaSource}).ManagedMediaSource;
  const Engine = [globalThis.MediaSource, managed].find(Type => Type && relayFormats.some(mime => Type.isTypeSupported(mime)));
  if (!Engine) { events.status(unsupported); return; }
  const mp4 = relayFormats.some(mime => mime.startsWith("video/mp4") && Engine.isTypeSupported(mime));
  const webm = relayFormats.some(mime => mime.startsWith("video/webm") && Engine.isTypeSupported(mime));
  const profile = mp4 && (!webm || Engine === managed) ? "mp4" : "auto";
  function expectFrame(ws: WebSocket) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
      if (document.hidden) { expectFrame(ws); return; }
      if (objectUrl && events.playback(objectUrl) !== "waiting") return;
      events.status("Первый кадр не пришёл. Повторяем подключение…");
      ws.close(4010,"No video frames");
    }, 16000);
  }
  roomSocket(code, session, events, { reset, open: ws => { expectFrame(ws); events.status("Ждём видео от ведущего через комнату…"); },
    message(ws, data) {
      if (data === "waiting") { reset(); expectFrame(ws); events.status("Ждём видео от ведущего через комнату…"); return; }
      if (data === "unsupported") { reset(); events.status("Браузер ведущего не может передать видео в этом формате. Попросите его открыть комнату в Chrome или Edge."); return; }
      const reconnect = () => { if (ws.readyState === WebSocket.OPEN) ws.close(4010, "Restart media"); };
      const drain = () => {
        if (!buffer || buffer.updating || media?.readyState !== "open") return;
        try {
          // Keep only a short live window; a two-hour film must not fill the browser's memory.
          const ranges = buffer.buffered;
          if (ranges.length && ranges.end(ranges.length - 1) - ranges.start(0) > 40) {
            buffer.remove(0, ranges.end(ranges.length - 1) - 18); return;
          }
          const next = queue.shift();
          if (next) { pendingAppend = true; buffer.appendBuffer(next); }
        } catch { reconnect(); }
      };
      if (typeof data === "string") {
        if (!data.startsWith("format:")) return;
        reset();
        const mime = data.slice(7);
        if (!relayFormats.some(f => f === mime) || !Engine.isTypeSupported(mime)) {
          events.status(unsupported); ws.close(4003, "Unsupported format"); return;
        }
        const current = media = new Engine();
        current.onsourceopen = () => {
          if (media !== current || signal.aborted) return;
          try {
            buffer = current.addSourceBuffer(mime);
            buffer.onupdateend = () => {
              if (pendingAppend) { pendingAppend = false; if (ws.readyState === WebSocket.OPEN) ws.send("ack"); }
              drain();
            };
            buffer.onerror = reconnect;
            drain();
          } catch { reconnect(); }
        };
        objectUrl = URL.createObjectURL(current);
        events.source(objectUrl);
        expectFrame(ws);
        events.status("Загружаем трансляцию через комнату…");
        return;
      }
      if (!media) return;
      if (queue.length >= 16) { reconnect(); return; }
      queue.push(data); drain();
    },
  }, signal, profile);
}
