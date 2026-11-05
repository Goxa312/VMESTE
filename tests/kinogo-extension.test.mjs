import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { appRoom, isAppSender, movieId, moviePageUrl, playback } from '../extension/kinogo/protocol.mjs';
import { isKinogoPage, videoUrlError } from '../lib/video-source.ts';

const movie = 'https://kinogo.my/films/page,1,2,53645-obitel-zla-219.html';
const roomId = 'abcdef123456';
const sample = (extra = {}) => ({ roomId, sourceUrl: movie, isHost: true, playing: false, position: 0, revision: 0, sampledAt: Date.now(), connected: true, ...extra });
test('ordinary Kinogo film URLs are accepted, lookalikes and home pages are not', () => {
  assert.equal(isKinogoPage(movie), true);
  assert.equal(videoUrlError(movie), null);
  assert.equal(movieId(movie), '53645');
  for (const bad of ['https://kinogo.my.evil.test/films/123-a.html', 'https://kinogo.my/', 'https://kinogo.my:444/123-a.html', 'https://x:pass@kinogo.my/123-a.html']) {
    assert.equal(isKinogoPage(bad), false); assert.equal(movieId(bad), null);
  }
  assert.ok(videoUrlError('https://example.com/movie.html'));
  assert.equal(videoUrlError('https://example.com/video.mp4?signature=123'), null);
});
test('only top-level room pages on the configured origin can connect', () => {
  const sender = { tab: { id: 1 }, frameId: 0, url: `http://127.0.0.1:5173/room/${roomId}` };
  assert.equal(appRoom(sender), roomId);
  assert.equal(appRoom({ ...sender, frameId: 2 }), null);
  assert.equal(appRoom({ ...sender, url: `http://127.0.0.1:9000/room/${roomId}` }), null);
  assert.equal(appRoom({ ...sender, url: `https://kinogo.my/room/${roomId}` }), null);
  assert.throws(() => playback(sample({ position: Infinity }), roomId));
  assert.throws(() => playback(sample({ sampledAt: Date.now() - 60000 }), roomId));
  assert.equal('token' in playback(sample({ token: 'secret', messages: ['private'] }), roomId), false);
});

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../extension/kinogo/media-controller.js', import.meta.url), 'utf8'), context);
const Controller = context.VmesteMediaController;
class Video extends EventTarget {
  constructor() { super(); this._time = 0; this.paused = true; this.ended = false; this.readyState = 4; this.duration = 120; this.playbackRate = 1; this.seeking = false; this.error = null; }
  get currentTime() { return this._time; }
  set currentTime(value) { this._time = value; this.dispatchEvent(new Event('seeked')); }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
test('late guest joins the current timeline and never publishes local playback events', async () => {
  const video = new Video(), commands = [];
  const controller = new Controller(video, async data => commands.push(data), () => {}, () => 100000);
  controller.update(sample({ isHost: false, playing: true, position: 10, sampledAt: 95000 })); controller.tick();
  assert.equal(video.currentTime, 15); assert.equal(video.paused, false);
  video.currentTime = 80; video.pause(); controller.tick();
  assert.equal(video.currentTime, 15); assert.equal(video.paused, false); assert.equal(commands.length, 0);
  controller.destroy();
});
test('remote pause/seek does not echo, but a real host action is published', async () => {
  const video = new Video(), commands = [];
  await video.play();
  const controller = new Controller(video, async data => commands.push(data), () => {}, () => 100000);
  controller.update(sample({ playing: false, position: 42, sampledAt: 100000 })); controller.tick();
  assert.equal(video.currentTime, 42); assert.equal(video.paused, true); assert.equal(commands.length, 0);
  await video.play(); await Promise.resolve();
  assert.equal(commands.length, 1); assert.equal(commands[0].playing, true); assert.equal(commands[0].position, 42);
  controller.destroy(); video.pause(); assert.equal(commands.length, 1);
});
test('old snapshots cannot undo a newer seek; stale connection stops correction', () => {
  const video = new Video(), messages = [];
  const controller = new Controller(video, async () => {}, m => messages.push(m), () => 100000);
  controller.update(sample({ revision: 2, position: 50, sampledAt: 100000 }));
  controller.update(sample({ revision: 1, position: 5, sampledAt: 100001 })); controller.tick(); assert.equal(video.currentTime, 50);
  controller.update(sample({ revision: 3, position: 80, sampledAt: 80000 })); controller.tick(); assert.equal(video.currentTime, 50);
  assert.ok(messages.at(-1).includes('Нет связи')); controller.destroy();
});

let listener, removed, updated, installed, stored = {}, nextTab = 100;
const sent = [], activated = [], appStates = new Map(), tabs = new Map(), refreshReplies = new Map(), controlReplies = new Map();
const injected = [];
const createdOptions = [];
const reloaded = [], scheduledAlarms = new Map();
const manifest = JSON.parse(await readFile(new URL('../extension/kinogo/manifest.json', import.meta.url), 'utf8'));
globalThis.chrome = {
  runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, getManifest: () => manifest, onMessage: { addListener: f => { listener = f; } }, onInstalled: { addListener: f => { installed = f; } } },
  scripting: { executeScript: async options => { injected.push(options); return []; } },
  storage: { session: { get: async () => structuredClone(stored), set: async value => { stored = structuredClone(value); } }, local: { get: async () => ({}), set: async () => {} } },
  permissions: { contains: async () => false },
  alarms: { create: async (name, options) => scheduledAlarms.set(name, options), clear: async name => scheduledAlarms.delete(name), onAlarm: { addListener() {} } },
  tabs: {
    query: async ({ url }) => [...tabs.values()].filter(tab => url.some(pattern => (tab.url || tab.pendingUrl || '').startsWith(pattern.slice(0, -1)))),
    create: async options => { createdOptions.push(options); const tab = { id: ++nextTab, pendingUrl: options.url, status: 'loading', incognito: options.windowId === 900 }; tabs.set(tab.id, tab); return tab; },
    get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
    update: async (id, options) => { activated.push({ id, options }); return tabs.get(id) || {}; },
    reload: async (id, options) => { reloaded.push({ id, options }); },
    sendMessage: async (tabId, message) => {
      sent.push({ tabId, message });
      if (message.type === 'refresh') return refreshReplies.get(tabId)?.() ?? { ok: true, state: appStates.get(tabId) };
      if (message.type === 'control' && controlReplies.has(tabId)) return controlReplies.get(tabId)();
      return { ok: true };
    },
    onRemoved: { addListener: f => { removed = f; } }, onUpdated: { addListener: f => { updated = f; } }
  }
};
await import('../extension/kinogo/background.mjs');
const app = id => ({ id: 'extension', tab: { id }, frameId: 0, url: `http://127.0.0.1:5173/room/${roomId}` });
const media = (tabId, frameId = 7, url = 'https://kinogomy.stravers.live/') => ({ tab: { id: tabId, url: movie }, frameId, url });
const dispatch = (sender, type, data) => new Promise(resolve => listener({ channel: 'vmeste-extension', type, data }, sender, resolve));

