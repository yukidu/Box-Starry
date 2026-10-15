import baseWorker from './youtubeLibraryRouter';
import type { Env } from './types';
import { currentUser } from './auth';
import { json } from './security';
import { handleYoutubeStudio } from './youtubeStudio';
import { handleYoutubeStudioExtended } from './youtubeStudioExtended';

const THUMBNAIL_ROUTE = /^\/api\/youtube\/studio\/thumbnail\/[A-Za-z0-9_-]{6,32}$/;
const THUMBNAIL_RETRY_DELAYS = [1200, 2400];

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryThumbnail(response: Response): boolean {
  return response.status === 409 || response.status === 429 || response.status >= 500;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/youtube/studio/')) {
      const user = await currentUser(request, env);
      if (!user) return json({ error: '請先登入 Starry ID' }, 401);

      const thumbnailRequest = THUMBNAIL_ROUTE.test(url.pathname) && request.method === 'POST';
      const retryRequests = thumbnailRequest
        ? THUMBNAIL_RETRY_DELAYS.map(() => request.clone())
        : [];

      const extended = await handleYoutubeStudioExtended(request, env, user);
      if (extended) return extended;
      let response = await handleYoutubeStudio(request, env, user);

      if (response && thumbnailRequest && !response.ok && shouldRetryThumbnail(response)) {
        for (let index = 0; index < retryRequests.length; index++) {
          await wait(THUMBNAIL_RETRY_DELAYS[index]);
          const retried = await handleYoutubeStudio(retryRequests[index], env, user);
          if (!retried) break;
          response = retried;
          if (response.ok || !shouldRetryThumbnail(response)) break;
        }
      }

      if (response) return response;
    }
    return baseWorker.fetch(request, env);
  }
};
