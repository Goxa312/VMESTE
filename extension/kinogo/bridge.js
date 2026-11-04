(() => {
  const APP_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'https://vmeste.dadvanigeorgii.workers.dev'];
  if (!APP_ORIGINS.includes(location.origin)) return;
  // Repair may inject into an already open tab. Keep exactly one live bridge.
  globalThis.__vmesteBridgeCleanup?.();
  const post = message => window.postMessage({ channel: 'vmeste-extension', ...message }, location.origin);
  const pending = new Map();
  const receive = event => {
    if (!chrome.runtime?.id || event.source !== window || event.origin !== location.origin || event.data?.channel !== 'vmeste-app') return;
    const message = event.data;
    if (message.type === 'control-result' || message.type === 'refresh-result') {
      const response = pending.get(message.requestId);
      if (response) { pending.delete(message.requestId); clearTimeout(response.timer); response.reply({ ok: message.ok === true, error: message.error, state: message.state }); }
      return;
    }
    if (!['ping', 'connect', 'state', 'disconnect'].includes(message.type) || typeof message.requestId !== 'string') return;
    if (message.type !== 'ping' && !/^\/room\/[a-z0-9]{12}\/?$/.test(location.pathname)) return;
    chrome.runtime.sendMessage({ channel: 'vmeste-extension', type: message.type, data: message.data })
      .then(result => post({ type: 'response', requestId: message.requestId, result }))
      .catch(() => { if (chrome.runtime?.id) post({ type: 'response', requestId: message.requestId, result: { error: 'Откройте значок «Вместе» и нажмите «Восстановить связь».' } }); });
  };
  const fromExtension = (message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'vmeste-extension' || !['control', 'refresh'].includes(message.type)) return;
    const timer = setTimeout(() => { pending.delete(message.requestId); reply({ ok: false, error: 'Комната не отвечает. Вернитесь во вкладку «Вместе».' }); }, 15000);
    pending.set(message.requestId, { reply, timer });
    post(message);
    return true;
  };
  window.addEventListener('message', receive);
  chrome.runtime.onMessage.addListener(fromExtension);
  globalThis.__vmesteBridgeCleanup = () => {
    window.removeEventListener('message', receive);
    chrome.runtime.onMessage.removeListener(fromExtension);
    for (const { timer, reply } of pending.values()) { clearTimeout(timer); reply({ ok: false, error: 'Восстанавливаем связь с комнатой' }); }
    pending.clear();
  };
  post({ type: 'ready', version: chrome.runtime.getManifest().version });
})();
