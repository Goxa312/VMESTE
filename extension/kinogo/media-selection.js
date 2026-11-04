// Conservative automatic selection: short clips and trailers keep a manual button.
globalThis.VmesteAutoSelection = class {
  constructor() { this.reset(); }
  reset() { this.video = null; this.source = ''; this.since = 0; }
  ready(video, now = Date.now()) {
    if (!video || video.paused || video.ended || video.seeking || video.error || video.readyState < 2 ||
        !Number.isFinite(video.duration) || video.duration < 600 || !video.currentSrc) { this.reset(); return false; }
    if (this.video !== video || this.source !== video.currentSrc) {
      this.video = video; this.source = video.currentSrc; this.since = now; return false;
    }
    return now - this.since >= 3000;
  }
};
