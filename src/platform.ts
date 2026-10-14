export async function shareLink(title: string, url: string) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return true; } catch { return false; }
  }
  await navigator.clipboard.writeText(url);
  return true;
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches;
}
