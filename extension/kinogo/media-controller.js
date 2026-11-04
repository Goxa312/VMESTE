// Runs in the extension's isolated world, never in the site's JavaScript world.
globalThis.VmesteMediaController = class {
  constructor(video, onControl, onStatus, now = () => Date.now()) {
    this.video = video; this.onControl = onControl; this.onStatus = onStatus; this.now = now;
    this.active = true; this.suppressUntil = 0; this.holdUntil = 0; this.sending = false;
    this.listener = event => this.changed(event);
    for (const name of ['play', 'pause', 'seeked', 'ended']) video.addEventListener(name, this.listener);
  }
  status(message) {
    if (this.lastStatus !== message) { this.lastStatus = message; this.onStatus(message); }
  }
  update(state) {
    if (this.state && (state.revision < this.state.revision ||
        (state.revision === this.state.revision && state.sampledAt < this.state.sampledAt))) return;
    if (this.state && state.revision > this.state.revision) this.holdUntil = 0;
    this.state = state;
  }
  changed(event) {
    if (!this.active || !this.state?.isHost) return;
    const data = { playing: !this.video.paused && !this.video.ended, position: this.video.currentTime };
    if (this.now() < this.suppressUntil && this.expected &&
        (event.type === 'seeked' ? Math.abs(data.position - this.expected.position) < 1 : data.playing === this.expected.playing)) return;
    this.publish(data);
  }
  publish(data = { playing: !this.video.paused && !this.video.ended, position: this.video.currentTime }) {
    if (!this.active || !this.state?.isHost || !Number.isFinite(data.position)) return;
    this.pending = data;
    this.holdUntil = this.now() + 2000;
    if (!this.sending) void this.flush();
  }
  async flush() {
    this.sending = true;
    while (this.pending && this.active) {
      const data = this.pending; this.pending = null;
      try { await this.onControl(data); }
      catch (error) { this.holdUntil = 0; this.status(error.message || 'Не удалось передать действие'); }
    }
    this.sending = false;
  }
  tick() {
    const s = this.state, v = this.video;
    if (!this.active || !s) return;
    if (!s.connected || this.now() - s.sampledAt > 10000) { this.status('Нет связи. Откройте вкладку комнаты.'); return; }
    if (v.error) { this.status('Киного не загрузил видео. Выберите другой плеер на сайте.'); return; }
    if (v.readyState < 1 || v.seeking) { this.status('Ожидаем загрузку видео…'); return; }
    if (this.sending || this.now() < this.holdUntil) return;
    const duration = Number.isFinite(v.duration) ? v.duration : Infinity;
    const target = Math.max(0, Math.min(duration, s.position + (s.playing ? Math.max(0, this.now() - s.sampledAt) / 1000 : 0)));
    const drift = target - v.currentTime;
    this.expected = { playing: s.playing, position: target };
    this.suppressUntil = this.now() + 500;
    if (Math.abs(drift) > .8 || (!s.playing && Math.abs(drift) > .12)) v.currentTime = target;
    v.playbackRate = s.playing && Math.abs(drift) > .18 && Math.abs(drift) <= .8 ? (drift > 0 ? 1.03 : .97) : 1;
    if (s.playing && v.paused && !v.ended) {
      void v.play().catch(() => this.status('Нажмите ▶ в плеере, чтобы разрешить звук.'));
    } else if (!s.playing && !v.paused) v.pause();
    this.status(s.isHost ? 'Вы ведущий · действия передаются в комнату' : 'Синхронизировано с ведущим');
  }
  destroy() {
    this.active = false; this.pending = null;
    for (const name of ['play', 'pause', 'seeked', 'ended']) this.video.removeEventListener(name, this.listener);
    this.video.playbackRate = 1;
  }
};
