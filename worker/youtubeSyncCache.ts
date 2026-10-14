import type { Env, LocalUser } from './types';
import { listYoutubeLibraryPage, type YoutubeLibraryItem } from './youtube';
import { listYoutubePlaylists } from './playlists';
import { cleanText, json } from './security';

const FULL_SYNC_MS = 6 * 60 * 60 * 1000;
const HOT_CACHE_MS = 20 * 1000;

type SyncKind = 'videos' | 'playlists';

type SyncState = {
  last_full_sync: string | null;
  last_incremental_sync: string | null;
};

type YoutubePlaylistItem = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  itemCount: number;
  privacy: string;
  publishedAt: string;
};

function age(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms) : Number.POSITIVE_INFINITY;
}

async function state(env: Env, userId: string, kind: SyncKind): Promise<SyncState | null> {
  return env.DB.prepare('SELECT last_full_sync,last_incremental_sync FROM youtube_sync_state WHERE user_id=? AND kind=? LIMIT 1')
    .bind(userId, kind).first<SyncState>();
}

async function saveState(env: Env, userId: string, kind: SyncKind, full: boolean) {
  await env.DB.prepare(`
    INSERT INTO youtube_sync_state(user_id,kind,last_full_sync,last_incremental_sync)
    VALUES(?,?,${full ? "datetime('now')" : 'NULL'},datetime('now'))
    ON CONFLICT(user_id,kind) DO UPDATE SET
      last_full_sync=${full ? "datetime('now')" : 'youtube_sync_state.last_full_sync'},
      last_incremental_sync=datetime('now')
  `).bind(userId, kind).run();
}

async function chunkedBatch(env: Env, statements: any[], size = 50) {
  for (let i = 0; i < statements.length; i += size) {
    await env.DB.batch(statements.slice(i, i + size));
  }
}

async function cachedVideos(env: Env, userId: string): Promise<YoutubeLibraryItem[]> {
  const rows = await env.DB.prepare('SELECT payload_json FROM youtube_video_cache WHERE user_id=? ORDER BY sort_key DESC, updated_at DESC')
    .bind(userId).all<{ payload_json: string }>();
  return (rows.results || []).flatMap(row => {
    try { return [JSON.parse(row.payload_json) as YoutubeLibraryItem]; } catch { return []; }
  });
}

async function replaceVideoCache(env: Env, userId: string, items: YoutubeLibraryItem[]) {
  await env.DB.prepare('DELETE FROM youtube_video_cache WHERE user_id=?').bind(userId).run();
  const statements = items.map(item => env.DB.prepare(`
    INSERT INTO youtube_video_cache(user_id,youtube_video_id,payload_json,sort_key,updated_at)
    VALUES(?,?,?,?,datetime('now'))
  `).bind(userId, item.youtubeVideoId, JSON.stringify(item), item.publishedAt || ''));
  await chunkedBatch(env, statements);
}

