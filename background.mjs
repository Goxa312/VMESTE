import { appRoom, playback, isMediaSender, validateControl, movieId } from './protocol.mjs';

let sessions;
let queue = Promise.resolve();
const refreshing = new WeakSet();
function enqueue(task) {
  const work = queue.then(task);
  queue = work.catch(() => {});
  return work;
}
async function load() {
  if (!sessions) sessions = (await chrome.storage.session.get('sessions')).sessions || {};
}
async function save() { await chrome.storage.session.set({ sessions }); }
async function send(tabId, message, options, timeout = 16000) {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message, options).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); })
    ]);
  } finally { clearTimeout(timer); }
}
function status(session) {
  return { installed: true, connected: !!session, hasPlayer: !!session && Number.isInteger(session.frameId),
    pageReady: !!session?.pageReady,
    error: session?.error || '', version: chrome.runtime.getManifest().version };
}
function applyState(session, state) {
  if (state.revision > session.state.revision ||
      (state.revision === session.state.revision && state.sampledAt >= session.state.sampledAt)) session.state = state;
}
function refreshRoom(key, session) {
  if (refreshing.has(session) || (session.refreshedAt && Date.now() - session.refreshedAt < 900)) return;
  refreshing.add(session);
  session.refreshedAt = Date.now();
  const previous = session.state;
  // An inactive room may answer slowly. Return the saved state to the player
  // immediately; never hold the command queue or panel creation on this request.
  void send(session.roomTabId, { channel: 'vmeste-extension', type: 'refresh', requestId: crypto.randomUUID(),
    roomId: session.roomId, sourceUrl: previous.sourceUrl }, { frameId: 0 }, 5000)
    .then(fresh => enqueue(async () => {
      if (sessions[key] !== session) return;
      let updated;
      try { if (fresh?.ok && fresh.state?.sourceUrl === previous.sourceUrl) updated = playback(fresh.state, session.roomId); } catch { /* Invalid or expired reply. */ }
      if (updated) applyState(session, updated);
      else if (session.state === previous) session.state = { ...previous, connected: false };
      await save();
    }))
    .catch(() => {})
    .finally(() => refreshing.delete(session));
}
async function stop(key) {
  const session = sessions[key];
  if (!session) return;
  delete sessions[key];
  await save();
  void send(session.mediaTabId, { channel: 'vmeste-extension', type: 'stop' });
}
async function handle(message, sender) {
  await load();
  const roomId = appRoom(sender);
  if (message.channel !== 'vmeste-extension') return null;
  if (roomId) {
    const key = String(sender.tab.id);
    if (message.type === 'ping') return status(sessions[key]);
    if (message.type === 'disconnect') { await stop(key); return status(null); }
    if (message.type === 'connect') {
      const state = playback(message.data, roomId);
      if (!state.connected) throw new Error('Сначала восстановите связь с комнатой');
      const existing = sessions[key];
      if (existing?.roomId === roomId && existing.state.sourceUrl === state.sourceUrl) {
        const tab = await chrome.tabs.get(existing.mediaTabId).catch(() => null);
        const id = movieId(state.sourceUrl);
        if (tab && (movieId(tab.url) === id || movieId(tab.pendingUrl) === id)) {
          applyState(existing, state);
          await save();
          await chrome.tabs.update(existing.mediaTabId, { active: true });
          return status(existing);
        }
      }
      await stop(key);
      const tab = await chrome.tabs.create({ url: state.sourceUrl, active: true });
      sessions[key] = { roomTabId: sender.tab.id, roomId, mediaTabId: tab.id, frameId: null, pageReady: false, state, error: '' };
      await save();
      return status(sessions[key]);
    }
    if (message.type === 'state') {
      const state = playback(message.data, roomId), session = sessions[key];
      if (!session) return status(null);
      if (state.sourceUrl !== session.state.sourceUrl || session.roomId !== roomId) { await stop(key); return status(null); }
      applyState(session, state);
      await save();
      return status(session);
    }
    throw new Error('Неизвестная команда комнаты');
  }
  const entry = Object.entries(sessions).find(([, session]) => isMediaSender(sender, session));
  if (!entry) return null;
  const [key, session] = entry;
  if (message.type === 'hello') {
    if (!session.pageReady) { session.pageReady = true; await save(); }
    refreshRoom(key, session);
    return { state: session.state, frameId: sender.frameId, selectedFrameId: session.frameId };
  }
  if (message.type === 'select') {
    session.frameId = sender.frameId;
    session.error = '';
    await save();
    return { state: session.state, frameId: sender.frameId, selectedFrameId: session.frameId };
  }
  if (message.type === 'report' && sender.frameId === session.frameId) {
    session.error = typeof message.error === 'string' ? message.error.slice(0, 200) : '';
    if (message.lost) session.frameId = null;
    await save();
    return { ok: true };
  }
  if (message.type === 'focus-room') { await chrome.tabs.update(session.roomTabId, { active: true }); return { ok: true }; }
  if (message.type === 'disconnect') { await stop(key); return { ok: true }; }
  if (message.type === 'control') {
    if (sender.frameId !== session.frameId || !session.state.isHost) throw new Error('Управляет только выбранный плеер ведущего');
    if (!session.state.connected || Date.now() - session.state.sampledAt > 10000) throw new Error('Нет связи с комнатой. Вернитесь во вкладку «Вместе».');
    const control = validateControl(message.data);
    return { pendingReply: send(session.roomTabId, { channel: 'vmeste-extension', type: 'control',
      requestId: crypto.randomUUID(), roomId: session.roomId, sourceUrl: session.state.sourceUrl, ...control }, { frameId: 0 }).then(reply => {
      if (!reply?.ok) throw new Error(reply?.error || 'Откройте вкладку комнаты и восстановите соединение');
      return { ok: true };
    }) };
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'vmeste-extension') return;
  // Serialize session changes, but let API replies finish outside the queue.
  const work = enqueue(() => handle(message, sender)).then(result => result?.pendingReply ?? result);
  work.then(respond, error => respond({ error: error.message || 'Не удалось подключить просмотр' }));
  return true;
});

function enqueueCleanup(predicate) {
  void enqueue(async () => {
    await load();
    for (const [key, session] of Object.entries(sessions)) if (predicate(session)) await stop(key);
  }).catch(() => {});
}
chrome.tabs.onRemoved.addListener(tabId => enqueueCleanup(s => s.roomTabId === tabId || s.mediaTabId === tabId));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) enqueueCleanup(s => (s.roomTabId === tabId && appRoom({ tab: { id: tabId }, frameId: 0, url: change.url }) !== s.roomId) ||
    (s.mediaTabId === tabId && movieId(change.url) !== movieId(s.state.sourceUrl)));
  if (change.status === 'loading') void enqueue(async () => {
    await load();
    for (const session of Object.values(sessions)) if (session.mediaTabId === tabId) {
      session.pageReady = false; session.frameId = null; session.error = '';
    }
    await save();
  }).catch(() => {});
});
