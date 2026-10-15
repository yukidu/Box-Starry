import type { Env } from './types';

export const DEFAULT_DAILY_UPLOAD_LIMIT = 100;
const QUOTA_TIME_ZONE = 'America/Los_Angeles';

function quotaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function recordYoutubeUploadAttempt(env: Env): Promise<void> {
  const day = quotaDate();
  await env.DB.prepare(`
    INSERT INTO youtube_upload_quota_usage(quota_date,used_count,updated_at)
    VALUES(?,1,datetime('now'))
    ON CONFLICT(quota_date) DO UPDATE SET
      used_count=youtube_upload_quota_usage.used_count+1,
      updated_at=datetime('now')
  `).bind(day).run();
}

export async function youtubeUploadQuotaEstimate(env: Env) {
  const day = quotaDate();
  const row = await env.DB.prepare('SELECT used_count FROM youtube_upload_quota_usage WHERE quota_date=? LIMIT 1')
    .bind(day).first<{ used_count: number }>();
  const attempted = Math.max(0, Number(row?.used_count || 0));
  const remaining = Math.max(0, DEFAULT_DAILY_UPLOAD_LIMIT - attempted);
  return {
    dailyLimit: DEFAULT_DAILY_UPLOAD_LIMIT,
    attempted,
    remaining,
    quotaDate: day,
    resetTimeZone: QUOTA_TIME_ZONE,
    source: 'box_estimate',
    note: '此數字只統計 Box Starry 自己送出的 YouTube 上傳呼叫，官方即時額度仍以 Google Cloud Console 為準。'
  };
}
