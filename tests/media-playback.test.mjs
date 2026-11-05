import test from 'node:test';
import assert from 'node:assert/strict';
import Hls, { ErrorDetails, ErrorTypes } from 'hls.js';
import { attachRoomMedia } from '../lib/media-playback.ts';

const source = { format: 'hls', url: 'https://media.example.test/film/master.m3u8?signature=private' };
function fixture(t, { mse = true, native = 'maybe', media = source } = {}) {
  const calls = [], errors = [], progress = [];
  const video = new (class extends EventTarget {
    src = ''; error = null;
    canPlayType() { return native; }
    load() { calls.push('load'); this.error = null; }
    pause() {}
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  })();
  let engine;
  t.mock.method(Hls, 'isSupported', () => mse);
  t.mock.method(Hls.prototype, 'loadSource', function (url) { engine = this; calls.push(url); });
  t.mock.method(Hls.prototype, 'attachMedia', function (element) { assert.equal(element, video); calls.push('attach'); });
  const detach = attachRoomMedia(video, media, text => errors.push(text), text => progress.push(text));
  t.after(detach);
  function fatal(type, details, code = 0) {
    engine.trigger(Hls.Events.ERROR, { fatal: true, type, details, error: new Error('loader'),
      response: { code, url: source.url, text: 'private response' } });
  }
  function elementError(code) { video.error = { code }; video.dispatchEvent(new Event('error')); }
  return { calls, errors, progress, video, fatal, elementError, detach };
}

test('Chromium native "maybe" uses hls.js first and preserves a specific HTTP error', async t => {
  const f = fixture(t);
  assert.deepEqual(f.calls, [source.url, 'attach']); assert.equal(f.video.src, '');
  f.elementError(4);
  f.fatal(ErrorTypes.NETWORK_ERROR, ErrorDetails.MANIFEST_LOAD_ERROR, 403);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.errors.length, 1); assert.match(f.errors[0], /плейлист фильма \(HTTP 403\)/);
  assert.doesNotMatch(f.errors[0], /signature|private|https:/);
  assert.equal(f.video.src, '', 'an explicit rejection must not retry the same URL natively');
});

test('unreadable cross-origin playlist tries native once; a later native error retains the failed stage', t => {
  const f = fixture(t);
  f.fatal(ErrorTypes.NETWORK_ERROR, ErrorDetails.LEVEL_LOAD_ERROR);
  assert.equal(f.video.src, source.url); assert.deepEqual(f.errors, []);
  assert.match(f.progress.at(-1), /встроенное/);
  f.elementError(4); f.elementError(4);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0], /плейлист качества/);
  assert.doesNotMatch(f.errors[0], /HTTP 403|private/);
});

test('native fallback that decodes a frame clears the earlier error', t => {
  const f = fixture(t);
  f.fatal(ErrorTypes.MEDIA_ERROR, ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR);
  f.video.dispatchEvent(new Event('loadeddata'));
  assert.equal(f.video.src, source.url); assert.deepEqual(f.errors, []);
  f.elementError(3);
  assert.match(f.errors[0], /декодировать кадры/);
});

test('later segment failures keep the active backend and report the segment', t => {
  const f = fixture(t);
  f.video.dispatchEvent(new Event('loadeddata'));
  f.fatal(ErrorTypes.NETWORK_ERROR, ErrorDetails.FRAG_LOAD_ERROR, 404);
  assert.match(f.errors[0], /фрагмент фильма \(HTTP 404\)/);
  assert.equal(f.video.src, '');
});

test('direct files and native-only HLS still use the video element', t => {
  const f = fixture(t, { mse: false });
  assert.equal(f.video.src, source.url);
  const direct = { url: 'https://media.example.test/movie.mp4', format: 'file' };
  const d = fixture(t, { native: '', media: direct });
  assert.equal(d.video.src, direct.url);
  assert.deepEqual(d.calls, ['load']);
});

test('unsupported HLS is reported; detaching cancels pending errors on a replaced source', async t => {
  const unsupported = fixture(t, { mse: false, native: '' });
  assert.match(unsupported.errors[0], /не поддерживает/);
  const f = fixture(t); f.elementError(4); f.detach();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.errors, []); assert.equal(f.video.src, '');
});
