import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cache = readFileSync(new URL('../worker/youtubeSyncCache.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../worker/youtubeLibraryRouter.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0003_youtube_sync_cache.sql', import.meta.url), 'utf8');

test('YouTube sync persists video and playlist caches', () => {
  assert.match(migration, /youtube_sync_state/);
  assert.match(migration, /youtube_video_cache/);
  assert.match(migration, /youtube_playlist_cache/);
});

test('normal entry uses incremental first-page sync instead of re-reading all pages', () => {
  assert.match(cache, /FULL_SYNC_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(cache, /HOT_CACHE_MS = 20 \* 1000/);
  assert.match(cache, /const page = await listYoutubeLibraryPage\(env, userId, ''\)/);
  assert.match(cache, /mergeVideoCache/);
  assert.match(cache, /syncMode: 'incremental'/);
});

test('full reconciliation remains available periodically for deletions and older edits', () => {
  assert.match(cache, /age\(current\.last_full_sync\) >= FULL_SYNC_MS/);
  assert.match(cache, /replaceVideoCache/);
  assert.match(cache, /replacePlaylistCache/);
});

test('router returns cached complete lists to existing pages with no pagination loop', () => {
  assert.match(router, /syncYoutubeVideosCached/);
  assert.match(router, /syncYoutubePlaylistsCached/);
  assert.match(router, /nextPageToken: null/);
  assert.match(router, /syncMode: synced\.mode/);
});

test('disconnecting YouTube clears cached content', () => {
  assert.match(router, /DELETE FROM youtube_video_cache/);
  assert.match(router, /DELETE FROM youtube_playlist_cache/);
  assert.match(router, /DELETE FROM youtube_sync_state/);
});
