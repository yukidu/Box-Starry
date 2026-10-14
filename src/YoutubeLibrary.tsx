import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { copyText, shareLink } from './platform';
import './YoutubeLibraryDense.css';

type User = { id:string; email:string; name:string|null; avatar:string|null; profileSlug:string|null; rank:string|null };
type Me = { user: User|null; youtubeConnected:boolean };
type ConfirmState = { title:string; message:string; confirmLabel?:string; onConfirm:()=>void } | null;
type BoxMeta = { id:string; appVisibility:'owner'|'public'; originalFilename:string; fileSize:number; createdAt:string } | null;
type LibraryVideo = {
  youtubeVideoId:string;
  title:string;
  description:string;
  youtubePrivacy:'private'|'unlisted'|'public';
  thumbnailUrl:string;
  publishedAt:string;
  uploadedViaBox:boolean;
  box:BoxMeta;
};
type LibraryResponse = { videos:LibraryVideo[]; nextPageToken:string|null };
type RegisteredVideo = { id:string; appVisibility:'owner'|'public'; originalFilename:string; fileSize:number; createdAt:string };

function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}
function formatDate(value:string){try{return new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return value;}}
function privacyLabel(value:LibraryVideo['youtubePrivacy']){return value==='private'?'YouTube 私人':value==='public'?'YouTube 公開':'YouTube 不公開';}
function studioEditUrl(id:string){return `https://studio.youtube.com/video/${encodeURIComponent(id)}/edit`;}

function LoginGate(){return <div className="empty-card"><div className="big-symbol">✦</div><h2>先登入你的 Starry ID</h2><p>登入後才能讀取你自己的 YouTube 影片清單。</p><button className="btn primary" onClick={()=>location.href='/auth/starry'}>註冊或登入</button></div>}

function ShareCreator({video,onClose}:{video:LibraryVideo;onClose:()=>void}){
  const [expires,setExpires]=useState('');const [days,setDays]=useState('');const [password,setPassword]=useState('');const [url,setUrl]=useState('');const [message,setMessage]=useState('');
  const create=async()=>{if(!video.box)return;try{const data=await api<{shareUrl:string}>(`/api/videos/${video.box.id}/shares`,{method:'POST',body:JSON.stringify({expiresAt:expires?new Date(expires).toISOString():null,expireAfterFirstOpenDays:days?Number(days):null,password})});setUrl(data.shareUrl);setMessage('分享連結已建立');}catch(e){setMessage(e instanceof Error?e.message:'建立失敗')}};
  return <div className="sheet-backdrop"><section className="share-sheet"><button className="close-x" onClick={onClose}>×</button><span className="eyebrow">繁星膠囊分享控制</span><h2>{video.title}</h2><p>這裡建立的是 Box Starry 分享連結，不是 YouTube 原生分享。可設定密碼與失效時間。</p><label>固定失效時間（可留空）<input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/></label><label>第一次成功開啟後幾天失效（可留空）<input type="number" min="1" max="3650" value={days} onChange={e=>setDays(e.target.value)} placeholder="例如 3"/></label><label>自訂密碼（可留空）<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="設定觀看密碼"/></label>{url?<div className="created-link"><input readOnly value={url}/><div><button className="btn ghost" onClick={()=>copyText(url)}>複製</button><button className="btn primary" onClick={()=>shareLink(video.title,url)}>呼叫手機分享</button></div></div>:<button className="btn primary wide" onClick={create}>建立繁星膠囊分享連結</button>}{message&&<p className="form-message">{message}</p>}</section></div>
}

function GearMenu({video,onShare,onClose}:{video:LibraryVideo;onShare:()=>void;onClose:()=>void}){
  const studio=studioEditUrl(video.youtubeVideoId);
  const item=(label:string,sub:string)=><a href={studio} target="_blank" rel="noreferrer" onClick={onClose}><span>↗</span><span>{label}<small>{sub}</small></span></a>;
  return <div className="yt-gear-menu" role="menu">
    {item('修改名稱','開啟這支影片的 YouTube Studio 編輯頁')}
    {item('修改縮圖','開啟 YouTube Studio 更換縮圖')}
    {item('新增／修改播放清單','開啟 YouTube Studio 管理播放清單')}
    {item('修改影片日期','開啟 YouTube Studio 調整影片資料')}
    <div className="menu-sep"/>
    <button className="share-control" onClick={()=>{onClose();onShare();}}><span>✦</span><span>分享影片<small>使用繁星膠囊的密碼、效期與原生分享功能</small></span></button>
    <a href={`https://youtu.be/${video.youtubeVideoId}`} target="_blank" rel="noreferrer" onClick={onClose}><span>▶</span><span>開啟 YouTube<small>查看 YouTube 原始影片</small></span></a>
  </div>;
}

