export type DirectSource = { url: string; format: "file" | "hls" };
export type SourceMode = "direct" | "page" | "upload" | "local";
const mediaPath = /\.(mp4|m4v|mov|webm|ogv|m3u8)$/i;

export function mediaFormat(value: string): DirectSource["format"] {
  try { return /\.m3u8$/i.test(new URL(value).pathname) ? "hls" : "file"; }
  catch { return "file"; }
}

export function isKinogoPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["kinogo.my", "www.kinogo.my"].includes(url.hostname) &&
      /\/(?:page,\d+,\d+,)?\d+-[^/]+\.html$/i.test(url.pathname);
  } catch { return false; }
}

export function videoUrlError(value: string): string | null {
  if (value.length > 4000) return "Ссылка слишком длинная.";
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.hostname.includes(".") &&
        !/^\[|^\d+\.\d+\.\d+\.\d+$|\.(?:localhost|local|internal)\.?$/i.test(url.hostname)) return null;
  } catch { /* Invalid or relative address */ }
  return "Вставьте публичную ссылку на фильм или страницу сайта.";
}

export function linkMode(value: string): "page" | "direct" {
  try { return mediaPath.test(new URL(value).pathname) ? "direct" : "page"; }
  catch { return "page"; }
}

export function directSourceError(value: string): string | null {
  if (value.startsWith("blob:")) return "Эта ссылка работает только во вкладке сайта. Покажите вкладку или загрузите файл.";
  const invalid = videoUrlError(value);
  if (invalid) return invalid;
  const url = new URL(value);
  if (url.protocol !== "https:") return "Для общего плеера нужен адрес видео с HTTPS.";
  if (isKinogoPage(value) || /\.x?html?\/?$/i.test(url.pathname) ||
      /(^|\.)(youtube\.com|youtu\.be|netflix\.com)$/i.test(url.hostname)) {
    return "Это страница сайта. Выберите показ вкладки или вставьте адрес самого видео.";
  }
  return null;
}
