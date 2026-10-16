import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/studioRouter.ts', import.meta.url), 'utf8');
const quota = await readFile(new URL('../worker/googleCloudQuota.ts', import.meta.url), 'utf8');
const widget = await readFile(new URL('../src/UploadQuotaIndicator.tsx', import.meta.url), 'utf8');
const cleanup = await readFile(new URL('../migrations/0005_remove_local_upload_quota.sql', import.meta.url), 'utf8');

test('Box Starry reads the official Google Cloud Video Uploads quota', () => {
  assert.match(quota, /serviceruntime\.googleapis\.com\/quota\/rate\/net_usage/);
  assert.match(quota, /serviceruntime\.googleapis\.com\/quota\/limit/);
  assert.match(quota, /youtube\.googleapis\.com\/video_insert/);
  assert.match(quota, /defaultVideoInserterPerDayPerProject/);
  assert.match(quota, /https:\/\/www\.googleapis\.com\/auth\/monitoring\.read/);
  assert.match(router, /googleYoutubeUploadQuota/);
});

test('local Box quota estimation is removed', () => {
  assert.match(cleanup, /DROP TABLE IF EXISTS youtube_upload_quota_usage/);
  assert.doesNotMatch(router, /recordYoutubeUploadAttempt/);
  assert.doesNotMatch(router, /youtubeUploadQuotaEstimate/);
  assert.doesNotMatch(widget, /Box 估算/);
  assert.doesNotMatch(widget, /估算剩餘/);
});

test('upload page labels quota numbers as Google Cloud official data', () => {
  assert.match(widget, /Google 官方 YouTube 配額/);
  assert.match(widget, /Google Cloud 官方資料/);
  assert.match(widget, /剩餘/);
  assert.match(widget, /今日已用/);
  assert.match(widget, /box-google-quota-refresh/);
});
