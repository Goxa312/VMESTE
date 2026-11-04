import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageRecovery, pageTimedOut, PAGE_TIMEOUT_MS } from '../extension/kinogo/page-recovery.mjs';
import { movieId } from '../extension/kinogo/protocol.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const movie = 'https://kinogo.my/films/53645-obitel-zla-219.html';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ enabled = false, permission = true, hostAccess = true, incognito = false, remove } = {}) {
  const session = { roomTabId: 1, mediaTabId: 2, frameId: null, pageReady: false, openedAt: Date.now() - PAGE_TIMEOUT_MS - 1, state: { sourceUrl: movie } };
  const sessions = { '1': session }, tab = { id: 2, url: movie, incognito };
  const reloads = [], cleanups = [], alarms = [], otherTabs = [], canceledAlarms = [], timers = new Map();
  let timerId = 0;
  let queue = Promise.resolve();
  globalThis.chrome = {
    tabs: { get: async () => tab, query: async () => [tab, ...otherTabs], reload: async (...args) => reloads.push(args) },
    permissions: { contains: async request => request.origins ? hostAccess : permission },
    alarms: { create: async (...args) => alarms.push(args), clear: async name => canceledAlarms.push(name) },
    browsingData: { remove: async (...args) => { cleanups.push(args); await remove?.(); } }
  };
  const recovery = createPageRecovery({ current: key => sessions[key], all: () => sessions,
    enqueue: fn => { queue = queue.then(fn); return queue; }, save: async () => {}, movieId, enabled: () => enabled,
    setTimer: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  return { session, sessions, tab, reloads, cleanups, alarms, otherTabs, recovery, timers, canceledAlarms };
}

test('blank film reloads automatically once without cache and never clears data without opt-in', async () => {
  const f = fixture();
  assert.equal(pageTimedOut(f.session), true);
  assert.equal(await f.recovery.start(f.session), true);
  assert.equal(f.session.recovering, true);
  await flush();
  assert.deepEqual(f.reloads, [[2, { bypassCache: true }]]);
  f.session.openedAt -= PAGE_TIMEOUT_MS + 1;
  assert.equal(await f.recovery.start(f.session), false);
  assert.equal(f.cleanups.length, 0);
  assert.equal(f.alarms.length, 1);
});

test('enabled recovery clears only Kinogo immediately after the first timeout, then stops retrying', async () => {
  const f = fixture({ enabled: true });
  await f.recovery.start(f.session); await flush();
  assert.deepEqual(f.cleanups, [[{ origins: ['https://kinogo.my', 'https://www.kinogo.my'] },
    { cache: true, cacheStorage: true, serviceWorkers: true, cookies: true, localStorage: true, indexedDB: true }]]);
  assert.equal(f.reloads.length, 1, 'no extra cache-only retry or second timeout');
  f.session.openedAt -= PAGE_TIMEOUT_MS + 1;
  assert.equal(await f.recovery.start(f.session), false, 'no endless reload/reset loop');
});

test('a short timer starts recovery without waiting for a delayed Chrome alarm and is canceled when content loads', async () => {
  const f = fixture({ enabled: true });
  await f.recovery.watch(f.session);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 10050);
  timer.fn(); await flush();
  assert.equal(f.cleanups.length, 1);
  await f.recovery.cancel('1');
  assert.equal(f.canceledAlarms.at(-1), 'vmeste-page:1');
  const g = fixture();
  await g.recovery.watch(g.session); await g.recovery.cancel('1');
  assert.equal(g.timers.size, 0); assert.equal(g.reloads.length, 0);
});

test('visible page, selected video and unexpired navigation are never auto-reloaded', async () => {
  for (const patch of [{ pageReady: true }, { frameId: 0 }, { openedAt: Date.now() }]) {
    const f = fixture({ enabled: true }); Object.assign(f.session, patch);
    assert.equal(await f.recovery.start(f.session), false);
    assert.equal(f.reloads.length, 0); assert.equal(f.cleanups.length, 0);
  }
});

