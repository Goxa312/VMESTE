import { env } from "cloudflare:workers";
import { ApiError, body, db, getRoom, json, member, safe } from "@/lib/server";

type Context = { params: Promise<{ code: string }> };
type AttemptRow = { attempt: string; offer: string | null; answered: number };
const isAttempt = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function requireSession(expected: string, current: string | null) {
  if (!current || current !== expected) {
    throw new ApiError("Этот показ уже завершён или заменён.", 409, "share_changed");
  }
}

async function access(req: Request, code: string) {
  const room = await getRoom(code);
  const me = await member(req, code);
  const query = new URL(req.url).searchParams;
  return { room, me: me.id, host: room.host_id === me.id, session: query.get("session") ?? "", query };
}

async function readAttempt(code: string, session: string, guest: string, attempt: string) {
  const row = await db().prepare(
    "SELECT attempt,offer,answer IS NOT NULL AS answered FROM share_peers WHERE room_id=? AND session=? AND guest=?"
  ).bind(code, session, guest).first<AttemptRow>();
  if (row?.attempt === attempt) return row;
  requireSession(session, (await getRoom(code)).share_id);
  if (row) throw new ApiError("Этот зритель уже открыл другое подключение.", 409, "attempt_replaced");
  throw new ApiError("Подключение зрителя нужно открыть заново.", 409, "attempt_missing");
}

async function iceServers() {
  const fallback = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return fallback;
  try {
    const reply = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      { method: "POST", headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(5000) }
    );
    if (reply.ok) {
      const data = await reply.json<{ iceServers?: RTCIceServer[] }>();
      if (Array.isArray(data.iceServers) && data.iceServers.length) return { iceServers: data.iceServers };
    }
  } catch {
    // A TURN outage must still allow peers that can establish a direct connection.
  }
  return fallback;
}

export async function GET(req: Request, context: Context) {
  return safe(async () => {
    const { code } = await context.params;
    const { room, me, host, session, query } = await access(req, code);
    requireSession(session, room.share_id);
    if (query.has("ice")) return json(await iceServers());
    if (host) {
      const rows = await db().prepare(
        "SELECT guest,attempt,offer IS NOT NULL AS offered,answer FROM share_peers WHERE room_id=? AND session=? AND updated_at>?"
      ).bind(code, session, Date.now() - 120000).all();
      return json(rows.results);
    }
    const attempt = query.get("attempt");
    if (!isAttempt(attempt)) throw new ApiError("Некорректное подключение зрителя.");
    const { offer, answered } = await readAttempt(code, session, me, attempt);
    return json({ offer, answered });
  });
}

export async function POST(req: Request, context: Context) {
  return safe(async () => {
    const { code } = await context.params;
    const { room, me, host, session } = await access(req, code);
    const input = await body(req, 65536);
    const { action, attempt } = input;
    if (!isAttempt(attempt)) throw new ApiError("Некорректное подключение зрителя.");

    // A late cleanup only owns this exact attempt, even after the host starts a new show.
    if (!host && action === "leave") {
      await db().prepare("DELETE FROM share_peers WHERE room_id=? AND session=? AND guest=? AND attempt=?")
        .bind(code, session, me, attempt).run();
      return json({ ok: true });
    }
    requireSession(session, room.share_id);
    const now = Date.now();
    if (!host && action === "join") {
      const previous = input.previousAttempt ?? null;
      if (previous !== null && !isAttempt(previous)) throw new ApiError("Некорректное предыдущее подключение.");
      // Fence the INSERT against a concurrent share-start. Retrying the same join preserves its SDP.
      const joined = await db().prepare(`
        INSERT INTO share_peers (room_id,guest,session,attempt,updated_at)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND share_id=?)
        ON CONFLICT(room_id,guest) DO UPDATE SET
          offer=CASE WHEN share_peers.attempt=excluded.attempt AND share_peers.session=excluded.session THEN share_peers.offer END,
          answer=CASE WHEN share_peers.attempt=excluded.attempt AND share_peers.session=excluded.session THEN share_peers.answer END,
          session=excluded.session, attempt=excluded.attempt, updated_at=excluded.updated_at
        WHERE ? IS NULL OR share_peers.session<>excluded.session OR share_peers.attempt IN (excluded.attempt,?)
      `).bind(code, me, session, attempt, now, code, session, previous, previous).run();
      if (!joined.meta.changes) {
        requireSession(session, (await getRoom(code)).share_id);
        await readAttempt(code, session, me, attempt);
      }
    } else if (!host && action === "heartbeat") {
      const update = await db().prepare("UPDATE share_peers SET updated_at=? WHERE room_id=? AND session=? AND guest=? AND attempt=?")
        .bind(now, code, session, me, attempt).run();
      if (!update.meta.changes) await readAttempt(code, session, me, attempt);
    } else if (host && action === "reset" && typeof input.guest === "string") {
      await db().prepare("DELETE FROM share_peers WHERE room_id=? AND session=? AND guest=? AND attempt=?")
        .bind(code, session, input.guest, attempt).run();
    } else {
      if (host ? action !== "offer" || typeof input.guest !== "string" : action !== "answer") {
        throw new ApiError("Действие недоступно.", 403);
      }
      const sdp = input.sdp;
      if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 63000) throw new ApiError("Некорректные данные соединения.");
      const guest = host ? String(input.guest) : me;
      const field = host ? "offer" : "answer";
      const result = await db().prepare(
        `UPDATE share_peers SET ${field}=? WHERE room_id=? AND session=? AND guest=? AND attempt=?
         AND (${field} IS NULL OR ${field}=?)${host ? "" : " AND offer IS NOT NULL"}
         AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND share_id=?)`
      ).bind(sdp, code, session, guest, attempt, sdp, code, session).run();
      if (!result.meta.changes) {
        requireSession(session, (await getRoom(code)).share_id);
        await readAttempt(code, session, guest, attempt);
        throw new ApiError("Нужно повторить согласование подключения.", 409, "attempt_conflict");
      }
    }
    return json({ ok: true });
  });
}
