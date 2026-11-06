import { api, RequestError } from "./client";
import { serveRoomRelay, watchRoomRelay } from "./tab-relay";

type RoomConfig = RTCConfiguration & { roomRelay?: boolean };

type PeerRow = { guest: string; attempt: string; offered: number; answer: string | null };
type GuestRow = { offer: string | null; answered: number };
type Callbacks = {
  onStream: (stream: MediaStream | null) => void;
  onStatus: (status: string) => void;
  onHttpError: (status: number) => void;
  onSessionChanged: () => Promise<unknown>;
  onConnected?: () => void;
  preferRoomRelay?: boolean;
  onRelaySource: (url: string | null) => void;
  playback: (source: MediaStream | string) => "waiting" | "playing" | "blocked";
};

const pollInterval = 1150;
const iceTimeout = 14000;
const firstFrameTimeout = 10000;
const isConflict = (error: unknown, code: string) => error instanceof RequestError && error.code === code;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function description(pc: RTCPeerConnection, type: "offer" | "answer", signal: AbortSignal) {
  await pc.setLocalDescription(type === "offer" ? await pc.createOffer() : await pc.createAnswer());
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>(resolve => {
      let grace: ReturnType<typeof setTimeout> | undefined, settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); clearTimeout(grace);
        pc.removeEventListener("icegatheringstatechange", check);
        pc.removeEventListener("signalingstatechange", check);
        pc.removeEventListener("icecandidate", candidate);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === "complete" || pc.signalingState === "closed" || signal.aborted) done(); };
      // Send usable candidates promptly instead of waiting for every STUN path to time out.
      const needsTurn = hasRelay(pc.getConfiguration());
      const candidate = () => {
        const sdp = pc.localDescription?.sdp || "";
        if (!settled && !grace && (needsTurn ? / typ relay\b/.test(sdp) : /a=candidate:/.test(sdp))) {
          grace = setTimeout(done, needsTurn || / typ srflx\b/.test(sdp) ? 300 : 1400);
        }
      };
      const timer = setTimeout(done, needsTurn ? 5500 : 4000);
      pc.addEventListener("icegatheringstatechange", check);
      pc.addEventListener("signalingstatechange", check);
      pc.addEventListener("icecandidate", candidate);
      signal.addEventListener("abort", done, { once: true });
      check(); candidate();
    });
  }
  if (signal.aborted || !pc.localDescription || pc.signalingState === "closed") throw new Error("Соединение закрыто.");
  return pc.localDescription.sdp;
}

function hasRelay(config: RTCConfiguration) {
  return config.iceServers?.some(server => [server.urls].flat().some(url => /^turns?:/.test(url))) ?? false;
}

