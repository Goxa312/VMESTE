const pageLinkError = "Это ссылка на страницу сайта, который пока не поддерживается. Подойдёт страница фильма с kinogo.my или прямая HTTPS-ссылка на MP4, WebM или HLS (.m3u8).";

export type DirectSource = { url: string; format: "file" | "hls" };

export function mediaFormat(value: string): DirectSource["format"] {
  try { return /\.m3u8$/i.test(new URL(value).pathname) ? "hls" : "file"; }
  catch { return "file"; }
}

/** Browser-playable media shared with room members. The Worker never fetches this URL. */
export function directSourceError(value: string): string | null {
  if (value.startsWith("blob:")) return "Ссылка blob: действует только в открытой вкладке. Нужен адрес самого файла или плейлиста HLS.";
  if (isKinogoPage(value)) return "Это страница фильма. Вставьте адрес видео или найдите его в запущенном плеере.";
  if (value.length > 4000) return "Ссылка слишком длинная.";
  let url: URL;
  try { url = new URL(value); } catch { return "Вставьте HTTPS-ссылку на видео."; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
      /^\[|^\d+\.\d+\.\d+\.\d+$|\.(?:localhost|local|internal)\.?$/i.test(url.hostname)) {
    return "Нужна публичная HTTPS-ссылка на видео.";
  }
  if (["kinogo.my", "www.kinogo.my"].includes(url.hostname) && /\.(?:mp4|webm|mov|m3u8)$/i.test(url.pathname)) return null;
  return videoUrlError(value);
}

export function isKinogoPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["kinogo.my", "www.kinogo.my"].includes(url.hostname) &&
      /\/(?:page,\d+,\d+,)?\d+-[^/]+\.html$/i.test(url.pathname);
  } catch { return false; }
}

// Check obvious page URLs without requesting arbitrary third-party resources.
// Direct media endpoints may have no extension or include a signed query string.
export function videoUrlError(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return "Введите прямую HTTPS-ссылку на видео"; }
  if (url.protocol !== "https:" || url.username || url.password) {
    return "Нужна прямая HTTPS-ссылка на видео без логина и пароля";
  }
  if (isKinogoPage(value)) return null;
  if (["kinogo.my", "www.kinogo.my"].includes(url.hostname)) return "Вставьте ссылку на страницу конкретного фильма или сериала с Киного.";
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { /* Keep malformed escapes for the media loader. */ }
  if (/\.(?:html?|xhtml)\/?$/i.test(pathname) ||
      ["youtube.com", "youtu.be", "netflix.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return pageLinkError;
  }
  return null;
}
