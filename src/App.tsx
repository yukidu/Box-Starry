import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { copyText, shareLink } from './platform';

type User = { id:string; email:string; name:string|null; avatar:string|null; profileSlug:string|null; rank:string|null };
type Video = { id:string; youtubeVideoId:string; title:string; description:string; youtubePrivacy:'private'|'unlisted'|'public'; appVisibility:'owner'|'public'; uploadStatus:string; originalFilename:string; fileSize:number; thumbnailUrl:string; createdAt:string };
type Me = { user: User|null; youtubeConnected:boolean };
type ConfirmState = { title:string; message:string; confirmLabel?:string; onConfirm:()=>void } | null;

const navItems = [
  { key:'upload', label:'上傳影片', path:'/', icon:'↑' },
  { key:'videos', label:'我的影片', path:'/videos', icon:'▣' },
  { key:'shares', label:'分享連結', path:'/shares', icon:'↗' },
  { key:'youtube', label:'YouTube 連線', path:'/youtube', icon:'▶' }
];

function go(path:string) { history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')); }
function formatBytes(value:number) { if (!value) return ''; const units=['B','KB','MB','GB']; let n=value,i=0; while(n>=1024&&i<3){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }
function formatDate(value:string) { try { return new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); } catch { return value; } }

function ConfirmModal({state,onClose}:{state:ConfirmState;onClose:()=>void}) {
  if (!state) return null;
  return <div className="confirm-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-shield" aria-hidden="true">⚠</div>
      <div className="confirm-copy"><h2 id="confirm-title">{state.title}</h2><p>{state.message}</p></div>
      <div className="confirm-actions">
        <button className="btn confirm-cancel" onClick={onClose}>取消</button>
        <button className="btn confirm-ok" onClick={()=>{onClose();state.onConfirm();}}>{state.confirmLabel||'確定'}</button>
      </div>
    </section>
  </div>;
}

function AppIcon(){ return <span className="app-icon" aria-hidden="true"><span className="capsule">✦</span></span>; }
function Wave(){ return <span className="wave" aria-hidden="true"><i/><i/><i/><i/></span>; }

function Navbar({me,onRefresh}:{me:Me;onRefresh:()=>void}) {
  const [open,setOpen]=useState(false);
  const [theme,setTheme]=useState<'light'|'dark'>(()=>(localStorage.getItem('box-theme')==='dark'?'dark':'light'));
  const [pins,setPins]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('box-pins')||'["upload","videos"]')}catch{return ['upload','videos']}});
  const deferredPrompt=useRef<any>(null);
  useEffect(()=>{ document.documentElement.dataset.theme=theme; localStorage.setItem('box-theme',theme); },[theme]);
  useEffect(()=>{ const h=(e:any)=>{e.preventDefault();deferredPrompt.current=e;}; window.addEventListener('beforeinstallprompt',h); return()=>window.removeEventListener('beforeinstallprompt',h); },[]);
  const togglePin=(key:string)=>{ const next=pins.includes(key)?pins.filter(x=>x!==key):[...pins,key]; setPins(next);localStorage.setItem('box-pins',JSON.stringify(next)); };
  const install=async()=>{ setOpen(false); if(deferredPrompt.current){deferredPrompt.current.prompt();await deferredPrompt.current.userChoice;deferredPrompt.current=null;} else go('/install'); };
  return <header className="topbar">
    <div className="topbar-inner">
      <button className="brand" onClick={()=>go('/')} aria-label="回到繁星膠囊首頁"><AppIcon/><span className="brand-name">繁星膠囊</span><Wave/></button>
      <nav className="pinned" aria-label="快速功能">
        {navItems.filter(x=>pins.includes(x.key)).map(item=><button key={item.key} className="icon-btn" title={item.label} onClick={()=>go(item.path)}><span>{item.icon}</span><small>{item.label}</small></button>)}
      </nav>
      <div className="identity">
        {me.user ? <button className="user-chip" onClick={()=>me.user?.profileSlug&&go(`/u/${encodeURIComponent(me.user.profileSlug)}`)}>
          {me.user.avatar?<img src={me.user.avatar} alt=""/>:<span className="avatar-fallback">★</span>}
          <span><b>{me.user.name||'繁星會員'}</b>{me.user.rank&&<small>{me.user.rank}</small>}</span>
        </button> : <button className="login-btn" onClick={()=>location.href='/auth/starry'}>按此註冊或登入</button>}
        <button className="hamburger" aria-label="主選單" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><i/><i/><i/></button>
      </div>
    </div>
    <div className="starline"><span/><span/><span/><span/><span/><span/></div>
    {open&&<div className="menu-wrap"><div className="menu-panel">
      {me.user&&<button className="menu-profile" onClick={()=>{setOpen(false);me.user?.profileSlug?go(`/u/${encodeURIComponent(me.user.profileSlug)}`):undefined;}}>
        {me.user.avatar?<img src={me.user.avatar} alt=""/>:<span className="menu-avatar">★</span>}<span><b>{me.user.name||'繁星會員'}</b><small>{me.user.rank||me.user.email}</small></span>
      </button>}
      <button className="menu-row" onClick={()=>setTheme(theme==='dark'?'light':'dark')}><span className="menu-icon">◐</span><span>{theme==='dark'?'切換淺色':'切換深色'}</span></button>
      <div className="menu-divider"/>
      {navItems.map(item=><div className="menu-row with-pin" key={item.key}>
        <button onClick={()=>{setOpen(false);go(item.path)}}><span className="menu-icon">{item.icon}</span><span>{item.label}</span></button>
        <label title="固定到上方"><input type="checkbox" checked={pins.includes(item.key)} onChange={()=>togglePin(item.key)}/><span>固定</span></label>
      </div>)}
      <div className="menu-divider"/>
      <button className="menu-row" onClick={install}><span className="menu-icon">⇩</span><span>安裝到桌面</span></button>
      {me.user?<button className="menu-row logout" onClick={async()=>{await api('/api/logout',{method:'POST'});setOpen(false);onRefresh();go('/')}}><span className="menu-icon">↪</span><span>登出</span></button>
      :<button className="menu-row login" onClick={()=>location.href='/auth/starry'}><span className="menu-icon">◎</span><span>註冊或登入 Starry ID</span></button>}
    </div></div>}
  </header>;
}

