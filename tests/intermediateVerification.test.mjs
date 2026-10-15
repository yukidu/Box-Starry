import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');
const upload = await readFile(new URL('../src/UploadStudioPage.tsx', import.meta.url), 'utf8');

test('Box Starry reads YouTube long-upload eligibility for intermediate verification guidance', () => {
  assert.match(router, /youtubeIntermediateStatus/);
  assert.match(router, /youtube\/v3\/channels/);
  assert.match(router, /searchParams\.set\('part', 'status'\)/);
  assert.match(router, /searchParams\.set\('mine', 'true'\)/);
  assert.match(router, /longUploadsStatus/);
  assert.match(router, /needsPhoneVerification/);
  assert.match(router, /https:\/\/www\.youtube\.com\/verify/);
});

test('upload page guides users to phone verification before custom thumbnails or long videos', () => {
  assert.match(upload, /videoDurationSeconds>15\*60/);
  assert.match(upload, /longUploadsStatus==='eligible'/);
  assert.match(upload, /自訂縮圖與上傳超過 15 分鐘的影片/);
  assert.match(upload, /立即驗證 YouTube/);
  assert.match(upload, /已完成，重新檢查/);
  assert.match(upload, /window\.open\(YOUTUBE_VERIFY_URL/);
});
