import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');

test('thumbnail upload retries transient YouTube responses instead of failing immediately', () => {
  assert.match(source, /THUMBNAIL_ROUTE/);
  assert.match(source, /THUMBNAIL_RETRY_DELAYS\s*=\s*\[1200,\s*2400\]/);
  assert.match(source, /request\.clone\(\)/);
  assert.match(source, /response\.status\s*===\s*409/);
  assert.match(source, /response\.status\s*===\s*429/);
  assert.match(source, /response\.status\s*>=\s*500/);
  assert.match(source, /await wait\(THUMBNAIL_RETRY_DELAYS\[index\]\)/);
  assert.match(source, /if \(response\.ok \|\| !shouldRetryThumbnail\(response\)\) break/);
});
