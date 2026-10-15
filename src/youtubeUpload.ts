import { api } from './api';

type UploadProbe = {
  complete:boolean;
  video?:any;
  retryable?:boolean;
  receivedRange?:string;
  error?:string;
};

export async function uploadYoutubeFile(
  uploadUrl:string,
  file:File,
  onProgress:(percent:number)=>void
):Promise<any>{
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    let settled=false;
    let lastLoaded=0;

    const done=(fn:()=>void)=>{if(settled)return;settled=true;fn();};
    const probe=async()=>{
      try{
        const status=await api<UploadProbe>('/api/youtube/studio/upload-status',{
          method:'POST',
          body:JSON.stringify({uploadUrl,fileSize:file.size})
        });
        if(status.complete&&status.video?.id){
          done(()=>resolve(status.video));
          return;
        }
        const nearlySent=file.size>0&&lastLoaded/file.size>=0.98;
        const text=nearlySent
          ? '影片資料已送出，但 YouTube 完成狀態暫時無法確認。請先到「我的影片」確認，避免重複上傳。'
          : '影片傳輸中斷，YouTube 尚未完整收到檔案，請重新上傳。';
        done(()=>reject(new Error(status.error||text)));
      }catch{
        const nearlySent=file.size>0&&lastLoaded/file.size>=0.98;
        const text=nearlySent
          ? '影片資料已送出，但 YouTube 完成狀態暫時無法確認。請先到「我的影片」確認，避免重複上傳。'
          : '影片傳輸中斷，請重新上傳。';
        done(()=>reject(new Error(text)));
      }
    };

    xhr.open('PUT',uploadUrl);
    xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable){
        lastLoaded=e.loaded;
        onProgress(Math.max(2,Math.round(e.loaded/e.total*88)));
      }
    };
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){
        try{
          const payload=JSON.parse(xhr.responseText);
          if(payload?.id)done(()=>resolve(payload));
          else void probe();
        }catch{
          void probe();
        }
      }else{
        void probe();
      }
    };
    xhr.onerror=()=>void probe();
    xhr.onabort=()=>done(()=>reject(new Error('已取消上傳')));
    xhr.send(file);
  });
}