async function mergeVideoCache(env: Env, userId: string, items: YoutubeLibraryItem[], completeDataset: boolean) {
  const statements = items.map(item => env.DB.prepare(`
    INSERT INTO youtube_video_cache(user_id,youtube_video_id,payload_json,sort_key,updated_at)
    VALUES(?,?,?,?,datetime('now'))
    ON CONFLICT(user_id,youtube_video_id) DO UPDATE SET
      payload_json=excluded.payload_json,sort_key=excluded.sort_key,updated_at=datetime('now')
  `).bind(userId, item.youtubeVideoId, JSON.stringify(item), item.publishedAt || ''));
  await chunkedBatch(env, statements);
  if (completeDataset) {
    if (!items.length) {
      await env.DB.prepare('DELETE FROM youtube_video_cache WHERE user_id=?').bind(userId).run();
    } else {
      const marks = items.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM youtube_video_cache WHERE user_id=? AND youtube_video_id NOT IN (${marks})`)
        .bind(userId, ...items.map(item => item.youtubeVideoId)).run();
    }
  }
}

export async function syncYoutubeVideosCached(env: Env, userId: string): Promise<{ videos: YoutubeLibraryItem[]; mode: 'cache' | 'incremental' | 'full' }> {
  const current = await state(env, userId, 'videos');

  if (current && age(current.last_incremental_sync) < HOT_CACHE_MS) {
    return { videos: await cachedVideos(env, userId), mode: 'cache' };
  }

  const full = !current || age(current.last_full_sync) >= FULL_SYNC_MS;
  if (full) {
    const all: YoutubeLibraryItem[] = [];
    let pageToken = '';
    let guard = 0;
    do {
      const page = await listYoutubeLibraryPage(env, userId, pageToken);
      all.push(...page.videos);
      pageToken = page.nextPageToken || '';
      guard += 1;
      if (guard > 100) throw new Error('youtube_library_failed');
    } while (pageToken);
    await replaceVideoCache(env, userId, all);
    await saveState(env, userId, 'videos', true);
    return { videos: all, mode: 'full' };
  }

  const page = await listYoutubeLibraryPage(env, userId, '');
  await mergeVideoCache(env, userId, page.videos, !page.nextPageToken);
  await saveState(env, userId, 'videos', false);
  return { videos: await cachedVideos(env, userId), mode: 'incremental' };
}

async function cachedPlaylists(env: Env, userId: string): Promise<YoutubePlaylistItem[]> {
  const rows = await env.DB.prepare('SELECT payload_json FROM youtube_playlist_cache WHERE user_id=? ORDER BY sort_key DESC, updated_at DESC')
    .bind(userId).all<{ payload_json: string }>();
  return (rows.results || []).flatMap(row => {
    try { return [JSON.parse(row.payload_json) as YoutubePlaylistItem]; } catch { return []; }
  });
}

async function replacePlaylistCache(env: Env, userId: string, items: YoutubePlaylistItem[]) {
  await env.DB.prepare('DELETE FROM youtube_playlist_cache WHERE user_id=?').bind(userId).run();
  const statements = items.map(item => env.DB.prepare(`
    INSERT INTO youtube_playlist_cache(user_id,youtube_playlist_id,payload_json,sort_key,updated_at)
    VALUES(?,?,?,?,datetime('now'))
  `).bind(userId, item.id, JSON.stringify(item), item.publishedAt || ''));
  await chunkedBatch(env, statements);
}

async function mergePlaylistCache(env: Env, userId: string, items: YoutubePlaylistItem[], completeDataset: boolean) {
  const statements = items.map(item => env.DB.prepare(`
    INSERT INTO youtube_playlist_cache(user_id,youtube_playlist_id,payload_json,sort_key,updated_at)
    VALUES(?,?,?,?,datetime('now'))
    ON CONFLICT(user_id,youtube_playlist_id) DO UPDATE SET
      payload_json=excluded.payload_json,sort_key=excluded.sort_key,updated_at=datetime('now')
  `).bind(userId, item.id, JSON.stringify(item), item.publishedAt || ''));
  await chunkedBatch(env, statements);
  if (completeDataset) {
    if (!items.length) {
      await env.DB.prepare('DELETE FROM youtube_playlist_cache WHERE user_id=?').bind(userId).run();
    } else {
      const marks = items.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM youtube_playlist_cache WHERE user_id=? AND youtube_playlist_id NOT IN (${marks})`)
        .bind(userId, ...items.map(item => item.id)).run();
    }
  }
}

async function rawPlaylistPage(request: Request, env: Env, user: LocalUser, pageToken = ''): Promise<{ playlists: YoutubePlaylistItem[]; nextPageToken: string | null } | Response> {
  const url = new URL(request.url);
  if (pageToken) url.searchParams.set('pageToken', pageToken); else url.searchParams.delete('pageToken');
  const response = await listYoutubePlaylists(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, user);
  if (!response.ok) return response;
  const data = await response.json() as { playlists?: YoutubePlaylistItem[]; nextPageToken?: string | null };
  return { playlists: Array.isArray(data.playlists) ? data.playlists : [], nextPageToken: cleanText(data.nextPageToken, 512) || null };
}

export async function syncYoutubePlaylistsCached(request: Request, env: Env, user: LocalUser): Promise<Response> {
  const current = await state(env, user.id, 'playlists');

  if (current && age(current.last_incremental_sync) < HOT_CACHE_MS) {
    return json({ playlists: await cachedPlaylists(env, user.id), nextPageToken: null, syncMode: 'cache' });
  }

  const full = !current || age(current.last_full_sync) >= FULL_SYNC_MS;
  if (full) {
    const all: YoutubePlaylistItem[] = [];
    let pageToken = '';
    let guard = 0;
    do {
      const page = await rawPlaylistPage(request, env, user, pageToken);
      if (page instanceof Response) return page;
      all.push(...page.playlists);
      pageToken = page.nextPageToken || '';
      guard += 1;
      if (guard > 100) return json({ error: '同步 YouTube 播放清單失敗，請稍後再試', code: 'youtube_playlist_failed' }, 502);
    } while (pageToken);
    await replacePlaylistCache(env, user.id, all);
    await saveState(env, user.id, 'playlists', true);
    return json({ playlists: all, nextPageToken: null, syncMode: 'full' });
  }

  const page = await rawPlaylistPage(request, env, user, '');
  if (page instanceof Response) return page;
  await mergePlaylistCache(env, user.id, page.playlists, !page.nextPageToken);
  await saveState(env, user.id, 'playlists', false);
  return json({ playlists: await cachedPlaylists(env, user.id), nextPageToken: null, syncMode: 'incremental' });
}
