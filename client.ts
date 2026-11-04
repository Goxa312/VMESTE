import type { Snapshot } from "./shared";
export function readLocal<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } }
export function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable persistence. */ } }
export function libraryKey() { let key = readLocal("vm-library-key", ""); if (!key) { key = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); saveLocal("vm-library-key", key); } return key; }
export class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(url: string, token?: string, data?: unknown, method?: string): Promise<T> {
  const response = await fetch(url, { method: method || (data ? "POST" : "GET"), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined, cache: "no-store", signal: AbortSignal.timeout(12000) });
  const result = await response.json() as T & { error?: string }; if (!response.ok) throw new RequestError(result.error || "Не удалось выполнить запрос", response.status); return result;
}
export function rememberRoom(data: Snapshot & { token: string }) {
  saveLocal(`vm-room-${data.room.id}`, data.token);
  const recent = readLocal<{ id: string; title: string; videoTitle: string; poster: string }[]>("vm-recent", []);
  saveLocal("vm-recent", [{ id: data.room.id, title: data.room.title, videoTitle: data.room.videoTitle, poster: data.room.poster }, ...recent.filter(r => r.id !== data.room.id)].slice(0, 8));
}
