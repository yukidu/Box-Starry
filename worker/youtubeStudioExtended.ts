import type { Env, LocalUser } from './types';
import { cleanText, json } from './security';
import { youtubeAccessToken, youtubeStudioReady } from './youtube';

type PlaylistSummary = {
  id: string;
  title: string;
  itemCount: number;
  privacy: string;
};

function validVideoId(value: unknown): string {
  const id = cleanText(value, 32);
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : '';
}

function validPlaylistId(value: unknown): string {
  const id = cleanText(value, 128);
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : '';
}

async function requireWrite(env: Env, user: LocalUser): Promise<{ token: string } | Response> {
  if (!(await youtubeStudioReady(env, user.id))) {
    return json({ error: '需要重新授權 YouTube 編輯權限', code: 'youtube_write_reconnect_required' }, 409);
  }
  try {
    return { token: await youtubeAccessToken(env, user.id) };
  } catch {
    return json({ error: '需要重新授權 YouTube', code: 'youtube_reconnect_required' }, 409);
  }
}

async function youtubeJson(token: string, url: string, init: RequestInit = {}): Promise<{ response: Response; payload: any }> {
  const headers = new Headers(init.headers || {});
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const payload: any = await response.json().catch(() => ({}));
  return { response, payload };
}

async function listOwnedPlaylists(token: string): Promise<PlaylistSummary[]> {
  const playlists: PlaylistSummary[] = [];
  let pageToken = '';
  let rounds = 0;
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.searchParams.set('part', 'snippet,contentDetails,status');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const { response, payload } = await youtubeJson(token, url.toString());
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'youtube_reconnect_required' : 'youtube_playlist_failed');
    for (const item of (Array.isArray(payload?.items) ? payload.items : [])) {
      const id = validPlaylistId(item?.id);
      if (!id) continue;
      playlists.push({
        id,
        title: cleanText(item?.snippet?.title, 500) || '未命名播放清單',
        itemCount: Number(item?.contentDetails?.itemCount || 0),
        privacy: cleanText(item?.status?.privacyStatus, 32) || 'private'
      });
    }
    pageToken = cleanText(payload?.nextPageToken, 512);
    rounds++;
  } while (pageToken && rounds < 10);
  return playlists;
}

async function playlistItemId(token: string, playlistId: string, videoId: string): Promise<string> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'id');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', '1');
  const { response, payload } = await youtubeJson(token, url.toString());
  if (!response.ok) return '';
  return cleanText(payload?.items?.[0]?.id, 128);
}

async function playlistMemberships(token: string, playlists: PlaylistSummary[], videoId: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const batchSize = 20;
  for (let i = 0; i < playlists.length; i += batchSize) {
    const batch = playlists.slice(i, i + batchSize);
    const rows = await Promise.all(batch.map(async playlist => ({
      playlistId: playlist.id,
      itemId: await playlistItemId(token, playlist.id, videoId)
    })));
    for (const row of rows) if (row.itemId) result[row.playlistId] = row.itemId;
  }
  return result;
}

async function readVideo(token: string, videoId: string): Promise<any | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,status,recordingDetails');
  url.searchParams.set('id', videoId);
  const { response, payload } = await youtubeJson(token, url.toString());
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'youtube_reconnect_required' : 'youtube_video_failed');
  return Array.isArray(payload?.items) ? payload.items[0] || null : null;
}

function publicVideoEditor(item: any, videoId: string) {
  const snippet = item?.snippet || {};
  const status = item?.status || {};
  const details = item?.recordingDetails || {};
  const thumbs = snippet?.thumbnails || {};
  const privacy = ['private', 'unlisted', 'public'].includes(String(status?.privacyStatus)) ? String(status.privacyStatus) : 'private';
  const rawDate = cleanText(details?.recordingDate, 80);
  return {
    youtubeVideoId: videoId,
    title: cleanText(snippet?.title, 100) || '未命名影片',
    description: cleanText(snippet?.description, 5000),
    categoryId: /^\d{1,4}$/.test(cleanText(snippet?.categoryId, 8)) ? cleanText(snippet.categoryId, 8) : '27',
    tags: Array.isArray(snippet?.tags) ? snippet.tags.map((tag: unknown) => cleanText(tag, 100)).filter(Boolean).slice(0, 40) : [],
    privacy,
    recordingDate: rawDate ? rawDate.slice(0, 10) : '',
    thumbnailUrl: cleanText(thumbs?.maxres?.url || thumbs?.standard?.url || thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url, 1000)
      || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
  };
}

