import baseWorker from './index';
import type { Env } from './types';
import { currentUser } from './auth';
import { listYoutubeLibraryPage } from './youtube';
import { cleanText, json } from './security';
import { handleBoxPlaylists, listYoutubePlaylists } from './playlists';

interface BoxVideoRow {
  id: string;
  youtube_video_id: string;
  app_visibility: 'owner' | 'public';
  original_filename: string | null;
  file_size: number | null;
  created_at: string;
}

async function library(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: '請先登入 Starry ID' }, 401);
  const pageToken = cleanText(new URL(request.url).searchParams.get('pageToken'), 512);
  try {
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
      const synced = await env.DB.prepare(`
        SELECT id,youtube_video_id,app_visibility,original_filename,file_size,created_at
        FROM videos WHERE owner_user_id=? AND youtube_video_id=? LIMIT 1
      `).bind(user.id, item.youtubeVideoId).first<BoxVideoRow>();
      if (synced) byYoutubeId.set(item.youtubeVideoId, synced);
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
      nextPageToken: page.nextPageToken
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
    if (url.pathname === '/api/account' && request.method === 'DELETE') {
      await cleanupPlaylistsBeforeAccountDelete(request, env);
    }
    return baseWorker.fetch(request, env);
  }
};
