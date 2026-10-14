import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync(new URL('../worker/youtubeLibraryRouter.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/HardenedSharePage.tsx', import.meta.url), 'utf8');

test('share playback uses a derived Box Starry code instead of the YouTube id or raw share token', () => {
  assert.match(router, /playbackCodeFor\(shareToken\)/);
  assert.match(router, /playbackUrl: `\/api\/public\/playback\/\$\{playbackCode\}`/);
  assert.match(router, /sha256\(`box-starry-playback:\$\{shareToken\}`\)/);
  assert.match(router, /youtube-nocookie\.com\/embed\/\$\{youtubeId\}/);
  assert.doesNotMatch(router, /encryptSecret|decryptSecret|PlaybackGrant/);
});

test('copied playback code alone cannot play without the verified share session', () => {
  assert.match(router, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(router, /parseCookies\(request\.headers\.get\('cookie'\)\)/);
  assert.match(router, /cookies\[PLAYBACK_COOKIE\]/);
  assert.match(router, /sec-fetch-dest/);
  assert.match(router, /sec-fetch-site/);
  assert.match(router, /只能由繁星膠囊播放頁使用/);
});

test('public share response does not expose youtubeVideoId to the outer page', () => {
  assert.match(router, /delete safeVideo\.youtubeVideoId/);
  assert.match(page, /iframe src=\{data\.playbackUrl\}/);
  assert.doesNotMatch(page, /youtubeVideoId/);
});
