import { env } from "cloudflare:workers";
import { ApiError, body, db, getRoom, json, member, safe } from "@/lib/server";
type Context = { params: Promise<{ code: string }> };
type Peer = { guest: string; attempt: string; offer: string | null; answer: string | null };
async function access(req: Request, code: string) {
  const room = await getRoom(code), me = await member(req, code);
  const query = new URL(req.url).searchParams;
  if (!room.share_id || room.share_id !== query.get("session")) throw new ApiError("Показ этой вкладки завершён.", 409);
  return { session: room.share_id, me: me.id, host: room.host_id === me.id, query };
}
export async function GET(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params, { session, me, host, query } = await access(req, code);
  if (query.has("ice")) {
    if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
      const reply = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: "POST", headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 3600 }),
      });
      if (reply.ok) { const value = await reply.json<{ iceServers: unknown[] }>(); return json({ iceServers: value.iceServers }); }
    }
    return json({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
  }
  if (host) {
    const rows = await db().prepare("SELECT guest,attempt,offer IS NOT NULL AS offered,answer FROM share_peers WHERE room_id=? AND session=? AND updated_at>?").bind(code, session, Date.now()-120000).all();
    return json(rows.results);
  }
  const peer = await db().prepare("SELECT offer,answer IS NOT NULL AS answered FROM share_peers WHERE room_id=? AND session=? AND guest=? AND attempt=?").bind(code, session, me, query.get("attempt") || "").first();
  return json(peer || {});
}); }
export async function POST(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params, { session, me, host } = await access(req, code), input = await body(req, 65536);
  const { action, attempt } = input;
  if (typeof attempt !== "string" || !/^[a-f0-9-]{36}$/.test(attempt)) throw new ApiError("Некорректный сеанс.");
  const now = Date.now();
  if (!host && action === "join") {
    await db().prepare(`INSERT INTO share_peers (room_id,guest,session,attempt,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(room_id,guest) DO UPDATE SET session=excluded.session,attempt=excluded.attempt,offer=NULL,answer=NULL,updated_at=excluded.updated_at`)
      .bind(code, me, session, attempt, now).run();
  } else if (!host && action === "heartbeat") {
    await db().prepare("UPDATE share_peers SET updated_at=? WHERE room_id=? AND session=? AND guest=? AND attempt=?").bind(now,code,session,me,attempt).run();
  } else if (!host && action === "leave") {
    await db().prepare("DELETE FROM share_peers WHERE room_id=? AND session=? AND guest=? AND attempt=?").bind(code,session,me,attempt).run();
  } else {
    if (host ? action !== "offer" || typeof input.guest !== "string" : action !== "answer") throw new ApiError("Действие недоступно.", 403);
    if (typeof input.sdp !== "string" || !input.sdp.startsWith("v=0") || input.sdp.length > 63000) throw new ApiError("Некорректные данные соединения.");
    const field: keyof Peer = host ? "offer" : "answer";
    const result = await db().prepare(`UPDATE share_peers SET ${field}=? WHERE room_id=? AND session=? AND guest=? AND attempt=? AND (${field} IS NULL OR ${field}=?)${host ? "" : " AND offer IS NOT NULL"}`)
      .bind(input.sdp, code, session, host ? input.guest : me, attempt, input.sdp).run();
    if (!result.meta.changes) throw new ApiError("Участник переподключился.", 409);
  }
  return json({ ok: true });
}); }
