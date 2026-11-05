import { env } from "cloudflare:workers";
import type { Kind } from "./shared";
import { directSourceError, isKinogoPage, linkMode, videoUrlError, type SourceMode } from "./video-source";
export function db() { if (!env.DB) throw new Error("Database unavailable"); return env.DB; }
export class ApiError extends Error { constructor(message: string, public status = 400, public code?: string) { super(message); } }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
export async function safe(fn: () => Promise<Response>) { try { return await fn(); } catch (e) { if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status); console.error(e); return json({ error: "Сервер временно недоступен. Попробуйте ещё раз." }, 500); } }
export async function body(req: Request, limit = 12000): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") || 0) > limit) throw new ApiError("Слишком большой запрос", 413);
  const raw = await req.text(); if (raw.length > limit) throw new ApiError("Слишком большой запрос", 413);
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw 0; return value; } catch { throw new ApiError("Некорректный запрос"); }
}
export function str(v: unknown, label: string, max = 100) { if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new ApiError(`${label}: от 1 до ${max} символов`); return v.trim(); }
export function videoInput(v: Record<string, unknown>) {
  const title = str(v.title, "Название", 100), url = v.sourceMode === "upload" ? "" : v.sourceMode === "local" ? "local:" + randomId() : str(v.url, "Ссылка", 4000);
  const sourceMode: SourceMode = v.sourceMode === "upload" || v.sourceMode === "local" ? v.sourceMode : v.sourceMode === "direct" || v.sourceMode === "page" ? v.sourceMode : linkMode(url);
  const urlError = sourceMode === "upload" || sourceMode === "local" ? null : sourceMode === "direct" ? directSourceError(url) : videoUrlError(url);
  if (urlError) throw new ApiError(urlError);
  const kind: Kind = v.kind === "series" || v.kind === "anime" ? v.kind : "film";
  const poster = typeof v.poster === "string" && /^\/images\/[a-z]+\.jpg$/.test(v.poster) ? v.poster : "";
  return { title, url, kind, poster, sourceMode };
}
export function randomId() { return crypto.randomUUID().replaceAll("-", ""); }
export async function hash(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join(""); }
export function bearer(req: Request) { const token = req.headers.get("authorization")?.replace(/^Bearer /, ""); if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError("Войдите в комнату по приглашению", 401); return token; }
export type RoomRow = { id: string; title: string; video_url: string; video_title: string; media_url: string | null; media_format: "file" | "hls" | null; source_mode: SourceMode | null; share_id: string | null; kind: Kind; poster: string; host_id: string; playing: number; position: number; revision: number; updated_at: number; expires_at: number };
export function sourceMode(room: RoomRow): SourceMode {
  return room.source_mode ?? (isKinogoPage(room.video_url) ? "page" : "direct");
}
export function mediaCookie(response: Response, req: Request, code: string, token: string) {
  response.headers.append("Set-Cookie", `vm-film=${token}; Path=/api/rooms/${code}/uploads; Max-Age=604800; HttpOnly; SameSite=Strict${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}
export type MemberRow = { id: string; room_id: string; name: string; color: number; seen_at: number };
export async function getRoom(code: string) {
  if (!/^[a-z0-9]{12}$/.test(code)) throw new ApiError("Комната не найдена. Проверьте приглашение.", 404);
  const room = await db().prepare("SELECT * FROM rooms WHERE id = ?").bind(code).first<RoomRow>();
  if (!room) throw new ApiError("Комната не найдена. Проверьте приглашение.", 404);
  if (room.expires_at < Date.now()) throw new ApiError("Срок комнаты истёк. Создайте новую.", 410);
  return room;
}
export async function member(req: Request, code: string, token = bearer(req)) {
  const found = await db().prepare("SELECT * FROM participants WHERE room_id = ? AND token_hash = ?").bind(code, await hash(token)).first<MemberRow>();
  if (!found) throw new ApiError("Войдите в комнату по приглашению", 401); return found;
}
export async function snapshot(code: string, me: string) {
  const [r, people, chat] = await Promise.all([
    getRoom(code),
    db().prepare("SELECT id, name, color, seen_at FROM participants WHERE room_id = ? ORDER BY joined_at").bind(code).all<{ id: string; name: string; color: number; seen_at: number }>(),
    db().prepare("SELECT id, participant_id AS participantId, name, body, created_at AS createdAt FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 100").bind(code).all(),
  ]);
  const nativeSource = r.media_url && r.media_format ? { url: r.media_url, format: r.media_format } : null;
  return { room: { id: r.id, title: r.title, videoUrl: r.video_url, sourceMode: sourceMode(r), shareId: r.share_id, nativeSource, videoTitle: r.video_title, kind: r.kind, poster: r.poster, hostId: r.host_id, playing: !!r.playing, position: r.position, revision: r.revision, updatedAt: r.updated_at, expiresAt: r.expires_at }, participants: people.results.map(p => ({ id: p.id, name: p.name, color: p.color, online: Date.now() - p.seen_at < 25000 })), messages: chat.results.reverse(), me, serverTime: Date.now() };
}
