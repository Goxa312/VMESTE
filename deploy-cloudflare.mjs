import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import './sites-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = fileURLToPath(new URL('../dist/server/wrangler.json', import.meta.url));
let config;
try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
catch { throw new Error('Сначала выполните npm run build.'); }
const database = config.d1_databases?.find(item => item.binding === 'DB');
if (!database?.database_id || database.database_id === '00000000-0000-4000-8000-000000000000') {
  throw new Error('Создайте D1-базу vmeste-db, укажите её database_id в wrangler.jsonc и повторите npm run build.');
}
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath],
  ['deploy', '--config', configPath]
]) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