test('only the owning host room can request a source from its selected film frame', async () => {
  const host = app(81), stream = 'https://example.test/film.m3u8?signature=keep';
  await dispatch(host, 'connect', sample());
  const tabId = stored.sessions['81'].mediaTabId;
  await dispatch(media(tabId, 7), 'select');
  const original = chrome.tabs.sendMessage, imports = [];
  chrome.tabs.sendMessage = (id, message, options) => {
    if (message.type !== 'media-sources') return original(id, message, options);
    imports.push({ id, frameId: options.frameId });
    return Promise.resolve({ candidates: [{ url: stream, format: 'hls' }, { url: 'blob:https://kinogo.my/id', format: 'file' }] });
  };
  try {
    const result = await dispatch(host, 'media-sources', { sourceUrl: movie });
    assert.deepEqual(result.candidates, [{ url: stream, format: 'hls' }]);
    assert.deepEqual(imports, [{ id: tabId, frameId: 7 }]);
    assert.ok((await dispatch(app(82), 'media-sources', { sourceUrl: movie })).error);
    assert.equal(await dispatch({ ...host, url: 'https://unrelated.test/' }, 'media-sources', { sourceUrl: movie }), null);
    await dispatch(host, 'state', sample({ isHost: false, revision: 1 }));
    assert.ok((await dispatch(host, 'media-sources', { sourceUrl: movie })).error);
    assert.equal(imports.length, 1);
  } finally { chrome.tabs.sendMessage = original; await dispatch(host, 'disconnect'); }
});

