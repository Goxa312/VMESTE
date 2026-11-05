import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const script = fileURLToPath(new URL('scripts/package-kinogo-extension.mjs', root));
const scratch = new URL('outputs/extension-package-tests/', root);
await mkdir(scratch, { recursive: true });
function unpack(bytes) {
  const files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameSize + extraSize;
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    files.set(name, inflateRawSync(bytes.subarray(start, start + size)).toString('utf8'));
    offset = start + size;
  }
  return files;
}
function run(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: fileURLToPath(root), encoding: 'utf8', env: { ...process.env, VMESTE_APP_ORIGIN: '' } });
}
test('default archive preserves every local extension source file', async () => {
  const output = fileURLToPath(new URL('local.zip', scratch));
  const result = run(['--output', output]);
  assert.equal(result.status, 0, result.stderr);
  const files = unpack(await readFile(output));
  assert.equal(files.size, 13);
  assert.ok(files.has('page-recovery.mjs'));
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.ok(files.has(manifest.action.default_popup));
  for (const entry of manifest.content_scripts) for (const file of entry.js) assert.ok(files.has(file), file);
  assert.ok(manifest.host_permissions.includes('https://vmeste.dadvanigeorgii.workers.dev/*'));
  assert.deepEqual(manifest.optional_permissions, ['browsingData']);
  assert.equal(manifest.permissions.includes('browsingData'), false, 'site-data cleanup must remain opt-in');
  for (const [name, content] of files) assert.equal(content, await readFile(new URL(`extension/kinogo/${name}`, root), 'utf8'));
});
test('public archive admits only the configured HTTPS site and leaves local sources unchanged', async () => {
  const output = fileURLToPath(new URL('public.zip', scratch));
  const bridgeSource = new URL('extension/kinogo/bridge.js', root), before = await readFile(bridgeSource, 'utf8');
  const result = run(['--origin', 'https://watch.example.test', '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  const files = unpack(await readFile(output));
  const original = JSON.parse(await readFile(new URL('extension/kinogo/manifest.json', root), 'utf8'));
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.deepEqual(manifest.host_permissions, [...original.host_permissions, 'https://watch.example.test/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, [...original.content_scripts[0].matches, 'https://watch.example.test/*']);
  const protocol = await import(`data:text/javascript;base64,${Buffer.from(files.get('protocol.mjs')).toString('base64')}`);
  const sender = origin => ({ tab: { id: 1 }, frameId: 0, url: `${origin}/room/abcdef123456` });
  assert.equal(protocol.appRoom(sender('https://watch.example.test')), 'abcdef123456');
  assert.equal(protocol.appRoom(sender('https://other.example.test')), null);
  assert.equal(protocol.appRoom(sender('http://watch.example.test')), null);
  for (const [origin, expected] of [['https://watch.example.test', 1], ['http://localhost:5173', 1], ['https://other.example.test', 0]]) {
    let listeners = 0;
    vm.runInNewContext(files.get('bridge.js'), { location: { origin }, window: { addEventListener() { listeners++; }, postMessage() {} },
      chrome: { runtime: { getManifest: () => ({ version: '0.2.0' }), onMessage: { addListener() {} } } } });
    assert.equal(listeners, expected, origin);
  }
  assert.equal(await readFile(bridgeSource, 'utf8'), before);
});

test('packaging for the existing public site never duplicates origin permissions', async () => {
  const output = fileURLToPath(new URL('production.zip', scratch));
  const result = run(['--origin', 'https://vmeste.dadvanigeorgii.workers.dev', '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  const files = unpack(await readFile(output)), manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(new Set(manifest.host_permissions).size, manifest.host_permissions.length);
  assert.equal(new Set(manifest.content_scripts[0].matches).size, manifest.content_scripts[0].matches.length);
});
test('packaging refuses insecure, wildcard and non-origin URLs', () => {
  for (const origin of ['http://watch.example.test', 'https://*.example.test', 'https://watch.example.test/room/x', 'https://watch.example.test?x=y', 'https://user:pass@watch.example.test']) {
    const result = run(['--origin', origin, '--output', fileURLToPath(new URL('invalid.zip', scratch))]);
    assert.notEqual(result.status, 0, origin);
  }
});
