import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync(new URL('../worker/youtubeLibraryRouter.ts', import.meta.url), 'utf8');
const library = readFileSync(new URL('../src/YoutubeLibrary.tsx', import.meta.url), 'utf8');
const playlists = readFileSync(new URL('../src/PlaylistPage.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0003_youtube_sync_cache.sql', import.meta.url), 'utf8');

test('legacy server cache tables remain compatible with existing production data', () => {
  assert.match(migration, /youtube_sync_state/);
  assert.match(migration, /youtube_video_cache/);
  assert.match(migration, /youtube_playlist_cache/);
});

test('normal entry reads only the latest YouTube page and merges it into local cache', () => {
  assert.match(library, /FULL_SYNC_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(library, /box-youtube-library-cache-/);
  assert.match(library, /mergeLatest/);
  assert.match(library, /apiTimed<LibraryResponse>\('\/api\/youtube\/library'\)/);
  assert.match(playlists, /box-youtube-playlists-cache-/);
  assert.match(playlists, /mergePlaylists/);
});

test('full reconciliation remains available periodically and on manual request', () => {
  assert.match(library, /cacheAge\(fullKey\)>=FULL_SYNC_MS/);
  assert.match(library, /while\(token\)/);
  assert.match(library, /onClick=\{\(\)=>load\(true\)\}/);
  assert.match(playlists, /cacheAge\(ytFullKey\)>=FULL_SYNC_MS/);
  assert.match(playlists, /onClick=\{\(\)=>syncYoutube\(true\)\}/);
});

test('router serves one YouTube page at a time so a request cannot wait for the whole library', () => {
  assert.match(router, /listYoutubeLibraryPage\(env, user\.id, pageToken\)/);
  assert.match(router, /nextPageToken: page\.nextPageToken/);
  assert.match(router, /return listYoutubePlaylists\(request, env, user\)/);
  assert.doesNotMatch(router, /syncYoutubeVideosCached/);
  assert.doesNotMatch(router, /syncYoutubePlaylistsCached/);
});

test('background upload refresh checks only the latest page', () => {
  assert.match(apiSource, /fetch\('\/api\/youtube\/library'/);
  assert.doesNotMatch(apiSource, /while \(token/);
});

test('disconnecting YouTube clears legacy server cache content', () => {
  assert.match(router, /DELETE FROM youtube_video_cache/);
  assert.match(router, /DELETE FROM youtube_playlist_cache/);
  assert.match(router, /DELETE FROM youtube_sync_state/);
});
