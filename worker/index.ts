import type { Env, LocalUser } from './types';
import { centralRank, currentUser, finishStarryAuth, logout, startStarryAuth } from './auth';
import { finishYoutubeAuth, startYoutubeAuth, youtubeConnected, createUploadSession } from './youtube';
import { cleanText, hashPassword, isoOrNull, json, randomToken, sha256, verifyPassword } from './security';

interface VideoRow {
  id: string;
  owner_user_id: string;
  youtube_video_id: string;
  title: string;
  description: string | null;
  youtube_privacy: 'private' | 'unlisted' | 'public';
  app_visibility: 'owner' | 'public';
  upload_status: string;
  original_filename: string | null;
  file_size: number | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ShareRow {
  id: string;
  video_id: string;
  owner_user_id: string;
  token_hash: string;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: string | null;
  first_opened_at: string | null;
  expire_after_first_open_days: number | null;
  disabled_at: string | null;
  created_at: string;
}

function envReady(env: Partial<Env>): boolean {
  return Boolean(env.DB && env.STARRY_ID_DB);
}

function publicVideo(row: VideoRow) {
  return {
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    title: row.title,
    description: row.description || '',
    youtubePrivacy: row.youtube_privacy,
    appVisibility: row.app_visibility,
    uploadStatus: row.upload_status,
    originalFilename: row.original_filename || '',
    fileSize: row.file_size || 0,
    thumbnailUrl: row.thumbnail_url || `https://i.ytimg.com/vi/${encodeURIComponent(row.youtube_video_id)}/hqdefault.jpg`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function shareExpired(row: ShareRow): boolean {
  const now = Date.now();
  if (row.disabled_at) return true;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return true;
  if (row.first_opened_at && row.expire_after_first_open_days) {
    const due = new Date(row.first_opened_at).getTime() + row.expire_after_first_open_days * 86400_000;
    if (due <= now) return true;
  }
  return false;
}

async function requireUser(request: Request, env: Env): Promise<LocalUser | Response> {
  const user = await currentUser(request, env);
  return user || json({ error: '請先登入 Starry ID' }, 401);
}

async function listOwnVideos(env: Env, userId: string): Promise<VideoRow[]> {
  const rows = await env.DB.prepare('SELECT * FROM videos WHERE owner_user_id=? ORDER BY created_at DESC').bind(userId).all<VideoRow>();
  return rows.results || [];
}

async function videoOwned(env: Env, userId: string, id: string): Promise<VideoRow | null> {
  return env.DB.prepare('SELECT * FROM videos WHERE id=? AND owner_user_id=? LIMIT 1').bind(id, userId).first<VideoRow>();
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/health' && request.method === 'GET') {
    return json({
      ok: true,
      app: '繁星膠囊 Box Starry',
      environmentReady: envReady(env),
      youtubeOAuthReady: Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_TOKEN_ENCRYPTION_KEY)
    });
  }
  if (!envReady(env)) return json({ error: '正式資料庫尚未綁定，應用仍在建置階段' }, 503);

  if (path === '/api/me' && request.method === 'GET') {
    const user = await currentUser(request, env);
    if (!user) return json({ user: null, youtubeConnected: false });
    return json({
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        avatar: user.avatar_url,
        profileSlug: user.starry_profile_slug,
        rank: await centralRank(env, user.id)
      },
      youtubeConnected: await youtubeConnected(env, user.id)
    });
  }

  if (path === '/api/logout' && request.method === 'POST') return logout(request, env);

  const publicMember = path.match(/^\/api\/public\/member\/([^/]+)$/);
  if (publicMember && request.method === 'GET') {
    const slug = decodeURIComponent(publicMember[1]).slice(0, 80);
    const owner = await env.DB.prepare(`SELECT id,display_name,avatar_url,starry_profile_slug FROM users WHERE starry_profile_slug=? AND status='active' LIMIT 1`)
      .bind(slug).first<{ id: string; display_name: string | null; avatar_url: string | null; starry_profile_slug: string | null }>();
    if (!owner) return json({ error: '找不到這位會員的繁星膠囊' }, 404);
    const videos = await env.DB.prepare(`
      SELECT * FROM videos WHERE owner_user_id=? AND app_visibility='public' AND youtube_privacy <> 'private' ORDER BY created_at DESC
    `).bind(owner.id).all<VideoRow>();
    return json({
      owner: { name: owner.display_name || '繁星會員', avatar: owner.avatar_url || '', profileSlug: owner.starry_profile_slug },
      videos: (videos.results || []).map(publicVideo)
    });
  }

