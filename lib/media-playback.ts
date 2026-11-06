import Hls, { ErrorDetails, ErrorTypes, type ErrorData } from "hls.js";
import type { DirectSource } from "./video-source";

function hlsFailure(data: ErrorData) {
  const status = data.response?.code || data.networkDetails?.status || 0;
  let resource = "плейлист фильма";
  if (data.details.startsWith("level")) resource = "плейлист качества";
  if (data.details.startsWith("audioTrack")) resource = "звуковую дорожку";
  if (data.details.startsWith("frag")) resource = "фрагмент фильма";
  if (data.details.startsWith("keyLoad")) resource = "ключ для фрагмента";
  // Only display the stage and the status. URLs and raw loader errors can contain signed tokens.
  if (status >= 400) {
    const hint = [401, 403, 404, 410].includes(status) ? "Получите свежую ссылку из фильма или выберите другой поток." : "Повторите проверку позже или выберите другой поток.";
    return { message: `Не удалось загрузить ${resource} (HTTP ${status}). ${hint}`, fallback: false };
  }
  if (data.type === ErrorTypes.KEY_SYSTEM_ERROR || data.details === ErrorDetails.FRAG_DECRYPT_ERROR) {
    return { message: "Плееру не удалось расшифровать этот поток. Выберите другой источник.", fallback: false };
  }
  if (data.details.toLowerCase().includes("timeout")) {
    return { message: "Истекло время ожидания при загрузке HLS. Попробуйте другой поток.", fallback: true };
  }
  if (data.details === ErrorDetails.MANIFEST_PARSING_ERROR || data.details === ErrorDetails.LEVEL_PARSING_ERROR) {
    return { message: "Источник ответил, но браузер не смог прочитать плейлист HLS. Проверьте другой найденный поток.", fallback: false };
  }
  if (data.type === ErrorTypes.NETWORK_ERROR) {
    return { message: `Браузер не смог загрузить ${resource}. Возможны сбой сети или ограничение доступа из комнаты. Попробуйте другой поток.`, fallback: true };
  }
  return { message: "Браузер не смог декодировать этот HLS-поток. Попробуйте другой вариант качества или другой источник.", fallback: true };
}

function mediaFailure(code: number) {
  if (code === 2) return "Загрузка видео прервалась. Повторите проверку ссылки.";
  if (code === 3) return "Браузер не смог декодировать кадры видео. Попробуйте другой поток.";
  return "Браузер не открыл источник. Проверьте доступность ссылки и поддержку формата.";
}

export function attachRoomMedia(video: HTMLVideoElement, source: DirectSource, onError: (message: string) => void, onProgress?: (message: string) => void, onLive?: (live:boolean)=>void) {
  let hls: Hls | null = null, closed = false, terminal = false, hadFrame = false;
  let nativeReason = "", pendingMediaError: ReturnType<typeof setTimeout> | undefined;
  const nativeSupport = source.format === "hls" ? video.canPlayType("application/vnd.apple.mpegurl") : "";
  const canPlayNative = Boolean(nativeSupport);
  let triedNative = false, triedHls = false;
  const frameReady = () => { hadFrame = true; nativeReason = ""; };
  function fail(message: string) {
    if (closed || terminal) return;
    terminal = true;
    onError(message);
  }
  function startNative() {
    triedNative = true;
    video.src = source.url;
    video.load();
  }
  function handleFailure(message: string, allowFallback: boolean) {
    if (closed || terminal) return;
    clearTimeout(pendingMediaError);
    if (allowFallback && hls && canPlayNative && !triedNative && !hadFrame) {
      nativeReason = message;
      const previous = hls;
      hls = null;
      previous.destroy();
      onProgress?.("Проверяем встроенное воспроизведение HLS…");
      startNative();
    } else fail(message);
  }
  function elementError() {
    if (!video.error || closed || terminal) return;
    const message = mediaFailure(video.error.code);
    if (!hls) {
      if (source.format === "hls" && !triedHls && !hadFrame && Hls.isSupported()) startHls();
      else fail(nativeReason || message);
      return;
    }
    // Prefer the loader's HTTP/codec diagnostic over a generic media error from the same event.
    clearTimeout(pendingMediaError);
    pendingMediaError = setTimeout(() => handleFailure(message, true), 0);
  }
  video.addEventListener("error", elementError);
  video.addEventListener("loadeddata", frameReady);
  function startHls() {
    triedHls = true;
    const engine = hls = new Hls({ maxBufferLength: 30 });
    onProgress?.("Загружаем плейлист HLS…");
    engine.on(Hls.Events.MANIFEST_PARSED, () => {
      if (engine === hls && !hadFrame && !terminal) onProgress?.("Плейлист прочитан. Загружаем первый кадр…");
    });
    engine.on(Hls.Events.LEVEL_LOADED, (_, data) => { if (engine === hls && !closed) onLive?.(data.details.live); });
    engine.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || engine !== hls) return;
      const failure = hlsFailure(data);
      handleFailure(failure.message, failure.fallback);
    });
    engine.loadSource(source.url);
    engine.attachMedia(video);
  }
  // Prefer native HLS when the browser is confident or only exposes Apple's managed media source.
  // Chromium may advertise "maybe" without being able to decode the playlist natively.
  const nativeFirst = nativeSupport === "probably" || (canPlayNative && "ManagedMediaSource" in globalThis && !globalThis.MediaSource);
  if (source.format === "file" || nativeFirst) startNative();
  else if (Hls.isSupported()) startHls();
  else if (canPlayNative) startNative();
  else fail("Этот браузер не поддерживает воспроизведение HLS.");
  return () => {
    closed = true;
    clearTimeout(pendingMediaError);
    video.removeEventListener("error", elementError);
    video.removeEventListener("loadeddata", frameReady);
    hls?.destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
