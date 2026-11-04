import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { appRoom, movieId, playback } from '../extension/kinogo/protocol.mjs';
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

let listener, removed, updated, stored = {}, nextTab = 100;
const sent = [], activated = [], appStates = new Map(), tabs = new Map(), refreshReplies = new Map(), controlReplies = new Map();
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: '0.1.1' }), onMessage: { addListener: f => { listener = f; } } },
  storage: { session: { get: async () => structuredClone(stored), set: async value => { stored = structuredClone(value); } } },
  tabs: {
    create: async ({ url }) => { const tab = { id: ++nextTab, pendingUrl: url, status: 'loading' }; tabs.set(tab.id, tab); return tab; },
    get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
    update: async (id, options) => { activated.push({ id, options }); return tabs.get(id) || {}; },
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
  await dispatch(app(10), 'connect', sample());
  const firstTab = stored.sessions['10'].mediaTabId;
  await dispatch(media(firstTab), 'select');
  const before = nextTab;
  const result = await dispatch(app(10), 'connect', sample());
  assert.equal(nextTab, before, 'a second click must not open another tab');
  assert.equal(stored.sessions['10'].mediaTabId, firstTab);
  assert.equal(result.hasPlayer, true, 'the first player must remain connected');
  assert.equal(activated.at(-1).id, firstTab);
  assert.equal(sent.some(item => item.tabId === firstTab && item.message.type === 'stop'), false);
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
  const nodes = [], timers = [], errors = [];
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
  vm.runInNewContext(await readFile(new URL('../extension/kinogo/media.js', import.meta.url), 'utf8'), {
    document: doc, window: win, getComputedStyle: () => ({ visibility: 'visible' }),
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {},
    chrome: { runtime: { id: 'extension', onMessage: { addListener() {} },
      sendMessage: async () => ({ state: sample(), frameId: 0, selectedFrameId: null }) } },
    console: { error: message => errors.push(message) }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.length, 0, 'no DOM root yet');
  doc.documentElement = new Element('html');
  doc.querySelectorAll = () => [video];
  timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  const button = nodes.find(node => node.textContent === 'Подключить это видео');
  assert.ok(button);
  assert.equal(button.hidden, false);
  assert.equal(doc.readyState, 'loading');
  assert.equal(doc.documentElement.children.length, 1);
  const panel = doc.documentElement.children[0];
  panel.remove();
  timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.isConnected, true, 'restore panel if page construction removed it');
  assert.deepEqual(errors, []);
});
