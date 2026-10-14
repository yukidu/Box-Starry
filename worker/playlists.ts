import type { Env, LocalUser } from './types';
import { cleanText, decryptSecret, json } from './security';

async function youtubeAccessToken(env: Env, userId: string): Promise<string> {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    throw new Error('youtube_not_configured');
  }
  const row = await env.DB.prepare('SELECT encrypted_refresh_token,token_iv,scope FROM youtube_connections WHERE user_id=? LIMIT 1')
    .bind(userId).first<{ encrypted_refresh_token:string; token_iv:string; scope:string }>();
  if (!row) throw new Error('youtube_not_connected');
  if (!String(row.scope || '').split(/\s+/).includes('https://www.googleapis.com/auth/youtube.readonly')) {
    throw new Error('youtube_reconnect_required');
  }
  const refreshToken = await decryptSecret(row.encrypted_refresh_token, row.token_iv, env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json() as Record<string, unknown>;
  const token = cleanText(payload.access_token, 4096);
  if (!response.ok || !token) throw new Error('youtube_reconnect_required');
  return token;
}

async function youtubeJson(token: string, url: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('youtube_reconnect_required');
    throw new Error('youtube_playlist_failed');
  }
  return payload;
}

export async function listYoutubePlaylists(request: Request, env: Env, user: LocalUser): Promise<Response> {
  try {
    const token = await youtubeAccessToken(env, user.id);
    const source = new URL(request.url);
    const pageToken = cleanText(source.searchParams.get('pageToken'), 512);
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.searchParams.set('part', 'snippet,contentDetails,status');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await youtubeJson(token, url.toString());
    const playlists = (Array.isArray(payload?.items) ? payload.items : []).map((item: any) => {
      const snippet = item?.snippet || {};
      const thumbs = snippet.thumbnails || {};
      return {
        id: cleanText(item?.id, 128),
        title: cleanText(snippet.title, 500) || '未命名播放清單',
        description: cleanText(snippet.description, 5000),
        thumbnailUrl: cleanText(thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url, 1000),
        itemCount: Number(item?.contentDetails?.itemCount || 0),
        privacy: cleanText(item?.status?.privacyStatus, 32) || 'private',
        publishedAt: cleanText(snippet.publishedAt, 80)
      };
    }).filter((item: any) => item.id);
    return json({ playlists, nextPageToken: cleanText(payload?.nextPageToken, 512) || null });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'youtube_playlist_failed';
    if (code === 'youtube_reconnect_required') return json({ error: '需要重新授權 YouTube，才能同步播放清單', code }, 409);
    if (code === 'youtube_not_connected') return json({ error: '請先連接 YouTube', code }, 409);
    return json({ error: '同步 YouTube 播放清單失敗，請稍後再試', code }, 502);
  }
}

async function ownedPlaylist(env: Env, userId: string, playlistId: string) {
  return env.DB.prepare('SELECT id,name,description,created_at,updated_at FROM box_playlists WHERE id=? AND owner_user_id=? LIMIT 1')
    .bind(playlistId, userId).first<any>();
}

