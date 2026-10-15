import baseWorker from './youtubeLibraryRouter';
import type { Env } from './types';
import { currentUser } from './auth';
import { json } from './security';
import { handleYoutubeStudio } from './youtubeStudio';
import { handleYoutubeStudioExtended } from './youtubeStudioExtended';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/youtube/studio/')) {
      const user = await currentUser(request, env);
      if (!user) return json({ error: '請先登入 Starry ID' }, 401);
      const extended = await handleYoutubeStudioExtended(request, env, user);
      if (extended) return extended;
      const response = await handleYoutubeStudio(request, env, user);
      if (response) return response;
    }
    return baseWorker.fetch(request, env);
  }
};