async function getVideoEditor(env: Env, user: LocalUser, videoId: string): Promise<Response> {
  const access = await requireWrite(env, user);
  if (access instanceof Response) return access;
  try {
    const [item, playlists] = await Promise.all([
      readVideo(access.token, videoId),
      listOwnedPlaylists(access.token)
    ]);
    if (!item) return json({ error: '找不到這支 YouTube 影片' }, 404);
    const memberships = await playlistMemberships(access.token, playlists, videoId);
    return json({
      video: publicVideoEditor(item, videoId),
      playlists,
      selectedPlaylistIds: Object.keys(memberships)
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'youtube_video_failed';
    if (code === 'youtube_reconnect_required') return json({ error: '需要重新授權 YouTube', code }, 409);
    return json({ error: '讀取 YouTube 影片詳細資料失敗，請稍後再試', code }, 502);
  }
}

async function updateVideo(request: Request, env: Env, user: LocalUser, videoId: string): Promise<Response> {
  const access = await requireWrite(env, user);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const current = await readVideo(access.token, videoId);
    if (!current) return json({ error: '找不到這支 YouTube 影片' }, 404);
    const currentSnippet = current.snippet || {};
    const currentStatus = current.status || {};
    const title = cleanText(body.title, 100) || cleanText(currentSnippet.title, 100);
    const description = cleanText(body.description, 5000);
    const categoryId = /^\d{1,4}$/.test(cleanText(body.categoryId, 8)) ? cleanText(body.categoryId, 8) : cleanText(currentSnippet.categoryId, 8) || '27';
    const privacy = ['private', 'unlisted', 'public'].includes(String(body.privacy)) ? String(body.privacy) : String(currentStatus.privacyStatus || 'private');
    const tags = Array.isArray(body.tags)
      ? Array.from(new Set(body.tags.map(tag => cleanText(tag, 100)).filter(Boolean))).slice(0, 40)
      : (Array.isArray(currentSnippet.tags) ? currentSnippet.tags.map((tag: unknown) => cleanText(tag, 100)).filter(Boolean).slice(0, 40) : []);
    const recordingDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(body.recordingDate, 10)) ? cleanText(body.recordingDate, 10) : '';
    if (!title) return json({ error: '請輸入影片名稱' }, 400);

    const snippet: Record<string, unknown> = { title, description, categoryId, tags };
    const defaultLanguage = cleanText(currentSnippet.defaultLanguage, 32);
    if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;
    const status: Record<string, unknown> = { privacyStatus: privacy };
    if (typeof currentStatus.selfDeclaredMadeForKids === 'boolean') status.selfDeclaredMadeForKids = currentStatus.selfDeclaredMadeForKids;
    const resource: Record<string, unknown> = { id: videoId, snippet, status };
    const parts = ['snippet', 'status'];
    if (recordingDate) {
      resource.recordingDetails = { recordingDate: `${recordingDate}T00:00:00.000Z` };
      parts.push('recordingDetails');
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', parts.join(','));
    const { response, payload } = await youtubeJson(access.token, url.toString(), {
      method: 'PUT',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(resource)
    });
    if (!response.ok) {
      console.error('YouTube video update failed', response.status, payload?.error?.message || 'unknown');
      return json({ error: 'YouTube 影片資料更新失敗，請稍後再試' }, response.status === 401 || response.status === 403 ? 409 : 502);
    }

    await env.DB.prepare(`
      UPDATE videos SET title=?,description=?,youtube_privacy=?,
        app_visibility=CASE WHEN ?='private' THEN 'owner' ELSE app_visibility END,
        updated_at=datetime('now')
      WHERE owner_user_id=? AND youtube_video_id=?
    `).bind(title, description || null, privacy, privacy, user.id, videoId).run();
    return json({ ok: true, video: publicVideoEditor(payload, videoId) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'youtube_video_failed';
    if (code === 'youtube_reconnect_required') return json({ error: '需要重新授權 YouTube', code }, 409);
    return json({ error: 'YouTube 影片資料更新失敗，請稍後再試', code }, 502);
  }
}

async function createYoutubePlaylist(request: Request, env: Env, user: LocalUser): Promise<Response> {
  const access = await requireWrite(env, user);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const title = cleanText(body.title, 150);
  const description = cleanText(body.description, 5000);
  const privacy = ['private', 'unlisted', 'public'].includes(String(body.privacy)) ? String(body.privacy) : 'private';
  if (!title) return json({ error: '請輸入 YouTube 播放清單名稱' }, 400);
  const { response, payload } = await youtubeJson(access.token, 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ snippet: { title, description }, status: { privacyStatus: privacy } })
  });
  if (!response.ok) {
    console.error('YouTube playlist create failed', response.status, payload?.error?.message || 'unknown');
    return json({ error: '建立 YouTube 播放清單失敗，請稍後再試' }, response.status === 401 || response.status === 403 ? 409 : 502);
  }
  const id = validPlaylistId(payload?.id);
  if (!id) return json({ error: 'YouTube 沒有回傳播放清單編號' }, 502);
  return json({ playlist: { id, title, itemCount: 0, privacy } }, 201);
}