function LoginGate(){return <div className="empty-card"><div className="big-symbol">✦</div><h2>先登入你的 Starry ID</h2><p>登入後，就會有自己的繁星膠囊與影片清單。</p><button className="btn primary" onClick={()=>location.href='/auth/starry'}>註冊或登入</button></div>}

function UploadPage({me,onDone}:{me:Me;onDone:()=>void}){
  const [file,setFile]=useState<File|null>(null); const [title,setTitle]=useState(''); const [description,setDescription]=useState('');
  const [privacy,setPrivacy]=useState<'private'|'unlisted'>('unlisted'); const [progress,setProgress]=useState(0); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  if(!me.user)return <LoginGate/>;
  const upload=async()=>{
    if(!file){setMessage('請先選擇影片');return;} if(!title.trim()){setMessage('請輸入影片名稱');return;} if(!me.youtubeConnected){go('/youtube');return;}
    setBusy(true);setMessage('正在建立 YouTube 上傳工作…');setProgress(1);
    try{
      const session=await api<{uploadUrl:string}>('/api/youtube/upload-session',{method:'POST',body:JSON.stringify({title,description,mimeType:file.type||'application/octet-stream',fileSize:file.size,privacy})});
      const yt:any=await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest(); xhr.open('PUT',session.uploadUrl); xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
        xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.max(2,Math.round(e.loaded/e.total*95)));};
        xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){try{resolve(JSON.parse(xhr.responseText))}catch{reject(new Error('YouTube 回傳資料無法讀取'))}}else reject(new Error('YouTube 上傳失敗，請稍後再試'));}; xhr.onerror=()=>reject(new Error('網路中斷，請重新上傳')); xhr.send(file);
      });
      setProgress(97); const actualPrivacy=(yt?.status?.privacyStatus||privacy) as 'private'|'unlisted'|'public';
      await api('/api/videos',{method:'POST',body:JSON.stringify({youtubeVideoId:yt.id,title,description,youtubePrivacy:actualPrivacy,appVisibility:'owner',originalFilename:file.name,fileSize:file.size})});
      setProgress(100);setMessage(actualPrivacy==='private'&&privacy==='unlisted'?'上傳完成。YouTube 目前仍限制為私人影片；通過 API 稽核後即可使用分享功能。':'上傳完成，已放進你的繁星膠囊。'); setFile(null);setTitle('');setDescription('');onDone();
    }catch(e){setMessage(e instanceof Error?e.message:'上傳失敗');}finally{setBusy(false);}
  };
  return <section className="page"><div className="hero"><div><span className="eyebrow">Box Starry</span><h1>把今天的影像，放進自己的繁星膠囊</h1><p>手機錄影、Zoom 錄影都可以。影片直接上傳到你的 YouTube。</p></div><div className="hero-orbit"><span>▶</span><i/><i/></div></div>
    <div className="upload-grid">
      <label className={`dropzone ${file?'has-file':''}`}><input type="file" accept="video/*" onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);if(f&&!title)setTitle(f.name.replace(/\.[^.]+$/,''));}}/><span className="upload-symbol">＋</span><b>{file?file.name:'選擇影片'}</b><small>{file?formatBytes(file.size):'從手機相簿、檔案或電腦選擇'}</small></label>
      <div className="form-card"><label>影片名稱<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="例如：10/14 Zoom 練習"/></label><label>備註（可留空）<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="這支影片的重點…"/></label>
        <fieldset><legend>YouTube 狀態</legend><label className="radio-card"><input type="radio" checked={privacy==='unlisted'} onChange={()=>setPrivacy('unlisted')}/><span><b>不公開（推薦）</b><small>不會出現在公開清單，但可以用 Box 的密碼與效期分享。</small></span></label><label className="radio-card"><input type="radio" checked={privacy==='private'} onChange={()=>setPrivacy('private')}/><span><b>私人</b><small>只有你的 YouTube 帳號能看，Box 分享功能會停用。</small></span></label></fieldset>
        {!me.youtubeConnected&&<div className="notice">尚未連接 YouTube。第一次使用只要授權一次。</div>}
        {busy&&<div className="progress"><span style={{width:`${progress}%`}}/></div>}{message&&<p className="form-message">{message}</p>}
        <button className="btn primary wide" disabled={busy||!file} onClick={upload}>{busy?`上傳中 ${progress}%`:me.youtubeConnected?'開始上傳到 YouTube':'先連接 YouTube'}</button>
      </div>
    </div></section>
}

