import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import CoverStudio from './CoverStudio';
import { uploadYoutubeFile } from './youtubeUpload';
import './UploadStudioPage.css';

// 自訂縮圖由 CoverStudio 四合一封面圖工作室提供。
type Me = { user: { id:string } | null; youtubeConnected:boolean };
type YoutubePlaylist = { id:string; title:string; itemCount:number; privacy:string };
type BoxPlaylist = { id:string; name:string; itemCount:number };
type Privacy = 'private'|'unlisted'|'public';
type LongUploadsStatus = 'allowed'|'eligible'|'disallowed'|'unknown';
type Props = { me:Me; onDone:()=>void };

const CHINESE = [
  { code:'zh-TW', label:'繁體中文（台灣）' },
  { code:'zh-HK', label:'繁體中文（香港）' },
  { code:'zh-CN', label:'簡體中文（中國）' },
  { code:'zh-SG', label:'簡體中文（新加坡）' },
  { code:'zh-Hant', label:'繁體中文' },
  { code:'zh-Hans', label:'簡體中文' }
];
const CATEGORY_OPTIONS = [
  ['27','教育'],['22','人物與網誌'],['28','科學與科技'],['26','操作說明與風格'],['24','娛樂']
];
const YOUTUBE_VERIFY_URL='https://www.youtube.com/verify';

function today(){const d=new Date();const offset=d.getTimezoneOffset()*60000;return new Date(d.getTime()-offset).toISOString().slice(0,10);}
function formatBytes(value:number){if(!value)return '';const units=['B','KB','MB','GB'];let n=value,i=0;while(n>=1024&&i<3){n/=1024;i++;}return `${n.toFixed(i?1:0)} ${units[i]}`;}
function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}
function readVideoDuration(file:File):Promise<number>{
  return new Promise(resolve=>{
    const url=URL.createObjectURL(file);
    const video=document.createElement('video');
    const done=(value:number)=>{URL.revokeObjectURL(url);video.removeAttribute('src');resolve(value);};
    video.preload='metadata';
    video.onloadedmetadata=()=>done(Number.isFinite(video.duration)?video.duration:0);
    video.onerror=()=>done(0);
    video.src=url;
  });
}

async function loadYoutubePlaylists(){
  const all:YoutubePlaylist[]=[];let token='';let rounds=0;
  do{
    const data=await api<{playlists:YoutubePlaylist[];nextPageToken:string|null}>(`/api/youtube/playlists${token?`?pageToken=${encodeURIComponent(token)}`:''}`);
    all.push(...data.playlists);token=data.nextPageToken||'';rounds++;
  }while(token&&rounds<20);
  return all;
}

