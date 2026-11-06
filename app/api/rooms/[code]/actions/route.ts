import { safe, body, str, db, json, snapshot, getRoom, member, videoInput, sourceMode, randomId, ApiError, endRelay, sameOriginWrite } from "@/lib/server";
import { directSourceError } from "@/lib/video-source";

export async function POST(req: Request, context: { params: Promise<{ code: string }> }) { return safe(async () => {
  const { code } = await context.params, input = await body(req);
  const room = await getRoom(code), me = await member(req, code), now = Date.now();
  if (input.action === "set-break") {
    sameOriginWrite(req);
    const { away, previousChange } = input;
    if (typeof away !== "boolean" || typeof previousChange !== "number" || !Number.isSafeInteger(previousChange) || previousChange < 0)
      throw new ApiError("Некорректный статус перерыва.");
    // Only a fresh transition for the caller can pause the authoritative room clock.
    // A retried request after the host resumed, or one from an old tab, must not pause it again.
    const change = db().prepare(`UPDATE participants SET on_break=?1, break_changed_at=MAX(?2, break_changed_at+1), seen_at=MAX(seen_at,?2)
      WHERE room_id=?3 AND id=?4 AND break_changed_at=?5 AND on_break<>?1
      AND EXISTS(SELECT 1 FROM rooms WHERE id=?3 AND expires_at>?2)`).bind(away ? 1 : 0, now, code, me.id, previousChange);
    if (away) {
      const pause = db().prepare(`UPDATE rooms SET position=position+MAX(0,?1-updated_at)/1000.0, playing=0, updated_at=?1, revision=revision+1
        WHERE id=?2 AND expires_at>?1 AND playing=1 AND share_id IS NULL
        AND ((media_url<>'' AND media_format IN ('file','hls')) OR (video_url<>'' AND COALESCE(source_mode,?3) IN ('direct','upload')))
        AND EXISTS(SELECT 1 FROM participants WHERE room_id=?2 AND id=?4 AND on_break=0 AND break_changed_at=?5)`)
        .bind(now, code, sourceMode(room), me.id, previousChange);
      await db().batch([pause, change]);
    } else await change.run();
    const result = await snapshot(code, me.id);
    if (result.participants.find(p => p.id === me.id)?.onBreak !== away)
      throw new ApiError("Статус перерыва уже изменился. Проверьте его ещё раз.", 409);
    return json(result);
  }
  let startedShare: string | undefined;
  if (input.action === "message") {
    const text = str(input.text, "Сообщение", 500);
    const last = await db().prepare("SELECT created_at FROM messages WHERE room_id = ? AND participant_id = ? ORDER BY id DESC LIMIT 1").bind(code, me.id).first<{ created_at: number }>();
    if (last && now - last.created_at < 450) throw new ApiError("Подождите секунду перед следующим сообщением", 429);
    await db().prepare("INSERT INTO messages (room_id,participant_id,name,body,created_at) VALUES (?,?,?,?,?)").bind(code, me.id, me.name, text, now).run();
  } else if (input.action === "leave") {
    await db().prepare("UPDATE participants SET seen_at = 0 WHERE id = ?").bind(me.id).run(); return json({ ok: true });
  } else {
    if (room.host_id !== me.id) throw new ApiError("Плеером управляет ведущий комнаты", 403);
    // Capture cleanup can arrive after a host tab closes or after a new share starts.
    // Only the exact capture can end itself, independent of unrelated revisions.
    if (input.action === "share-stop") {
      if (typeof input.session !== "string" || !/^[a-f0-9]{32}$/.test(input.session) || typeof input.pageUrl !== "string") throw new ApiError("Некорректный сеанс.");
      const stopped = await db().prepare("UPDATE rooms SET share_id=NULL, playing=0, updated_at=?, revision=revision+1 WHERE id=? AND share_id=? AND video_url=?")
        .bind(now, code, input.session, input.pageUrl).run();
      if (stopped.meta.changes) await endRelay(code, input.session);
      return json(await snapshot(code, me.id));
    }
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
    } else if (input.action === "share-start") {
      if (!["page", "local"].includes(sourceMode(room)) || room.media_url || input.pageUrl !== room.video_url) throw new ApiError("Источник изменился.", 409);
      startedShare = randomId();
      result = await db().prepare("UPDATE rooms SET share_id = ?, playing = 0, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
        .bind(startedShare, now, code, room.revision).run();
    } else if (input.action === "video") {
      const v = videoInput(input);
      result = await db().prepare("UPDATE rooms SET video_url = ?, video_title = ?, source_mode = ?, share_id = NULL, kind = ?, poster = ?, media_url = NULL, media_format = NULL, playing = 0, position = 0, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(v.url, v.title, v.sourceMode, v.kind, v.poster, now, code, room.revision).run();
    } else throw new ApiError("Неизвестное действие");
    if (!result.meta.changes) throw new ApiError("Состояние изменилось. Повторите действие.", 409);
    if (input.action !== "control") await endRelay(code, room.share_id);
  }
  return json({ ...await snapshot(code, me.id), startedShare });
}); }
