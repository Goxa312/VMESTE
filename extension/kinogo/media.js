(() => {
  if (globalThis.__vmesteMedia?.alive()) { globalThis.__vmesteMedia.wake(); return; }
  globalThis.__vmesteMedia?.dispose();
  let session, controller, selectedVideo, panel, statusText, selectButton, title, box, expandButton;
  let polling = false, report = '', nextPoll = 0, selecting = false, selectedSource = '', compact = false;
  const autoSelection = new globalThis.VmesteAutoSelection();
  const topFrame = window === window.top;
  const send = async (type, data = {}) => {
    const reply = await chrome.runtime.sendMessage({ channel: 'vmeste-extension', type, ...data });
    if (reply?.error) throw new Error(reply.error);
    return reply;
  };
  function candidate() {
    return [...document.querySelectorAll('video')].filter(video => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 90 && getComputedStyle(video).visibility !== 'hidden';
    }).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
  }
  function pageHasContent() {
    // Our panel lives outside body, so it cannot make an empty site look ready.
    if (topFrame && (document.body?.innerText || '').trim().length >= 40) return true;
    return !!candidate();
  }
  function text(message) { if (statusText) statusText.textContent = message; }
  function collapse(value) {
    compact = value;
    if (box) box.className = compact ? 'box compact' : 'box';
    if (expandButton) expandButton.textContent = compact ? 'Развернуть' : 'Свернуть';
  }
  async function select(video, automatic = false) {
    if (!video || !session || selecting) return;
    selecting = true;
    if (selectButton) selectButton.disabled = true;
    if (!automatic && !session.state.isHost && session.state.playing) void video.play().catch(() => {});
    try {
      const result = await send('select', { data: { automatic } });
      if (!result) throw new Error('Комната уже отключена');
      session = result;
      if (result.selectedFrameId !== result.frameId) return;
      controller?.destroy(); selectedVideo = video; selectedSource = video.currentSrc;
      controller = new globalThis.VmesteMediaController(video, data => send('control', { data }), text);
      controller.update(session.state);
      if (session.state.isHost) controller.publish();
      controller.tick(); collapse(true);
    } catch (error) { text(error.message); }
    finally { selecting = false; if (selectButton) selectButton.disabled = false; }
  }
  function createPanel() {
    if (panel) { if (!panel.isConnected) document.documentElement?.append(panel); return; }
    if (!document.documentElement) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const shadow = panel.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}.box{box-sizing:border-box;width:285px;max-width:calc(100vw - 24px);padding:12px;border:1px solid #749366;border-radius:12px;background:#132018f5;color:#edf6e8;box-shadow:0 6px 24px #0008;font:12px/1.5 system-ui,sans-serif}.title{font-weight:700;margin-bottom:5px}.status{margin-bottom:9px}.buttons{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;cursor:pointer;border:1px solid #749366;border-radius:6px;padding:5px 8px;background:#233421;color:#edf6e8}button.primary{background:#baf0a2;color:#162b13}button:disabled{opacity:.5;cursor:wait}button[hidden]{display:none}.compact{width:210px;padding:9px 12px}.compact .buttons{display:none}.compact .status{font-size:11px;margin-bottom:3px}.toggle{border:0;background:transparent;color:#baf0a2;padding:2px 0;font-size:10px}';
    box = document.createElement('div'); box.className = 'box';
    title = document.createElement('div'); title.className = 'title';
    statusText = document.createElement('div'); statusText.className = 'status'; statusText.setAttribute('role', 'status');
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    selectButton = document.createElement('button'); selectButton.className = 'primary'; selectButton.textContent = 'Подключить это видео';
    selectButton.addEventListener('click', () => void select(candidate()));
    const back = document.createElement('button'); back.textContent = 'К комнате';
    back.addEventListener('click', () => void send('focus-room').catch(error => text(error.message)));
    const disconnect = document.createElement('button'); disconnect.textContent = 'Отключить';
    disconnect.addEventListener('click', () => void send('disconnect').then(stop).catch(error => text(error.message)));
    expandButton = document.createElement('button'); expandButton.className = 'toggle'; expandButton.textContent = 'Свернуть';
    expandButton.addEventListener('click', () => collapse(!compact));
    buttons.append(selectButton, back, disconnect); box.append(title, statusText, buttons, expandButton); shadow.append(style, box);
    document.documentElement.append(panel);
  }
  function stop() {
    controller?.destroy(); controller = null; panel?.remove(); panel = null;
    session = null; selectedVideo = null; selectedSource = ''; autoSelection.reset(); compact = false; nextPoll = Date.now() + 4000;
  }
  async function poll() {
    if (polling || Date.now() < nextPoll) return;
    if (!chrome.runtime?.id) { globalThis.__vmesteMedia.dispose(); return; }
    polling = true;
    try {
      const next = await send('hello', { data: { pageReady: pageHasContent() } });
      if (!next) { stop(); return; }
      session = next;
      if (controller && (session.selectedFrameId !== session.frameId || !selectedVideo?.isConnected || selectedVideo.currentSrc !== selectedSource)) {
        const lost = !selectedVideo?.isConnected || selectedVideo.currentSrc !== selectedSource;
        controller.destroy(); controller = null; selectedVideo = null;
        autoSelection.reset(); collapse(false);
        if (lost && session.selectedFrameId === session.frameId) { await send('report', { lost: true }); session.selectedFrameId = null; }
      }
      const video = candidate();
      if (topFrame || video) {
        createPanel();
        if (!panel) return;
        panel.style.display = Number.isInteger(session.selectedFrameId) && session.selectedFrameId !== session.frameId ? 'none' : '';
        title.textContent = session.state.isHost ? 'Together Tonight · ведущий' : 'Together Tonight · участник';
        selectButton.hidden = !video || !!controller;
        if (!controller) text(Number.isInteger(session.selectedFrameId) ? 'Плеер подключён к комнате' : video ? 'Запустите фильм — подключим автоматически. Короткое видео можно выбрать кнопкой.' : 'Запустите фильм в плеере. Подключение начнётся автоматически.');
      }
      if (!controller && !Number.isInteger(session.selectedFrameId) && autoSelection.ready(video)) await select(video, true);
      if (controller) {
        controller.update(session.state);
        const error = selectedVideo.error ? 'Киного не загрузил видео. Выберите другой плеер на сайте.' : '';
        if (error !== report) { report = error; await send('report', { error }); }
      }
    } catch (error) { text(error.message || 'Нет связи с расширением'); }
    finally { polling = false; }
  }
  const receive = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'vmeste-extension') return;
    if (message.type === 'media-sources') {
      const selected = controller && session?.state.isHost && session.selectedFrameId === session.frameId &&
        selectedVideo?.currentSrc === selectedSource;
      respond({ candidates: selected ? globalThis.vmesteFilmSources(selectedVideo, performance.getEntriesByType('resource')) : [] });
      return;
    }
    if (message.type === 'stop') {
      const previous = selectedVideo;
      stop();
      if (message.pause) previous?.pause();
    }
    if (message.type === 'wake') { nextPoll = 0; void poll(); }
  };
  chrome.runtime.onMessage.addListener(receive);
  const pollTimer = setInterval(() => void poll(), 1000);
  const syncTimer = setInterval(() => controller?.tick(), 350);
  globalThis.__vmesteMedia = {
    alive: () => !!chrome.runtime?.id,
    wake: () => { nextPoll = 0; void poll(); },
    dispose: () => { stop(); clearInterval(pollTimer); clearInterval(syncTimer); chrome.runtime.onMessage.removeListener(receive); }
  };
  void poll();
})();