function VideosPage({me,confirm}:{me:Me;confirm:(s:ConfirmState)=>void}){
  const [videos,setVideos]=useState<Video[]>([]);const [loading,setLoading]=useState(true);const [shareVideo,setShareVideo]=useState<Video|null>(null);
  const load=()=>api<{videos:Video[]}>('/api/videos').then(x=>setVideos(x.videos)).finally(()=>setLoading(false)); useEffect(()=>{if(me.user)load();},[me.user]);
  if(!me.user)return <LoginGate/>;
  const visibility=(v:Video)=>confirm({title:v.appVisibility==='public'?'改成只有本人可看？':'開放公開訪客觀看？',message:v.appVisibility==='public'?'改回私人後，會員公開頁將不再顯示這支影片。':'公開後，任何訪客都能在你的繁星膠囊公開頁看到這支影片。',onConfirm:async()=>{try{await api(`/api/videos/${v.id}`,{method:'PATCH',body:JSON.stringify({appVisibility:v.appVisibility==='public'?'owner':'public'})});load();}catch(e){window.dispatchEvent(new CustomEvent('box-toast',{detail:e instanceof Error?e.message:'操作失敗'}));}}});
  const remove=(v:Video)=>confirm({title:'從繁星膠囊移除？',message:'只會移除 Box Starry 的清單與分享連結，不會刪除 YouTube 原始影片。',confirmLabel:'移除',onConfirm:async()=>{await api(`/api/videos/${v.id}`,{method:'DELETE'});load();}});
  return <section className="page"><div className="page-head"><div><span className="eyebrow">我的膠囊</span><h1>我的影片</h1><p>每支影片都可以個別決定誰能看到。</p></div><button className="btn primary" onClick={()=>go('/')}>＋ 上傳影片</button></div>
    {loading?<div className="loading">正在讀取影片…</div>:videos.length===0?<div className="empty-card"><div className="big-symbol">▣</div><h2>膠囊還是空的</h2><p>上傳第一支手機錄影或 Zoom 影片吧。</p><button className="btn primary" onClick={()=>go('/')}>上傳第一支影片</button></div>:
    <div className="video-list">{videos.map(v=><article className="video-card" key={v.id}><div className="thumb"><img src={v.thumbnailUrl} alt=""/><span className={`privacy ${v.youtubePrivacy}`}>{v.youtubePrivacy==='private'?'YouTube 私人':'YouTube 不公開'}</span></div><div className="video-info"><h2>{v.title}</h2><p>{v.description||'沒有備註'}</p><div className="meta"><span>{formatDate(v.createdAt)}</span>{v.fileSize>0&&<span>{formatBytes(v.fileSize)}</span>}<span className={v.appVisibility==='public'?'public-pill':'owner-pill'}>{v.appVisibility==='public'?'公開訪客可看':'只有本人清單可見'}</span></div><div className="card-actions"><a className="btn ghost" href={`https://youtu.be/${v.youtubeVideoId}`} target="_blank" rel="noreferrer">YouTube</a><button className="btn ghost" onClick={()=>visibility(v)}>{v.appVisibility==='public'?'改私人':'公開顯示'}</button><button className="btn ghost" disabled={v.youtubePrivacy==='private'} onClick={()=>setShareVideo(v)}>分享連結</button><button className="btn danger-ghost" onClick={()=>remove(v)}>移除</button></div>{v.youtubePrivacy==='private'&&<small className="private-note">私人影片無法讓訪客播放；要分享請用「不公開」模式上傳。</small>}</div></article>)}</div>}
    {shareVideo&&<ShareCreator video={shareVideo} onClose={()=>setShareVideo(null)}/>} </section>
}