export default function UploadStudioPage({me,onDone}:Props){
  const [file,setFile]=useState<File|null>(null);
  const [thumbnail,setThumbnail]=useState<File|null>(null);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [privacy,setPrivacy]=useState<Privacy>('unlisted');
  const [recordingDate,setRecordingDate]=useState(today());
  const [categoryId,setCategoryId]=useState('27');
  const [tagsText,setTagsText]=useState('');
  const [synthetic,setSynthetic]=useState(false);
  const [advanced,setAdvanced]=useState(false);
  const [languages,setLanguages]=useState<string[]>(CHINESE.map(item=>item.code));
  const [localized,setLocalized]=useState<Record<string,{title:string;description:string}>>({});
  const [ytPlaylists,setYtPlaylists]=useState<YoutubePlaylist[]>([]);
  const [boxPlaylists,setBoxPlaylists]=useState<BoxPlaylist[]>([]);
  const [ytSelected,setYtSelected]=useState<string[]>([]);
  const [boxSelected,setBoxSelected]=useState<string[]>([]);
  const [positions,setPositions]=useState<Record<string,string>>({});
  const [ytQuery,setYtQuery]=useState('');
  const [newBoxName,setNewBoxName]=useState('');
  const [creatingBox,setCreatingBox]=useState(false);
  const [playlistMessage,setPlaylistMessage]=useState('');
  const [writeReady,setWriteReady]=useState(true);
  const [longUploadsStatus,setLongUploadsStatus]=useState<LongUploadsStatus>('unknown');
  const [verificationNeeded,setVerificationNeeded]=useState(false);
  const [videoDurationSeconds,setVideoDurationSeconds]=useState(0);
  const [progress,setProgress]=useState(0);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [dragging,setDragging]=useState(false);

  const refreshYoutubeStatus=async()=>{
    try{
      const data=await api<{writeReady:boolean;longUploadsStatus?:LongUploadsStatus;needsPhoneVerification?:boolean}>('/api/youtube/studio/status');
      setWriteReady(data.writeReady);
      const next=data.longUploadsStatus||'unknown';
      setLongUploadsStatus(next);
      if(next==='allowed')setVerificationNeeded(false);
      else if(data.needsPhoneVerification)setVerificationNeeded(true);
    }catch{
      setWriteReady(false);
      setLongUploadsStatus('unknown');
    }
  };

  useEffect(()=>{
    if(!me.user||!me.youtubeConnected)return;
    void Promise.all([
      loadYoutubePlaylists().then(setYtPlaylists).catch(()=>setYtPlaylists([])),
      api<{playlists:BoxPlaylist[]}>('/api/playlists').then(x=>setBoxPlaylists(x.playlists)).catch(()=>setBoxPlaylists([])),
      refreshYoutubeStatus()
    ]);
  },[me.user?.id,me.youtubeConnected]);

  useEffect(()=>{
    const created=(event:Event)=>{
      const playlist=(event as CustomEvent<YoutubePlaylist>).detail;
      if(!playlist?.id)return;
      setYtPlaylists(prev=>[playlist,...prev.filter(item=>item.id!==playlist.id)]);
      setYtSelected(prev=>prev.includes(playlist.id)?prev:[...prev,playlist.id]);
    };
    window.addEventListener('box-youtube-playlist-created',created as EventListener);
    return()=>window.removeEventListener('box-youtube-playlist-created',created as EventListener);
  },[]);

  useEffect(()=>{
    setLocalized(prev=>{
      const next={...prev};
      for(const code of languages){if(!next[code])next[code]={title,description};}
      return next;
    });
  },[languages]);

  const filteredYtPlaylists=useMemo(()=>{
    const q=ytQuery.trim().toLocaleLowerCase('zh-TW');
    return q?ytPlaylists.filter(p=>p.title.toLocaleLowerCase('zh-TW').includes(q)):ytPlaylists;
  },[ytPlaylists,ytQuery]);

  const selectVideo=(next:File|null)=>{
    if(!next)return;
    const isVideo=next.type.startsWith('video/')||/\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg|3gp)$/i.test(next.name);
    if(!isVideo){setMessage('請拖曳影片檔案');return;}
    setFile(next);
    setThumbnail(null);
    setVideoDurationSeconds(0);
    setMessage('');
    void readVideoDuration(next).then(setVideoDurationSeconds);
    if(!title)setTitle(next.name.replace(/\.[^.]+$/,''));
  };

  if(!me.user)return <div className="empty-card"><div className="big-symbol">✦</div><h2>先登入你的 Starry ID</h2><p>登入後才能使用完整上傳工作室。</p><button className="btn primary" onClick={()=>location.href='/auth/starry'}>註冊或登入</button></div>;

  const toggle=(list:string[],value:string,setter:(next:string[])=>void)=>setter(list.includes(value)?list.filter(x=>x!==value):[...list,value]);

  const createBoxPlaylist=async()=>{
    const name=newBoxName.trim();
    if(!name){setPlaylistMessage('請先輸入播放清單名稱');return;}
    setCreatingBox(true);setPlaylistMessage('');
    try{
      const data=await api<{playlist:BoxPlaylist}>('/api/playlists',{method:'POST',body:JSON.stringify({name,description:''})});
      setBoxPlaylists(prev=>[data.playlist,...prev]);
      setBoxSelected(prev=>prev.includes(data.playlist.id)?prev:[...prev,data.playlist.id]);
      setNewBoxName('');
      setPlaylistMessage('已建立並自動勾選這個繁星視界播放清單');
    }catch(e){setPlaylistMessage(e instanceof Error?e.message:'建立播放清單失敗');}
    finally{setCreatingBox(false);}
  };

  const upload=async()=>{
    if(!file){setMessage('請先選擇影片');return;}
    if(!title.trim()){setMessage('請輸入影片名稱');return;}
    if(!me.youtubeConnected){go('/youtube');return;}
    if(ytSelected.length&&!writeReady){setMessage('YouTube 播放清單需要重新授權一次編輯權限。');return;}
    const isLongVideo=videoDurationSeconds>15*60;
    if((thumbnail||isLongVideo)&&longUploadsStatus==='eligible'){
      setVerificationNeeded(true);
      setMessage(isLongVideo?'這支影片超過 15 分鐘，請先完成 YouTube 電話驗證並開啟中階功能。':'自訂縮圖需要先完成 YouTube 電話驗證並開啟中階功能。');
      return;
    }
    if(isLongVideo&&longUploadsStatus==='disallowed'){
      setMessage('這個 YouTube 頻道目前不允許上傳超過 15 分鐘的影片，請先到 YouTube Studio 檢查「功能使用資格」。');
      return;
    }
    setBusy(true);setProgress(1);setMessage('正在建立 YouTube 上傳工作…');
    try{
      const tags=tagsText.split(',').map(x=>x.trim()).filter(Boolean);
      const localizations:Record<string,{title:string;description:string}>={};
      for(const code of languages){const item=localized[code]||{title,description};localizations[code]={title:item.title.trim()||title.trim(),description:item.description||description};}
      const session=await api<{uploadUrl:string}>('/api/youtube/upload-session',{method:'POST',body:JSON.stringify({
        title,description,mimeType:file.type||'application/octet-stream',fileSize:file.size,privacy,
        categoryId,defaultLanguage:'zh-TW',recordingDate,tags,containsSyntheticMedia:synthetic,localizations
      })});
      const yt:any=await uploadYoutubeFile(session.uploadUrl,file,setProgress);
      if(!yt?.id)throw new Error('YouTube 沒有回傳影片編號');
      setProgress(90);setMessage('影片已上傳，正在套用縮圖與播放清單…');
      const actualPrivacy=(yt?.status?.privacyStatus||privacy) as Privacy;
      try{await api('/api/videos',{method:'POST',body:JSON.stringify({youtubeVideoId:yt.id,title,description,youtubePrivacy:actualPrivacy,appVisibility:'owner',originalFilename:file.name,fileSize:file.size})});}catch{/* YouTube 已成功，上傳紀錄可由同步補回 */}
      if(thumbnail){
        const response=await fetch(`/api/youtube/studio/thumbnail/${encodeURIComponent(yt.id)}`,{method:'POST',headers:{'content-type':thumbnail.type||'application/octet-stream'},body:thumbnail});
        if(!response.ok){
          const data:any=await response.json().catch(()=>({}));
          if(data.code==='youtube_thumbnail_not_allowed')setVerificationNeeded(true);
          throw new Error(data.error||'縮圖設定失敗');
        }
      }
      setProgress(94);
      if(ytSelected.length){
        const numericPositions:Record<string,number>={};
        for(const id of ytSelected){const n=Number(positions[id]);if(Number.isInteger(n)&&n>=0)numericPositions[id]=n;}
        await api('/api/youtube/studio/playlists',{method:'POST',body:JSON.stringify({youtubeVideoId:yt.id,playlistIds:ytSelected,positions:numericPositions})});
      }
      setProgress(97);
      for(const playlistId of boxSelected){
        await api(`/api/playlists/${encodeURIComponent(playlistId)}/items`,{method:'POST',body:JSON.stringify({youtubeVideoId:yt.id,title,thumbnailUrl:`https://i.ytimg.com/vi/${encodeURIComponent(yt.id)}/hqdefault.jpg`})});
      }
      setProgress(100);
      setMessage(actualPrivacy==='private'&&privacy!=='private'?'上傳完成。YouTube 最終將影片設為私人。':'上傳完成，YouTube 與播放清單設定已同步。');
      setFile(null);setThumbnail(null);setVideoDurationSeconds(0);setTitle('');setDescription('');setPrivacy('unlisted');setRecordingDate(today());setCategoryId('27');setTagsText('');setSynthetic(false);setYtSelected([]);setBoxSelected([]);setPositions({});setLocalized({});onDone();
    }catch(e){setMessage(e instanceof Error?e.message:'上傳失敗');}
    finally{setBusy(false);}
  };

  return <section className="page studio-page">
    <div className="page-head"><div><span className="eyebrow">YouTube Upload Studio</span><h1>上傳影片</h1><p>常用設定直接完成，需要時再打開進階。</p></div></div>
    <div className="studio-layout">
      <div className="studio-media">
        <label
          className={`dropzone studio-drop ${file?'has-file':''} ${dragging?'is-dragging':''}`}
          onDragEnter={e=>{e.preventDefault();setDragging(true);}}
          onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';setDragging(true);}}
          onDragLeave={e=>{e.preventDefault();setDragging(false);}}
          onDrop={e=>{e.preventDefault();setDragging(false);selectVideo(e.dataTransfer.files?.[0]||null);}}
          style={dragging?{borderColor:'var(--accent)',background:'var(--soft)'}:undefined}
        >
          <input type="file" accept="video/*" onChange={e=>selectVideo(e.target.files?.[0]||null)}/>
          <span className="upload-symbol">＋</span>
          <b>{file?file.name:dragging?'放開即可加入影片':'選擇影片或拖曳到這裡'}</b>
          <small>{file?formatBytes(file.size):'電腦可直接拖曳影片；手機可從相簿或檔案選擇'}</small>
        </label>
        <CoverStudio videoFile={file} title={title} value={thumbnail} onChange={setThumbnail}/>
      </div>
      <div className="form-card studio-form">
        <label>標題<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="輸入影片標題"/></label>
        <label>說明<textarea value={description} maxLength={5000} onChange={e=>setDescription(e.target.value)} placeholder="輸入影片說明"/></label>
        <div className="studio-two"><label>錄製日期<input type="date" value={recordingDate} onChange={e=>setRecordingDate(e.target.value)}/></label><label>隱私<select value={privacy} onChange={e=>setPrivacy(e.target.value as Privacy)}><option value="unlisted">不公開（預設）</option><option value="private">私人</option><option value="public">公開</option></select></label></div>

        <div className="playlist-pair">
          <section className="playlist-card">
            <div className="playlist-card-head"><h3>YouTube 播放清單</h3><span>{ytSelected.length?`已選 ${ytSelected.length} 個`:'可複選'}</span></div>
            {ytPlaylists.length?<><input className="playlist-search" value={ytQuery} onChange={e=>setYtQuery(e.target.value)} placeholder="搜尋 YouTube 播放清單"/><div className="playlist-options">{filteredYtPlaylists.length?filteredYtPlaylists.map(p=><label className="playlist-option" key={p.id}><input type="checkbox" checked={ytSelected.includes(p.id)} onChange={()=>toggle(ytSelected,p.id,setYtSelected)}/><span className="playlist-copy"><b>{p.title}</b><small>{p.itemCount} 支影片</small></span></label>):<p className="muted-mini">找不到符合的播放清單</p>}</div></>:<p className="muted-mini">目前沒有可選的 YouTube 播放清單</p>}
          </section>
          <section className="playlist-card">
            <div className="playlist-card-head"><h3>繁星視界播放清單</h3><span>{boxSelected.length?`已選 ${boxSelected.length} 個`:'可複選'}</span></div>
            {boxPlaylists.length?<div className="playlist-options box-playlist-options">{boxPlaylists.map(p=><label className="playlist-option" key={p.id}><input type="checkbox" checked={boxSelected.includes(p.id)} onChange={()=>toggle(boxSelected,p.id,setBoxSelected)}/><span className="playlist-copy"><b>{p.name}</b><small>{p.itemCount} 支影片</small></span></label>)}</div>:<p className="muted-mini empty-playlist-copy">目前還沒有繁星視界播放清單，可直接在這裡建立。</p>}
            <div className="inline-playlist-create"><input value={newBoxName} maxLength={120} onChange={e=>setNewBoxName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void createBoxPlaylist();}}} placeholder="輸入新播放清單名稱"/><button className="btn ghost" type="button" disabled={creatingBox} onClick={()=>void createBoxPlaylist()}>{creatingBox?'建立中…':'＋ 建立'}</button></div>
            {playlistMessage&&<small className="playlist-message">{playlistMessage}</small>}
          </section>
        </div>
        {ytSelected.length>0&&!writeReady&&<div className="notice studio-warning">要直接加入 YouTube 播放清單，需要重新授權一次編輯權限。<button className="btn ghost" type="button" onClick={()=>location.href='/auth/youtube'}>重新授權 YouTube</button></div>}

        <button className="advanced-toggle" type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}><span>進階設定</span><b>{advanced?'收起 −':'展開 ＋'}</b></button>
        {advanced&&<div className="advanced-panel">
          <div className="studio-two"><label>分類<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}>{CATEGORY_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}{id==='27'?'（預設）':''}</option>)}</select></label><label>標籤<input value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="用逗號分隔，例如：健康,教學"/></label></div>
          <fieldset className="language-fieldset"><div className="language-title"><div><b>主要影片語言</b><small>中文系預設全選</small></div><span>主語言：繁體中文（台灣）</span></div><div className="language-grid">{CHINESE.map(item=><label className="language-option" key={item.code}><input type="checkbox" checked={languages.includes(item.code)} onChange={()=>toggle(languages,item.code,setLanguages)}/><span>{item.label}</span></label>)}</div><small className="field-help">YouTube 主語言以繁體中文（台灣）儲存；其餘勾選語言建立多語言標題／說明。</small></fieldset>
          <fieldset><legend>多語言標題／說明</legend>{languages.map(code=>{const name=CHINESE.find(x=>x.code===code)?.label||code;const item=localized[code]||{title,description};return <div className="locale-card" key={code}><b>{name}</b><input value={item.title} onChange={e=>setLocalized(prev=>({...prev,[code]:{title:e.target.value,description:(prev[code]?.description??description)}}))} placeholder={title||'標題'}/><textarea value={item.description} onChange={e=>setLocalized(prev=>({...prev,[code]:{title:(prev[code]?.title??title),description:e.target.value}}))} placeholder={description||'說明'}/></div>})}</fieldset>
          <label className="toggle-row"><input type="checkbox" checked={synthetic} onChange={e=>setSynthetic(e.target.checked)}/><span><b>含 AI／合成或變造內容</b><small>勾選後會向 YouTube 提交合成媒體聲明。</small></span></label>
          <fieldset><legend>加入／移出播放清單、播放清單內排序</legend><p className="field-help">上方勾選代表加入，取消勾選代表這次不上傳到該清單。YouTube 播放清單可指定位置；0 代表最前面。</p>{ytSelected.length?<div className="position-list">{ytSelected.map(id=>{const p=ytPlaylists.find(x=>x.id===id);return <label key={id}><span>{p?.title||id}</span><input type="number" min="0" step="1" value={positions[id]||''} onChange={e=>setPositions(prev=>({...prev,[id]:e.target.value}))} placeholder="留空＝加到最後"/></label>})}</div>:<p className="muted-mini">尚未選擇 YouTube 播放清單。</p>}</fieldset>
        </div>}

        {(longUploadsStatus==='eligible'||verificationNeeded)&&<div className="notice studio-warning"><b>YouTube 中階功能尚未完成</b><br/>完成一次電話驗證後，即可使用自訂縮圖與上傳超過 15 分鐘的影片。驗證由 YouTube 官方完成，Box Starry 會直接帶你前往。<div><button className="btn ghost" type="button" onClick={()=>window.open(YOUTUBE_VERIFY_URL,'_blank','noopener,noreferrer')}>立即驗證 YouTube</button> <button className="btn ghost" type="button" onClick={()=>void refreshYoutubeStatus()}>已完成，重新檢查</button></div></div>}
        {longUploadsStatus==='disallowed'&&<div className="notice studio-warning">這個 YouTube 頻道目前不允許上傳超過 15 分鐘的影片。請先到 YouTube Studio 的「功能使用資格」檢查頻道狀態。</div>}
        <div className="notice">上傳前請確認你有權使用影片內容。開始上傳即表示你同意 <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube 服務條款</a>、<a href="/terms">Box Starry 使用條款</a>與<a href="/privacy">隱私權政策</a>。</div>
        {!me.youtubeConnected&&<div className="notice">尚未連接 YouTube。第一次使用只要授權一次。</div>}
        {busy&&<div className="progress"><span style={{width:`${progress}%`}}/></div>}
        {message&&<p className="form-message">{message}</p>}
        <button className="btn primary wide" disabled={busy||!file} onClick={upload}>{busy?`上傳中 ${progress}%`:me.youtubeConnected?'開始上傳到 YouTube':'先連接 YouTube'}</button>
      </div>
    </div>
  </section>;
}