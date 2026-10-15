import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');

test('custom thumbnail uses YouTube media upload endpoint', () => {
  assert.match(source, /upload\/youtube\/v3\/thumbnails\/set/);
  assert.match(source, /searchParams\.set\('uploadType', 'media'\)/);
  assert.match(source, /searchParams\.set\('videoId', videoId\)/);
  assert.match(source, /body: bytes/);
});

test('thumbnail route is handled directly before legacy studio handler', () => {
  const direct = source.indexOf('return setThumbnailDirect(request, env, user, thumbnailMatch[1])');
  const legacy = source.indexOf('handleYoutubeStudio(request, env, user)');
  assert.ok(direct >= 0);
  assert.ok(legacy >= 0);
  assert.ok(direct < legacy);
});