test('bridge isolates tabs and frames, authorizes host control and refreshes background rooms', async () => {
  appStates.set(1, sample());
  assert.equal((await dispatch(app(1), 'connect', sample({ token: 'must-stay-private' }))).connected, true);
  const mediaTab = stored.sessions['1'].mediaTabId;
  assert.equal(JSON.stringify(stored).includes('must-stay-private'), false);
  assert.equal(await dispatch(media(999), 'hello'), null);
  assert.equal(await dispatch(media(mediaTab, 7, 'https://unrelated.test/'), 'hello'), null);
  const hello = await dispatch(media(mediaTab), 'hello');
  assert.equal(hello.state.roomId, roomId);
  assert.ok(sent.some(item => item.tabId === 1 && item.message.type === 'refresh'));
  assert.ok((await dispatch(media(mediaTab), 'control', { playing: true, position: 10 })).error);
  await dispatch(media(mediaTab), 'select');
  assert.equal((await dispatch(media(mediaTab), 'control', { playing: true, position: 10 })).ok, true);
  assert.ok((await dispatch(media(mediaTab, 8), 'control', { playing: false, position: 10 })).error);
  assert.ok((await dispatch(media(mediaTab), 'control', { playing: true, position: -1 })).error);
  await dispatch(app(1), 'state', sample({ isHost: false, revision: 1 }));
  assert.ok((await dispatch(media(mediaTab), 'control', { playing: true, position: 10 })).error);
  await dispatch(app(1), 'disconnect');
  assert.equal(await dispatch(media(mediaTab), 'hello'), null);
});
test('closing the room or navigating to another film revokes the media session', async () => {
  await dispatch(app(2), 'connect', sample());
  const firstTab = stored.sessions['2'].mediaTabId;
  removed(2); await dispatch(app(2), 'ping'); assert.equal(await dispatch(media(firstTab), 'hello'), null);
  await dispatch(app(3), 'connect', sample());
  const secondTab = stored.sessions['3'].mediaTabId;
  updated(secondTab, { url: 'https://kinogo.my/films/999-another-film.html' });
  await dispatch(app(3), 'ping'); assert.equal(await dispatch(media(secondTab), 'hello'), null);
});

test('opening Kinogo twice reuses the loading tab and preserves the chosen player', async () => {
  const firstMessage = sent.length;
  await dispatch(app(10), 'connect', sample());
  const firstTab = stored.sessions['10'].mediaTabId;
  await dispatch(media(firstTab), 'select');
  const before = nextTab;
  const result = await dispatch(app(10), 'connect', sample());
  assert.equal(nextTab, before, 'a second click must not open another tab');
  assert.equal(stored.sessions['10'].mediaTabId, firstTab);
  assert.equal(result.hasPlayer, true, 'the first player must remain connected');
  assert.equal(activated.at(-1).id, firstTab);
  assert.equal(sent.slice(firstMessage).some(item => item.tabId === firstTab && item.message.type === 'stop'), false);
  await dispatch(app(10), 'disconnect');
});

