(() => {
  const APP_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
  if (!APP_ORIGINS.includes(location.origin)) return;
  const post = message => window.postMessage({ channel: 'vmeste-extension', ...message }, location.origin);
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'vmeste-app') return;
    const message = event.data;
    if (message.type === 'control-result' || message.type === 'refresh-result') {
      const response = pending.get(message.requestId);
      if (response) { pending.delete(message.requestId); clearTimeout(response.timer); response.reply({ ok: message.ok === true, error: message.error, state: message.state }); }
      return;
    }
    if (!/^\/room\/[a-z0-9]{12}\/?$/.test(location.pathname) ||
        !['ping', 'connect', 'state', 'disconnect'].includes(message.type) || typeof message.requestId !== 'string') return;
    chrome.runtime.sendMessage({ channel: 'vmeste-extension', type: message.type, data: message.data })
      .then(result => post({ type: 'response', requestId: message.requestId, result }))
      .catch(() => post({ type: 'response', requestId: message.requestId, result: { error: 'Перезагрузите страницу после установки расширения' } }));
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'vmeste-extension' || !['control', 'refresh'].includes(message.type)) return;
    const timer = setTimeout(() => { pending.delete(message.requestId); reply({ ok: false, error: 'Комната не отвечает. Вернитесь во вкладку «Вместе».' }); }, 15000);
    pending.set(message.requestId, { reply, timer });
    post(message);
    return true;
  });
})();
