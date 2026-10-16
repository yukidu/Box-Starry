import type { Env } from './types';

const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read';
const YOUTUBE_SERVICE = 'youtube.googleapis.com';
const EXPECTED_VIDEO_INSERT_QUOTA_METRIC = 'youtube.googleapis.com/video_insert';
const EXPECTED_VIDEO_INSERT_LIMIT_NAME = 'defaultVideoInserterPerDayPerProject';
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type TimeSeriesPoint = {
  interval?: { endTime?: string };
  value?: { int64Value?: string; doubleValue?: number };
};

type TimeSeries = {
  metric?: { labels?: Record<string, string> };
  points?: TimeSeriesPoint[];
};

type TimeSeriesResponse = { timeSeries?: TimeSeries[]; nextPageToken?: string };

function base64UrlBytes(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlText(text: string): string {
  return base64UrlBytes(new TextEncoder().encode(text));
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function serviceAccountToken(env: Env): Promise<string> {
  if (!env.GOOGLE_MONITORING_SERVICE_ACCOUNT_JSON) throw new Error('google_monitoring_not_configured');
  let account: ServiceAccount;
  try {
    account = JSON.parse(env.GOOGLE_MONITORING_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch {
    throw new Error('google_monitoring_invalid_credentials');
  }
  if (!account.client_email || !account.private_key) throw new Error('google_monitoring_invalid_credentials');

  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlText(JSON.stringify({
    iss: account.client_email,
    scope: MONITORING_SCOPE,
    aud: tokenUri,
    iat: now - 30,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    ownedArrayBuffer(pemToBytes(account.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    ownedArrayBuffer(new TextEncoder().encode(unsigned))
  );
  const assertion = `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error('google_monitoring_auth_failed');
  return String(payload.access_token);
}

function pacificDayStart(now = new Date()): Date {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (type: string) => Number(dateParts.find(part => part.type === type)?.value || 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  for (let utcHour = 6; utcHour <= 10; utcHour++) {
    const candidate = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));
    const parts = check.formatToParts(candidate);
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value || -1);
    if (value('year') === year && value('month') === month && value('day') === day && value('hour') === 0 && value('minute') === 0) return candidate;
  }
  throw new Error('google_monitoring_time_zone_failed');
}

function pointNumber(point: TimeSeriesPoint): number {
  if (point.value?.int64Value != null) return Number(point.value.int64Value) || 0;
  if (point.value?.doubleValue != null) return Number(point.value.doubleValue) || 0;
  return 0;
}

async function listTimeSeries(env: Env, token: string, metricType: string, extraFilter: string, start: Date, end: Date): Promise<TimeSeries[]> {
  const project = env.GOOGLE_CLOUD_PROJECT_NUMBER;
  if (!project) throw new Error('google_monitoring_project_missing');
  const all: TimeSeries[] = [];
  let pageToken = '';
  do {
    const endpoint = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries`);
    const filters = [
      `metric.type="${metricType}"`,
      'resource.type="consumer_quota"',
      `resource.label."service"="${YOUTUBE_SERVICE}"`
    ];
    if (extraFilter) filters.push(extraFilter);
    endpoint.searchParams.set('filter', filters.join(' AND '));
    endpoint.searchParams.set('interval.startTime', start.toISOString());
    endpoint.searchParams.set('interval.endTime', end.toISOString());
    endpoint.searchParams.set('view', 'FULL');
    endpoint.searchParams.set('pageSize', '10000');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetch(endpoint.toString(), { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({})) as TimeSeriesResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(`google_monitoring_query_failed:${response.status}:${payload.error?.message || 'unknown'}`);
    all.push(...(payload.timeSeries || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return all;
}

function looksLikeVideoInsert(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return normalized.includes('video') && (normalized.includes('insert') || normalized.includes('upload'));
}

function discoverVideoInsertQuota(limitSeries: TimeSeries[]): { quotaMetric: string; limitName: string; dailyLimit: number } {
  const candidates = limitSeries.map(series => {
    const labels = series.metric?.labels || {};
    const quotaMetric = String(labels.quota_metric || '');
    const limitName = String(labels.limit_name || '');
    const values = (series.points || []).map(pointNumber).filter(value => Number.isFinite(value) && value > 0);
    return { quotaMetric, limitName, dailyLimit: values.length ? Math.max(...values) : 0 };
  }).filter(item => item.dailyLimit > 0 && (looksLikeVideoInsert(item.quotaMetric) || looksLikeVideoInsert(item.limitName)));

  const exact = candidates.find(item => item.quotaMetric === EXPECTED_VIDEO_INSERT_QUOTA_METRIC)
    || candidates.find(item => item.limitName === EXPECTED_VIDEO_INSERT_LIMIT_NAME)
    || candidates[0];
  if (!exact) throw new Error('google_video_insert_quota_not_visible');
  return exact;
}

export async function googleYoutubeUploadQuota(env: Env) {
  const token = await serviceAccountToken(env);
  const now = new Date();
  const dayStart = pacificDayStart(now);
  const limitStart = new Date(now.getTime() - 7 * 86400_000);

  const allYoutubeLimits = await listTimeSeries(
    env,
    token,
    'serviceruntime.googleapis.com/quota/limit',
    '',
    limitStart,
    now
  );
  const { quotaMetric, limitName, dailyLimit } = discoverVideoInsertQuota(allYoutubeLimits);

  const usageSeries = await listTimeSeries(
    env,
    token,
    'serviceruntime.googleapis.com/quota/rate/net_usage',
    `metric.label."quota_metric"="${quotaMetric}"`,
    dayStart,
    now
  );
  const used = Math.max(0, Math.round(usageSeries.reduce((sum, series) => sum + (series.points || []).reduce((pointSum, point) => pointSum + pointNumber(point), 0), 0)));

  return {
    source: 'google_cloud',
    official: true,
    quotaMetric,
    limitName,
    dailyLimit,
    used,
    remaining: Math.max(0, dailyLimit - used),
    resetTimeZone: PACIFIC_TIME_ZONE,
    periodStart: dayStart.toISOString(),
    checkedAt: now.toISOString(),
    dataDelaySeconds: 240
  };
}
