import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync(new URL('../worker/youtubeLibraryRouter.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/HardenedSharePage.tsx', import.meta.url), 'utf8');

test('share playback uses opaque Box Starry code mapping without extra encrypt/decrypt layer', () => {
  assert.match(router, /playbackUrl: `\/api\/public\/playback\/\$\{shareToken\}`/);
  assert.match(router, /sha256\(shareToken\)/);
  assert.match(router, /youtube-nocookie\.com\/embed\/\$\{youtubeId\}/);
  assert.doesNotMatch(router, /encryptSecret|decryptSecret|PLAYBACK_TTL_MS|PlaybackGrant/);
});

test('public share response does not expose youtubeVideoId to the outer page', () => {
  assert.match(router, /delete safeVideo\.youtubeVideoId/);
  assert.match(page, /iframe src=\{data\.playbackUrl\}/);
  assert.doesNotMatch(page, /youtubeVideoId/);
});
