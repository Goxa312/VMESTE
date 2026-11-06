import { ApiError, body, currentAccount, db, hash, json, safe, sameOriginWrite } from "@/lib/server";

export async function POST(req:Request) {
  return safe(async () => {
    sameOriginWrite(req);
    const account = await currentAccount(req);
    if (!account) throw new ApiError("Войдите, чтобы перенести комнаты.",401);
    const { rooms } = await body(req,2200);
    if (!Array.isArray(rooms) || rooms.length > 8 || rooms.some(room => !room || !/^[a-f0-9]{12}$/.test(room.id) || !/^[a-f0-9]{64}$/.test(room.token)))
      throw new ApiError("Некорректная история комнат.");
    if (!rooms.length) return json({ ids:[] });
    // Only the holder of the original guest credential can move that participant and its role.
    const now = Date.now();
    const writes = await Promise.all(rooms.map(async entry => db().prepare(
      "UPDATE OR IGNORE participants SET account_id=? WHERE room_id=? AND token_hash=? AND (account_id IS NULL OR account_id=?) AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND expires_at>?) RETURNING room_id"
    ).bind(account.id,entry.id,await hash(entry.token),account.id,entry.id,now)));
    const results = await db().batch<{room_id:string}>(writes);
    return json({ ids:results.flatMap(row=>row.results.map(entry=>entry.room_id)) });
  });
}
