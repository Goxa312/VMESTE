const pageLinkError = "Это ссылка на страницу сайта, который пока не поддерживается. Подойдёт страница фильма с kinogo.my или прямая HTTPS-ссылка на MP4, WebM или HLS (.m3u8).";

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