  const publicShare = path.match(/^\/api\/public\/share\/([A-Za-z0-9_-]{20,})$/);
  if (publicShare && request.method === 'POST') {
    const token = publicShare[1];
    const tokenHash = await sha256(token);
    const share = await env.DB.prepare('SELECT * FROM share_links WHERE token_hash=? LIMIT 1').bind(tokenHash).first<ShareRow>();
    if (!share || shareExpired(share)) return json({ error: '這個分享連結已失效' }, 410);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (share.password_hash && share.password_salt) {
      const password = cleanText(body.password, 200);
      if (!password || !(await verifyPassword(password, share.password_salt, share.password_hash))) {
        return json({ error: '密碼不正確', passwordRequired: true }, 401);
      }
    }
    if (!share.first_opened_at && share.expire_after_first_open_days) {
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE share_links SET first_opened_at=? WHERE id=? AND first_opened_at IS NULL').bind(now, share.id).run();
      share.first_opened_at = now;
    }
    const video = await env.DB.prepare('SELECT * FROM videos WHERE id=? LIMIT 1').bind(share.video_id).first<VideoRow>();
    if (!video || video.youtube_privacy === 'private') return json({ error: '影片目前仍是 YouTube 私人狀態，無法對外播放' }, 409);
    return json({
      video: publicVideo(video),
      share: {
        expiresAt: share.expires_at,
        firstOpenedAt: share.first_opened_at,
        expireAfterFirstOpenDays: share.expire_after_first_open_days
      }
    });
  }

  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;
  const user = auth;

