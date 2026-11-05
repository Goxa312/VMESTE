export const MiB = 1024 * 1024;
export const databaseFileLimit = 32 * MiB;
export const bucketFileLimit = 4 * 1024 * MiB;
export function videoMime(name: string) {
  if (/\.webm$/i.test(name)) return "video/webm";
  if (/\.(mp4|m4v)$/i.test(name)) return "video/mp4";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  return null;
}
export function fileSize(bytes: number) {
  return bytes >= 1024 * MiB ? `${+(bytes / (1024 * MiB)).toFixed(1)} ГБ` : `${+(bytes / MiB).toFixed(1)} МБ`;
}
export function byteRange(raw: string | null, size: number) {
  if (raw === null) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match || !(match[1] || match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && start <= end && start < size ? { start, end } : null;
}