function ShareCreator({video,onClose}:{video:Video;onClose:()=>void}){
  const [expires,setExpires]=useState('');const [days,setDays]=useState('');const [password,setPassword]=useState('');const [url,setUrl]=useState('');const [message,setMessage]=useState('');
  const create=async()=>{try{const data=await api<{shareUrl:string}>(`/api/videos/${video.id}/shares`,{method:'POST',body:JSON.stringify({expiresAt:expires?new Date(expires).toISOString():null,expireAfterFirstOpenDays:days?Number(days):null,password})});setUrl(data.shareUrl);setMessage('分享連結已建立');}catch(e){setMessage(e instanceof Error?e.message:'建立失敗')}};
  return <div className="sheet-backdrop"><section className="share-sheet"><button className="close-x" onClick={onClose}>×</button><span className="eyebrow">分享設定</span><h2>{video.title}</h2><p>可同時設定固定日期與「第一次開啟後」期限，先到的條件會先失效。</p><label>固定失效時間（可留空）<input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/></label><label>第一次成功開啟後幾天失效（可留空）<input type="number" min="1" max="3650" value={days} onChange={e=>setDays(e.target.value)} placeholder="例如 3"/></label><label>自訂密碼（可留空）<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="設定觀看密碼"/></label>{url?<div className="created-link"><input readOnly value={url}/><div><button className="btn ghost" onClick={()=>copyText(url)}>複製</button><button className="btn primary" onClick={()=>shareLink(video.title,url)}>分享</button></div></div>:<button className="btn primary wide" onClick={create}>建立分享連結</button>}{message&&<p className="form-message">{message}</p>}</section></div>
}

