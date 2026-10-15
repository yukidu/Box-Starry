import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import './CoverStudio.css';

type FrameChoice = { file: File; url: string; time: number };
type Props = {
  videoFile: File | null;
  title: string;
  value: File | null;
  onChange: (file: File | null) => void;
};

const COVER_WIDTH = 1280;
const COVER_HEIGHT = 720;
const DEFAULT_EXCLUDE_TEXT = '不要產品圖，不要人物';

function waitFor(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('影片畫面讀取失敗')); };
    const cleanup = () => { video.removeEventListener(event, ok); video.removeEventListener('error', fail); };
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('封面圖片產生失敗')), 'image/jpeg', quality));
}

async function captureFrame(video: HTMLVideoElement, time: number, name: string): Promise<File> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const safeTime = Math.max(0, Math.min(duration > 0 ? duration - 0.05 : 0, time));
  if (Math.abs(video.currentTime - safeTime) > 0.04) {
    const pending = waitFor(video, 'seeked');
    video.currentTime = safeTime;
    await pending;
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error('目前無法擷取這支影片的畫面');
  const canvas = document.createElement('canvas');
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援影片截圖');
  const targetRatio = COVER_WIDTH / COVER_HEIGHT;
  const sourceRatio = video.videoWidth / video.videoHeight;
  let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
  if (sourceRatio > targetRatio) {
    sw = video.videoHeight * targetRatio;
    sx = (video.videoWidth - sw) / 2;
  } else if (sourceRatio < targetRatio) {
    sh = video.videoWidth / targetRatio;
    sy = (video.videoHeight - sh) / 2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);
  const blob = await canvasBlob(canvas);
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

async function normalizeImage(file: File, name: string): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('AI 圖片讀取失敗'));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援圖片處理');
    const targetRatio = COVER_WIDTH / COVER_HEIGHT;
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
    if (sourceRatio > targetRatio) {
      sw = image.naturalHeight * targetRatio;
      sx = (image.naturalWidth - sw) / 2;
    } else if (sourceRatio < targetRatio) {
      sh = image.naturalWidth / targetRatio;
      sy = (image.naturalHeight - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);
    const blob = await canvasBlob(canvas, 0.9);
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(value / 60);
  const remain = value % 60;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

function sixMoments(duration: number) {
  const bases = [0.08, 0.24, 0.40, 0.56, 0.72, 0.88];
  return bases.map(base => {
    const jitter = (Math.random() - 0.5) * 0.06;
    return Math.max(0, Math.min(Math.max(0, duration - 0.05), duration * (base + jitter)));
  }).sort((a, b) => a - b);
}

export default function CoverStudio({ videoFile, title, value, onChange }: Props) {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [frames, setFrames] = useState<FrameChoice[]>([]);
  const [framesBusy, setFramesBusy] = useState(false);
  const [aiVideoTitle, setAiVideoTitle] = useState(title);
  const [aiTitleDirty, setAiTitleDirty] = useState(false);
  const [coverTitleText, setCoverTitleText] = useState('');
  const [excludeText, setExcludeText] = useState(DEFAULT_EXCLUDE_TEXT);
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [source, setSource] = useState('');

  const selectedUrl = useMemo(() => value ? URL.createObjectURL(value) : '', [value]);
  useEffect(() => () => { if (selectedUrl) URL.revokeObjectURL(selectedUrl); }, [selectedUrl]);
  useEffect(() => () => { frames.forEach(frame => URL.revokeObjectURL(frame.url)); }, [frames]);
  useEffect(() => { if (!aiTitleDirty) setAiVideoTitle(title); }, [title, aiTitleDirty]);

  useEffect(() => {
    setDuration(0); setCurrentTime(0); setFrames([]); setMessage(''); setAiTitleDirty(false); setAiVideoTitle(title); setCoverTitleText(''); setExcludeText(DEFAULT_EXCLUDE_TEXT);
    if (!videoFile) { setVideoUrl(''); return; }
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  useEffect(() => {
    if (!videoFile || !videoUrl) return;
    let cancelled = false;
    const build = async () => {
      setFramesBusy(true);
      const sampleVideo = document.createElement('video');
      sampleVideo.preload = 'auto';
      sampleVideo.muted = true;
      sampleVideo.playsInline = true;
      sampleVideo.src = videoUrl;
      try {
        if (sampleVideo.readyState < 1) await waitFor(sampleVideo, 'loadedmetadata');
        const picks = sixMoments(sampleVideo.duration || 0);
        const next: FrameChoice[] = [];
        for (let i = 0; i < picks.length; i++) {
          if (cancelled) return;
          const frame = await captureFrame(sampleVideo, picks[i], `cover-auto-${i + 1}.jpg`);
          next.push({ file: frame, url: URL.createObjectURL(frame), time: picks[i] });
        }
        if (!cancelled) setFrames(next);
        else next.forEach(item => URL.revokeObjectURL(item.url));
      } catch {
        if (!cancelled) setMessage('這支影片暫時無法自動擷取 6 張縮圖，仍可使用時間軸、自訂圖片或 AI 生圖。');
      } finally {
        if (!cancelled) setFramesBusy(false);
        sampleVideo.removeAttribute('src');
        sampleVideo.load();
      }
    };
    void build();
    return () => { cancelled = true; };
  }, [videoFile, videoUrl]);

  const selectCover = (file: File, nextSource: string) => {
    onChange(file);
    setSource(nextSource);
    setMessage(`已選擇：${nextSource}`);
  };

  const captureCurrent = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      const file = await captureFrame(player, player.currentTime, 'cover-current-frame.jpg');
      selectCover(file, `影片 ${formatTime(player.currentTime)} 畫面`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '擷取畫面失敗');
    }
  };

  const generateAi = async () => {
    const videoTitle = aiVideoTitle.trim();
    const coverText = coverTitleText.trim();
    const exclusions = excludeText.trim();
    if (!videoTitle) { setMessage('請先輸入影片標題'); return; }
    setAiBusy(true); setMessage('Cloudflare AI 正在理解標題並產生封面圖…');
    try {
      const data = await api<{ image: string; mimeType?: string }>('/api/youtube/studio/cover-ai', {
        method: 'POST',
        body: JSON.stringify({ videoTitle, coverTitleText: coverText, excludeText: exclusions })
      });
      const mime = data.mimeType || 'image/jpeg';
      const response = await fetch(`data:${mime};base64,${data.image}`);
      const blob = await response.blob();
      const raw = new File([blob], 'cover-ai-source.jpg', { type: mime });
      const normalized = await normalizeImage(raw, 'cover-ai.jpg');
      selectCover(normalized, coverText ? 'AI 底圖＋封面標題生成' : 'AI 依影片標題生成');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 生圖失敗，請稍後再試');
    } finally {
      setAiBusy(false);
    }
  };

  return <section className="cover-studio" aria-label="封面圖工作室">
    <div className="cover-head">
      <div><b>封面圖</b><small>四種方式選一張，最後選到的圖片會設為 YouTube 封面</small></div>
      {source && <span>{source}</span>}
    </div>

    {selectedUrl && <div className="cover-selected"><img src={selectedUrl} alt="目前選擇的封面"/><span>目前封面</span></div>}

    <div className="cover-method ai-cover-method">
      <div className="cover-method-title"><span>1</span><div><b>Cloudflare AI 自動生圖</b><small>影片標題決定底圖；封面標題文字決定封面上的標題呈現</small></div></div>
      <label className="ai-cover-field"><span>影片標題</span><input value={aiVideoTitle} maxLength={300} onChange={e=>{setAiTitleDirty(true);setAiVideoTitle(e.target.value);}} placeholder="會自動抓取上方影片標題，也可自行修改"/><small>AI 會用這段文字理解影片內容並生成封面底圖。</small></label>
      <label className="ai-cover-field"><span>封面標題文字</span><input value={coverTitleText} maxLength={120} onChange={e=>setCoverTitleText(e.target.value)} placeholder="例如：每天10分鐘，找回健康活力"/><small>可留空；有輸入時，AI 會依這段文字規劃封面標題的字體、位置與視覺效果。</small></label>
      <label className="ai-cover-field"><span>不要納入生圖</span><input value={excludeText} maxLength={500} onChange={e=>setExcludeText(e.target.value)} placeholder="例如：不要產品圖，不要人物"/><small>AI 會把這一欄當成排除條件，盡量避免生成這些內容。</small></label>
      <button className="btn primary wide" type="button" disabled={aiBusy} onClick={()=>void generateAi()}>{aiBusy?'AI 生圖中…':'✨ 生成封面圖'}</button>
    </div>

    <div className="cover-method">
      <div className="cover-method-title"><span>2</span><div><b>拖曳影片時間軸抓圖</b><small>移到想要的畫面後，直接設為封面</small></div></div>
      {videoUrl ? <>
        <video ref={playerRef} src={videoUrl} controls playsInline preload="metadata" onLoadedMetadata={e => { const video=e.currentTarget; setDuration(video.duration || 0); setCurrentTime(video.currentTime || 0); }} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime || 0)} onSeeked={e=>setCurrentTime(e.currentTarget.currentTime || 0)}/>
        <div className="cover-timeline"><span>{formatTime(currentTime)}</span><input type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={Math.min(currentTime, Math.max(duration,0.1))} onChange={e=>{const next=Number(e.target.value);setCurrentTime(next);if(playerRef.current)playerRef.current.currentTime=next;}}/><span>{formatTime(duration)}</span></div>
        <button className="btn ghost wide" type="button" onClick={()=>void captureCurrent()}>📸 把目前畫面設為封面</button>
      </> : <p className="cover-empty">先選擇影片，就可以拖曳時間軸抓圖。</p>}
    </div>

    <div className="cover-method">
      <div className="cover-method-title"><span>3</span><div><b>自動挑選 6 張影片縮圖</b><small>全部在你的裝置上擷取，不會增加 Cloudflare 用量</small></div></div>
      {framesBusy ? <p className="cover-empty">正在從不同時間自動擷取 6 張圖片…</p> : frames.length ? <div className="cover-six">{frames.map((frame,index)=><button type="button" key={`${frame.time}-${index}`} onClick={()=>selectCover(frame.file,`自動縮圖 ${index+1}`)} className={value===frame.file?'selected':''}><img src={frame.url} alt={`影片縮圖 ${index+1}`}/><small>{formatTime(frame.time)}</small></button>)}</div> : <p className="cover-empty">選擇影片後會自動出現 6 張不同時間的縮圖。</p>}
    </div>

    <div className="cover-method">
      <div className="cover-method-title"><span>4</span><div><b>上傳自訂圖片</b><small>保留原本 JPG / PNG 上傳方式</small></div></div>
      <label className="cover-upload"><input type="file" accept="image/jpeg,image/png" onChange={e=>{const file=e.target.files?.[0];if(file)selectCover(file,'自訂圖片');}}/><span>＋ 選擇 JPG / PNG</span></label>
    </div>

    {message && <p className="cover-message">{message}</p>}
  </section>;
}
