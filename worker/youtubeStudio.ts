import type { Env, LocalUser } from './types';
import { cleanText, json } from './security';
import { youtubeAccessToken, youtubeStudioReady } from './youtube';

function validVideoId(value: unknown): string {
  const id = cleanText(value, 32);
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : '';
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

async function setThumbnail(request: Request, env: Env, user: LocalUser, videoId: string): Promise<Response> {
  if (!videoId) return json({ error: 'YouTube 影片編號不正確' }, 400);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'application/octet-stream'].includes(type)) {
    return json({ error: '縮圖請使用 JPG 或 PNG' }, 415);
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return json({ error: '縮圖檔案需小於 10MB' }, 413);
  let token: string;
  try { token = await youtubeAccessToken(env, user.id); }
  catch { return json({ error: '需要重新授權 YouTube', code: 'youtube_reconnect_required' }, 409); }
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': type || 'application/octet-stream' },
    body: bytes
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('YouTube thumbnail failed', response.status, payload?.error?.message || 'unknown');
    return json({ error: 'YouTube 縮圖設定失敗，請稍後再試' }, response.status === 403 ? 409 : 502);
  }
  const thumbs = payload?.items?.[0] || {};
  return json({ ok: true, thumbnailUrl: cleanText(thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url, 1000) });
}

async function buildSmartCoverPrompt(env: Env, prompt: string, mode: 'title' | 'custom'): Promise<string> {
  const fallback = mode === 'title'
    ? `Premium YouTube thumbnail visual directly about this video title: ${prompt}. Infer the central subject faithfully from the title. If the title is abstract, use only clearly related symbolic imagery. Cinematic 16:9 composition, one strong focal subject, high contrast, professional lighting, clean background, room for optional overlay text, no logos, no watermarks, no readable text, no unrelated people or objects.`
    : `Premium YouTube thumbnail visual. Follow these user requirements faithfully: ${prompt}. Keep every visible subject relevant to the request. Cinematic 16:9 composition, one strong focal subject, professional lighting, clear depth, no logos, no watermarks, and no readable text unless explicitly requested.`;

  try {
    const planner = await env.AI!.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      prompt: `You are a YouTube thumbnail art director. Convert the user's ${mode === 'title' ? 'video title' : 'custom thumbnail request'} into one concise English image-generation prompt.\n\nUser input: ${prompt}\n\nRules:\n- Preserve the actual topic and intent; never invent unrelated people, products, places, or objects.\n- If the input is Chinese, understand its meaning before translating visual concepts.\n- Pick one clear focal subject that best represents the topic.\n- Use realistic, premium, cinematic 16:9 thumbnail composition with strong visual hierarchy.\n- Prefer concrete visual details that are directly supported by the input.\n- If the topic is abstract, use only a simple, obviously related metaphor.\n- Leave clean negative space for optional title overlay.\n- No logos, no watermarks, no readable text unless the user explicitly requested text.\n- Output only the final image prompt, no explanation.`,
      max_tokens: 220,
      temperature: 0.25,
      top_p: 0.85
    });
    const refined = cleanText(planner?.response, 1800);
    return refined || fallback;
  } catch (error) {
    console.warn('Cloudflare smart cover prompt failed, using fallback', error instanceof Error ? error.message : 'unknown');
    return fallback;
  }
}

async function generateCover(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: 'Cloudflare AI 尚未啟用，請稍後再試' }, 503);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const prompt = cleanText(body.prompt, 1200);
  if (!prompt) return json({ error: '請輸入影片標題或封面條件' }, 400);
  const mode: 'title' | 'custom' = body.mode === 'custom' ? 'custom' : 'title';

  try {
    const smartPrompt = await buildSmartCoverPrompt(env, prompt, mode);
    const form = new FormData();
    form.append('prompt', smartPrompt);
    form.append('width', '1280');
    form.append('height', '720');
    form.append('steps', '20');
    const serialized = new Response(form);
    const contentType = serialized.headers.get('content-type');
    const stream = serialized.body;
    if (!contentType || !stream) return json({ error: 'AI 生圖資料準備失敗，請再試一次' }, 502);

    const result = await env.AI.run('@cf/black-forest-labs/flux-2-dev', {
      multipart: {
        body: stream,
        contentType
      }
    });
    const image = typeof result?.image === 'string' ? result.image : '';
    if (!image) return json({ error: 'Cloudflare AI 沒有產生圖片，請再試一次' }, 502);
    return json({
      image,
      mimeType: 'image/jpeg',
      model: '@cf/black-forest-labs/flux-2-dev',
      smartPromptApplied: true
    });
  } catch (error) {
    console.error('Cloudflare cover AI failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'AI 生圖暫時失敗，請稍後再試' }, 502);
  }
}

async function assignPlaylists(request: Request, env: Env, user: LocalUser): Promise<Response> {
  const access = await requireWrite(env, user);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const videoId = validVideoId(body.youtubeVideoId);
  if (!videoId) return json({ error: 'YouTube 影片編號不正確' }, 400);
  const playlistIds = Array.isArray(body.playlistIds)
    ? Array.from(new Set(body.playlistIds.map(v => cleanText(v, 128)).filter(v => /^[A-Za-z0-9_-]{8,128}$/.test(v)))).slice(0, 30)
    : [];
  const rawPositions = body.positions && typeof body.positions === 'object' && !Array.isArray(body.positions)
    ? body.positions as Record<string, unknown>
    : {};
  const results: Array<{ playlistId: string; ok: boolean; reason?: string }> = [];
  for (const playlistId of playlistIds) {
    const raw = Number(rawPositions[playlistId]);
    const snippet: Record<string, unknown> = {
      playlistId,
      resourceId: { kind: 'youtube#video', videoId }
    };
    if (Number.isInteger(raw) && raw >= 0 && raw <= 5000) snippet.position = raw;
    const response = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ snippet })
    });
    const payload: any = await response.json().catch(() => ({}));
    if (response.ok) results.push({ playlistId, ok: true });
    else {
      const reason = cleanText(payload?.error?.errors?.[0]?.reason || payload?.error?.message, 200) || 'playlist_failed';
      if (reason === 'videoAlreadyInPlaylist') results.push({ playlistId, ok: true });
      else results.push({ playlistId, ok: false, reason });
    }
  }
  const failed = results.filter(item => !item.ok);
  return json({ ok: failed.length === 0, results, failedCount: failed.length }, failed.length ? 207 : 200);
}

export async function handleYoutubeStudio(request: Request, env: Env, user: LocalUser): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/youtube/studio/status' && request.method === 'GET') {
    return json({ writeReady: await youtubeStudioReady(env, user.id) });
  }
  if (url.pathname === '/api/youtube/studio/cover-ai' && request.method === 'POST') return generateCover(request, env);
  const thumbnail = url.pathname.match(/^\/api\/youtube\/studio\/thumbnail\/([A-Za-z0-9_-]{6,32})$/);
  if (thumbnail && request.method === 'POST') return setThumbnail(request, env, user, thumbnail[1]);
  if (url.pathname === '/api/youtube/studio/playlists' && request.method === 'POST') return assignPlaylists(request, env, user);
  return null;
}
