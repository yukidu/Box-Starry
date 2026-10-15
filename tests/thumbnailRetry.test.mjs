import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');

test('thumbnail upload retries transient YouTube responses instead of failing immediately', () => {
  assert.match(source, /THUMBNAIL_ROUTE/);
  assert.match(source, /THUMBNAIL_RETRY_DELAYS\s*=\s*\[0,\s*1200,\s*3000,\s*6000\]/);
  assert.match(source, /status === 404/);
  assert.match(source, /status === 429/);
  assert.match(source, /status >= 500/);
  assert.match(source, /reason === 'videoNotFound'/);
  assert.match(source, /reason === 'backendError'/);
  assert.match(source, /if \(delay\) await wait\(delay\)/);
  assert.match(source, /if \(!shouldRetryThumbnail\(response\.status, payload\)\) break/);
});
