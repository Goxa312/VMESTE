export type Kind = "film" | "series" | "anime";
export type Video = { id: string; title: string; url: string; kind: Kind; poster: string; subtitle?: string; duration?: string; year?: string; demo?: boolean };
export type RoomState = { id: string; title: string; videoUrl: string; nativeSource?: import("./video-source").DirectSource | null; videoTitle: string; kind: Kind; poster: string; hostId: string; playing: boolean; position: number; revision: number; updatedAt: number; expiresAt: number };
export type Person = { id: string; name: string; color: number; online: boolean };
export type Message = { id: number; participantId: string; name: string; body: string; createdAt: number };
export type Snapshot = { room: RoomState; participants: Person[]; messages: Message[]; me: string; serverTime: number };
export const kinds: Record<Kind, string> = { film: "Фильм", series: "Сериал", anime: "Аниме" };
export const demos: Video[] = [
  { id: "sintel", title: "Синтел", url: "https://media.w3.org/2010/05/sintel/trailer.mp4", kind: "film", poster: "/images/sintel.jpg", subtitle: "Фэнтези · Трейлер", duration: "52 сек", year: "2010", demo: true },
  { id: "tears", title: "Слёзы стали", url: "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov", kind: "film", poster: "/images/tears.jpg", subtitle: "Фантастика · Короткий метр", duration: "12 мин", year: "2012", demo: true },
  { id: "bunny", title: "Большой Бак", url: "https://media.w3.org/2010/05/bunny/movie.mp4", kind: "film", poster: "/images/bunny.jpg", subtitle: "Анимация · Комедия", duration: "10 мин", year: "2008", demo: true },
  { id: "elephants", title: "Сон слонов", url: "https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov", kind: "film", poster: "/images/elephants.jpg", subtitle: "Анимация · Фантастика", duration: "11 мин", year: "2006", demo: true },
];
export function playbackPosition(room: Pick<RoomState, "position" | "playing" | "updatedAt">, serverNow: number) { return Math.max(0, room.position + (room.playing ? Math.max(0, serverNow - room.updatedAt) / 1000 : 0)); }
export function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00"; const s = Math.max(0, Math.floor(value));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
