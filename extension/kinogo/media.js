(() => {
  let session, controller, selectedVideo, panel, statusText, selectButton, title;
  let polling = false, misses = 0, report = '', stopped = false;
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
  function text(message) { if (statusText) statusText.textContent = message; }
  function createPanel() {
    if (panel) { if (!panel.isConnected) document.documentElement?.append(panel); return; }
    if (!document.documentElement) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const shadow = panel.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}.box{box-sizing:border-box;width:285px;max-width:calc(100vw - 24px);padding:12px;border:1px solid #749366;border-radius:12px;background:#132018f5;color:#edf6e8;box-shadow:0 6px 24px #0008;font:12px/1.5 system-ui,sans-serif}.title{font-weight:700;margin-bottom:5px}.status{margin-bottom:9px}.buttons{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;cursor:pointer;border:1px solid #749366;border-radius:6px;padding:5px 8px;background:#233421;color:#edf6e8}button.primary{background:#baf0a2;color:#162b13}button:disabled{opacity:.5;cursor:wait}button[hidden]{display:none}';
    const box = document.createElement('div'); box.className = 'box';
    title = document.createElement('div'); title.className = 'title';
    statusText = document.createElement('div'); statusText.className = 'status'; statusText.setAttribute('role', 'status');
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    selectButton = document.createElement('button'); selectButton.className = 'primary'; selectButton.textContent = 'Подключить это видео';
    selectButton.addEventListener('click', async () => {
      const video = candidate(); if (!video || !session) return;
      selectButton.disabled = true;
      // Keep the browser's user activation when the guest enables sound.
      if (!session.state.isHost && session.state.playing) void video.play().catch(() => {});
      try {
        const result = await send('select');
        if (!result) throw new Error('Комната уже отключена');
        controller?.destroy(); session = result; selectedVideo = video;
        controller = new globalThis.VmesteMediaController(video,
          data => send('control', { data }), message => text(message));
        controller.update(session.state);
        if (session.state.isHost) controller.publish();
        controller.tick();
      } catch (error) { text(error.message); }
      finally { selectButton.disabled = false; }
    });
    const back = document.createElement('button'); back.textContent = 'К комнате';
    back.addEventListener('click', () => void send('focus-room').catch(error => text(error.message)));
    const disconnect = document.createElement('button'); disconnect.textContent = 'Отключить';
    disconnect.addEventListener('click', () => void send('disconnect').then(stop).catch(error => text(error.message)));
    buttons.append(selectButton, back, disconnect); box.append(title, statusText, buttons); shadow.append(style, box);
    document.documentElement.append(panel);
  }
  function stop() {
    stopped = true; controller?.destroy(); controller = null; panel?.remove(); panel = null;
    clearInterval(pollTimer); clearInterval(syncTimer);
  }
  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const next = await send('hello');
      if (!next) { if (session || ++misses > 15) stop(); return; }
      session = next; misses = 0;
      if (controller && (session.selectedFrameId !== session.frameId || !selectedVideo?.isConnected)) {
        const lost = !selectedVideo?.isConnected;
        controller.destroy(); controller = null; selectedVideo = null;
        if (lost) await send('report', { lost: true });
      }
      const video = candidate();
      if (topFrame || video) {
        createPanel();
        if (!panel) return;
        title.textContent = session.state.isHost ? 'Вместе · ведущий' : 'Вместе · участник';
        selectButton.hidden = !video || !!controller;
        if (!controller) text(Number.isInteger(session.selectedFrameId) ? 'Плеер подключён к комнате' : video ? 'Запустите фильм и подключите видео после рекламы.' : 'Запустите фильм. Кнопка подключения появится в его плеере.');
      }
      if (controller) {
        controller.update(session.state);
        const error = selectedVideo.error ? 'Киного не загрузил видео. Выберите другой плеер на сайте.' : '';
        if (error !== report) { report = error; await send('report', { error }); }
      }
    } catch (error) { text(error.message || 'Нет связи с расширением'); }
    finally { polling = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.channel === 'vmeste-extension' && message.type === 'stop') stop();
  });
  const pollTimer = setInterval(() => void poll(), 1000);
  const syncTimer = setInterval(() => controller?.tick(), 350);
  void poll();
})();