test('a slow background room cannot delay the first panel, status or repeat open', async () => {
  let finishRefresh;
  refreshReplies.set(11, () => new Promise(resolve => { finishRefresh = resolve; }));
  await dispatch(app(11), 'connect', sample());
  const tabId = stored.sessions['11'].mediaTabId;
  let helloSettled = false, pingSettled = false, openSettled = false;
  const hello = dispatch(media(tabId), 'hello').then(result => { helloSettled = true; return result; });
  const ping = dispatch(app(11), 'ping').then(result => { pingSettled = true; return result; });
  const reopen = dispatch(app(11), 'connect', sample()).then(result => { openSettled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  const responsive = { helloSettled, pingSettled, openSettled };
  finishRefresh({ ok: true, state: sample() });
  await Promise.all([hello, ping, reopen]);
  refreshReplies.delete(11);
  await dispatch(app(11), 'disconnect');
  assert.deepEqual(responsive, { helloSettled: true, pingSettled: true, openSettled: true });
});

test('a late refresh never rolls back newer playback or restores a disconnected session', async () => {
  let finishRefresh;
  refreshReplies.set(12, () => new Promise(resolve => { finishRefresh = resolve; }));
  await dispatch(app(12), 'connect', sample());
  const tabId = stored.sessions['12'].mediaTabId;
  await dispatch(media(tabId), 'hello');
  await dispatch(app(12), 'state', sample({ revision: 4, position: 70 }));
  finishRefresh({ ok: true, state: sample({ revision: 1, position: 3 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stored.sessions['12'].state.revision, 4);
  assert.equal(stored.sessions['12'].state.position, 70);
  await dispatch(app(12), 'disconnect');

  await dispatch(app(12), 'connect', sample());
  const replacement = stored.sessions['12'].mediaTabId;
  await dispatch(media(replacement), 'hello');
  await dispatch(app(12), 'disconnect');
  finishRefresh({ ok: true, state: sample() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stored.sessions['12'], undefined);
  refreshReplies.delete(12);
});

test('pending playback control cannot block status or disconnect', async () => {
  let finishControl;
  controlReplies.set(13, () => new Promise(resolve => { finishControl = resolve; }));
  await dispatch(app(13), 'connect', sample());
  const tabId = stored.sessions['13'].mediaTabId;
  await dispatch(media(tabId), 'select');
  const control = dispatch(media(tabId), 'control', { playing: true, position: 10 });
  let disconnected = false;
  const disconnect = dispatch(app(13), 'disconnect').then(() => { disconnected = true; });
  await new Promise(resolve => setImmediate(resolve));
  const responsive = disconnected;
  finishControl({ ok: true });
  await Promise.all([control, disconnect]);
  controlReplies.delete(13);
  assert.equal(responsive, true);
  assert.equal(stored.sessions['13'], undefined);
});

test('reloading a movie clears its old player; a missing tab can be opened again', async () => {
  appStates.set(14, sample());
  await dispatch(app(14), 'connect', sample());
  const tabId = stored.sessions['14'].mediaTabId;
  await dispatch(media(tabId), 'hello');
  await dispatch(media(tabId), 'select');
  assert.equal((await dispatch(app(14), 'ping')).pageReady, true);
  updated(tabId, { status: 'loading' });
  const status = await dispatch(app(14), 'ping');
  assert.equal(status.connected, true);
  assert.equal(status.pageReady, false);
  assert.equal(status.hasPlayer, false);
  tabs.delete(tabId);
  await dispatch(app(14), 'connect', sample());
  assert.notEqual(stored.sessions['14'].mediaTabId, tabId);
  await dispatch(app(14), 'disconnect');
});

test('media panel survives document_start and appears before the page finishes loading', async () => {
  const nodes = [], timers = [], errors = [], hellos = [];
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.isConnected = false; nodes.push(this); }
    append(...children) { this.children.push(...children); for (const child of children) child.isConnected = true; }
    attachShadow() { return new Element('shadow'); }
    setAttribute() {}
    addEventListener() {}
    remove() { this.isConnected = false; }
  }
  const video = { getBoundingClientRect: () => ({ width: 640, height: 360 }) };
  const doc = { documentElement: null, readyState: 'loading', createElement: tag => new Element(tag), querySelectorAll: () => [] };
  const win = {}; win.top = win;
  const selectorContext = vm.createContext({});
  vm.runInContext(await readFile(new URL('../extension/kinogo/media-selection.js', import.meta.url), 'utf8'), selectorContext);
  vm.runInNewContext(await readFile(new URL('../extension/kinogo/media.js', import.meta.url), 'utf8'), {
    document: doc, window: win, getComputedStyle: () => ({ visibility: 'visible' }),
    VmesteAutoSelection: selectorContext.VmesteAutoSelection,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {},
    chrome: { runtime: { id: 'extension', onMessage: { addListener() {} },
      sendMessage: async message => { if (message.type === 'hello') hellos.push(message.data); return { state: sample(), frameId: 0, selectedFrameId: null }; } } },
    console: { error: message => errors.push(message) }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.length, 0, 'no DOM root yet');
  assert.equal(hellos[0].pageReady, false, 'an injected script does not make an empty page ready');
  doc.documentElement = new Element('html');
  doc.querySelectorAll = () => [video];
  timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  const button = nodes.find(node => node.textContent === 'Подключить это видео');
  assert.ok(button);
  assert.equal(button.hidden, false);
  assert.equal(hellos.at(-1).pageReady, true);
  assert.equal(doc.readyState, 'loading');
  assert.equal(doc.documentElement.children.length, 1);
  const panel = doc.documentElement.children[0];
  panel.remove();
  timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.isConnected, true, 'restore panel if page construction removed it');
  assert.deepEqual(errors, []);
});

test('the unpacked project extension recognizes the live site and supports setup-page diagnostics', async () => {
  const sender = { id: 'extension', tab: { id: 70 }, frameId: 0, url: 'https://vmeste.dadvanigeorgii.workers.dev/kinogo-extension' };
  assert.equal(isAppSender(sender), true);
  assert.equal(appRoom(sender), null);
  const result = await dispatch(sender, 'ping');
  assert.equal(result.installed, true); assert.equal(result.version, manifest.version);
  assert.equal(await dispatch(sender, 'connect', sample()), null);
  assert.equal(await dispatch({ ...sender, frameId: 3 }, 'ping'), null);
  assert.equal(await dispatch({ ...sender, url: 'https://evil.test/kinogo-extension' }, 'ping'), null);
  assert.equal(appRoom({ ...sender, url: `https://vmeste.dadvanigeorgii.workers.dev/room/${roomId}` }), roomId);
});

test('installation and popup repair reconnect only configured app tabs', async () => {
  tabs.set(71, { id: 71, url: `https://vmeste.dadvanigeorgii.workers.dev/room/${roomId}` });
  tabs.set(72, { id: 72, url: 'https://unrelated.test/' });
  injected.length = 0;
  installed(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(injected.some(item => item.target.tabId === 71 && item.files[0] === 'bridge.js'));
  assert.equal(injected.some(item => item.target.tabId === 72), false);
  const result = await dispatch({ id: 'extension', url: 'chrome-extension://extension/popup.html' }, 'repair');
  assert.ok(result.repaired >= 1);
  assert.equal(await dispatch({ id: 'extension', tab: { id: 72 }, frameId: 0, url: 'https://unrelated.test/' }, 'repair'), null);
  tabs.delete(71); tabs.delete(72);
});

test('automatic selection cannot steal a manually selected player in another frame', async () => {
  await dispatch(app(73), 'connect', sample());
  const tabId = stored.sessions['73'].mediaTabId;
  await dispatch(media(tabId, 7), 'select');
  const attempt = await dispatch(media(tabId, 8), 'select', { automatic: true });
  assert.equal(attempt.selectedFrameId, 7);
  assert.equal(stored.sessions['73'].frameId, 7);
  await dispatch(app(73), 'disconnect');
});

test('disconnect and reconnect reuse an open film without stealing another room tab', async () => {
  await dispatch(app(74), 'connect', sample());
  const first = stored.sessions['74'].mediaTabId;
  await dispatch(app(74), 'disconnect');
  await dispatch(app(74), 'connect', sample());
  assert.equal(stored.sessions['74'].mediaTabId, first);
  await dispatch(app(75), 'connect', sample());
  assert.notEqual(stored.sessions['75'].mediaTabId, first);
  await dispatch(app(74), 'disconnect'); await dispatch(app(75), 'disconnect');
});

test('automatic selection waits for stable playback and rejects short clips, loading, and changed sources', async () => {
  const selectorContext = vm.createContext({});
  vm.runInContext(await readFile(new URL('../extension/kinogo/media-selection.js', import.meta.url), 'utf8'), selectorContext);
  const selection = new selectorContext.VmesteAutoSelection();
  const video = { paused: false, ended: false, seeking: false, readyState: 4, duration: 90, currentSrc: 'blob:ad' };
  assert.equal(selection.ready(video, 1000), false); assert.equal(selection.ready(video, 5000), false);
  Object.assign(video, { duration: 5400, currentSrc: 'blob:film' });
  assert.equal(selection.ready(video, 6000), false); assert.equal(selection.ready(video, 8000), false);
  assert.equal(selection.ready(video, 9000), true);
  video.currentSrc = 'blob:new-film'; assert.equal(selection.ready(video, 10000), false);
  video.paused = true; assert.equal(selection.ready(video, 15000), false);
  video.paused = false; assert.equal(selection.ready(video, 16000), false);
});

test('blocked autoplay shows an actionable status without retrying play continuously', async () => {
  const video = new Video(), messages = []; let attempts = 0;
  video.play = async () => { attempts++; throw new Error('NotAllowedError'); };
  const controller = new Controller(video, async () => {}, message => messages.push(message), () => 100000);
  controller.update(sample({ isHost: false, playing: true, sampledAt: 100000 }));
  controller.tick(); await new Promise(resolve => setImmediate(resolve)); controller.tick(); controller.tick();
  assert.equal(attempts, 1); assert.ok(messages.at(-1).includes('Нажмите'));
  video.paused = false; video.dispatchEvent(new Event('play')); controller.tick();
  assert.ok(messages.at(-1).includes('Синхронизировано')); controller.destroy();
});

test('comment-page links open the main film page; a timeout automatically reloads without cache in the same tab', async () => {
  assert.equal(moviePageUrl(movie + '#comment'), 'https://kinogo.my/films/53645-obitel-zla-219.html');
  assert.throws(() => moviePageUrl('https://evil.test/123-film.html'));
  await dispatch(app(76), 'connect', sample());
  const tabId = stored.sessions['76'].mediaTabId, realNow = Date.now, now = realNow();
  try {
    Date.now = () => now + 21000;
    assert.equal((await dispatch(app(76), 'ping')).recovering, true);
    await new Promise(resolve => setImmediate(resolve));
    const before = nextTab;
    await dispatch(app(76), 'connect', sample());
    assert.equal(nextTab, before);
    assert.equal(activated.at(-1).id, tabId);
    assert.deepEqual(reloaded.at(-1), { id: tabId, options: { bypassCache: true } });
    assert.equal((await dispatch(app(76), 'ping')).pageTimedOut, false);
  } finally { Date.now = realNow; await dispatch(app(76), 'disconnect'); }
});

test('empty document health does not disarm recovery; visible content does', async () => {
  await dispatch(app(78), 'connect', sample());
  const tabId = stored.sessions['78'].mediaTabId;
  await dispatch(media(tabId, 0, movie), 'hello', { pageReady: false });
  assert.equal((await dispatch(app(78), 'ping')).pageReady, false);
  assert.equal(scheduledAlarms.has('vmeste-page:78'), true);
  await dispatch(media(tabId, 0, movie), 'hello', { pageReady: true });
  assert.equal((await dispatch(app(78), 'ping')).pageReady, true);
  assert.equal(scheduledAlarms.has('vmeste-page:78'), false);
  await dispatch(app(78), 'disconnect');
});

test('a private room never reuses a regular-window film and creates its tab in the room window', async () => {
  const privateSender = { ...app(77), tab: { id: 77, windowId: 900, incognito: true } };
  const before = nextTab;
  await dispatch(privateSender, 'connect', sample());
  assert.ok(nextTab > before);
  assert.equal(createdOptions.at(-1).windowId, 900);
  assert.equal(createdOptions.at(-1).url, 'https://kinogo.my/films/53645-obitel-zla-219.html');
  await dispatch(privateSender, 'disconnect');
});
