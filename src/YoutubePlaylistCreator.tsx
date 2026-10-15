import React, { useState } from 'react';
import { api } from './api';
import './YoutubePlaylistCreator.css';

type Playlist = { id:string; title:string; itemCount:number; privacy:string };
type Props = { enabled:boolean; compact?:boolean };

export default function YoutubePlaylistCreator({enabled,compact=false}:Props){
  const [title,setTitle]=useState('');
  const [privacy,setPrivacy]=useState('private');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  if(!enabled)return null;

  const create=async()=>{
    const name=title.trim();
    if(!name){setMessage('請先輸入 YouTube 播放清單名稱');return;}
    setBusy(true);setMessage('');
    try{
      const data=await api<{playlist:Playlist}>('/api/youtube/studio/playlists/create',{
        method:'POST',
        body:JSON.stringify({title:name,description:'',privacy})
      });
      setTitle('');
      setMessage(`已建立「${data.playlist.title}」`);
      window.dispatchEvent(new CustomEvent('box-youtube-playlist-created',{detail:data.playlist}));
      window.dispatchEvent(new CustomEvent('box-toast',{detail:`已建立 YouTube 播放清單「${data.playlist.title}」`}));
    }catch(e){setMessage(e instanceof Error?e.message:'建立 YouTube 播放清單失敗');}
    finally{setBusy(false);}
  };

  return <section className={`youtube-playlist-creator ${compact?'compact':''}`}>
    <div className="yt-create-copy"><span className="eyebrow">YouTube Playlist</span><b>新增 YouTube 播放清單</b><small>不用離開 Box，建立後可直接加入目前影片。</small></div>
    <div className="yt-create-fields">
      <input value={title} maxLength={150} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create();}}} placeholder="輸入播放清單名稱"/>
      <select value={privacy} onChange={e=>setPrivacy(e.target.value)} aria-label="YouTube 播放清單隱私"><option value="private">私人</option><option value="unlisted">不公開</option><option value="public">公開</option></select>
      <button className="btn primary" type="button" disabled={busy} onClick={()=>void create()}>{busy?'建立中…':'＋ 建立'}</button>
    </div>
    {message&&<small className="yt-create-message">{message}</small>}
  </section>;
}
