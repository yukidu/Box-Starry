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

function splitExcludeRules(excludeText: string): { suppressAutoText: boolean; genericExcludeText: string } {
  const suppressAutoText = /不要\s*文字/.test(excludeText);
  const genericExcludeText = excludeText
    .replace(/不要\s*文字/g, '')
    .split(/[，,、；;\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .join('、');
  return { suppressAutoText, genericExcludeText };
}

async function buildSmartCoverPrompt(env: Env, videoTitle: string, coverTitleText: string, excludeText: string): Promise<string> {
  const { suppressAutoText, genericExcludeText } = splitExcludeRules(excludeText);
  const titleRule = suppressAutoText
    ? coverTitleText
      ? `The only readable text allowed is exactly this user-supplied cover headline: "${coverTitleText}". Preserve the wording and language exactly. Make it large, highly legible, visually balanced, and do not add any other readable text. Never derive, invent, or render text from the background and main-visual brief.`
      : 'Do not render any readable text anywhere. Never derive, invent, or render text from the background and main-visual brief.'
    : coverTitleText
      ? `Include exactly this visible cover headline: "${coverTitleText}". Preserve the wording and language exactly. Make it large, highly legible, visually balanced, and do not add any other readable text.`
      : 'Do not render any readable text. Leave useful negative space for an optional future title.';
  const exclusionRule = genericExcludeText
    ? `STRICT EXCLUSIONS: Do not include any of these contents in the image: ${genericExcludeText}. Treat this as a hard visual restriction even if the background and main-visual brief might otherwise suggest them.`
    : 'No additional visual exclusions.';
  const fallback = `Premium YouTube thumbnail based directly on this background and main-visual brief: ${videoTitle}. Infer the central visual subject faithfully and create only clearly relevant people, objects, symbols, and scenery. Cinematic 16:9 composition, one strong focal subject, premium professional lighting, strong hierarchy, no logos, no watermarks. ${titleRule} ${exclusionRule}`;

  try {
    const planner = await env.AI!.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      prompt: `You are a YouTube thumbnail art director. Build one concise English image-generation prompt from three separate inputs.\n\nBACKGROUND & MAIN VISUAL BRIEF (controls only the background scene and visual subject):\n${videoTitle}\n\nCOVER HEADLINE (user-supplied visible headline; may be empty):\n${coverTitleText || '[empty]'}\n\nDO NOT INCLUDE (hard exclusions; may be empty):\n${genericExcludeText || '[empty]'}\n\nNO AUTO TEXT FROM BACKGROUND BRIEF:\n${suppressAutoText ? 'YES' : 'NO'}\n\nRules:\n- First understand the BACKGROUND & MAIN VISUAL BRIEF faithfully, including Chinese meaning.\n- The background scene and focal subject must come from the BACKGROUND & MAIN VISUAL BRIEF, not from unrelated guesses.\n- Treat DO NOT INCLUDE as hard negative visual instructions. Translate their meaning if needed and explicitly tell the image model not to show those people, products, objects, styles, colors, scenes, or other excluded visual content.\n- The visual exclusions override any conflicting visual ideas from the BACKGROUND & MAIN VISUAL BRIEF.\n- If NO AUTO TEXT FROM BACKGROUND BRIEF is YES, never derive, invent, or render any readable text from the BACKGROUND & MAIN VISUAL BRIEF. This rule does NOT prohibit the user-supplied COVER HEADLINE.\n- If NO AUTO TEXT FROM BACKGROUND BRIEF is YES and COVER HEADLINE is not empty, the COVER HEADLINE is the only readable text allowed in the image.\n- Never invent unrelated people, products, places, medical claims, brands, objects, or extra wording.\n- Use a premium realistic/cinematic 16:9 YouTube thumbnail composition with one strong focal subject and clear visual hierarchy.\n- If the topic is abstract, use only an obvious, simple metaphor directly related to the background and main-visual brief.\n- If COVER HEADLINE is not empty, instruct the image model to render that exact headline, preserving its wording and language exactly, with large readable typography, strong contrast, safe margins, and no additional readable text.\n- If COVER HEADLINE is empty, instruct the image model not to render readable text and to leave clean negative space.\n- No logos or watermarks.\n- Output only the final image prompt, no explanation.`,
      max_tokens: 340,
      temperature: 0.18,
      top_p: 0.82
    });
    const refined = cleanText(planner?.response, 2400);
    return refined || fallback;
  } catch (error) {
    console.warn('Cloudflare smart cover prompt failed, using fallback', error instanceof Error ? error.message : 'unknown');
    return fallback;
  }
}

async function generateCover(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: 'Cloudflare AI 尚未啟用，請稍後再試' }, 503);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const videoTitle = cleanText(body.videoTitle, 300);
  const coverTitleText = cleanText(body.coverTitleText, 120);
  const excludeText = cleanText(body.excludeText, 500);
  if (!videoTitle) return json({ error: '請輸入影片背景圖與主視覺' }, 400);

  try {
    const { suppressAutoText } = splitExcludeRules(excludeText);
    const smartPrompt = await buildSmartCoverPrompt(env, videoTitle, coverTitleText, excludeText);
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
      multipart: { body: stream, contentType }
    });
    const image = typeof result?.image === 'string' ? result.image : '';
    if (!image) return json({ error: 'Cloudflare AI 沒有產生圖片，請再試一次' }, 502);
    return json({
      image,
      mimeType: 'image/jpeg',
      model: '@cf/black-forest-labs/flux-2-dev',
      smartPromptApplied: true,
      coverTitleApplied: Boolean(coverTitleText),
      exclusionsApplied: Boolean(excludeText),
      suppressAutoText
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
