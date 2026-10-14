import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './PlaylistPage.css';

type User = { id:string; email:string; name:string|null; avatar:string|null; profileSlug:string|null; rank:string|null };
type Me = { user: User|null; youtubeConnected:boolean };
type YoutubePlaylist = { id:string; title:string; description:string; thumbnailUrl:string; itemCount:number; privacy:string; publishedAt:string };
type BoxPlaylist = { id:string; name:string; description:string; itemCount:number; createdAt:string; updatedAt:string };
type BoxPlaylistItem = { youtubeVideoId:string; title:string; thumbnailUrl:string; position:number; addedAt:string };
type LibraryVideo = { youtubeVideoId:string; title:string; thumbnailUrl:string };

function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}

function LoginGate(){return <div className="empty-card"><div className="big-symbol">☰</div><h2>先登入你的 Starry ID</h2><p>登入後才能使用播放清單。</p><button className="btn primary" onClick={()=>location.href='/auth/starry'}>註冊或登入</button></div>}

export default function PlaylistPage({me}:{me:Me}){
  const [tab,setTab]=useState<'youtube'|'box'>('youtube');
  const [youtube,setYoutube]=useState<YoutubePlaylist[]>([]);
  const [ytLoading,setYtLoading]=useState(false);
  const [ytProgress,setYtProgress]=useState(0);
  const [ytError,setYtError]=useState('');
  const [box,setBox]=useState<BoxPlaylist[]>([]);
  const [boxLoading,setBoxLoading]=useState(false);
  const [selectedId,setSelectedId]=useState<string>('');
  const [items,setItems]=useState<BoxPlaylistItem[]>([]);
  const [library,setLibrary]=useState<LibraryVideo[]>([]);
  const [libraryLoaded,setLibraryLoaded]=useState(false);
  const [newName,setNewName]=useState('');
  const [newDescription,setNewDescription]=useState('');
  const [editName,setEditName]=useState('');
  const [editDescription,setEditDescription]=useState('');
  const [selectedVideo,setSelectedVideo]=useState('');
  const [message,setMessage]=useState('');

  const selected=box.find(p=>p.id===selectedId)||null;
  const existingIds=useMemo(()=>new Set(items.map(item=>item.youtubeVideoId)),[items]);
  const availableVideos=library.filter(v=>!existingIds.has(v.youtubeVideoId));

  const syncYoutube=async()=>{
    if(!me.user||!me.youtubeConnected)return;
    setYtLoading(true);setYtError('');setYtProgress(8);
    try{
      const all:YoutubePlaylist[]=[];let token='';let page=0;
      do{
        const data=await api<{playlists:YoutubePlaylist[];nextPageToken:string|null}>(`/api/youtube/playlists${token?`?pageToken=${encodeURIComponent(token)}`:''}`);
        all.push(...data.playlists);token=data.nextPageToken||'';page++;
        setYtProgress(token?Math.min(92,18+page*24):100);
        if(page>100)throw new Error('播放清單數量過多，請稍後再重新同步');
      }while(token);
      setYoutube(all);
    }catch(e){setYtError(e instanceof Error?e.message:'同步 YouTube 播放清單失敗');}
    finally{setYtLoading(false);}
  };

  const loadBox=async()=>{
    if(!me.user)return;
    setBoxLoading(true);
    try{
      const data=await api<{playlists:BoxPlaylist[]}>('/api/playlists');
      setBox(data.playlists);
      if(selectedId&&!data.playlists.some(p=>p.id===selectedId)){setSelectedId('');setItems([]);}
    }catch(e){setMessage(e instanceof Error?e.message:'讀取播放清單失敗');}
    finally{setBoxLoading(false);}
  };

  const loadItems=async(id:string)=>{
    const data=await api<{playlist:{id:string;name:string;description:string};items:BoxPlaylistItem[]}>(`/api/playlists/${id}/items`);
    setItems(data.items);setEditName(data.playlist.name);setEditDescription(data.playlist.description||'');setSelectedId(id);
  };

  const loadLibrary=async()=>{
    if(libraryLoaded||!me.youtubeConnected)return;
    const all:LibraryVideo[]=[];let token='';let page=0;
    do{
      const data=await api<{videos:LibraryVideo[];nextPageToken:string|null}>(`/api/youtube/library${token?`?pageToken=${encodeURIComponent(token)}`:''}`);
      all.push(...data.videos.map(v=>({youtubeVideoId:v.youtubeVideoId,title:v.title,thumbnailUrl:v.thumbnailUrl})));
      token=data.nextPageToken||'';page++;
      if(page>100)break;
    }while(token);
    setLibrary(all);setLibraryLoaded(true);
  };

  useEffect(()=>{if(me.user){syncYoutube();loadBox();}},[me.user?.id,me.youtubeConnected]);
  useEffect(()=>{if(tab==='box'&&me.user&&me.youtubeConnected)loadLibrary().catch(()=>undefined);},[tab,me.user?.id,me.youtubeConnected]);

  if(!me.user)return <section className="page"><LoginGate/></section>;

  const createPlaylist=async()=>{
    if(!newName.trim())return;
    try{
      const data=await api<{playlist:BoxPlaylist}>('/api/playlists',{method:'POST',body:JSON.stringify({name:newName,description:newDescription})});
      setNewName('');setNewDescription('');setMessage('已建立繁星膠囊播放清單');await loadBox();await loadItems(data.playlist.id);
    }catch(e){setMessage(e instanceof Error?e.message:'建立失敗');}
  };

  const savePlaylist=async()=>{
    if(!selected||!editName.trim())return;
    try{await api(`/api/playlists/${selected.id}`,{method:'PATCH',body:JSON.stringify({name:editName,description:editDescription})});setMessage('播放清單已更新');await loadBox();}
    catch(e){setMessage(e instanceof Error?e.message:'更新失敗');}
  };

  const deletePlaylist=async()=>{
    if(!selected)return;
    try{await api(`/api/playlists/${selected.id}`,{method:'DELETE'});setSelectedId('');setItems([]);setMessage('播放清單已刪除');await loadBox();}
    catch(e){setMessage(e instanceof Error?e.message:'刪除失敗');}
  };

  const addVideo=async()=>{
    if(!selected||!selectedVideo)return;
    const video=library.find(v=>v.youtubeVideoId===selectedVideo);if(!video)return;
    try{await api(`/api/playlists/${selected.id}/items`,{method:'POST',body:JSON.stringify(video)});setSelectedVideo('');await loadItems(selected.id);await loadBox();}
    catch(e){setMessage(e instanceof Error?e.message:'加入影片失敗');}
  };

  const removeVideo=async(videoId:string)=>{
    if(!selected)return;
    try{await api(`/api/playlists/${selected.id}/items/${encodeURIComponent(videoId)}`,{method:'DELETE'});await loadItems(selected.id);await loadBox();}
    catch(e){setMessage(e instanceof Error?e.message:'移除影片失敗');}
  };

  return <section className="page playlists-page">
    <div className="page-head"><div><span className="eyebrow">Playlists</span><h1>播放清單</h1><p>同一頁管理 YouTube 播放清單，以及繁星膠囊自己的自訂播放清單。</p></div></div>
    <div className="playlist-tabs" role="tablist">
      <button className={tab==='youtube'?'active':''} onClick={()=>setTab('youtube')}>▶ YouTube 播放清單</button>
      <button className={tab==='box'?'active':''} onClick={()=>setTab('box')}>✦ 繁星膠囊自訂播放清單</button>
    </div>

    {tab==='youtube'&&<div className="playlist-section">
      <div className="playlist-section-head"><div><h2>YouTube 播放清單</h2><p>每次進入此頁都會自動同步你的 YouTube 播放清單，只讀取、不會修改 YouTube 原內容。</p></div><button className="btn ghost" onClick={syncYoutube} disabled={ytLoading}>{ytLoading?'同步中…':'立即同步'}</button></div>
      {ytLoading&&<div className="sync-panel"><div className="sync-copy"><b>正在同步 YouTube 播放清單…</b><span>{youtube.length?`目前已顯示 ${youtube.length} 個播放清單`:'正在連線…'}</span></div><div className="sync-bar"><span style={{width:`${ytProgress}%`}}/></div></div>}
      {ytError&&<div className="empty-card"><div className="big-symbol">!</div><h2>暫時無法同步</h2><p>{ytError}</p><button className="btn primary" onClick={()=>ytError.includes('重新授權')?location.href='/auth/youtube':syncYoutube()}>{ytError.includes('重新授權')?'重新授權 YouTube':'再試一次'}</button></div>}
      {!ytError&&!ytLoading&&youtube.length===0&&<div className="empty-card"><div className="big-symbol">▶</div><h2>目前沒有 YouTube 播放清單</h2><p>你在 YouTube 建立的播放清單會同步顯示在這裡。</p></div>}
      <div className="youtube-playlists">{youtube.map(p=><article className="youtube-playlist-row" key={p.id}><div className="playlist-thumb">{p.thumbnailUrl?<img src={p.thumbnailUrl} alt=""/>:<span>▶</span>}</div><div className="playlist-copy"><h3>{p.title}</h3><p>{p.description||'沒有說明'}</p><div className="meta"><span>{p.itemCount} 支影片</span><span>{p.privacy==='public'?'公開':p.privacy==='unlisted'?'不公開':'私人'}</span></div></div><a className="btn ghost" href={`https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer">開啟</a></article>)}</div>
    </div>}

    {tab==='box'&&<div className="playlist-section">
      <div className="playlist-section-head"><div><h2>繁星膠囊自訂播放清單</h2><p>這裡的分類只存在 Box Starry，不會改動你的 YouTube 播放清單。</p></div></div>
      <div className="playlist-create-card"><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="播放清單名稱" maxLength={120}/><input value={newDescription} onChange={e=>setNewDescription(e.target.value)} placeholder="說明（可留空）" maxLength={1000}/><button className="btn primary" onClick={createPlaylist} disabled={!newName.trim()}>＋ 新增播放清單</button></div>
      {message&&<p className="form-message">{message}</p>}
      {boxLoading?<div className="loading">正在讀取繁星膠囊播放清單…</div>:box.length===0?<div className="empty-card"><div className="big-symbol">✦</div><h2>還沒有自訂播放清單</h2><p>你可以建立自己的課程、活動、學習或私人分類。</p></div>:<div className="box-playlist-list">{box.map(p=><button className={`box-playlist-card ${selectedId===p.id?'selected':''}`} key={p.id} onClick={()=>loadItems(p.id)}><span className="box-playlist-icon">✦</span><span><b>{p.name}</b><small>{p.description||'沒有說明'} · {p.itemCount} 支影片</small></span><span>›</span></button>)}</div>}

      {selected&&<div className="playlist-editor">
        <div className="playlist-editor-head"><div><span className="eyebrow">Box Playlist</span><h2>{selected.name}</h2></div><button className="btn danger-ghost" onClick={deletePlaylist}>刪除播放清單</button></div>
        <div className="playlist-edit-fields"><input value={editName} onChange={e=>setEditName(e.target.value)} placeholder="播放清單名稱"/><input value={editDescription} onChange={e=>setEditDescription(e.target.value)} placeholder="說明"/><button className="btn ghost" onClick={savePlaylist}>儲存名稱／說明</button></div>
        <div className="playlist-add-video"><select value={selectedVideo} onChange={e=>setSelectedVideo(e.target.value)}><option value="">選擇要加入的 YouTube 影片</option>{availableVideos.map(v=><option key={v.youtubeVideoId} value={v.youtubeVideoId}>{v.title}</option>)}</select><button className="btn primary" onClick={addVideo} disabled={!selectedVideo}>＋ 加入影片</button></div>
        {!me.youtubeConnected&&<div className="notice">連接 YouTube 後，就可以從自己的影片清單加入影片。</div>}
        {items.length===0?<div className="playlist-empty">這個播放清單目前還沒有影片。</div>:<div className="playlist-items">{items.map(item=><article key={item.youtubeVideoId}><div className="playlist-item-thumb">{item.thumbnailUrl?<img src={item.thumbnailUrl} alt=""/>:<span>▶</span>}</div><div><h3>{item.title}</h3><a href={`https://youtu.be/${item.youtubeVideoId}`} target="_blank" rel="noreferrer">開啟 YouTube</a></div><button className="btn danger-ghost" onClick={()=>removeVideo(item.youtubeVideoId)}>移除</button></article>)}</div>}
      </div>}
    </div>}
    <div className="playlist-bottom-actions"><button className="btn ghost" onClick={()=>go('/videos')}>← 回我的影片</button></div>
  </section>;
}
