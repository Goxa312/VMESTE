// Hand a large file to the room during client-side navigation without copying it.
let pending: { room: string; file: File } | undefined;
export function holdFilm(room: string, file: File) { pending = { room, file }; }
export function takeFilm(room: string) { return pending?.room === room ? pending.file : undefined; }
export function releaseFilm(room: string) { if (pending?.room === room) pending = undefined; }
