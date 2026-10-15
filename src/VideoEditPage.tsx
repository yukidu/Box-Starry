import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import YoutubePlaylistCreator from './YoutubePlaylistCreator';
import './UploadStudioPage.css';
import './VideoEditPage.css';

type Me = { user:{id:string}|null; youtubeConnected:boolean };
type Privacy = 'private'|'unlisted'|'public';
type YoutubePlaylist = { id:string; title:string; itemCount:number; privacy:string };
type VideoEditor = {
  youtubeVideoId:string;
  title:string;
  description:string;
  categoryId:string;
  tags:string[];
  privacy:Privacy;
  recordingDate:string;
  thumbnailUrl:string;
};
type EditorResponse = { video:VideoEditor; playlists:YoutubePlaylist[]; selectedPlaylistIds:string[] };
type CachedVideo = {
  youtubeVideoId:string;
  title?:string;
  description?:string;
  youtubePrivacy?:Privacy;
  thumbnailUrl?:string;
};
type Props = { me:Me; videoId:string };

const CATEGORY_OPTIONS = [
  ['27','教育'],['22','人物與網誌'],['28','科學與科技'],['26','操作說明與風格'],['24','娛樂']
];

function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}
function readCachedVideo(userId:string,videoId:string):CachedVideo|null{
  if(!userId)return null;
  try{
    const rows=JSON.parse(localStorage.getItem(`box-youtube-library-cache-${userId}`)||'[]');
    if(!Array.isArray(rows))return null;
    return rows.find((item:any)=>item?.youtubeVideoId===videoId)||null;
  }catch{return null;}
}

