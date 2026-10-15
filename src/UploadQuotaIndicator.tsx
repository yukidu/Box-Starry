import React, { useEffect, useState } from 'react';
import { api } from './api';
import './UploadQuotaIndicator.css';

type UploadQuota = {
  dailyLimit: number;
  attempted: number;
  remaining: number;
  quotaDate: string;
  resetTimeZone: string;
  source: 'box_estimate';
  note: string;
};

export default function UploadQuotaIndicator() {
  const [path, setPath] = useState(location.pathname);
  const [quota, setQuota] = useState<UploadQuota | null>(null);

  const load = async () => {
    try {
      setQuota(await api<UploadQuota>('/api/youtube/studio/upload-quota'));
    } catch {
      setQuota(null);
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
    window.addEventListener('box-youtube-upload-quota-changed', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('box-youtube-upload-quota-changed', refresh);
    };
  }, [path]);

  if (path !== '/' || !quota) return null;
  const usedForBar = Math.min(quota.attempted, quota.dailyLimit);
  const percent = quota.dailyLimit > 0 ? Math.round((usedForBar / quota.dailyLimit) * 100) : 0;

  return <aside className="upload-quota-indicator" aria-label="YouTube 今日上傳額度">
    <div className="upload-quota-top">
      <span>YouTube 今日上傳額度</span>
      <b>估算剩餘 {quota.remaining} / {quota.dailyLimit}</b>
    </div>
    <div className="upload-quota-track" aria-hidden="true"><i style={{width:`${percent}%`}} /></div>
    <div className="upload-quota-bottom">
      <span>Box 今日已送出 {quota.attempted} 次上傳呼叫</span>
      <small>Box 估算 · 美西時間午夜重置</small>
    </div>
  </aside>;
}
