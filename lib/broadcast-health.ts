export type BroadcastPlayback = "waiting" | "playing" | "stalled" | "paused" | "blocked";

// A still picture or a paused host file can legitimately produce no new frames.
export const healthReply = /^health:(?:paused|lost|\d{1,16}\/\d{1,16})$/;
export type CaptureHealth = (sent: number) => string;

export function createVideoProbe() {
  let started = 0, requested = 0, answered = 0;
  let previous = "", interrupted = false;
  return {
    reset() { started = requested = answered = 0; previous = ""; interrupted = false; },
    receive(message: string) {
      if (!started || !healthReply.test(message)) return;
      answered = performance.now();
      if (message === "health:lost" || (previous && previous !== "health:paused" && message !== "health:paused" && message !== previous)) interrupted = true;
      previous = message;
    },
    // Only ask a producer for counters after the visible viewer has stopped displaying frames.
    // If the producer is also still, keep this stream and wait for it to move again.
    failed(send: () => void) {
      const now = performance.now();
      if (!started) started = now;
      if (interrupted || now - (answered || started) >= 6500) return true;
      if (!requested || now - requested >= 2200) { requested = now; send(); }
      return false;
    },
  };
}

export function observeBroadcastVideo(video: HTMLVideoElement, onFirstFrame: () => void) {
  let lastFrameAt = 0, previousCount = 0, frameId: number | undefined;
  const canObserve = typeof video.requestVideoFrameCallback === "function";
  const arrived = () => {
    if (!lastFrameAt) onFirstFrame();
    lastFrameAt = performance.now();
  };
  const arm = () => {
    if (canObserve && frameId === undefined) {
      frameId = video.requestVideoFrameCallback(() => { frameId = undefined; arrived(); });
    }
  };
  const allowTime = () => { if (lastFrameAt) lastFrameAt = performance.now(); };
  document.addEventListener("visibilitychange", allowTime);
  video.addEventListener("play", allowTime);
  arm();
  return {
    read(): BroadcastPlayback {
      if (!canObserve) {
        const count = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;
        if (video.readyState >= 2 && video.videoWidth > 0 && count !== previousCount) { previousCount = count; arrived(); }
      }
      arm();
      if (!lastFrameAt) return "waiting";
      if (video.ended || video.error) return "stalled";
      if (video.paused) return "paused";
      if (!document.hidden && performance.now() - lastFrameAt > 8500) return "stalled";
      return "playing";
    },
    stop() {
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      document.removeEventListener("visibilitychange", allowTime);
      video.removeEventListener("play", allowTime);
    },
  };
}
