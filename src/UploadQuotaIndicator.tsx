import React, { useEffect, useState } from 'react';
import { api } from './api';
import './UploadQuotaIndicator.css';

type UploadQuota = {
  source: 'google_cloud';
  official: true;
  dailyLimit: number;
  used: number;
  remaining: number;
  resetTimeZone: string;
  checkedAt: string;
  dataDelaySeconds: number;
};

export default function UploadQuotaIndicator() {
  const [path, setPath] = useState(location.pathname);
  const [quota, setQuota] = useState<UploadQuota | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = async () => {
    try {
      setQuota(await api<UploadQuota>('/api/youtube/studio/upload-quota'));
      setUnavailable(false);
    } catch {
      setQuota(null);
      setUnavailable(true);
    }
  };

  useEffect(() => {
    const routeChanged = () => setPath(location.pathname);
    window.addEventListener('popstate', routeChanged);
    return () => window.removeEventListener('popstate', routeChanged);
  }, []);

  useEffect(() => {
    if (path !== '/') return;
    void load();
    const refresh = () => void load();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('box-google-quota-refresh', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('box-google-quota-refresh', refresh);
    };
  }, [path]);

  if (path !== '/') return null;
  if (!quota) {
    if (!unavailable) return null;
    return <aside className="upload-quota-indicator" aria-label="Google 官方 YouTube 配額">
      <div className="upload-quota-top"><span>Google 官方 YouTube 配額</span><b>讀取中</b></div>
      <div className="upload-quota-bottom"><span>目前暫時無法取得官方數字</span><small>不使用 Box 本地估算</small></div>
    </aside>;
  }

  const usedForBar = Math.min(quota.used, quota.dailyLimit);
  const percent = quota.dailyLimit > 0 ? Math.round((usedForBar / quota.dailyLimit) * 100) : 0;

  return <aside className="upload-quota-indicator" aria-label="Google 官方 YouTube 配額">
    <div className="upload-quota-top">
      <span>Google 官方 YouTube 配額</span>
      <b>剩餘 {quota.remaining} / {quota.dailyLimit}</b>
    </div>
    <div className="upload-quota-track" aria-hidden="true"><i style={{width:`${percent}%`}} /></div>
    <div className="upload-quota-bottom">
      <span>今日已用 {quota.used} 次</span>
      <small>Google Cloud 官方資料 · 可能延遲數分鐘</small>
    </div>
  </aside>;
}