export function connectTab(code: string, session: string, token: string, stream: MediaStream | null, callbacks: Callbacks) {
  const base = `/api/rooms/${code}/signal?session=${encodeURIComponent(session)}`;
  const controller = new AbortController();
  const { signal } = controller;
  const get = <T,>(suffix = "") => api<T>(base + suffix, token, undefined, undefined, signal);
  const send = (data: Record<string, unknown>) => api(base, token, data, undefined, signal);
  const peers = new Map<string, RTCPeerConnection>();
  let attempt = crypto.randomUUID(), previousAttempt: string | undefined;
  let relayRequested = Boolean(callbacks.preferRoomRelay), servingRelay = false, relayAudience = false;
  let joined = false, joinSent = false, joinedAt = 0, lastBeat = 0, startedIce = 0, retries = 0;
  let firstConnectionAt = 0, receivedVideo: MediaStream | null = null, firstFrame = false;

  function closePeer(key: string) {
    const pc = peers.get(key);
    peers.delete(key);
    if (pc) { pc.onconnectionstatechange = null; pc.ontrack = null; pc.close(); }
  }

  function connection(key: string, config: RTCConfiguration) {
    const pc = new RTCPeerConnection(config);
    peers.set(key, pc);
    const remote = stream ? null : new MediaStream();
    const showTracks = () => {
      if (!signal.aborted && peers.get(key) === pc && pc.connectionState === "connected" && remote?.getVideoTracks().length) {
        receivedVideo = remote;
        callbacks.onStream(remote);
      }
    };
    if (remote) pc.ontrack = ({ track }) => { remote.addTrack(track); showTracks(); };
    pc.onconnectionstatechange = () => {
      if (signal.aborted || peers.get(key) !== pc) return;
      if (pc.connectionState === "connected") {
        startedIce = 0;
        firstConnectionAt ||= Date.now();
        showTracks();
        callbacks.onStatus(stream ? "Идёт показ вкладки" : "Соединение установлено. Ждём первый кадр…");
        callbacks.onConnected?.();
      } else if (!stream && pc.connectionState === "disconnected") {
        startedIce ||= Date.now();
        callbacks.onStatus("Восстанавливаем связь с ведущим…");
      }
    };
    return pc;
  }

  async function hostStep(config: RTCConfiguration, local: MediaStream) {
    const rows = await get<PeerRow[]>();
    if (signal.aborted) return;
    const keys = new Set(rows.map(row => row.attempt));
    for (const key of peers.keys()) if (!keys.has(key)) closePeer(key);
    if (!rows.length && !relayAudience) callbacks.onStatus("Ждём подключения зрителя…");
    const updates = await Promise.allSettled(rows.map(async row => {
      let pc = peers.get(row.attempt);
      const reset = () => send({ action: "reset", guest: row.guest, attempt: row.attempt });
      try {
        // An offer belongs to the WebRTC connection that created it. A new host
        // connection cannot resume the previous connection's SDP.
        if ((!pc && row.offered) || pc?.connectionState === "failed") {
          closePeer(row.attempt);
          await reset();
          return;
        }
        if (!pc) {
          pc = connection(row.attempt, config);
          for (const track of local.getTracks()) pc.addTrack(track, local);
        }
        if (!row.offered) {
          const sdp = pc.localDescription?.sdp ?? await description(pc, "offer", signal);
          await send({ action: "offer", guest: row.guest, attempt: row.attempt, sdp });
        } else if (row.answer && !pc.remoteDescription) {
          await pc.setRemoteDescription({ type: "answer", sdp: row.answer });
        }
      } catch (error) {
        if (signal.aborted) return;
        if (isConflict(error, "attempt_missing") || isConflict(error, "attempt_replaced")) {
          closePeer(row.attempt);
          return;
        }
        if (error instanceof RequestError && !isConflict(error, "attempt_conflict")) throw error;
        if (error instanceof TypeError) throw error; // Fetch/network failure: retry the same write.
        closePeer(row.attempt);
        await reset();
      }
    }));
    for (const update of updates) if (update.status === "rejected") throw update.reason;
  }

  function renewGuest(config: RoomConfig, iceFailed = false) {
    closePeer(attempt);
    firstConnectionAt = 0; receivedVideo = null; firstFrame = false;
    callbacks.onStream(null);
    ++retries;
    if (config.roomRelay && (iceFailed && !hasRelay(config) || retries > 2)) {
      relayRequested = true;
      callbacks.onStatus("Прямая связь не установилась. Подключаемся через комнату…");
      return true;
    }
    if (retries > 2) {
      callbacks.onStatus(hasRelay(config)
        ? "Не удалось установить видеосвязь даже через ретранслятор. Попробуйте подключиться снова."
        : "Между вашими сетями не удалось передать видео. Попробуйте подключиться снова или попросите ведущего открыть файл в плеере комнаты.");
      return false;
    }
    previousAttempt = attempt;
    attempt = crypto.randomUUID();
    joined = false;
    joinSent = false;
    startedIce = 0;
    callbacks.onStatus("Открываем новое соединение с ведущим…");
    return true;
  }

  async function guestStep(config: RoomConfig): Promise<boolean> {
    if (!joined) {
      joinSent = true;
      await send({ action: "join", attempt, previousAttempt });
      joined = true;
      joinedAt = lastBeat = Date.now();
      callbacks.onStatus("Ждём ответа ведущего…");
    }
    if (Date.now() - lastBeat > 16000) {
      await send({ action: "heartbeat", attempt });
      lastBeat = Date.now();
    }
    const row = await get<GuestRow>("&attempt=" + attempt);
    if (signal.aborted) return true;
    if (!row.offer) {
      if (config.roomRelay && Date.now() - joinedAt > firstFrameTimeout) {
        relayRequested = true;
        callbacks.onStatus("Ждём ответ слишком долго. Подключаемся через сервер комнаты…");
      } else if (Date.now() - joinedAt > 15000) callbacks.onStatus("Ведущий ещё не передаёт видео. Попросите его открыть комнату и выбрать вкладку для показа.");
      return true;
    }
    let pc = peers.get(attempt);
    if (pc?.connectionState === "failed" || (startedIce && Date.now() - startedIce > iceTimeout)) {
      return renewGuest(config, true);
    }
    if (!pc) {
      if (row.answered) return renewGuest(config);
      startedIce = Date.now();
      // After a direct failure use the configured relay if one is available.
      pc = connection(attempt, retries && hasRelay(config) ? { ...config, iceTransportPolicy: "relay" } : config);
      callbacks.onStatus("Соединяем браузеры…");
    }
    if (!pc.remoteDescription) await pc.setRemoteDescription({ type: "offer", sdp: row.offer });
    if (!row.answered) {
      const sdp = pc.localDescription?.sdp ?? await description(pc, "answer", signal);
      await send({ action: "answer", attempt, sdp });
    } else if (pc.connectionState === "connected") {
      const state = receivedVideo ? callbacks.playback(receivedVideo) : "waiting";
      if (state === "playing") {
        firstFrame = true; retries = 0;
        callbacks.onStatus("В эфире");
      } else if (!firstFrame && state !== "blocked" && !document.hidden && Date.now() - firstConnectionAt > firstFrameTimeout) {
        if (config.roomRelay) {
          relayRequested = true;
          callbacks.onStatus("Видео не пришло. Подключаемся через сервер комнаты…");
        } else return renewGuest(config,true);
      }
    }
    return true;
  }

  function cleanup() {
    if (signal.aborted) return;
    controller.abort();
    for (const key of peers.keys()) closePeer(key);
    if (!stream && joinSent) void api(base, token, { action: "leave", attempt }).catch(() => {});
  }

  async function run() {
    let config: RoomConfig | undefined, errors = 0;
    try {
      while (!signal.aborted) {
        try {
          config ??= await get<RoomConfig>("&ice=1");
          if (signal.aborted) break;
          if (stream) {
            if (config.roomRelay && !servingRelay) {
              servingRelay = true;
              serveRoomRelay(code, session, stream, signal, {
                status: callbacks.onStatus, changed: callbacks.onSessionChanged,
                audience: active => { relayAudience = active; if (active) callbacks.onConnected?.(); },
              });
            }
            if (typeof RTCPeerConnection !== "undefined") await hostStep(config, stream);
            else if (!config.roomRelay) { callbacks.onStatus("Этот браузер не поддерживает передачу видео в комнате."); break; }
          } else if (relayRequested || typeof RTCPeerConnection === "undefined") {
            if (!config.roomRelay) { callbacks.onStatus("Передача через комнату недоступна на этом сервере. Нажмите «Переподключиться» для прямой связи."); break; }
            closePeer(attempt);
            callbacks.onStream(null);
            if (joinSent) { joinSent = false; void api(base, token, { action: "leave", attempt }).catch(() => {}); }
            watchRoomRelay(code, session, signal, { status: callbacks.onStatus, source: callbacks.onRelaySource, changed: callbacks.onSessionChanged, playback: callbacks.playback });
            if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
            break;
          } else if (!await guestStep(config)) break;
          errors = 0;
        } catch (error) {
          if (signal.aborted) break;
          if (error instanceof RequestError) callbacks.onHttpError(error.status);
          if (isConflict(error, "share_changed")) {
            callbacks.onStream(null);
            callbacks.onStatus("Показ сменился. Проверяем комнату…");
            await callbacks.onSessionChanged().catch(() => {}); // The room also polls independently.
            break;
          }
          if (!stream && isConflict(error, "attempt_replaced")) {
            callbacks.onStream(null);
            callbacks.onStatus("Просмотр открыт в другой вкладке. Нажмите «Переподключиться», чтобы смотреть здесь.");
            break;
          }
          if (error instanceof RequestError && [401,403,404,410].includes(error.status)) {
            callbacks.onStream(null);
            callbacks.onStatus(error.message);
            break;
          }
          if (!stream && config && (isConflict(error, "attempt_missing") || isConflict(error, "attempt_conflict") || error instanceof DOMException && error.name !== "TimeoutError")) {
            if (!renewGuest(config)) break;
          } else {
            errors++;
            if (!stream && config?.roomRelay && errors >= 2) relayRequested = true;
            callbacks.onStatus("Нет ответа от сервера комнаты. Пробуем снова…");
          }
        }
        if (!signal.aborted) await delay(Math.min(5000, pollInterval * (1 + errors)), signal);
      }
    } finally {
      cleanup();
    }
  }
  void run();
  return cleanup;
}