function SharesPage({me,confirm}:{me:Me;confirm:(s:ConfirmState)=>void}){
  const [shares,setShares]=useState<any[]>([]);const load=()=>api<{shares:any[]}>('/api/shares').then(x=>setShares(x.shares));useEffect(()=>{if(me.user)load()},[me.user]); if(!me.user)return <LoginGate/>;
  return <section className="page"><div className="page-head"><div><span className="eyebrow">權限控制</span><h1>分享連結</h1><p>集中查看哪些連結仍有效，隨時可以手動停用。</p></div></div>{shares.length===0?<div className="empty-card"><div className="big-symbol">↗</div><h2>還沒有分享連結</h2><p>到「我的影片」挑一支不公開影片建立分享。</p><button className="btn primary" onClick={()=>go('/videos')}>前往我的影片</button></div>:<div className="share-list">{shares.map(s=><article className="share-row" key={s.id}><div><h3>{s.title}</h3><p>{s.passwordProtected?'🔒 有密碼':'無密碼'} · {s.expired||s.disabled?'已失效':'有效'}{s.expiresAt?` · 固定至 ${formatDate(s.expiresAt)}`:''}{s.expireAfterFirstOpenDays?` · 首開後 ${s.expireAfterFirstOpenDays} 天`:''}</p></div>{!s.disabled&&!s.expired&&<button className="btn danger-ghost" onClick={()=>confirm({title:'停用這個分享連結？',message:'停用後，收到連結的人會立刻無法再開啟。',confirmLabel:'停用',onConfirm:async()=>{await api(`/api/shares/${s.id}`,{method:'DELETE'});load();}})}>停用</button>}</article>)}</div>}</section>
}

function YoutubePage({me}:{me:Me}){if(!me.user)return <LoginGate/>;return <section className="page narrow"><div className="page-head"><div><span className="eyebrow">YouTube</span><h1>連接我的 YouTube</h1><p>Starry ID 負責你的會員身份；YouTube 授權只在你要上傳影片時使用。</p></div></div><div className="connect-card"><div className={`yt-mark ${me.youtubeConnected?'ok':''}`}>▶</div><h2>{me.youtubeConnected?'已連接 YouTube':'尚未連接'}</h2><p>{me.youtubeConnected?'你現在可以從手機或電腦直接把影片上傳到自己的 YouTube。':'第一次使用需要到 Google 授權 Box Starry 上傳影片。Box Starry 不會知道你的 Google 密碼。'}</p><button className="btn primary" onClick={()=>location.href='/auth/youtube'}>{me.youtubeConnected?'重新授權':'連接我的 YouTube'}</button><div className="scope-note"><b>只要求上傳影片權限</b><span>不要求 Gmail、雲端硬碟或其他 Google 資料。</span></div></div></section>}

