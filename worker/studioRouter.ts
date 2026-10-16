import baseWorker from './youtubeLibraryRouter';
import type { Env, LocalUser } from './types';
import { currentUser } from './auth';
import { cleanText, json } from './security';
import { youtubeAccessToken, youtubeStudioReady } from './youtube';
import { handleYoutubeStudio } from './youtubeStudio';
import { handleYoutubeStudioExtended } from './youtubeStudioExtended';
import { googleYoutubeUploadQuota } from './googleCloudQuota';

const THUMBNAIL_ROUTE = /^\/api\/youtube\/studio\/thumbnail\/([A-Za-z0-9_-]{6,32})$/;
const THUMBNAIL_RETRY_DELAYS = [0, 1200, 3000, 6000];
const YOUTUBE_VERIFY_URL = 'https://www.youtube.com/verify';

type LongUploadsStatus = 'allowed' | 'eligible' | 'disallowed' | 'unknown';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function thumbnailErrorPayload(payload: any): { reason: string; message: string } {
  const reason = cleanText(payload?.error?.errors?.[0]?.reason || payload?.error?.status, 120);
  const message = cleanText(payload?.error?.message, 500);
  return { reason, message };
}

function thumbnailErrorResponse(status: number, payload: any): Response {
  const { reason } = thumbnailErrorPayload(payload);
  if (status === 401) {
    return json({ error: 'YouTube 授權已失效，請重新連接 YouTube', code: 'youtube_reconnect_required' }, 409);
  }
  if (status === 403) {
    return json({
      error: 'YouTube 不允許這個頻道設定自訂縮圖。請完成 YouTube 電話驗證並開啟「中階功能」。',
      code: 'youtube_thumbnail_not_allowed',
      verificationUrl: YOUTUBE_VERIFY_URL
    }, 409);
  }
  if (status === 404 || reason === 'videoNotFound') {
    return json({ error: '影片剛上傳完成，YouTube 尚未準備好縮圖，請稍後再試', code: 'youtube_thumbnail_video_not_ready' }, 409);
  }
  if (status === 429 || reason === 'uploadRateLimitExceeded') {
    return json({ error: 'YouTube 暫時限制自訂縮圖上傳次數，請稍後再試', code: 'youtube_thumbnail_rate_limited' }, 429);
  }
  if (status === 400 && reason === 'invalidImage') {
    return json({ error: 'YouTube 無法讀取這張縮圖，請重新選擇或重新產生封面', code: 'youtube_thumbnail_invalid_image' }, 400);
  }
  return json({ error: 'YouTube 縮圖設定失敗，請稍後再試', code: 'youtube_thumbnail_failed' }, status >= 500 ? 502 : 400);
}

function shouldRetryThumbnail(status: number, payload: any): boolean {
  const { reason } = thumbnailErrorPayload(payload);
  return status === 404 || status === 429 || status >= 500 || reason === 'videoNotFound' || reason === 'backendError';
}

async function setThumbnailDirect(request: Request, env: Env, user: LocalUser, videoId: string): Promise<Response> {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'application/octet-stream'].includes(type)) {
    return json({ error: '縮圖請使用 JPG 或 PNG' }, 415);
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) {
    return json({ error: '縮圖檔案需小於 50MB' }, 413);
  }

  let token: string;
  try {
    token = await youtubeAccessToken(env, user.id);
  } catch {
    return json({ error: '需要重新授權 YouTube', code: 'youtube_reconnect_required' }, 409);
  }

  let lastStatus = 502;
  let lastPayload: any = {};
  for (const delay of THUMBNAIL_RETRY_DELAYS) {
    if (delay) await wait(delay);
    const endpoint = new URL('https://www.googleapis.com/upload/youtube/v3/thumbnails/set');
    endpoint.searchParams.set('videoId', videoId);
    endpoint.searchParams.set('uploadType', 'media');

    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': type || 'application/octet-stream'
      },
      body: bytes
    });
    const payload: any = await response.json().catch(() => ({}));
    if (response.ok) {
      const thumbs = payload?.items?.[0] || {};
      return json({
        ok: true,
        thumbnailUrl: cleanText(thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url, 1000)
      });
    }

    lastStatus = response.status;
    lastPayload = payload;
    console.error('YouTube thumbnail failed', response.status, payload?.error?.message || 'unknown');
    if (!shouldRetryThumbnail(response.status, payload)) break;
  }

  return thumbnailErrorResponse(lastStatus, lastPayload);
}

async function youtubeIntermediateStatus(env: Env, user: LocalUser): Promise<Response> {
  const writeReady = await youtubeStudioReady(env, user.id);
  let longUploadsStatus: LongUploadsStatus = 'unknown';

  try {
    const token = await youtubeAccessToken(env, user.id);
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/channels');
    endpoint.searchParams.set('part', 'status');
    endpoint.searchParams.set('mine', 'true');
    const response = await fetch(endpoint.toString(), { headers: { authorization: `Bearer ${token}` } });
    const payload: any = await response.json().catch(() => ({}));
    if (response.ok) {
      const value = cleanText(payload?.items?.[0]?.status?.longUploadsStatus, 32);
      if (value === 'allowed' || value === 'eligible' || value === 'disallowed') longUploadsStatus = value;
    } else {
      console.warn('YouTube channel feature status failed', response.status, payload?.error?.message || 'unknown');
    }
  } catch (error) {
    console.warn('YouTube channel feature status unavailable', error instanceof Error ? error.message : 'unknown');
  }

  return json({
    writeReady,
    longUploadsStatus,
    canUploadLongVideos: longUploadsStatus === 'allowed',
    needsPhoneVerification: longUploadsStatus === 'eligible',
    verificationUrl: YOUTUBE_VERIFY_URL
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/youtube/studio/')) {
      const user = await currentUser(request, env);
      if (!user) return json({ error: '請先登入 Starry ID' }, 401);

      if (url.pathname === '/api/youtube/studio/status' && request.method === 'GET') {
        return youtubeIntermediateStatus(env, user);
      }
      if (url.pathname === '/api/youtube/studio/upload-quota' && request.method === 'GET') {
        try {
          return json(await googleYoutubeUploadQuota(env));
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown';
          console.error('Google official upload quota unavailable', reason);
          if (reason === 'google_monitoring_not_configured') {
            return json({ error: 'Google 官方配額尚未完成連線設定', code: 'google_quota_not_configured' }, 503);
          }
          if (reason === 'google_video_insert_quota_not_visible') {
            return json({ error: 'Google Cloud 尚未回傳 Video Uploads 官方配額資料', code: 'google_quota_not_visible' }, 503);
          }
          return json({ error: '暫時無法讀取 Google 官方配額，請稍後再試', code: 'google_quota_unavailable' }, 503);
        }
      }

      const thumbnailMatch = url.pathname.match(THUMBNAIL_ROUTE);
      if (thumbnailMatch && request.method === 'POST') {
        return setThumbnailDirect(request, env, user, thumbnailMatch[1]);
      }

      const extended = await handleYoutubeStudioExtended(request, env, user);
      if (extended) return extended;
      const response = await handleYoutubeStudio(request, env, user);
      if (response) return response;
    }

    return baseWorker.fetch(request, env);
  }
};