export default function VideoEditPage({me,videoId}:Props){
  const cached=useMemo(()=>readCachedVideo(me.user?.id||'',videoId),[me.user?.id,videoId]);
  const dirty=useRef(new Set<string>());
  const [loading,setLoading]=useState(!cached);
  const [syncing,setSyncing]=useState(Boolean(cached));
  const [detailsReady,setDetailsReady]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [title,setTitle]=useState(cached?.title||'');
  const [description,setDescription]=useState(cached?.description||'');
  const [privacy,setPrivacy]=useState<Privacy>(cached?.youtubePrivacy||'unlisted');
  const [recordingDate,setRecordingDate]=useState('');
  const [categoryId,setCategoryId]=useState('27');
  const [tagsText,setTagsText]=useState('');
  const [thumbnailUrl,setThumbnailUrl]=useState(cached?.thumbnailUrl||'');
  const [thumbnail,setThumbnail]=useState<File|null>(null);
  const [playlists,setPlaylists]=useState<YoutubePlaylist[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState('');
  const [previewUrl,setPreviewUrl]=useState('');

  const mark=(field:string)=>dirty.current.add(field);

  useEffect(()=>{
    if(!cached)return;
    if(!dirty.current.has('title'))setTitle(cached.title||'');
    if(!dirty.current.has('description'))setDescription(cached.description||'');
    if(!dirty.current.has('privacy'))setPrivacy(cached.youtubePrivacy||'unlisted');
    if(!dirty.current.has('thumbnailUrl'))setThumbnailUrl(cached.thumbnailUrl||'');
    setLoading(false);
    setSyncing(true);
  },[cached?.youtubeVideoId]);

  useEffect(()=>{
    if(!thumbnail){setPreviewUrl('');return;}
    const url=URL.createObjectURL(thumbnail);setPreviewUrl(url);
    return()=>URL.revokeObjectURL(url);
  },[thumbnail]);

  const load=async()=>{
    if(!me.user||!me.youtubeConnected)return;
    const hasCached=Boolean(readCachedVideo(me.user.id,videoId));
    if(!hasCached)setLoading(true);
    setSyncing(true);setDetailsReady(false);setError('');
    try{
      const data=await api<EditorResponse>(`/api/youtube/studio/video/${encodeURIComponent(videoId)}`);
      if(!dirty.current.has('title'))setTitle(data.video.title);
      if(!dirty.current.has('description'))setDescription(data.video.description);
      if(!dirty.current.has('privacy'))setPrivacy(data.video.privacy);
      if(!dirty.current.has('recordingDate'))setRecordingDate(data.video.recordingDate||'');
      if(!dirty.current.has('categoryId'))setCategoryId(data.video.categoryId||'27');
      if(!dirty.current.has('tagsText'))setTagsText((data.video.tags||[]).join(','));
      if(!dirty.current.has('thumbnailUrl'))setThumbnailUrl(data.video.thumbnailUrl||'');
      if(!dirty.current.has('playlists'))setSelected(data.selectedPlaylistIds||[]);
      setPlaylists(data.playlists||[]);
      setDetailsReady(true);
    }catch(e){setError(e instanceof Error?e.message:'讀取影片資料失敗');}
    finally{setLoading(false);setSyncing(false);}
  };

  useEffect(()=>{void load();},[me.user?.id,me.youtubeConnected,videoId]);

  useEffect(()=>{
    const created=(event:Event)=>{
      const playlist=(event as CustomEvent<YoutubePlaylist>).detail;
      if(!playlist?.id)return;
      mark('playlists');
      setPlaylists(prev=>[playlist,...prev.filter(item=>item.id!==playlist.id)]);
      setSelected(prev=>prev.includes(playlist.id)?prev:[...prev,playlist.id]);
    };
    window.addEventListener('box-youtube-playlist-created',created as EventListener);
    return()=>window.removeEventListener('box-youtube-playlist-created',created as EventListener);
  },[]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase('zh-TW');
    return q?playlists.filter(item=>item.title.toLocaleLowerCase('zh-TW').includes(q)):playlists;
  },[playlists,query]);

  if(!me.user)return <div className="empty-card"><div className="big-symbol">✦</div><h2>先登入你的 Starry ID</h2><p>登入後才能修改影片。</p><button className="btn primary" onClick={()=>location.href='/auth/starry'}>註冊或登入</button></div>;
  if(!me.youtubeConnected)return <section className="page"><div className="empty-card"><div className="big-symbol">▶</div><h2>先連接你的 YouTube</h2><p>連接後才能在 Box 直接修改 YouTube 影片。</p><button className="btn primary" onClick={()=>go('/youtube')}>連接 YouTube</button></div></section>;
  if(loading)return <section className="page narrow"><div className="loading">正在讀取影片詳細資料…</div></section>;
  if(error&&!cached)return <section className="page narrow"><div className="empty-card"><div className="big-symbol">!</div><h2>暫時無法開啟影片編輯頁</h2><p>{error}</p><div className="card-actions"><button className="btn ghost" onClick={()=>go('/videos')}>回到我的影片</button><button className="btn primary" onClick={()=>void load()}>再試一次</button></div></div></section>;

  const togglePlaylist=(id:string)=>{mark('playlists');setSelected(prev=>prev.includes(id)?prev.filter(item=>item!==id):[...prev,id]);};

  const save=async()=>{
    if(!detailsReady){setMessage('YouTube 詳細設定還在同步，請稍候一下再儲存。');return;}
    if(!title.trim()){setMessage('請輸入影片名稱');return;}
    setSaving(true);setMessage('正在儲存影片修改…');
    try{
      const tags=tagsText.split(',').map(item=>item.trim()).filter(Boolean);
      await api(`/api/youtube/studio/video/${encodeURIComponent(videoId)}`,{
        method:'PATCH',
        body:JSON.stringify({title,description,privacy,recordingDate,categoryId,tags})
      });
      if(thumbnail){
        const response=await fetch(`/api/youtube/studio/thumbnail/${encodeURIComponent(videoId)}`,{
          method:'POST',credentials:'same-origin',headers:{'content-type':thumbnail.type||'application/octet-stream'},body:thumbnail
        });
        if(!response.ok){const data:any=await response.json().catch(()=>({}));throw new Error(data.error||'縮圖設定失敗');}
      }
      const playlistResult=await api<{failedCount?:number}>(`/api/youtube/studio/video/${encodeURIComponent(videoId)}/playlists`,{
        method:'PUT',body:JSON.stringify({playlistIds:selected})
      });
      if(playlistResult.failedCount)throw new Error('影片資料已儲存，但有部分播放清單同步失敗，請再試一次');
      localStorage.setItem('box-youtube-sync-requested',new Date().toISOString());
      setMessage('已儲存。影片名稱、縮圖、日期與播放清單都會以 YouTube 最新資料為準。');
      window.dispatchEvent(new CustomEvent('box-toast',{detail:'影片修改已儲存'}));
      dirty.current.clear();
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'儲存失敗');}
    finally{setSaving(false);}
  };

  return <section className="page studio-page video-edit-page">
    <div className="page-head"><div><span className="eyebrow">Box Video Editor</span><h1>影片詳細編輯</h1><p>名稱、縮圖、日期與播放清單都可以直接在 Box 修改。</p></div><div className="card-actions"><button className="btn ghost" onClick={()=>go('/videos')}>← 回到我的影片</button><a className="btn ghost" href={`https://youtu.be/${encodeURIComponent(videoId)}`} target="_blank" rel="noreferrer">開啟 YouTube</a></div></div>
    {syncing&&<div className="notice">已先開啟影片資料，正在背景同步 YouTube 詳細設定與播放清單…</div>}
    {error&&cached&&<div className="notice">YouTube 詳細設定暫時同步失敗：{error} <button className="btn ghost" type="button" onClick={()=>void load()}>重新同步</button></div>}
    <div className="studio-layout">
      <div className="studio-media">
        <div className="edit-thumbnail-card">
          <div className="edit-thumbnail-preview"><img src={previewUrl||thumbnailUrl||`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`} alt="影片縮圖"/></div>
          <label className="edit-thumbnail-picker"><input type="file" accept="image/jpeg,image/png" onChange={e=>{mark('thumbnail');setThumbnail(e.target.files?.[0]||null);}}/><span>＋ 選擇新的 JPG / PNG 縮圖</span></label>
          {thumbnail&&<small>已選：{thumbnail.name}，按「儲存全部修改」後才會套用。</small>}
        </div>
        <YoutubePlaylistCreator enabled={detailsReady} compact/>
      </div>
      <div className="form-card studio-form">
        <label>影片名稱<input value={title} maxLength={100} onChange={e=>{mark('title');setTitle(e.target.value);}} placeholder="輸入影片名稱"/></label>
        <label>影片說明<textarea value={description} maxLength={5000} onChange={e=>{mark('description');setDescription(e.target.value);}} placeholder="輸入影片說明"/></label>
        <div className="studio-two"><label>錄製日期<input type="date" value={recordingDate} onChange={e=>{mark('recordingDate');setRecordingDate(e.target.value);}}/></label><label>YouTube 隱私<select value={privacy} onChange={e=>{mark('privacy');setPrivacy(e.target.value as Privacy);}}><option value="unlisted">不公開</option><option value="private">私人</option><option value="public">公開</option></select></label></div>
        <div className="studio-two"><label>分類<select value={categoryId} onChange={e=>{mark('categoryId');setCategoryId(e.target.value);}}>{CATEGORY_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>標籤<input value={tagsText} onChange={e=>{mark('tagsText');setTagsText(e.target.value);}} placeholder="用逗號分隔，例如：健康,教學"/></label></div>

        <section className="playlist-card edit-playlist-card">
          <div className="playlist-card-head"><h3>YouTube 播放清單</h3><span>{syncing?'同步中…':selected.length?`已選 ${selected.length} 個`:'尚未加入'}</span></div>
          <input className="playlist-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋播放清單" disabled={!detailsReady}/>
          <div className="playlist-options">{detailsReady?(filtered.length?filtered.map(item=><label className="playlist-option" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={()=>togglePlaylist(item.id)}/><span className="playlist-copy"><b>{item.title}</b><small>{item.itemCount} 支影片 · {item.privacy==='public'?'公開':item.privacy==='unlisted'?'不公開':'私人'}</small></span></label>):<p className="muted-mini">目前沒有符合的播放清單，可用左側直接新增。</p>):<p className="muted-mini">播放清單正在背景同步，不會擋住影片編輯頁。</p>}</div>
          <small className="field-help">勾選＝加入；取消勾選＝從該 YouTube 播放清單移除。</small>
        </section>

        {message&&<p className="form-message">{message}</p>}
        <button className="btn primary wide" disabled={saving||!detailsReady} onClick={()=>void save()}>{saving?'儲存中…':syncing?'同步設定中…':'儲存全部修改'}</button>
      </div>
    </div>
  </section>;
}
