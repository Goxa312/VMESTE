import { api } from "./client";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function description(pc: RTCPeerConnection, type: "offer" | "answer") {
  await pc.setLocalDescription(type === "offer" ? await pc.createOffer() : await pc.createAnswer());
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", listen); resolve(); };
      const listen = () => { if (pc.iceGatheringState === "complete" || pc.signalingState === "closed") done(); };
      const timer = setTimeout(done, 6500);
      pc.addEventListener("icegatheringstatechange", listen);
      listen();
    });
  }
  if (!pc.localDescription || pc.signalingState === "closed") throw new Error("Соединение закрыто.");
  return pc.localDescription.sdp;
}
type Peer = { guest: string; attempt: string; offered: number; answer: string | null };
type Callbacks = { onStream: (stream: MediaStream | null) => void; onStatus: (status: string) => void; onConnected?: () => void };
export function connectTab(code: string, session: string, token: string, stream: MediaStream | null, callbacks: Callbacks) {
  const base = `/api/rooms/${code}/signal?session=${session}`;
  const send = (data: Record<string, unknown>) => api(base, token, data);
  const attempt = crypto.randomUUID(), peers = new Map<string, RTCPeerConnection>();
  let active = true, joined = false, lastBeat = 0;
  function connection(key: string, config: RTCConfiguration) {
    const pc = new RTCPeerConnection(config);
    peers.set(key, pc);
    pc.onconnectionstatechange = () => {
      if (!active) return;
      if (pc.connectionState === "connected") { callbacks.onStatus(stream ? "Идёт показ вкладки" : "В эфире"); callbacks.onConnected?.(); }
      if (pc.connectionState === "failed") {
        if (!stream) callbacks.onStream(null);
        callbacks.onStatus("Связь прервалась. Подключитесь повторно.");
      }
    };
    return pc;
  }
  async function run() {
    let config: RTCConfiguration | undefined;
    while (active) {
      try {
        config ??= await api<RTCConfiguration>(base + "&ice=1", token);
        if (!active) return;
        if (stream) {
          const rows = await api<Peer[]>(base, token);
          if (!active) return;
          const keys = new Set(rows.map(row => row.attempt));
          for (const [key, pc] of peers) if (!keys.has(key)) { pc.close(); peers.delete(key); }
          await Promise.allSettled(rows.map(async row => {
            let pc = peers.get(row.attempt);
            if (!pc) {
              pc = connection(row.attempt, config!);
              for (const track of stream!.getTracks()) pc.addTrack(track, stream!);
            }
            if (!row.offered) {
              const sdp = pc.localDescription?.sdp || await description(pc, "offer");
              if (active) await send({ action: "offer", guest: row.guest, attempt: row.attempt, sdp });
            } else if (row.answer && !pc.remoteDescription) await pc.setRemoteDescription({ type: "answer", sdp: row.answer });
          }));
        } else {
          if (!joined) { await send({ action: "join", attempt }); joined = true; lastBeat = Date.now(); }
          if (Date.now() - lastBeat > 16000) { await send({ action: "heartbeat", attempt }); lastBeat = Date.now(); }
          const row = await api<{ offer?: string; answered?: number }>(base + "&attempt=" + attempt, token);
          if (!active) return;
          if (row.offer && !row.answered) {
            let pc = peers.get(attempt);
            if (!pc) {
              pc = connection(attempt, config);
              pc.ontrack = ({ streams, track }) => { if (active) callbacks.onStream(streams[0] || new MediaStream([track])); };
            }
            if (!pc.remoteDescription) await pc.setRemoteDescription({ type: "offer", sdp: row.offer });
            const sdp = pc.localDescription?.sdp || await description(pc, "answer");
            if (active) await send({ action: "answer", attempt, sdp });
          }
        }
      } catch { if (active) callbacks.onStatus("Восстанавливаем связь с комнатой…"); }
      if (active) await wait(1150);
    }
  }
  void run();
  return () => {
    active = false;
    for (const pc of peers.values()) pc.close();
    if (joined) void send({ action: "leave", attempt }).catch(() => {});
  };
}
