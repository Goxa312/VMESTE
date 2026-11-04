import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EXTENSION_VERSION, extensionRequest, needsExtensionUpdate } from '../lib/kinogo-bridge.ts';

test('an obsolete bridge error cannot hide the live extension response', async () => {
  const listeners = new Set(), origin = 'https://vmeste.dadvanigeorgii.workers.dev';
  const win = { location: { origin }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    postMessage(message) {
      queueMicrotask(() => {
        const deliver = result => { for (const fn of [...listeners]) fn({ source: win, origin, data: { channel: 'vmeste-extension', type: 'response', requestId: message.requestId, result } }); };
        deliver({ error: 'Old extension context invalidated' });
        deliver(null);
        deliver({ installed: true, connected: false, hasPlayer: false, version: '0.2.0' });
      });
    }
  };
  globalThis.window = win;
  try { const result = await extensionRequest('ping'); assert.equal(result.installed, true); assert.equal(listeners.size, 0); }
  finally { delete globalThis.window; }
});

test('missing or invalid extension replies remain unavailable instead of pretending installed', async () => {
  const listeners = new Set(), origin = 'https://vmeste.dadvanigeorgii.workers.dev';
  globalThis.window = { location: { origin }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn), postMessage() {} };
  try { await assert.rejects(extensionRequest('ping', undefined, 10), /Расширение не ответило/); assert.equal(listeners.size, 0); }
  finally { delete globalThis.window; }
  assert.equal(needsExtensionUpdate('0.1.1'), true); assert.equal(needsExtensionUpdate(EXTENSION_VERSION), false); assert.equal(needsExtensionUpdate('0.10.0'), false);
  assert.equal(needsExtensionUpdate('0.2.0', '0.2.0'), false);
});

test('reinjecting the bridge is idempotent and diagnostics work outside rooms', async () => {
  const listeners = new Set(), runtimeListeners = new Set(), posts = [], requests = [];
  const origin = 'https://vmeste.dadvanigeorgii.workers.dev';
  const win = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn), postMessage: message => posts.push(message) };
  const context = vm.createContext({ location: { origin, pathname: '/kinogo-extension' }, window: win, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'extension', getManifest: () => ({ version: '0.2.0' }),
      onMessage: { addListener: fn => runtimeListeners.add(fn), removeListener: fn => runtimeListeners.delete(fn) },
      sendMessage: async request => { requests.push(request); return { installed: true, connected: false, hasPlayer: false, version: '0.2.0' }; } } } });
  const source = await readFile(new URL('../extension/kinogo/bridge.js', import.meta.url), 'utf8');
  vm.runInContext(source, context); vm.runInContext(source, context);
  assert.equal(listeners.size, 1); assert.equal(runtimeListeners.size, 1);
  const dispatch = type => [...listeners][0]({ source: win, origin, data: { channel: 'vmeste-app', type, requestId: 'one' } });
  dispatch('ping'); dispatch('connect'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests.map(request => request.type), ['ping']);
  assert.ok(posts.some(message => message.type === 'response' && message.result.installed));
});
