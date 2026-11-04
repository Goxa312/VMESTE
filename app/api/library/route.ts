import { safe, body, videoInput, randomId, hash, db, json, ApiError, bearer } from "@/lib/server";
export async function GET(req: Request) { return safe(async () => {
  const owner = await hash(bearer(req));
  const result = await db().prepare("SELECT id,title,url,kind,poster FROM library WHERE owner_key = ? ORDER BY created_at DESC LIMIT 200").bind(owner).all();
  return json({ videos: result.results });
}); }
export async function POST(req: Request) { return safe(async () => {
  const owner = await hash(bearer(req)), v = videoInput(await body(req)), id = randomId();
  const result = await db().prepare("INSERT INTO library (id,owner_key,title,url,kind,poster,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM library WHERE owner_key = ?) < 200").bind(id, owner, v.title, v.url, v.kind, v.poster, Date.now(), owner).run();
  if (!result.meta.changes) throw new ApiError("В библиотеке уже 200 видео", 409);
  return json({ video: { id, ...v } }, 201);
}); }
export async function DELETE(req: Request) { return safe(async () => {
  const owner = await hash(bearer(req)), input = await body(req);
  if (typeof input.id !== "string") throw new ApiError("Не выбрано видео");
  await db().prepare("DELETE FROM library WHERE id = ? AND owner_key = ?").bind(input.id, owner).run(); return json({ ok: true });
}); }
