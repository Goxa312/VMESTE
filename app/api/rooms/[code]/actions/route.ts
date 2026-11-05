import { safe, body, str, db, json, snapshot, getRoom, member, videoInput, sourceMode, randomId, ApiError } from "@/lib/server";
import { directSourceError } from "@/lib/video-source";
export async function POST(req: Request, context: { params: Promise<{ code: string }> }) { return safe(async () => {
  const { code } = await context.params, input = await body(req);
  const room = await getRoom(code), me = await member(req, code), now = Date.now();
  if (input.action === "message") {
    const text = str(input.text, "Сообщение", 500);
    const last = await db().prepare("SELECT created_at FROM messages WHERE room_id = ? AND participant_id = ? ORDER BY id DESC LIMIT 1").bind(code, me.id).first<{ created_at: number }>();
    if (last && now - last.created_at < 450) throw new ApiError("Подождите секунду перед следующим сообщением", 429);
    await db().prepare("INSERT INTO messages (room_id,participant_id,name,body,created_at) VALUES (?,?,?,?,?)").bind(code, me.id, me.name, text, now).run();
  } else if (input.action === "leave") {
    await db().prepare("UPDATE participants SET seen_at = 0 WHERE id = ?").bind(me.id).run(); return json({ ok: true });
  } else {
    if (room.host_id !== me.id) throw new ApiError("Плеером управляет ведущий комнаты", 403);
    if (input.revision !== room.revision) throw new ApiError("Состояние изменилось. Повторите действие.", 409);
    let result;
    if (input.action === "control") {
      if (typeof input.playing !== "boolean" || typeof input.position !== "number" || !Number.isFinite(input.position) || input.position < 0 || input.position > 604800) throw new ApiError("Некорректная позиция видео");
      result = await db().prepare("UPDATE rooms SET playing = ?, position = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(input.playing ? 1 : 0, input.position, now, code, room.revision).run();
    } else if (input.action === "player-source") {
      if (sourceMode(room) !== "page" || input.pageUrl !== room.video_url ||
          input.previousUrl !== (room.media_url ?? null)) throw new ApiError("Источник комнаты уже изменился. Откройте настройку заново.", 409);
      const url = input.url === null ? null : str(input.url, "Ссылка на видео", 4000);
      const error = url && directSourceError(url);
      if (error) throw new ApiError(error);
      const format = url ? input.format : null;
      if (url && format !== "hls" && format !== "file") throw new ApiError("Выберите формат видео.");
      const position = room.position + (room.playing ? Math.max(0, now - room.updated_at) / 1000 : 0);
      result = await db().prepare("UPDATE rooms SET media_url = ?, media_format = ?, share_id = NULL, playing = 0, position = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
        .bind(url, format, position, now, code, room.revision).run();
    } else if (input.action === "share-start" || input.action === "share-stop") {
      if (!["page", "local"].includes(sourceMode(room)) || room.media_url || input.pageUrl !== room.video_url || (input.action === "share-stop" && input.session !== room.share_id)) throw new ApiError("Источник изменился.", 409);
      result = await db().prepare("UPDATE rooms SET share_id = ?, playing = 0, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
        .bind(input.action === "share-start" ? randomId() : null, now, code, room.revision).run();
    } else if (input.action === "video") {
      const v = videoInput(input);
      result = await db().prepare("UPDATE rooms SET video_url = ?, video_title = ?, source_mode = ?, share_id = NULL, kind = ?, poster = ?, media_url = NULL, media_format = NULL, playing = 0, position = 0, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(v.url, v.title, v.sourceMode, v.kind, v.poster, now, code, room.revision).run();
    } else throw new ApiError("Неизвестное действие");
    if (!result.meta.changes) throw new ApiError("Состояние изменилось. Повторите действие.", 409);
  }
  return json(await snapshot(code, me.id));
}); }
