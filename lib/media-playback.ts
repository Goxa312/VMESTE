import Hls from "hls.js";
import type { DirectSource } from "./video-source";

export function attachRoomMedia(video: HTMLVideoElement, source: DirectSource, onError: (message: string) => void) {
  let hls: Hls | undefined;
  const failed = () => onError("Источник не открылся в этом браузере. Проверьте адрес, срок действия ссылки и доступ к видео.");
  video.addEventListener("error", failed);
  if (source.format === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onError("Не удалось воспроизвести HLS. Плейлист и сегменты должны открываться с сайта «Вместе».");
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else onError("Этот браузер не поддерживает данный HLS-поток.");
  } else {
    video.src = source.url;
    video.load();
  }
  return () => {
    video.removeEventListener("error", failed);
    hls?.destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
