import { safe, body, str, randomId, hash, db, json, snapshot, getRoom, member, mediaCookie, bearer, ApiError, currentAccount, sameOriginWrite, accountCookie, accountRoomToken, endRelay } from "@/lib/server";
import { purgeClosedRoom } from "@/lib/uploads";
type Context = { params: Promise<{ code: string }> };
export async function GET(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params; await getRoom(code); const me = await member(req, code);
  if (Date.now() - me.seen_at > 9000) await db().prepare("UPDATE participants SET seen_at = ? WHERE id = ?").bind(Date.now(), me.id).run();
  const response = json(await snapshot(code, me.id));
  return mediaCookie(response, req, code, bearer(req));
}); }
export async function POST(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params;
  const input = await body(req), account = await currentAccount(req);
  if (account) sameOriginWrite(req);
  await getRoom(code);
  if (input.resume && !account) return json({ token: null });
  const accountToken = account ? await accountRoomToken(account.secret, code) : "";
  if (account) {
    const known = await db().prepare("SELECT id FROM participants WHERE room_id=? AND account_id=?").bind(code, account.id).first<{id:string}>();
    if (known) return mediaCookie(json({ ...(await snapshot(code, known.id)), token: accountToken }), req, code, accountToken);
    if (input.resume) return json({ token: null, name: account.name });
  }
  const name = str(input.name || account?.name, "Имя", 24);
  const id = randomId(), token = accountToken || randomId() + randomId(), now = Date.now();
  const result = await db().prepare("INSERT OR IGNORE INTO participants (id,room_id,token_hash,name,color,seen_at,joined_at,account_id) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM participants WHERE room_id = ? AND seen_at > ?) < 12 AND (SELECT COUNT(*) FROM participants WHERE room_id = ?) < 200").bind(id, code, await hash(token), name, crypto.getRandomValues(new Uint8Array(1))[0] % 6, now, now, account?.id ?? null, code, now - 25000, code).run();
  if (!result.meta.changes && account) {
    const raced = await db().prepare("SELECT id FROM participants WHERE room_id=? AND account_id=?").bind(code, account.id).first<{id:string}>();
    if (raced) return mediaCookie(json({ ...(await snapshot(code, raced.id)), token }), req, code, token);
  }
  if (!result.meta.changes) throw new ApiError("Комната заполнена. Создайте другую комнату.", 409);
  return mediaCookie(json({ ...(await snapshot(code, id)), token }, 201), req, code, token);
}); }

export async function DELETE(req: Request, context: Context) { return safe(async () => {
  sameOriginWrite(req);
  const { code } = await context.params, { action } = await body(req, 256);
  if (action !== "delete" && action !== "leave") throw new ApiError("Выберите действие с комнатой.");
  const room = await getRoom(code), secret = accountCookie(req);
  const token = !req.headers.has("Authorization") && secret ? await accountRoomToken(secret, code) : bearer(req);
  const me = await member(req, code, token);
  if (action === "leave") {
    if (room.host_id === me.id) throw new ApiError("Вы ведущий. Для закрытия выберите «Удалить комнату».", 409);
    await db().batch([
      db().prepare("DELETE FROM participants WHERE id=? AND room_id=? AND id<>(SELECT host_id FROM rooms WHERE id=?)").bind(me.id, code, code),
      db().prepare("DELETE FROM share_peers WHERE room_id=? AND guest=?").bind(code, me.id),
    ]);
  } else {
    if (room.host_id !== me.id) throw new ApiError("Удалить комнату для всех может только ведущий.", 403);
    const [closed] = await db().batch<{share_id: string | null}>([
      db().prepare("UPDATE rooms SET expires_at=0,playing=0,revision=revision+1 WHERE id=? AND host_id=? AND expires_at>? RETURNING share_id").bind(code, me.id, Date.now()),
      db().prepare("UPDATE uploads SET expires_at=0 WHERE room_id=? AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND host_id=? AND expires_at=0)").bind(code, code, me.id),
      purgeClosedRoom(code),
    ]);
    if (closed.results[0]) await endRelay(code, closed.results[0].share_id);
  }
  return json({ ok:true });
}); }
