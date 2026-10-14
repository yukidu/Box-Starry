import baseWorker from './index';
import type { Env } from './types';
import { currentUser } from './auth';
import { cleanText, json, parseCookies, sha256 } from './security';
import { listYoutubeLibraryPage } from './youtube';
import { handleBoxPlaylists, listYoutubePlaylists } from './playlists';

interface BoxVideoRow {
  id: string;
  youtube_video_id: string;
  app_visibility: 'owner' | 'public';
  original_filename: string | null;
  file_size: number | null;
  created_at: string;
}

interface PlaybackRow {
  disabled_at: string | null;
  expires_at: string | null;
  first_opened_at: string | null;
  expire_after_first_open_days: number | null;
  youtube_video_id: string;
  youtube_privacy: 'private' | 'unlisted' | 'public';
}

const PLAYBACK_COOKIE = 'box_starry_playback';
const PLAYBACK_COOKIE_MAX_AGE = 10 * 60;

function playbackExpired(row: PlaybackRow): boolean {
  const now = Date.now();
  if (row.disabled_at) return true;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return true;
  if (row.first_opened_at && row.expire_after_first_open_days) {
    const due = new Date(row.first_opened_at).getTime() + row.expire_after_first_open_days * 86400_000;
    if (due <= now) return true;
  }
  return false;
}

async function playbackCodeFor(shareToken: string): Promise<string> {
  return (await sha256(`box-starry-playback:${shareToken}`)).slice(0, 32);
}

async function hardenPublicShare(request: Request, response: Response): Promise<Response> {
  if (!response.ok) return response;
  const data = await response.json().catch(() => null) as any;
  const youtubeVideoId = cleanText(data?.video?.youtubeVideoId, 32);
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(youtubeVideoId)) return json({ error: '播放來源無法驗證' }, 502);

  const shareToken = new URL(request.url).pathname.match(/^\/api\/public\/share\/([A-Za-z0-9_-]{20,})$/)?.[1] || '';
  if (!shareToken) return json({ error: '分享連結格式不正確' }, 400);

  const safeVideo = { ...data.video };
  delete safeVideo.youtubeVideoId;
  const playbackCode = await playbackCodeFor(shareToken);

  return json({
    ...data,
    video: safeVideo,
    playbackUrl: `/api/public/playback/${playbackCode}`,
    sourceProtected: true
  }, 200, {
    'set-cookie': `${PLAYBACK_COOKIE}=${encodeURIComponent(shareToken)}; Path=/api/public/playback/; Max-Age=${PLAYBACK_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`
  });
}

async function protectedPlayback(request: Request, env: Env): Promise<Response> {
  const playbackCode = new URL(request.url).pathname.match(/^\/api\/public\/playback\/([a-f0-9]{32})$/)?.[1] || '';
  if (!playbackCode) return new Response('播放代碼格式不正確', { status: 400 });

  const fetchDest = request.headers.get('sec-fetch-dest');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((fetchDest && fetchDest !== 'iframe') || (fetchSite && fetchSite !== 'same-origin')) {
    return new Response('此播放代碼只能由繁星膠囊播放頁使用', { status: 403 });
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const shareToken = cookies[PLAYBACK_COOKIE] || '';
  if (!/^[A-Za-z0-9_-]{20,}$/.test(shareToken)) {
    return new Response('播放驗證已失效，請重新開啟分享頁', { status: 401 });
  }

  const expectedCode = await playbackCodeFor(shareToken);
  if (playbackCode !== expectedCode) {
    return new Response('播放代碼無效', { status: 403 });
  }

  const tokenHash = await sha256(shareToken);
  const row = await env.DB.prepare(`
    SELECT s.disabled_at,s.expires_at,s.first_opened_at,s.expire_after_first_open_days,
           v.youtube_video_id,v.youtube_privacy
    FROM share_links s JOIN videos v ON v.id=s.video_id
    WHERE s.token_hash=? LIMIT 1
  `).bind(tokenHash).first<PlaybackRow>();

  if (!row || playbackExpired(row) || row.youtube_privacy === 'private') {
    return new Response('這個分享已失效', { status: 410 });
  }

  const youtubeId = encodeURIComponent(row.youtube_video_id);
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>繁星膠囊播放</title><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1" title="繁星膠囊影片" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="no-referrer"></iframe></body></html>`;
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
  });
  return new Response(html, { status: 200, headers });
}

