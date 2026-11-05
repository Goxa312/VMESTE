import { safe, body, str, randomId, hash, db, json, snapshot, getRoom, member, mediaCookie, bearer, ApiError } from "@/lib/server";
type Context = { params: Promise<{ code: string }> };
export async function GET(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params; await getRoom(code); const me = await member(req, code);
  if (Date.now() - me.seen_at > 9000) await db().prepare("UPDATE participants SET seen_at = ? WHERE id = ?").bind(Date.now(), me.id).run();
  const response = json(await snapshot(code, me.id));
  return mediaCookie(response, req, code, bearer(req));
}); }
export async function POST(req: Request, context: Context) { return safe(async () => {
  const { code } = await context.params; await getRoom(code);
  const input = await body(req), name = str(input.name, "Имя", 24);
  const id = randomId(), token = randomId() + randomId(), now = Date.now();
  const result = await db().prepare("INSERT INTO participants (id,room_id,token_hash,name,color,seen_at,joined_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM participants WHERE room_id = ? AND seen_at > ?) < 12 AND (SELECT COUNT(*) FROM participants WHERE room_id = ?) < 200").bind(id, code, await hash(token), name, crypto.getRandomValues(new Uint8Array(1))[0] % 6, now, now, code, now - 25000, code).run();
  if (!result.meta.changes) throw new ApiError("Комната заполнена. Создайте другую комнату.", 409);
  return mediaCookie(json({ ...(await snapshot(code, id)), token }, 201), req, code, token);
}); }