async function syncVideoPlaylists(request: Request, env: Env, user: LocalUser, videoId: string): Promise<Response> {
  const access = await requireWrite(env, user);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const selected = new Set(Array.isArray(body.playlistIds)
    ? body.playlistIds.map(validPlaylistId).filter(Boolean).slice(0, 100)
    : []);
  try {
    const playlists = await listOwnedPlaylists(access.token);
    const memberships = await playlistMemberships(access.token, playlists, videoId);
    const results: Array<{ playlistId: string; action: string; ok: boolean }> = [];
    for (const playlist of playlists) {
      const itemId = memberships[playlist.id] || '';
      if (selected.has(playlist.id) && !itemId) {
        const { response } = await youtubeJson(access.token, 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ snippet: { playlistId: playlist.id, resourceId: { kind: 'youtube#video', videoId } } })
        });
        results.push({ playlistId: playlist.id, action: 'add', ok: response.ok });
      } else if (!selected.has(playlist.id) && itemId) {
        const { response } = await youtubeJson(access.token, `https://www.googleapis.com/youtube/v3/playlistItems?id=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        results.push({ playlistId: playlist.id, action: 'remove', ok: response.ok });
      }
    }
    const failed = results.filter(item => !item.ok);
    return json({ ok: failed.length === 0, results, failedCount: failed.length }, failed.length ? 207 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'youtube_playlist_failed';
    if (code === 'youtube_reconnect_required') return json({ error: '需要重新授權 YouTube', code }, 409);
    return json({ error: '更新 YouTube 播放清單失敗，請稍後再試', code }, 502);
  }
}

async function probeUploadStatus(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const uploadUrlText = cleanText(body.uploadUrl, 5000);
  const fileSize = Number(body.fileSize || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return json({ error: '影片檔案大小不正確' }, 400);
  let uploadUrl: URL;
  try { uploadUrl = new URL(uploadUrlText); }
  catch { return json({ error: 'YouTube 上傳工作網址不正確' }, 400); }
  if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'www.googleapis.com' || uploadUrl.pathname !== '/upload/youtube/v3/videos') {
    return json({ error: 'YouTube 上傳工作網址不正確' }, 400);
  }
  try {
    const response = await fetch(uploadUrl.toString(), {
      method: 'PUT',
      headers: { 'content-range': `bytes */${fileSize}` },
      body: new Uint8Array(0),
      redirect: 'manual'
    });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    const videoId = validVideoId(payload?.id);
    if (response.ok && videoId) return json({ complete: true, video: payload });
    if (response.status === 308) {
      return json({ complete: false, receivedRange: response.headers.get('range') || '', retryable: true });
    }
    if (response.status === 404 || response.status === 410) {
      return json({ complete: false, retryable: false, error: 'YouTube 上傳工作已失效' });
    }
    return json({ complete: false, retryable: true, status: response.status });
  } catch (error) {
    console.warn('YouTube upload status probe failed', error instanceof Error ? error.message : 'unknown');
    return json({ complete: false, retryable: true, error: '暫時無法確認 YouTube 上傳狀態' }, 502);
  }
}

export async function handleYoutubeStudioExtended(request: Request, env: Env, user: LocalUser): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/youtube/studio/upload-status' && request.method === 'POST') return probeUploadStatus(request);
  if (url.pathname === '/api/youtube/studio/playlists/create' && request.method === 'POST') return createYoutubePlaylist(request, env, user);
  const video = url.pathname.match(/^\/api\/youtube\/studio\/video\/([A-Za-z0-9_-]{6,32})$/);
  if (video && request.method === 'GET') return getVideoEditor(env, user, video[1]);
  if (video && request.method === 'PATCH') return updateVideo(request, env, user, video[1]);
  const videoPlaylists = url.pathname.match(/^\/api\/youtube\/studio\/video\/([A-Za-z0-9_-]{6,32})\/playlists$/);
  if (videoPlaylists && request.method === 'PUT') return syncVideoPlaylists(request, env, user, videoPlaylists[1]);
  return null;
}
