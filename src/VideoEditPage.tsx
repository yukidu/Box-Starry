import React, { useEffect, useMemo, useState } from 'react';
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
type Props = { me:Me; videoId:string };

const CATEGORY_OPTIONS = [
  ['27','教育'],['22','人物與網誌'],['28','科學與科技'],['26','操作說明與風格'],['24','娛樂']
];

function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}

export default function VideoEditPage({me,videoId}:Props){
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [privacy,setPrivacy]=useState<Privacy>('unlisted');
  const [recordingDate,setRecordingDate]=useState('');
  const [categoryId,setCategoryId]=useState('27');
  const [tagsText,setTagsText]=useState('');
  const [thumbnailUrl,setThumbnailUrl]=useState('');
  const [thumbnail,setThumbnail]=useState<File|null>(null);
  const [playlists,setPlaylists]=useState<YoutubePlaylist[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState('');
  const [previewUrl,setPreviewUrl]=useState('');

  useEffect(()=>{
    if(!thumbnail){setPreviewUrl('');return;}
    const url=URL.createObjectURL(thumbnail);setPreviewUrl(url);
    return()=>URL.revokeObjectURL(url);
  },[thumbnail]);

  const load=async()=>{
    if(!me.user||!me.youtubeConnected)return;
    setLoading(true);setError('');
    try{
      const data=await api<EditorResponse>(`/api/youtube/studio/video/${encodeURIComponent(videoId)}`);
      setTitle(data.video.title);
      setDescription(data.video.description);
      setPrivacy(data.video.privacy);
      setRecordingDate(data.video.recordingDate||'');
      setCategoryId(data.video.categoryId||'27');
      setTagsText((data.video.tags||[]).join(','));
      setThumbnailUrl(data.video.thumbnailUrl||'');
      setPlaylists(data.playlists||[]);
      setSelected(data.selectedPlaylistIds||[]);
      setThumbnail(null);
    }catch(e){setError(e instanceof Error?e.message:'讀取影片資料失敗');}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[me.user?.id,me.youtubeConnected,videoId]);

  useEffect(()=>{
    const created=(event:Event)=>{
      const playlist=(event as CustomEvent<YoutubePlaylist>).detail;
      if(!playlist?.id)return;
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
  if(error)return <section className="page narrow"><div className="empty-card"><div className="big-symbol">!</div><h2>暫時無法開啟影片編輯頁</h2><p>{error}</p><div className="card-actions"><button className="btn ghost" onClick={()=>go('/videos')}>回到我的影片</button><button className="btn primary" onClick={()=>void load()}>再試一次</button></div></div></section>;

  const togglePlaylist=(id:string)=>setSelected(prev=>prev.includes(id)?prev.filter(item=>item!==id):[...prev,id]);

  const save=async()=>{
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
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'儲存失敗');}
    finally{setSaving(false);}
  };

  return <section className="page studio-page video-edit-page">
    <div className="page-head"><div><span className="eyebrow">Box Video Editor</span><h1>影片詳細編輯</h1><p>名稱、縮圖、日期與播放清單都可以直接在 Box 修改。</p></div><div className="card-actions"><button className="btn ghost" onClick={()=>go('/videos')}>← 回到我的影片</button><a className="btn ghost" href={`https://youtu.be/${encodeURIComponent(videoId)}`} target="_blank" rel="noreferrer">開啟 YouTube</a></div></div>
    <div className="studio-layout">
      <div className="studio-media">
        <div className="edit-thumbnail-card">
          <div className="edit-thumbnail-preview"><img src={previewUrl||thumbnailUrl||`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`} alt="影片縮圖"/></div>
          <label className="edit-thumbnail-picker"><input type="file" accept="image/jpeg,image/png" onChange={e=>setThumbnail(e.target.files?.[0]||null)}/><span>＋ 選擇新的 JPG / PNG 縮圖</span></label>
          {thumbnail&&<small>已選：{thumbnail.name}，按「儲存全部修改」後才會套用。</small>}
        </div>
        <YoutubePlaylistCreator enabled={true} compact/>
      </div>
      <div className="form-card studio-form">
        <label>影片名稱<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="輸入影片名稱"/></label>
        <label>影片說明<textarea value={description} maxLength={5000} onChange={e=>setDescription(e.target.value)} placeholder="輸入影片說明"/></label>
        <div className="studio-two"><label>錄製日期<input type="date" value={recordingDate} onChange={e=>setRecordingDate(e.target.value)}/></label><label>YouTube 隱私<select value={privacy} onChange={e=>setPrivacy(e.target.value as Privacy)}><option value="unlisted">不公開</option><option value="private">私人</option><option value="public">公開</option></select></label></div>
        <div className="studio-two"><label>分類<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}>{CATEGORY_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>標籤<input value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="用逗號分隔，例如：健康,教學"/></label></div>

        <section className="playlist-card edit-playlist-card">
          <div className="playlist-card-head"><h3>YouTube 播放清單</h3><span>{selected.length?`已選 ${selected.length} 個`:'尚未加入'}</span></div>
          <input className="playlist-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋播放清單"/>
          <div className="playlist-options">{filtered.length?filtered.map(item=><label className="playlist-option" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={()=>togglePlaylist(item.id)}/><span className="playlist-copy"><b>{item.title}</b><small>{item.itemCount} 支影片 · {item.privacy==='public'?'公開':item.privacy==='unlisted'?'不公開':'私人'}</small></span></label>):<p className="muted-mini">目前沒有符合的播放清單，可用左側直接新增。</p>}</div>
          <small className="field-help">勾選＝加入；取消勾選＝從該 YouTube 播放清單移除。</small>
        </section>

        {message&&<p className="form-message">{message}</p>}
        <button className="btn primary wide" disabled={saving} onClick={()=>void save()}>{saving?'儲存中…':'儲存全部修改'}</button>
      </div>
    </div>
  </section>;
}