async function library(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: '請先登入 Starry ID' }, 401);
  try {
    const pageToken = cleanText(new URL(request.url).searchParams.get('pageToken'), 512);
    const page = await listYoutubeLibraryPage(env, user.id, pageToken);
    const rows = await env.DB.prepare(`
      SELECT id,youtube_video_id,app_visibility,original_filename,file_size,created_at
      FROM videos WHERE owner_user_id=?
    `).bind(user.id).all<BoxVideoRow>();
    const byYoutubeId = new Map<string, BoxVideoRow>();
    for (const row of rows.results || []) byYoutubeId.set(row.youtube_video_id, row);

    for (const item of page.videos) {
      if (byYoutubeId.has(item.youtubeVideoId) || !item.uploadedViaBoxTag) continue;
      const id = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT OR IGNORE INTO videos(
          id,owner_user_id,youtube_video_id,title,description,youtube_privacy,app_visibility,
          upload_status,original_filename,file_size,thumbnail_url,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,'owner','ready',NULL,NULL,?,datetime('now'),datetime('now'))
      `).bind(
        id,
        user.id,
        item.youtubeVideoId,
        item.title,
        item.description || null,
        item.youtubePrivacy,
        item.thumbnailUrl
      ).run();
      const row = await env.DB.prepare(`
        SELECT id,youtube_video_id,app_visibility,original_filename,file_size,created_at
        FROM videos WHERE owner_user_id=? AND youtube_video_id=? LIMIT 1
      `).bind(user.id, item.youtubeVideoId).first<BoxVideoRow>();
      if (row) byYoutubeId.set(item.youtubeVideoId, row);
    }

    return json({
      videos: page.videos.map(item => {
        const box = byYoutubeId.get(item.youtubeVideoId) || null;
        return {
          ...item,
          uploadedViaBox: Boolean(box || item.uploadedViaBoxTag),
          box: box ? {
            id: box.id,
            appVisibility: box.app_visibility,
            originalFilename: box.original_filename || '',
            fileSize: box.file_size || 0,
            createdAt: box.created_at
          } : null
        };
      }),
      nextPageToken: page.nextPageToken,
      syncMode: pageToken ? 'page' : 'latest'
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'youtube_library_failed';
    if (code === 'youtube_reconnect_required') {
      return json({ error: '需要重新授權 YouTube，才能顯示你的完整影片清單', code }, 409);
    }
    if (code === 'youtube_not_connected') return json({ error: '請先連接 YouTube', code }, 409);
    return json({ error: '讀取 YouTube 影片清單失敗，請稍後再試', code }, 502);
  }
}

async function cleanupPlaylistsBeforeAccountDelete(request: Request, env: Env) {
  const user = await currentUser(request, env);
  if (!user) return;
  const rows = await env.DB.prepare('SELECT id FROM box_playlists WHERE owner_user_id=?').bind(user.id).all<{id:string}>();
  const ids = (rows.results || []).map(row => row.id);
  for (const id of ids) await env.DB.prepare('DELETE FROM box_playlist_items WHERE playlist_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM box_playlists WHERE owner_user_id=?').bind(user.id).run();
}

async function cleanupYoutubeCache(request: Request, env: Env) {
  const user = await currentUser(request, env);
  if (!user) return;
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM youtube_video_cache WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM youtube_playlist_cache WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM youtube_sync_state WHERE user_id=?').bind(user.id)
    ]);
  } catch (error) {
    console.warn('YouTube cache cleanup skipped', error instanceof Error ? error.message : 'unknown');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (/^\/api\/public\/playback\/[a-f0-9]{32}$/.test(url.pathname) && request.method === 'GET') return protectedPlayback(request, env);
    if (/^\/api\/public\/share\/[A-Za-z0-9_-]{20,}$/.test(url.pathname) && request.method === 'POST') {
      return hardenPublicShare(request, await baseWorker.fetch(request, env));
    }
    if (url.pathname === '/api/youtube/library' && request.method === 'GET') return library(request, env);
    if (url.pathname === '/api/youtube/playlists' && request.method === 'GET') {
      const user = await currentUser(request, env);
      if (!user) return json({ error: '請先登入 Starry ID' }, 401);
      return listYoutubePlaylists(request, env, user);
    }
    if (url.pathname === '/api/playlists' || url.pathname.startsWith('/api/playlists/')) {
      const user = await currentUser(request, env);
      if (!user) return json({ error: '請先登入 Starry ID' }, 401);
      const response = await handleBoxPlaylists(request, env, user);
      if (response) return response;
    }
    if (url.pathname === '/api/youtube/disconnect' && request.method === 'POST') {
      await cleanupYoutubeCache(request, env);
    }
    if (url.pathname === '/api/account' && request.method === 'DELETE') {
      await cleanupPlaylistsBeforeAccountDelete(request, env);
      await cleanupYoutubeCache(request, env);
    }
    return baseWorker.fetch(request, env);
  }
};