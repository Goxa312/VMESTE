import { env } from "cloudflare:workers";
import { ApiError, db, getRoom, json, member, randomId, str } from "./server";
import { byteRange, bucketFileLimit, databaseFileLimit, fileSize, MiB, videoMime } from "./upload-format";

type FileRow = {
  id: string; room_id: string; title: string; mime: string; size: number; backend: "r2" | "d1";
  multipart: string | null; state: string; revision: number; expires_at: number;
};
const partBytes = (row: FileRow) => row.backend === "r2" ? 8 * MiB : MiB;
const objectKey = (row: FileRow) => `rooms/${row.room_id}/${row.id}`;
const mediaPath = (row: FileRow) => `/api/rooms/${row.room_id}/uploads/${row.id}`;
export const uploadLimit = () => env.BUCKET ? bucketFileLimit : databaseFileLimit;
function bucket() {
  if (!env.BUCKET) throw new ApiError("Хранилище этого фильма временно недоступно.", 503);
  return env.BUCKET;
}
export async function uploadHost(req: Request, code: string) {
  const room = await getRoom(code), me = await member(req, code);
  if (room.host_id !== me.id) throw new ApiError("Только ведущий может загружать фильм.", 403);
  return room;
}
export async function fileRow(code: string, file: string) {
  const row = await db().prepare("SELECT * FROM uploads WHERE room_id = ? AND id = ?").bind(code, file).first<FileRow>();
  if (!row || row.expires_at <= Date.now()) throw new ApiError("Загрузка истекла. Выберите файл ещё раз.", 404);
  return row;
}
function settings(row: FileRow) {
  return db().prepare("SELECT part FROM upload_parts WHERE file_id = ? ORDER BY part").bind(row.id).all<{ part: number }>()
    .then(parts => ({ id: row.id, chunkSize: partBytes(row), parts: parts.results.map(p => p.part) }));
}
export async function beginUpload(req: Request, code: string, input: Record<string, unknown>) {
  const room = await uploadHost(req, code);
  const filename = str(input.fileName, "Файл", 255), title = str(input.title, "Название фильма", 100);
  const mime = videoMime(filename), size = input.size;
  if (!mime) throw new ApiError("Поддерживаются MP4, WebM и MOV.");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 12 || size > uploadLimit())
    throw new ApiError(`Размер файла должен быть до ${fileSize(uploadLimit())}.`, 413);
  if (room.revision !== input.revision) throw new ApiError("Комната изменилась. Откройте выбор фильма ещё раз.", 409);
  const now = Date.now(), id = randomId();
  const row: FileRow = { id, room_id: code, title, size, mime, revision: room.revision, state: "pending",
    backend: env.BUCKET ? "r2" : "d1", multipart: null, expires_at: Math.min(room.expires_at, now + 6 * 3600000) };
  const reservation = await db().prepare(`INSERT INTO uploads (id,room_id,title,mime,size,backend,state,revision,expires_at)
    SELECT ?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE id=? AND expires_at>?)
    AND (SELECT count(*) FROM uploads WHERE room_id=? AND state='pending' AND expires_at>?) < 3
    AND (?='r2' OR (SELECT COALESCE(sum(size),0) FROM uploads WHERE backend='d1') + ? <= ?)`)
    .bind(id, code, title, mime, size, row.backend, row.revision, row.expires_at, code, now, code, now, row.backend, size, 160 * MiB).run();
  if (!reservation.meta.changes) throw new ApiError("Хранилище заполнено. Завершите текущую загрузку или используйте ссылку.", 409);
  if (row.backend === "r2") {
    let upload: R2MultipartUpload | undefined;
    try {
      upload = await bucket().createMultipartUpload(objectKey(row), { httpMetadata: { contentType: mime } });
      const linked = await db().prepare("UPDATE uploads SET multipart=? WHERE id=? AND expires_at>?").bind(upload.uploadId, id, Date.now()).run();
      if (!linked.meta.changes) throw new ApiError("Комната или загрузка уже закрыта.", 410);
    } catch (error) {
      if (upload) await upload.abort().catch(() => {});
      await db().batch([db().prepare("DELETE FROM uploads WHERE id=?").bind(id), purgeClosedRoom(code)]);
      throw error;
    }
  }
  return json(await settings(row), 201);
}
async function readPart(req: Request, length: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("Часть файла не передана.");
  const data = new Uint8Array(length);
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (offset + value.length > length) { await reader.cancel(); throw new ApiError("Часть слишком велика.", 413); }
    data.set(value, offset); offset += value.length;
  }
  if (offset !== length) throw new ApiError("Часть передана не полностью.", 422);
  return data;
}
export async function putPart(req: Request, code: string, file: string) {
  await uploadHost(req, code);
  const row = await fileRow(code, file), part = Number(new URL(req.url).searchParams.get("part")), chunk = partBytes(row);
  if (row.state !== "pending" || !Number.isInteger(part) || part < 1 || part > Math.ceil(row.size / chunk)) throw new ApiError("Неверный номер части или загрузка уже завершена.");
  const data = await readPart(req, Math.min(chunk, row.size - (part - 1) * chunk));
  if (await db().prepare("SELECT part FROM upload_parts WHERE file_id=? AND part=?").bind(file, part).first()) return json({ ok: true });
  if (part === 1) {
    const valid = row.mime === "video/webm" ? [0x1a, 0x45, 0xdf, 0xa3].every((byte, i) => data[i] === byte)
      : ["ftyp", "moov", "mdat", "wide", "free"].includes(String.fromCharCode(...data.subarray(4, 8)));
    if (!valid) throw new ApiError("Содержимое файла не соответствует выбранному видеоформату.", 422);
  }
  let tag: string | null = null;
  if (row.backend === "r2") tag = (await bucket().resumeMultipartUpload(objectKey(row), row.multipart!).uploadPart(part, data)).etag;
  await db().prepare("INSERT INTO upload_parts (file_id,part,tag,data) VALUES (?,?,?,?) ON CONFLICT(file_id,part) DO UPDATE SET tag=excluded.tag,data=excluded.data")
    .bind(file, part, tag, row.backend === "d1" ? data.buffer : null).run();
  return json({ ok: true });
}
export async function finishUpload(req: Request, code: string, file: string) {
  const room = await uploadHost(req, code), row = await fileRow(code, file), url = mediaPath(row);
  if (row.state === "ready" && room.video_url === url) return json({ url });
  if (row.state !== "pending" || row.revision !== room.revision) throw new ApiError("За время загрузки источник изменился. Откройте файл ещё раз.", 409);
  const parts = await db().prepare("SELECT part AS partNumber,tag AS etag FROM upload_parts WHERE file_id=? ORDER BY part").bind(file).all<R2UploadedPart>();
  if (parts.results.length !== Math.ceil(row.size / partBytes(row))) throw new ApiError("Дождитесь загрузки всех частей.", 409);
  if (row.backend === "r2" && !(await bucket().head(objectKey(row)))) {
    try { await bucket().resumeMultipartUpload(objectKey(row), row.multipart!).complete(parts.results); }
    catch (error) { if ((await bucket().head(objectKey(row)))?.size !== row.size) throw error; }
  }
  const now = Date.now();
  const [result] = await db().batch([
    db().prepare("UPDATE rooms SET video_url=?,video_title=?,source_mode='upload',share_id=NULL,media_url=NULL,media_format=NULL,poster='',playing=0,position=0,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='pending')")
      .bind(url, row.title, now, code, row.revision, file),
    db().prepare("UPDATE uploads SET state='ready',expires_at=? WHERE id=? AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND video_url=?)").bind(room.expires_at, file, code, url),
    db().prepare("UPDATE uploads SET expires_at=? WHERE room_id=? AND id<>? AND state='ready' AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND video_url=?)").bind(now, code, file, code, url),
  ]);
  if (!result.meta.changes && (await getRoom(code)).video_url !== url) throw new ApiError("Источник уже изменился.", 409);
  return json({ url });
}
// Keep R2 metadata until external objects have actually been removed. Everything in D1 cascades.
export function purgeClosedRoom(code: string) {
  return db().prepare("DELETE FROM rooms WHERE id=? AND expires_at=0 AND NOT EXISTS (SELECT 1 FROM uploads WHERE room_id=? AND backend='r2')").bind(code, code);
}
async function remove(row: FileRow) {
  if (row.backend === "r2") {
    if (row.multipart && row.state === "pending") await bucket().resumeMultipartUpload(objectKey(row), row.multipart).abort().catch(() => {});
    await bucket().delete(objectKey(row));
  }
  const dropFile = db().prepare("DELETE FROM uploads WHERE id=?").bind(row.id);
  if (row.backend === "r2") await db().batch([dropFile, purgeClosedRoom(row.room_id)]);
  else await dropFile.run();
}
export async function cancelUpload(req: Request, code: string, file: string) {
  await uploadHost(req, code);
  const row = await fileRow(code, file);
  const claimed = await db().prepare("UPDATE uploads SET state='cancelled',expires_at=? WHERE id=? AND state='pending'").bind(Date.now(), file).run();
  if (claimed.meta.changes) await remove(row);
  return json({ ok: true });
}
export async function cleanExpiredMedia() {
  const rows = await db().prepare("SELECT * FROM uploads WHERE expires_at<=? ORDER BY expires_at LIMIT 20").bind(Date.now()).all<FileRow>();
  for (const row of rows.results) await remove(row);
  await db().prepare("DELETE FROM share_peers WHERE updated_at<?").bind(Date.now() - 3600000).run();
}
export async function serveFilm(req: Request, code: string, file: string) {
  const room = await getRoom(code);
  const token = req.headers.get("cookie")?.match(/(?:^|;\s*)vm-film=([a-f0-9]{64})(?:;|$)/)?.[1];
  await member(req, code, token);
  const row = await fileRow(code, file);
  if (room.video_url !== mediaPath(row) || row.state !== "ready") throw new ApiError("Фильм ещё не опубликован в этой комнате.", 404);
  const range = byteRange(req.headers.get("range"), row.size);
  const headers = new Headers({ "Accept-Ranges": "bytes", "Content-Type": row.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (!range) { headers.set("Content-Range", `bytes */${row.size}`); return new Response(null, { status: 416, headers }); }
  const { start, end } = range, length = end - start + 1, partial = req.headers.has("range");
  headers.set("Content-Length", String(length));
  if (partial) headers.set("Content-Range", `bytes ${start}-${end}/${row.size}`);
  const init = { status: partial ? 206 : 200, headers };
  if (req.method === "HEAD") return new Response(null, init);
  if (row.backend === "r2") {
    const object = await bucket().get(objectKey(row), { range: { offset: start, length } });
    if (!object) throw new ApiError("Файл не найден.", 404);
    return new Response(object.body, init);
  }
  let part = Math.floor(start / MiB);
  const database = db();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      const offset = part * MiB;
      const item = await database.prepare("SELECT data FROM upload_parts WHERE file_id=? AND part=?").bind(file, ++part).first<{ data: number[] | ArrayBuffer }>();
      if (!item) { controller.error(new Error("Missing file part")); return; }
      controller.enqueue(new Uint8Array(item.data).subarray(Math.max(0, start - offset), Math.min(MiB, end - offset + 1)));
      if (part * MiB > end) controller.close();
    },
  }), init);
}
