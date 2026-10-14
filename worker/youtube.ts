import type { Env, LocalUser } from './types';
import { cleanText, decryptSecret, encryptSecret, json, randomToken, sha256 } from './security';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const STATE_MINUTES = 10;

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

export async function createUploadSession(request: Request, env: Env, user: LocalUser): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const title = cleanText(body.title, 100);
  const description = cleanText(body.description, 5000);
  const mimeType = cleanText(body.mimeType, 120) || 'application/octet-stream';
  const fileSize = Number(body.fileSize || 0);
  const privacy = ['private', 'unlisted'].includes(String(body.privacy)) ? String(body.privacy) : 'private';
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
      snippet: { title, description },
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
