import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { directSourceError, mediaFormat } from '../lib/video-source.ts';

const context = vm.createContext({ URL });
vm.runInContext(await readFile(new URL('../extension/kinogo/media-sources.js', import.meta.url), 'utf8'), context);
const collect = (video, resources = []) => Array.from(context.vmesteFilmSources({ isConnected: true, ...video }, resources), item => ({ ...item }));
const manifest = 'https://cdn.example.test/film/playlist.m3u8?signature=keep';

test('direct playback accepts signed media and rejects page, blob, credentials and local addresses', () => {
  assert.equal(mediaFormat(manifest), 'hls');
  assert.equal(directSourceError(manifest), null);
  assert.equal(directSourceError('https://media.example.test/signed?id=7'), null);
  for (const value of ['https://kinogo.my/films/123-film.html', 'https://example.test/movie.html?mp4',
    'blob:https://kinogo.my/id', 'https://name:pass@cdn.example.test/movie.mp4', 'https://127.0.0.1/file.mp4']) assert.ok(directSourceError(value));
});
test('import reads the selected video first and never mistakes another resource for its direct file', () => {
  const url = 'https://cdn.example.test/film.mp4?token=keep';
  assert.deepEqual(collect({ currentSrc: url }, [{ name: manifest, initiatorType: 'fetch' }]), [{ url, format: 'file' }]);
  assert.deepEqual(collect({ currentSrc: url, mediaKeys: {} }), []);
  assert.deepEqual(collect({ currentSrc: url, isConnected: false }), []);
});
test('blob playback proposes only distinct HTTPS playlists, including HLS endpoints identified by MIME', () => {
  const endpoint = 'https://cdn.example.test/signed?id=7';
  const resources = [manifest, 'https://cdn.example.test/chunk.ts', manifest, 'https://127.0.0.1/p.m3u8']
    .map(name => ({ name, initiatorType: 'xmlhttprequest' }));
  resources.push({ name: endpoint, contentType: 'application/vnd.apple.mpegurl', initiatorType: 'fetch' });
  assert.deepEqual(collect({ currentSrc: 'blob:https://kinogomy.stravers.live/id' }, resources),
    [{ url: endpoint, format: 'hls' }, { url: manifest, format: 'hls' }]);
});
