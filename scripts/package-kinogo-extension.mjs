import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { APP_ORIGINS } from '../extension/kinogo/protocol.mjs';

const { values } = parseArgs({ options: { origin: { type: 'string' }, output: { type: 'string' } } });
const publicAddress = (values.origin ?? process.env.VMESTE_APP_ORIGIN ?? '').trim();
const origins = [...APP_ORIGINS];
let publicOrigin;
if (publicAddress) {
  const url = new URL(publicAddress);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9.-]+$/i.test(url.hostname)) throw new Error('VMESTE_APP_ORIGIN: нужен HTTPS-адрес сайта без пути, порта и параметров.');
  publicOrigin = url.origin;
  if (!origins.includes(publicOrigin)) origins.push(publicOrigin);
}

// Small reproducible ZIP writer; no external packaging/runtime dependency.
const root = new URL('../extension/kinogo/', import.meta.url);
const files = ['manifest.json', 'protocol.mjs', 'background.mjs', 'page-recovery.mjs', 'bridge.js', 'media-controller.js', 'media-selection.js', 'media.js', 'popup.html', 'popup.css', 'popup.js', 'README.md'];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], directory = [];
let offset = 0;
for (const file of files) {
  let data = await readFile(new URL(file, root));
  if (publicOrigin) {
    if (file === 'manifest.json') {
      const manifest = JSON.parse(data.toString('utf8'));
      manifest.host_permissions = [...new Set([...manifest.host_permissions, `${publicOrigin}/*`])];
      manifest.content_scripts[0].matches = [...new Set([...manifest.content_scripts[0].matches, `${publicOrigin}/*`])];
      data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    } else if (file === 'protocol.mjs' || file === 'bridge.js') {
      const source = data.toString('utf8');
      const pattern = /const APP_ORIGINS = \[[^\n]*\];/;
      if (!pattern.test(source)) throw new Error(`Cannot configure origins in ${file}`);
      const changed = source.replace(pattern, `const APP_ORIGINS = ${JSON.stringify(origins)};`);
      data = Buffer.from(changed);
    } else if (file === 'README.md') {
      data = Buffer.from(`# Публичная сборка\n\nАдрес приложения: ${publicOrigin}\n\nУстановите ZIP по инструкции ниже и откройте комнату по этому адресу. Локальные адреса также поддерживаются.\n\n` + data.toString('utf8'));
    }
  }
  const name = Buffer.from(file), packed = deflateRawSync(data), checksum = crc32(data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, packed);
  const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt16LE(33, 14);
  record.writeUInt32LE(checksum, 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
  directory.push(record, name); offset += header.length + name.length + packed.length;
}
const central = Buffer.concat(directory), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const output = values.output ? resolve(values.output) : fileURLToPath(new URL('../public/downloads/vmeste-kinogo-extension.zip', import.meta.url));
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, Buffer.concat([...local, central, end]));
console.log(`Extension packaged: ${output}`);
console.log(`App origins: ${origins.join(', ')}`);
