import { ApiError, body, currentAccount, db, json, sameOriginWrite, safe } from "@/lib/server";

export async function POST(req: Request) {
  return safe(async () => {
    sameOriginWrite(req);
    const account = await currentAccount(req);
    if (!account) throw new ApiError("Войдите в профиль заново.", 401);
    const { id, saved } = await body(req, 500);
    if (typeof id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(id) || typeof saved !== "boolean") throw new ApiError("Некорректная карточка.");
    if (saved) {
      const result = await db().prepare("INSERT OR IGNORE INTO account_favorites(account_id,video_id,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM account_favorites WHERE account_id=?)<500")
        .bind(account.id, id, Date.now(), account.id).run();
      if (!result.meta.changes && !await db().prepare("SELECT 1 FROM account_favorites WHERE account_id=? AND video_id=?").bind(account.id,id).first())
        throw new ApiError("В списке уже 500 названий.", 409);
    } else await db().prepare("DELETE FROM account_favorites WHERE account_id=? AND video_id=?").bind(account.id, id).run();
    return json({ ok: true });
  });
}