test('permission revocation and incognito prevent site-data cleanup', async () => {
  for (const options of [{ permission: false }, { hostAccess: false }, { incognito: true }]) {
    const f = fixture({ enabled: true, ...options }); f.session.recoveryAttempts = 1;
    await f.recovery.start(f.session); await flush();
    assert.equal(f.cleanups.length, 0); assert.equal(f.reloads.length, 0);
    assert.ok(f.session.error); assert.equal(f.session.recovering, false);
  }
});

test('other Kinogo tabs and active sessions protect shared site data', async () => {
  for (const other of ['tab', 'session']) {
    const f = fixture({ enabled: true }); f.session.recoveryAttempts = 1;
    if (other === 'tab') f.otherTabs.push({ id: 3, url: movie });
    else f.sessions['4'] = { frameId: 7 };
    await f.recovery.start(f.session); await flush();
    assert.equal(f.cleanups.length, 0); assert.equal(f.reloads.length, 0);
    assert.ok(f.session.error);
  }
});

test('slow cleanup is nonblocking and cannot reload a closed room, changed page or playing film', async () => {
  for (const action of ['disconnect', 'navigate', 'play', 'visible']) {
    let finish;
    const f = fixture({ enabled: true, remove: () => new Promise(resolve => { finish = resolve; }) });
    f.session.recoveryAttempts = 1;
    assert.equal(await f.recovery.start(f.session), true);
    await flush();
    assert.equal(f.session.recovering, true);
    assert.equal(await f.recovery.start(f.session, true), false, 'a second click cannot start another cleanup');
    if (action === 'disconnect') delete f.sessions['1'];
    if (action === 'navigate') f.tab.pendingUrl = 'https://example.com/';
    if (action === 'play') f.session.frameId = 7;
    if (action === 'visible') f.session.pageReady = true;
    finish(); await flush();
    assert.equal(f.reloads.length, 0, action);
  }
});

test('cleanup failures remain visible and do not cause repeated background deletion', async () => {
  const f = fixture({ enabled: true, remove: () => { throw new Error('cleanup failed'); } });
  f.session.recoveryAttempts = 1;
  await f.recovery.start(f.session); await flush();
  assert.equal(f.session.error, 'cleanup failed');
  assert.equal(await f.recovery.start(f.session), false);
  assert.equal(f.cleanups.length, 1);
});

test('popup requires a direct user permission grant, remembers the choice, and revokes it when disabled', async () => {
  const source = await readFile(new URL('../extension/kinogo/popup.js', import.meta.url), 'utf8');
  for (const granted of [true, false]) {
    const elements = new Map(), calls = [];
    let enabled = false;
    const element = id => {
      if (!elements.has(id)) elements.set(id, { handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute() {}, replaceChildren() {} });
      return elements.get(id);
    };
    vm.runInNewContext(source, { document: { getElementById: element }, window: { close() {} }, chrome: {
      permissions: {
        request: async () => { calls.push('permission-request'); return granted; },
        remove: async () => { calls.push('permission-remove'); return true; }
      },
      runtime: { sendMessage: async message => {
        calls.push(message.type);
        if (message.type === 'recovery-setting') { enabled = message.enabled; return { autoRecovery: enabled }; }
        return { version: '0.3.0', rooms: [], origins: [], autoRecovery: enabled };
      } }
    } });
    await flush(); calls.length = 0;
    await element('auto-recovery').handlers.click();
    assert.equal(calls[0], 'permission-request');
    assert.equal(enabled, granted);
    assert.equal(calls.includes('recovery-setting'), granted);
    if (granted) {
      calls.length = 0; await element('auto-recovery').handlers.click();
      assert.equal(enabled, false);
      assert.deepEqual(calls.slice(0, 2), ['recovery-setting', 'permission-remove']);
    }
  }
});
