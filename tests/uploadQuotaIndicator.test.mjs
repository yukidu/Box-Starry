import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');
const quota = await readFile(new URL('../worker/youtubeUploadQuota.ts', import.meta.url), 'utf8');
const widget = await readFile(new URL('../src/UploadQuotaIndicator.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0004_youtube_upload_quota.sql', import.meta.url), 'utf8');

test('Box Starry tracks its own YouTube upload calls with Pacific-day reset', () => {
  assert.match(quota, /DEFAULT_DAILY_UPLOAD_LIMIT = 100/);
  assert.match(quota, /America\/Los_Angeles/);
  assert.match(quota, /recordYoutubeUploadAttempt/);
  assert.match(migration, /youtube_upload_quota_usage/);
  assert.match(router, /upload-quota/);
  assert.match(router, /recordYoutubeUploadAttempt/);
});

test('upload page shows an explicitly estimated remaining count', () => {
  assert.match(widget, /估算剩餘/);
  assert.match(widget, /Box 今日已送出/);
  assert.match(widget, /美西時間午夜重置/);
  assert.match(widget, /box-youtube-upload-quota-changed/);
});