  if (path === '/api/youtube/status' && request.method === 'GET') {
    return json({ connected: await youtubeConnected(env, user.id), configured: Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET) });
  }
  if (path === '/api/youtube/upload-session' && request.method === 'POST') return createUploadSession(request, env, user);

  if (path === '/api/videos' && request.method === 'GET') return json({ videos: (await listOwnVideos(env, user.id)).map(publicVideo) });

  if (path === '/api/videos' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const youtubeVideoId = cleanText(body.youtubeVideoId, 32);
    const title = cleanText(body.title, 100);
    const privacy = ['private', 'unlisted', 'public'].includes(String(body.youtubePrivacy)) ? String(body.youtubePrivacy) : 'private';
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(youtubeVideoId)) return json({ error: 'YouTube 影片編號不正確' }, 400);
    if (!title) return json({ error: '請輸入影片名稱' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO videos(id,owner_user_id,youtube_video_id,title,description,youtube_privacy,app_visibility,upload_status,original_filename,file_size,thumbnail_url)
      VALUES(?,?,?,?,?,?,?,'ready',?,?,?)
    `).bind(
      id, user.id, youtubeVideoId, title, cleanText(body.description, 5000) || null, privacy,
      privacy === 'private' ? 'owner' : (body.appVisibility === 'public' ? 'public' : 'owner'),
      cleanText(body.originalFilename, 500) || null,
      Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null,
      `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`
    ).run();
    return json({ video: publicVideo((await videoOwned(env, user.id, id))!) }, 201);
  }

  const videoMatch = path.match(/^\/api\/videos\/([0-9a-f-]{36})$/i);
  if (videoMatch) {
    const video = await videoOwned(env, user.id, videoMatch[1]);
    if (!video) return json({ error: '找不到影片' }, 404);
    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const visibility = body.appVisibility === 'public' ? 'public' : 'owner';
      if (visibility === 'public' && video.youtube_privacy === 'private') {
        return json({ error: 'YouTube 私人影片不能設為公開訪客可看；請重新上傳為「不公開」影片' }, 409);
      }
      await env.DB.prepare('UPDATE videos SET app_visibility=?,updated_at=datetime(\'now\') WHERE id=? AND owner_user_id=?')
        .bind(visibility, video.id, user.id).run();
      return json({ ok: true, appVisibility: visibility });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM videos WHERE id=? AND owner_user_id=?').bind(video.id, user.id).run();
      return json({ ok: true, note: '已從 Box Starry 清單移除；YouTube 原片不會被刪除' });
    }
  }

  const shareCreate = path.match(/^\/api\/videos\/([0-9a-f-]{36})\/shares$/i);
  if (shareCreate && request.method === 'POST') {
    const video = await videoOwned(env, user.id, shareCreate[1]);
    if (!video) return json({ error: '找不到影片' }, 404);
    if (video.youtube_privacy === 'private') return json({ error: 'YouTube 私人影片無法建立訪客分享連結；請使用「不公開」上傳模式' }, 409);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const password = cleanText(body.password, 200);
    const expiresAt = isoOrNull(body.expiresAt);
    const firstDaysRaw = Number(body.expireAfterFirstOpenDays || 0);
    const firstDays = Number.isInteger(firstDaysRaw) && firstDaysRaw >= 1 && firstDaysRaw <= 3650 ? firstDaysRaw : null;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return json({ error: '失效日期必須晚於現在' }, 400);
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const pass = password ? await hashPassword(password) : { hash: null, salt: null };
    await env.DB.prepare(`
      INSERT INTO share_links(id,video_id,owner_user_id,token_hash,password_hash,password_salt,expires_at,expire_after_first_open_days)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(), video.id, user.id, tokenHash, pass.hash, pass.salt, expiresAt, firstDays).run();
    return json({
      shareUrl: `${url.origin}/s/${token}`,
      expiresAt,
      expireAfterFirstOpenDays: firstDays,
      passwordProtected: Boolean(password)
    }, 201);
  }

  if (path === '/api/shares' && request.method === 'GET') {
    const rows = await env.DB.prepare(`
      SELECT s.*,v.title,v.youtube_video_id FROM share_links s JOIN videos v ON v.id=s.video_id
      WHERE s.owner_user_id=? ORDER BY s.created_at DESC
    `).bind(user.id).all<ShareRow & { title: string; youtube_video_id: string }>();
    return json({ shares: (rows.results || []).map(row => ({
      id: row.id,
      videoId: row.video_id,
      title: row.title,
      passwordProtected: Boolean(row.password_hash),
      expiresAt: row.expires_at,
      firstOpenedAt: row.first_opened_at,
      expireAfterFirstOpenDays: row.expire_after_first_open_days,
      disabled: Boolean(row.disabled_at),
      expired: shareExpired(row),
      createdAt: row.created_at
    })) });
  }

  const shareDelete = path.match(/^\/api\/shares\/([0-9a-f-]{36})$/i);
  if (shareDelete && request.method === 'DELETE') {
    const result = await env.DB.prepare('UPDATE share_links SET disabled_at=datetime(\'now\') WHERE id=? AND owner_user_id=? AND disabled_at IS NULL')
      .bind(shareDelete[1], user.id).run();
    if (!result.meta.changes) return json({ error: '找不到可停用的分享連結' }, 404);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/auth/starry' || path === '/auth/google')) {
      if (!envReady(env)) return Response.redirect(`${url.origin}/?login=setup`, 302);
      return startStarryAuth();
    }
    if (request.method === 'GET' && path === '/auth/callback') {
      if (!envReady(env)) return Response.redirect(`${url.origin}/?login=setup`, 302);
      return finishStarryAuth(request, env);
    }
    if (request.method === 'GET' && path === '/auth/youtube') {
      if (!envReady(env)) return Response.redirect(`${url.origin}/youtube?connect=setup`, 302);
      const user = await currentUser(request, env);
      return user ? startYoutubeAuth(request, env, user) : Response.redirect(`${url.origin}/?login=required`, 302);
    }
    if (request.method === 'GET' && path === '/auth/youtube/callback') {
      if (!envReady(env)) return Response.redirect(`${url.origin}/youtube?connect=setup`, 302);
      return finishYoutubeAuth(request, env);
    }
    if (path.startsWith('/api/')) return handleApi(request, env);

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    return env.ASSETS.fetch(new Request(new URL('/', url.origin), request));
  }
};