export function YoutubeLibraryPage({me,confirm}:{me:Me;confirm:(state:ConfirmState)=>void}){
  const [videos,setVideos]=useState<LibraryVideo[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [shareVideo,setShareVideo]=useState<LibraryVideo|null>(null);const [gear,setGear]=useState<string|null>(null);const [progress,setProgress]=useState(0);const [syncCount,setSyncCount]=useState(0);const runId=useRef(0);
  const firstKey=me.user?`box-youtube-first-sync-${me.user.id}`:'box-youtube-first-sync';
  const firstSync=typeof localStorage!=='undefined'&&!localStorage.getItem(firstKey);
  const load=async()=>{
    if(!me.user||!me.youtubeConnected)return;
    const current=++runId.current;setLoading(true);setError('');setProgress(6);setSyncCount(0);setGear(null);
    try{
      const all:LibraryVideo[]=[];let token='';let page=0;
      do{
        if(current!==runId.current)return;
        setProgress(Math.min(88,10+page*18));
        const data=await api<LibraryResponse>(`/api/youtube/library${token?`?pageToken=${encodeURIComponent(token)}`:''}`);
        all.push(...data.videos);setSyncCount(all.length);token=data.nextPageToken||'';page++;
        setProgress(token?Math.min(92,18+page*18):100);
        if(page>100)throw new Error('影片數量過多，請稍後再重新整理');
      }while(token);
      setVideos(all);localStorage.setItem(firstKey,new Date().toISOString());localStorage.removeItem('box-youtube-sync-requested');
    }catch(e){setError(e instanceof Error?e.message:'讀取 YouTube 影片失敗');}
    finally{if(current===runId.current)setLoading(false);}
  };
  useEffect(()=>{load();},[me.user?.id,me.youtubeConnected]);
  useEffect(()=>{const onFocus=()=>{if(document.visibilityState==='visible'&&localStorage.getItem('box-youtube-sync-requested'))load();};document.addEventListener('visibilitychange',onFocus);return()=>document.removeEventListener('visibilitychange',onFocus);},[me.user?.id,me.youtubeConnected]);
  if(!me.user)return <LoginGate/>;
  if(!me.youtubeConnected)return <section className="page"><div className="empty-card"><div className="big-symbol">▶</div><h2>先連接你的 YouTube</h2><p>連接後，這裡會直接顯示你 YouTube 後台的影片。</p><button className="btn primary" onClick={()=>go('/youtube')}>連接 YouTube</button></div></section>;
  const reconnect=error.includes('重新授權');
  const registerForBox=async(v:LibraryVideo):Promise<LibraryVideo>=>{
    if(v.box)return v;
    const result=await api<{video:RegisteredVideo}>('/api/videos',{method:'POST',body:JSON.stringify({youtubeVideoId:v.youtubeVideoId,title:v.title,description:v.description,youtubePrivacy:v.youtubePrivacy,appVisibility:'owner'})});
    return {...v,box:{id:result.video.id,appVisibility:result.video.appVisibility||'owner',originalFilename:result.video.originalFilename||'',fileSize:result.video.fileSize||0,createdAt:result.video.createdAt||new Date().toISOString()}};
  };
  const openShare=async(v:LibraryVideo)=>{try{if(v.youtubePrivacy==='private')throw new Error('YouTube 私人影片無法對外分享，請先改成「不公開」或「公開」');const ready=await registerForBox(v);setShareVideo(ready);}catch(e){window.dispatchEvent(new CustomEvent('box-toast',{detail:e instanceof Error?e.message:'無法建立分享'}));}};
  const visibility=(v:LibraryVideo)=>{if(!v.box)return;confirm({title:v.box.appVisibility==='public'?'改成只有本人可看？':'開放公開訪客觀看？',message:v.box.appVisibility==='public'?'改回私人後，會員公開頁將不再顯示這支影片。':'公開後，任何訪客都能在你的繁星膠囊公開頁看到這支影片。',onConfirm:async()=>{try{await api(`/api/videos/${v.box!.id}`,{method:'PATCH',body:JSON.stringify({appVisibility:v.box!.appVisibility==='public'?'owner':'public'})});await load();}catch(e){window.dispatchEvent(new CustomEvent('box-toast',{detail:e instanceof Error?e.message:'操作失敗'}));}}});};
  return <section className="page"><div className="page-head"><div><span className="eyebrow">YouTube Library</span><h1>我的影片</h1><p>每次進入此頁都會自動同步 YouTube；✦ 代表透過繁星膠囊上傳。</p></div><div className="card-actions"><button className="btn ghost" onClick={load} disabled={loading}>{loading?'同步中…':'立即同步'}</button><button className="btn primary" onClick={()=>go('/')}>＋ 上傳影片</button></div></div>
    {loading&&<div className="sync-panel"><div className="sync-copy"><b>{firstSync?'第一次同步 YouTube 影片會等比較久一點，請稍候…':'正在同步最新 YouTube 影片…'}</b><span>{syncCount?`已讀取 ${syncCount} 支`:'正在連線…'}</span></div><div className="sync-bar" aria-label="同步進度"><span style={{width:`${progress}%`}}/></div><div className="sync-note">同步期間可以停留在此頁，完成後清單會自動更新。</div></div>}
    {error&&<div className="empty-card"><div className="big-symbol">!</div><h2>{reconnect?'需要更新 YouTube 授權':'暫時讀不到影片'}</h2><p>{error}</p>{reconnect?<button className="btn primary" onClick={()=>location.href='/auth/youtube'}>重新授權 YouTube</button>:<button className="btn primary" onClick={load}>再試一次</button>}</div>}
    {!error&&!loading&&videos.length===0&&<div className="empty-card"><div className="big-symbol">▣</div><h2>YouTube 目前沒有影片</h2><p>你上傳到 YouTube 的影片會自動顯示在這裡。</p><button className="btn primary" onClick={()=>go('/')}>上傳第一支影片</button></div>}
    {!error&&videos.length>0&&<div className="yt-library-list">{videos.map(v=><article className="yt-library-row" key={v.youtubeVideoId}><div className="yt-library-thumb"><img src={v.thumbnailUrl} alt=""/><span className={`privacy ${v.youtubePrivacy}`}>{privacyLabel(v.youtubePrivacy)}</span></div><div className="yt-library-info"><div className="meta">{v.uploadedViaBox?<span className="public-pill">✦ 繁星膠囊上傳</span>:<span className="owner-pill">YouTube 原有影片</span>}{v.box&&<span className={v.box.appVisibility==='public'?'public-pill':'owner-pill'}>{v.box.appVisibility==='public'?'Box 公開':'Box 私人'}</span>}</div><h2 title={v.title}>{v.title}</h2><p>{v.description||'沒有備註'}</p><div className="meta"><span>{formatDate(v.publishedAt)}</span>{v.box&&<button className="btn ghost" style={{padding:'3px 7px',fontSize:'10px'}} onClick={()=>visibility(v)}>{v.box.appVisibility==='public'?'改 Box 私人':'改 Box 公開'}</button>}</div></div><div className="yt-gear-wrap"><button className="yt-gear" aria-label={`${v.title} 控制選單`} aria-expanded={gear===v.youtubeVideoId} onClick={()=>setGear(gear===v.youtubeVideoId?null:v.youtubeVideoId)}>⚙</button>{gear===v.youtubeVideoId&&<GearMenu video={v} onShare={()=>openShare(v)} onClose={()=>setGear(null)}/>}</div></article>)}</div>}
    {shareVideo&&<ShareCreator video={shareVideo} onClose={()=>setShareVideo(null)}/>} </section>;
}

export function YoutubeConnectionPage({me,onRefresh,confirm}:{me:Me;onRefresh:()=>Promise<void>|void;confirm:(state:ConfirmState)=>void}){
  if(!me.user)return <LoginGate/>;
  const disconnect=()=>confirm({title:'解除 YouTube 連線？',message:'Box Starry 會刪除保存的 YouTube 授權並向 Google 撤銷授權。已上傳到 YouTube 的影片不會被刪除。',confirmLabel:'解除連線',onConfirm:async()=>{try{await api('/api/youtube/disconnect',{method:'POST'});await onRefresh();window.dispatchEvent(new CustomEvent('box-toast',{detail:'已解除 YouTube 連線'}));}catch(e){window.dispatchEvent(new CustomEvent('box-toast',{detail:e instanceof Error?e.message:'解除失敗'}));}}});
  const deleteBoxData=()=>confirm({title:'刪除我的 Box Starry 資料？',message:'這會永久刪除 Box Starry 內的影片管理資料、分享連結、YouTube 授權與登入資料，但不會刪除 YouTube 原始影片，也不會刪除你的 Starry ID。',confirmLabel:'永久刪除',onConfirm:async()=>{try{await api('/api/account',{method:'DELETE'});await onRefresh();go('/');window.dispatchEvent(new CustomEvent('box-toast',{detail:'Box Starry 專屬資料已刪除'}));}catch(e){window.dispatchEvent(new CustomEvent('box-toast',{detail:e instanceof Error?e.message:'刪除失敗'}));}}});
  return <section className="page narrow"><div className="page-head"><div><span className="eyebrow">YouTube</span><h1>連接我的 YouTube</h1><p>授權後可以上傳影片，並在 Box Starry 同步你自己的 YouTube 影片清單。</p></div></div><div className="connect-card"><div className={`yt-mark ${me.youtubeConnected?'ok':''}`}>▶</div><h2>{me.youtubeConnected?'已連接 YouTube':'尚未連接'}</h2><p>{me.youtubeConnected?'你可以上傳影片，也可以在「我的影片」直接查看自己的 YouTube 後台影片。':'第一次使用需要到 Google 授權。Box Starry 不會知道你的 Google 密碼。'}</p><div className="card-actions"><button className="btn primary" onClick={()=>location.href='/auth/youtube'}>{me.youtubeConnected?'重新授權':'連接我的 YouTube'}</button>{me.youtubeConnected&&<button className="btn danger-ghost" onClick={disconnect}>解除 YouTube 連線</button>}</div><div className="scope-note"><b>目前只使用必要的 YouTube 權限</b><span>用於上傳與讀取你的影片清單；修改名稱、縮圖、播放清單與日期目前由齒輪選單直接帶到該影片的 YouTube Studio 編輯頁。</span></div></div><div className="connect-card"><h2>資料與隱私控制</h2><p>你可以刪除所有 Box Starry 專屬資料。這不會動到 Starry ID，也不會刪除已經在 YouTube 上的影片。</p><div className="card-actions"><button className="btn danger-ghost" onClick={deleteBoxData}>刪除我的 Box Starry 資料</button><a className="btn ghost" href="/privacy">查看隱私權政策</a></div></div></section>;
}

export function PrivacyPolicyPage(){return <section className="page narrow"><div className="page-head"><div><span className="eyebrow">Privacy</span><h1>隱私權政策</h1><p>最後更新：2026 年 10 月 14 日</p></div></div><div className="connect-card"><h2>Box Starry 會保存哪些資料</h2><p>為了提供會員影片膠囊功能，我們會保存你的 Starry ID 基本識別資料、Box Starry 影片管理與分享設定，以及經加密保存的 YouTube 授權憑證。影片檔案本身直接上傳到你的 YouTube，不會存進 Box Starry 的 Cloudflare 儲存空間。</p><h2>我們如何使用 YouTube 資料</h2><p>Box Starry 只使用 YouTube 權限來依你的指示上傳影片，以及唯讀取得你自己的頻道與影片清單，讓影片管理頁顯示 YouTube 後台內容。我們不販售你的個人資料，也不把 Google / YouTube 授權資料拿去做與本功能無關的用途。</p><h2>分享控制</h2><p>影片管理頁的「分享影片」使用 Box Starry 自己的分享控制，可設定密碼、固定失效時間與第一次開啟後的有效天數，再呼叫手機原生分享選單。這不是 YouTube 原生分享功能。</p><h2>Google 與 YouTube</h2><p>Box Starry 使用 YouTube API Services。你可以隨時在「YouTube 連線」頁撤銷授權；刪除 Box Starry 資料不會刪除 YouTube 原始影片。</p><p><a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google 隱私權政策</a> · <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube 服務條款</a></p><h2>聯絡方式</h2><p>隱私相關問題可寄至 <a href="mailto:yukidu@gmail.com">yukidu@gmail.com</a>。</p></div></section>}
