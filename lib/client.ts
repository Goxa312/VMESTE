import type { Kind, RoomState, Snapshot } from "./shared";
export function readLocal<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } }
export function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable persistence. */ } }
export function libraryKey() { let key = readLocal("vm-library-key", ""); if (!key) { key = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); saveLocal("vm-library-key", key); } return key; }
export class RequestError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message); this.status = status; this.code = code;
  }
}
export async function api<T>(url: string, token?: string, data?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Время ожидания истекло.", "TimeoutError")), 12000);
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(url, {
      method: method || (data ? "POST" : "GET"),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store", signal: controller.signal,
    });
    const result = await response.json() as T & { error?: string; code?: string };
    if (!response.ok) throw new RequestError(result.error || "Не удалось выполнить запрос", response.status, result.code);
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
export type RecentRoom = {
  id: string; title: string; videoTitle: string; poster: string; kind?: Kind; expiresAt?: number;
  position?: number; duration?: number; live?: boolean; sourceKey?: string; isHost?: number;
};

export function readRecentRooms(): RecentRoom[] {
  const rows = readLocal<unknown>("vm-recent", []);
  if (!Array.isArray(rows)) return [];
  return rows.filter((entry): entry is RecentRoom => entry && typeof entry.id === "string" &&
    /^[a-z0-9]{12}$/.test(entry.id) && typeof entry.videoTitle === "string" &&
    typeof entry.title === "string" && (entry.expiresAt === undefined || entry.expiresAt > Date.now()));
}

// A changed source resets its duration. Media URLs can contain credentials, so only keep a fingerprint.
function sourceKey(room: RoomState) {
  const source = room.nativeSource?.url || room.videoUrl;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function recordViewing(room: RoomState, position: number, duration?: number, promote = false) {
  if (room.expiresAt <= Date.now()) return;
  const rows = readRecentRooms(), index = rows.findIndex(entry => entry.id === room.id);
  const key = sourceKey(room);
  const live = !room.nativeSource && (room.sourceMode === "page" || room.sourceMode === "local");
  const knownDuration = duration && Number.isFinite(duration) && duration > 0 ? duration :
    index >= 0 && rows[index].sourceKey === key ? rows[index].duration : undefined;
  const updated: RecentRoom = {
    id: room.id, title: room.title, videoTitle: room.videoTitle, poster: room.poster, kind: room.kind,
    expiresAt: room.expiresAt, sourceKey: key, live,
    position: live || !Number.isFinite(position) ? undefined : Math.max(0, Math.min(position, knownDuration || Infinity)),
    duration: live ? undefined : knownDuration,
  };
  if (index >= 0) rows.splice(index, 1);
  rows.splice(promote || index < 0 ? 0 : index, 0, updated);
  saveLocal("vm-recent", rows.slice(0, 8));
}

export function rememberRoom(data: Snapshot & { token: string }) {
  if (data.accountMember) return;
  saveLocal(`vm-room-${data.room.id}`, data.token);
  recordViewing(data.room, data.room.position, undefined, true);
}