export async function handleBoxPlaylists(request: Request, env: Env, user: LocalUser): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (url.pathname === '/api/playlists') {
    if (method === 'GET') {
      const rows = await env.DB.prepare(`
        SELECT p.id,p.name,p.description,p.created_at,p.updated_at,
          (SELECT COUNT(*) FROM box_playlist_items i WHERE i.playlist_id=p.id) AS item_count
        FROM box_playlists p WHERE p.owner_user_id=? ORDER BY p.updated_at DESC,p.created_at DESC
      `).bind(user.id).all<any>();
      return json({ playlists: (rows.results || []).map(row => ({
        id: row.id, name: row.name, description: row.description || '',
        itemCount: Number(row.item_count || 0), createdAt: row.created_at, updatedAt: row.updated_at
      })) });
    }
    if (method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = cleanText(body.name, 120);
      const description = cleanText(body.description, 1000);
      if (!name) return json({ error: '請輸入播放清單名稱' }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO box_playlists(id,owner_user_id,name,description,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))`)
        .bind(id, user.id, name, description || null).run();
      return json({ playlist: { id, name, description, itemCount: 0 } }, 201);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  const playlistMatch = url.pathname.match(/^\/api\/playlists\/([A-Za-z0-9-]+)$/);
  if (playlistMatch) {
    const playlistId = playlistMatch[1];
    const playlist = await ownedPlaylist(env, user.id, playlistId);
    if (!playlist) return json({ error: '找不到這個播放清單' }, 404);
    if (method === 'PATCH') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = cleanText(body.name, 120);
      const description = cleanText(body.description, 1000);
      if (!name) return json({ error: '請輸入播放清單名稱' }, 400);
      await env.DB.prepare('UPDATE box_playlists SET name=?,description=?,updated_at=datetime(\'now\') WHERE id=? AND owner_user_id=?')
        .bind(name, description || null, playlistId, user.id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM box_playlist_items WHERE playlist_id=?').bind(playlistId),
        env.DB.prepare('DELETE FROM box_playlists WHERE id=? AND owner_user_id=?').bind(playlistId, user.id)
      ]);
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  const itemsMatch = url.pathname.match(/^\/api\/playlists\/([A-Za-z0-9-]+)\/items$/);
  if (itemsMatch) {
    const playlistId = itemsMatch[1];
    const playlist = await ownedPlaylist(env, user.id, playlistId);
    if (!playlist) return json({ error: '找不到這個播放清單' }, 404);
    if (method === 'GET') {
      const rows = await env.DB.prepare(`SELECT youtube_video_id,title,thumbnail_url,position,added_at FROM box_playlist_items WHERE playlist_id=? ORDER BY position,added_at`)
        .bind(playlistId).all<any>();
      return json({ playlist: { id: playlist.id, name: playlist.name, description: playlist.description || '' }, items: (rows.results || []).map(row => ({
        youtubeVideoId: row.youtube_video_id, title: row.title, thumbnailUrl: row.thumbnail_url || '', position: Number(row.position || 0), addedAt: row.added_at
      })) });
    }
    if (method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const youtubeVideoId = cleanText(body.youtubeVideoId, 64);
      const title = cleanText(body.title, 500) || '未命名影片';
      const thumbnailUrl = cleanText(body.thumbnailUrl, 1000);
      if (!youtubeVideoId) return json({ error: '影片資料不完整' }, 400);
      const max = await env.DB.prepare('SELECT COALESCE(MAX(position),-1) AS p FROM box_playlist_items WHERE playlist_id=?').bind(playlistId).first<{p:number}>();
      const position = Number(max?.p ?? -1) + 1;
      await env.DB.prepare(`INSERT INTO box_playlist_items(playlist_id,youtube_video_id,title,thumbnail_url,position,added_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(playlist_id,youtube_video_id) DO UPDATE SET title=excluded.title,thumbnail_url=excluded.thumbnail_url`)
        .bind(playlistId, youtubeVideoId, title, thumbnailUrl || null, position).run();
      await env.DB.prepare('UPDATE box_playlists SET updated_at=datetime(\'now\') WHERE id=? AND owner_user_id=?').bind(playlistId, user.id).run();
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  const itemDeleteMatch = url.pathname.match(/^\/api\/playlists\/([A-Za-z0-9-]+)\/items\/([A-Za-z0-9_-]+)$/);
  if (itemDeleteMatch && method === 'DELETE') {
    const playlistId = itemDeleteMatch[1];
    const youtubeVideoId = itemDeleteMatch[2];
    const playlist = await ownedPlaylist(env, user.id, playlistId);
    if (!playlist) return json({ error: '找不到這個播放清單' }, 404);
    await env.DB.prepare('DELETE FROM box_playlist_items WHERE playlist_id=? AND youtube_video_id=?').bind(playlistId, youtubeVideoId).run();
    await env.DB.prepare('UPDATE box_playlists SET updated_at=datetime(\'now\') WHERE id=? AND owner_user_id=?').bind(playlistId, user.id).run();
    return json({ ok: true });
  }
  return null;
}
