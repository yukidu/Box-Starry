async function syncYoutubeLibraryInBackground() {
  try {
    localStorage.setItem('box-youtube-sync-requested', new Date().toISOString());
    let token = '';
    let pages = 0;
    do {
      const path = `/api/youtube/library${token ? `?pageToken=${encodeURIComponent(token)}` : ''}`;
      const response = await fetch(path, { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      token = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      pages++;
    } while (token && pages < 100);
    localStorage.removeItem('box-youtube-sync-requested');
    window.dispatchEvent(new CustomEvent('box-youtube-synced'));
  } catch {
    // Background sync is best-effort. The video manager also syncs whenever it opens.
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '操作失敗，請稍後再試');
  if (path === '/api/videos' && String(init?.method || 'GET').toUpperCase() === 'POST') {
    void syncYoutubeLibraryInBackground();
  }
  return data as T;
}
