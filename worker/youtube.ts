import type { Env, LocalUser } from './types';
import { cleanText, decryptSecret, encryptSecret, json, randomToken, sha256 } from './security';

const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const SCOPE = `${UPLOAD_SCOPE} ${READ_SCOPE}`;
const BOX_UPLOAD_TAG = 'box-starry-upload';
const STATE_MINUTES = 10;

export interface YoutubeLibraryItem {
  youtubeVideoId: string;
  title: string;
  description: string;
  youtubePrivacy: 'private' | 'unlisted' | 'public';
  thumbnailUrl: string;
  publishedAt: string;
  uploadedViaBoxTag: boolean;
}

function configured(env: Env): boolean {
  return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
}

function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/auth/youtube/callback`;
}

export async function startYoutubeAuth(request: Request, env: Env, user: LocalUser): Promise<Response> {
  if (!configured(env)) return json({ error: 'YouTube OAuth 尚未完成正式環境設定' }, 503);
  const state = randomToken(32);
  const stateHash = await sha256(state);
  const expires = new Date(Date.now() + STATE_MINUTES * 60_000).toISOString();
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= datetime(\'now\')').run();
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(stateHash, user.id, expires).run();

  const params = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!,
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

export async function finishYoutubeAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!configured(env)) return Response.redirect(`${url.origin}/youtube?connect=setup`, 302);
  const state = cleanText(url.searchParams.get('state'), 256);
  const code = cleanText(url.searchParams.get('code'), 4096);
  if (!state || !code) return Response.redirect(`${url.origin}/youtube?connect=error`, 302);

  const stateHash = await sha256(state);
  const row = await env.DB.prepare(`
    DELETE FROM oauth_states WHERE state_hash=? AND expires_at > datetime('now') RETURNING user_id
  `).bind(stateHash).first<{ user_id: string }>();
  if (!row?.user_id) return Response.redirect(`${url.origin}/youtube?connect=expired`, 302);

  const body = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!,
    client_secret: env.YOUTUBE_CLIENT_SECRET!,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(request)
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json() as Record<string, unknown>;
  const refreshToken = cleanText(payload.refresh_token, 4096);
  if (!response.ok || !refreshToken) {
    console.error('YouTube OAuth token exchange failed', payload);
    return Response.redirect(`${url.origin}/youtube?connect=error`, 302);
  }
  const encrypted = await encryptSecret(refreshToken, env.YOUTUBE_TOKEN_ENCRYPTION_KEY!);
  await env.DB.prepare(`
    INSERT INTO youtube_connections(user_id,encrypted_refresh_token,token_iv,scope,connected_at,updated_at)
    VALUES(?,?,?,?,datetime('now'),datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token,
      token_iv=excluded.token_iv,scope=excluded.scope,updated_at=datetime('now')
  `).bind(row.user_id, encrypted.ciphertext, encrypted.iv, cleanText(payload.scope, 1000) || SCOPE).run();
  return Response.redirect(`${url.origin}/youtube?connect=ok`, 302);
}

export async function youtubeConnected(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM youtube_connections WHERE user_id=? LIMIT 1')
    .bind(userId).first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function youtubeLibraryReady(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT scope FROM youtube_connections WHERE user_id=? LIMIT 1')
    .bind(userId).first<{ scope: string }>();
  return Boolean(row?.scope && String(row.scope).split(/\s+/).includes(READ_SCOPE));
}

export async function disconnectYoutube(env: Env, userId: string): Promise<{ revoked: boolean }> {
  const row = await env.DB.prepare('SELECT encrypted_refresh_token,token_iv FROM youtube_connections WHERE user_id=? LIMIT 1')
    .bind(userId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  let revoked = false;
  if (row && env.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    try {
      const refreshToken = await decryptSecret(row.encrypted_refresh_token, row.token_iv, env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken })
      });
      revoked = response.ok;
      if (!response.ok) console.warn('YouTube OAuth revoke returned', response.status);
    } catch (error) {
      console.warn('YouTube OAuth revoke skipped', error instanceof Error ? error.message : 'unknown');
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM youtube_connections WHERE user_id=?').bind(userId),
    env.DB.prepare('DELETE FROM oauth_states WHERE user_id=?').bind(userId)
  ]);
  return { revoked };
}

async function accessToken(env: Env, userId: string): Promise<string> {
  if (!configured(env)) throw new Error('youtube_not_configured');
  const row = await env.DB.prepare(`SELECT encrypted_refresh_token,token_iv FROM youtube_connections WHERE user_id=? LIMIT 1`)
    .bind(userId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!row) throw new Error('youtube_not_connected');
  const refreshToken = await decryptSecret(row.encrypted_refresh_token, row.token_iv, env.YOUTUBE_TOKEN_ENCRYPTION_KEY!);
  const body = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!,
    client_secret: env.YOUTUBE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  });
  const payload = await response.json() as Record<string, unknown>;
  const token = cleanText(payload.access_token, 4096);
  if (!response.ok || !token) throw new Error('youtube_refresh_failed');
  return token;
}

async function youtubeGet(token: string, url: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('YouTube API read failed', response.status, payload?.error?.message || 'unknown');
    if (response.status === 401 || response.status === 403) throw new Error('youtube_reconnect_required');
    throw new Error('youtube_library_failed');
  }
  return payload;
}

export async function listYoutubeLibraryPage(env: Env, userId: string, pageToken = ''): Promise<{ videos: YoutubeLibraryItem[]; nextPageToken: string | null }> {
  if (!(await youtubeLibraryReady(env, userId))) throw new Error('youtube_reconnect_required');
  const token = await accessToken(env, userId);
  const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelUrl.searchParams.set('part', 'contentDetails');
  channelUrl.searchParams.set('mine', 'true');
  const channelPayload = await youtubeGet(token, channelUrl.toString());
  const uploads = cleanText(channelPayload?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads, 128);
  if (!uploads) return { videos: [], nextPageToken: null };

  const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  playlistUrl.searchParams.set('part', 'contentDetails');
  playlistUrl.searchParams.set('playlistId', uploads);
  playlistUrl.searchParams.set('maxResults', '50');
  if (pageToken) playlistUrl.searchParams.set('pageToken', pageToken);
  const playlistPayload = await youtubeGet(token, playlistUrl.toString());
  const ids = (Array.isArray(playlistPayload?.items) ? playlistPayload.items : [])
    .map((item: any) => cleanText(item?.contentDetails?.videoId, 32))
    .filter(Boolean);
  if (!ids.length) return { videos: [], nextPageToken: cleanText(playlistPayload?.nextPageToken, 256) || null };

  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,status');
  videosUrl.searchParams.set('id', ids.join(','));
  videosUrl.searchParams.set('maxResults', '50');
  const videosPayload = await youtubeGet(token, videosUrl.toString());
  const byId = new Map<string, any>();
  for (const item of (Array.isArray(videosPayload?.items) ? videosPayload.items : [])) {
    if (item?.id) byId.set(String(item.id), item);
  }

  const videos = ids.flatMap((id: string) => {
    const item = byId.get(id);
    if (!item) return [];
    const snippet = item.snippet || {};
    const status = item.status || {};
    const tags = Array.isArray(snippet.tags) ? snippet.tags.map((tag: unknown) => String(tag)) : [];
    const privacy = ['private', 'unlisted', 'public'].includes(String(status.privacyStatus))
      ? status.privacyStatus as 'private' | 'unlisted' | 'public'
      : 'private';
    const thumbnails = snippet.thumbnails || {};
    const thumbnailUrl = cleanText(thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url, 1000)
      || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    return [{
      youtubeVideoId: id,
      title: cleanText(snippet.title, 500) || '未命名影片',
      description: cleanText(snippet.description, 5000),
      youtubePrivacy: privacy,
      thumbnailUrl,
      publishedAt: cleanText(snippet.publishedAt, 80),
      uploadedViaBoxTag: tags.includes(BOX_UPLOAD_TAG)
    } satisfies YoutubeLibraryItem];
  });
  return { videos, nextPageToken: cleanText(playlistPayload?.nextPageToken, 256) || null };
}

export async function createUploadSession(request: Request, env: Env, user: LocalUser): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const title = cleanText(body.title, 100);
  const description = cleanText(body.description, 5000);
  const mimeType = cleanText(body.mimeType, 120) || 'application/octet-stream';
  const fileSize = Number(body.fileSize || 0);
  const privacy = ['private', 'unlisted', 'public'].includes(String(body.privacy)) ? String(body.privacy) : 'private';
  if (!title) return json({ error: '請輸入影片名稱' }, 400);
  if (!Number.isFinite(fileSize) || fileSize <= 0) return json({ error: '影片檔案大小不正確' }, 400);
  if (!mimeType.startsWith('video/') && mimeType !== 'application/octet-stream') return json({ error: '請選擇影片檔案' }, 415);

  let token: string;
  try { token = await accessToken(env, user.id); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'youtube_auth_failed' }, 409); }

  const yt = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      'x-upload-content-length': String(fileSize),
      'x-upload-content-type': mimeType
    },
    body: JSON.stringify({
      snippet: { title, description, tags: [BOX_UPLOAD_TAG] },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false }
    })
  });
  const uploadUrl = yt.headers.get('location');
  if (!yt.ok || !uploadUrl) {
    const detail = await yt.text();
    console.error('YouTube upload session failed', yt.status, detail);
    return json({ error: 'YouTube 暫時無法建立上傳工作，請稍後再試' }, 502);
  }
  return json({ uploadUrl, requestedPrivacy: privacy });
}