function PublicMemberPage({slug}:{slug:string}){const [data,setData]=useState<any>(null);const [error,setError]=useState('');useEffect(()=>{api(`/api/public/member/${encodeURIComponent(slug)}`).then(setData).catch(e=>setError(e.message))},[slug]);if(error)return <PublicError text={error}/>;if(!data)return <div className="loading public-load">正在打開繁星膠囊…</div>;return <section className="public-page"><div className="public-profile">{data.owner.avatar?<img src={data.owner.avatar} alt=""/>:<div className="public-avatar">★</div>}<div><span className="eyebrow">繁星膠囊</span><h1>{data.owner.name}</h1><p>公開影片</p></div></div>{data.videos.length===0?<div className="empty-card"><h2>目前沒有公開影片</h2></div>:<div className="public-grid">{data.videos.map((v:Video)=><article key={v.id} className="public-video"><div className="embed"><iframe src={`https://www.youtube-nocookie.com/embed/${v.youtubeVideoId}`} title={v.title} allowFullScreen/></div><h2>{v.title}</h2><p>{v.description}</p></article>)}</div>}</section>}
function PublicError({text}:{text:string}){return <div className="public-center"><AppIcon/><h1>這顆膠囊暫時打不開</h1><p>{text}</p></div>}
function SharePage({token}:{token:string}){const [password,setPassword]=useState('');const [data,setData]=useState<any>(null);const [error,setError]=useState('');const [needs,setNeeds]=useState(false);const open=async()=>{try{const x=await api<any>(`/api/public/share/${token}`,{method:'POST',body:JSON.stringify({password})});setData(x);setError('');setNeeds(false)}catch(e:any){setError(e.message);setNeeds(e.message==='密碼不正確')}};useEffect(()=>{open()},[token]);if(data)return <section className="share-watch"><div className="watch-card"><span className="eyebrow">繁星膠囊分享</span><div className="embed"><iframe src={`https://www.youtube-nocookie.com/embed/${data.video.youtubeVideoId}`} title={data.video.title} allowFullScreen/></div><h1>{data.video.title}</h1><p>{data.video.description}</p></div></section>;return <div className="public-center"><AppIcon/><h1>{needs?'這顆膠囊有密碼':'正在打開分享影片'}</h1>{error&&<p>{error}</p>}{needs&&<div className="password-box"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="輸入分享密碼" onKeyDown={e=>e.key==='Enter'&&open()}/><button className="btn primary" onClick={open}>開啟影片</button></div>}</div>}
function InstallPage(){return <section className="page narrow"><div className="page-head"><div><span className="eyebrow">PWA</span><h1>安裝到桌面</h1><p>安裝後會像 App 一樣從手機桌面直接打開。</p></div></div><div className="connect-card"><h2>iPhone / iPad</h2><p>Safari → 分享按鈕 →「加入主畫面」。</p><h2>Android / Chrome</h2><p>Chrome 選單 →「安裝應用程式」或「加到主畫面」。</p></div></section>}

export default function App(){const [path,setPath]=useState(location.pathname);const [me,setMe]=useState<Me>({user:null,youtubeConnected:false});const [confirm,setConfirm]=useState<ConfirmState>(null);const [toast,setToast]=useState('');
  const refresh=()=>api<Me>('/api/me').then(setMe).catch(()=>setMe({user:null,youtubeConnected:false}));useEffect(()=>{refresh();const p=()=>setPath(location.pathname);addEventListener('popstate',p);const t=(e:any)=>{setToast(e.detail);setTimeout(()=>setToast(''),3500)};addEventListener('box-toast',t);return()=>{removeEventListener('popstate',p);removeEventListener('box-toast',t)}},[]);
  const publicRoute=path.match(/^\/u\/([^/]+)$/);const shareRoute=path.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if(publicRoute)return <PublicMemberPage slug={decodeURIComponent(publicRoute[1])}/>;if(shareRoute)return <SharePage token={shareRoute[1]}/>;
  let page:React.ReactNode;if(path==='/videos')page=<VideosPage me={me} confirm={setConfirm}/>;else if(path==='/shares')page=<SharesPage me={me} confirm={setConfirm}/>;else if(path==='/youtube')page=<YoutubePage me={me}/>;else if(path==='/install')page=<InstallPage/>;else page=<UploadPage me={me} onDone={refresh}/>;
  return <><Navbar me={me} onRefresh={refresh}/><main>{page}</main><ConfirmModal state={confirm} onClose={()=>setConfirm(null)}/>{toast&&<div className="toast">{toast}</div>}<footer><span>繁星 Starry.phd 生態系</span><span>Box Starry · 私人影片膠囊</span></footer></>}
