import { DurableObject } from "cloudflare:workers";
import { ApiError, getRoom, member, safe } from "../lib/server";
import { relayFormats, relayMaxPacket } from "../lib/relay-format";

type SocketState = { host: boolean; code: string; session: string; ready: boolean; pending: number[] };
const stateOf = (ws: WebSocket) => ws.deserializeAttachment() as SocketState;
function close(ws: WebSocket, code: number, reason: string) { try { ws.close(code, reason); } catch { /* already closed */ } }
function send(ws: WebSocket, data: ArrayBuffer | string) {
  try { ws.send(data); } catch { close(ws, 4001, "Connection lost"); }
}

// Called by the Worker, never by the framework's buffered response handler.
export function routeRelay(request: Request, env: Cloudflare.Env, code: string, session: string) {
  return safe(async () => {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new ApiError("Нужно подключение WebSocket.", 426);
    if (request.headers.get("Origin") !== new URL(request.url).origin) throw new ApiError("Чужой источник.", 403);
    const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)vm-live=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) throw new ApiError("Сначала войдите в комнату.", 401);
    const [room, me] = await Promise.all([getRoom(code), member(request, code, token)]);
    if (room.share_id !== session) throw new ApiError("Показ завершён.", 409, "share_changed");
    const ns = env.ROOM_RELAY;
    if (!ns) throw new ApiError("Передача через комнату недоступна.", 503);
    // Rebuild internal headers: the caller cannot select their role or forward a room token.
    return ns.get(ns.idFromName(code + ":" + session)).fetch("https://relay.internal/connect", {
      headers: { Upgrade: "websocket", "X-Member": me.id, "X-Host": room.host_id === me.id ? "1" : "0",
        "X-Room": code, "X-Session": session, "X-Expires": String(room.expires_at) },
    });
  });
}

export class RoomRelay extends DurableObject<Cloudflare.Env> {
  private checkedAt = 0;
  private bytes = 0;
  private windowStart = 0;

  private active(tag?: string) { return this.ctx.getWebSockets(tag).filter(ws => ws.readyState === 1); }
  private end() { for (const ws of this.active()) close(ws, 4004, "Broadcast ended"); }
  async alarm() { this.end(); }
  async fetch(req: Request): Promise<Response> {
    if (req.method === "POST" && new URL(req.url).pathname === "/end") {
      this.end();
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204 });
    }
    if (req.headers.get("Upgrade") !== "websocket") return new Response(null, { status: 426 });
    const code = req.headers.get("X-Room")!, session = req.headers.get("X-Session")!;
    const host = req.headers.get("X-Host") === "1", id = req.headers.get("X-Member")!;
    // Recheck after routing to the object: a share-stop may race the initial handshake.
    const current = await getRoom(code);
    if (current.share_id !== session) return new Response(null, { status: 409 });
    const tag = "member:" + id;
    for (const ws of this.active(tag)) close(ws, 4009, "Opened in another tab");
    if (!host && this.active("guest").length >= 11) return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [host ? "host" : "guest", tag]);
    server.serializeAttachment({ host, code, session, ready: false, pending: [] } satisfies SocketState);
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(current.expires_at);
    if (!host) send(server, "waiting");
    if (this.active("guest").length) for (const ws of this.active("host")) send(ws, "start");
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (ws.readyState !== 1) return;
    const state = stateOf(ws);
    if (!state.host) {
      if (data !== "ack") { close(ws, 1008, "Viewer cannot publish"); return; }
      state.pending.shift();
      ws.serializeAttachment(state);
      return;
    }
    const now = Date.now();
    if (now - this.checkedAt > 20000) {
      // Keep the format header ahead of binary events while validating a live session.
      const active = await this.ctx.blockConcurrencyWhile(async () => {
        const room = await this.env.DB!.prepare("SELECT 1 FROM rooms WHERE id=? AND share_id=? AND expires_at>?")
          .bind(state.code, state.session, now).first();
        if (!room) this.end(); else this.checkedAt = now;
        return Boolean(room);
      });
      if (!active || ws.readyState !== 1) return;
    }
    const viewers = this.active("guest");
    if (!viewers.length) { send(ws, "idle"); return; }
    if (typeof data === "string") {
      if (data === "unsupported") { for (const viewer of viewers) send(viewer, data); return; }
      if (!relayFormats.some(format => data === "format:" + format)) { close(ws, 1008, "Unknown format"); return; }
      for (const viewer of viewers) {
        const guest = stateOf(viewer); guest.ready = true; guest.pending = []; viewer.serializeAttachment(guest); send(viewer, data);
      }
      return;
    }
    if (now - this.windowStart >= 10000) { this.windowStart = now; this.bytes = 0; }
    this.bytes += data.byteLength;
    if (!data.byteLength || data.byteLength > relayMaxPacket || this.bytes > 8 * 1024 * 1024) { close(ws, 1009, "Media limit"); return; }
    for (const viewer of viewers) {
      const guest = stateOf(viewer);
      if (!guest.ready) continue; // A mid-stream guest must first receive a fresh initialization segment.
      if (guest.pending.length >= 16 || guest.pending.reduce((a, b) => a + b, data.byteLength) > 4 * 1024 * 1024) {
        close(viewer, 4010, "Viewer fell behind"); continue;
      }
      guest.pending.push(data.byteLength); viewer.serializeAttachment(guest); send(viewer, data);
    }
  }
  webSocketClose(ws: WebSocket) {
    if (stateOf(ws).host) {
      if (!this.active("host").length) for (const viewer of this.active("guest")) send(viewer, "waiting");
    } else if (!this.active("guest").length) for (const host of this.active("host")) send(host, "idle");
  }
  webSocketError(ws: WebSocket) { close(ws, 4001, "Connection lost"); }
}
