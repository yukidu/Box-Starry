import React, { useEffect, useState } from 'react';
import { api } from './api';

type ShareData = {
  video: { title:string; description:string };
  playbackUrl: string;
};

export default function HardenedSharePage({token}:{token:string}) {
  const [password,setPassword]=useState('');
  const [data,setData]=useState<ShareData|null>(null);
  const [error,setError]=useState('');
  const [needsPassword,setNeedsPassword]=useState(false);

  const open=async()=>{
    try {
      const result=await api<ShareData>(`/api/public/share/${token}`,{method:'POST',body:JSON.stringify({password})});
      setData(result);
      setError('');
      setNeedsPassword(false);
    } catch (e) {
      const message=e instanceof Error?e.message:'分享影片開啟失敗';
      setError(message);
      setNeedsPassword(message==='密碼不正確');
    }
  };

  useEffect(()=>{void open();},[token]);

  if(data) return <section className="share-watch"><div className="watch-card"><span className="eyebrow">繁星膠囊分享</span><div className="embed"><iframe src={data.playbackUrl} title={data.video.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="no-referrer"/></div><h1>{data.video.title}</h1><p>{data.video.description}</p></div></section>;

  return <div className="public-center"><span className="app-icon" aria-hidden="true"><span className="capsule">✦</span></span><h1>{needsPassword?'這顆膠囊有密碼':'正在打開分享影片'}</h1>{error&&<p>{error}</p>}{needsPassword&&<div className="password-box"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="輸入分享密碼" onKeyDown={e=>e.key==='Enter'&&open()}/><button className="btn primary" onClick={open}>開啟影片</button></div>}</div>;
}
