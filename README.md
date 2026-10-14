# 繁星膠囊 Box Starry

Starry.phd 生態系的會員影片膠囊：讓會員從手機錄影或電腦 Zoom 錄影快速上傳到自己的 YouTube，並在 Box Starry 管理影片清單與分享權限。

## 核心原則

- Web First、PWA Ready、Capacitor-ready。
- 共用 Starry ID 中央會員身份；Box Starry 的影片、分享連結、YouTube 授權資料獨立保存。
- 大型影片不經 Cloudflare Worker 中轉；Worker 建立 YouTube resumable upload session，瀏覽器直接把檔案送到 YouTube。
- 分享權限包含：只有本人、公開訪客、分享連結。
- 分享連結支援：固定失效日、自訂密碼、第一次成功開啟後 N 天自動失效。
- 所有確認視窗使用 Starry 規範的琥珀／橘色自訂視窗，不使用瀏覽器 confirm()/alert()。

## 尚待正式環境設定

1. Cloudflare 建立獨立 D1：`box-starry-db`，套用 `migrations/0001_init.sql`。
2. 綁定中央 `starry_id_db` 為 `STARRY_ID_DB`。
3. Starry ID 將 `boxstarry` 加入允許及自助加入 App 清單，並設定正式回呼。
4. Google Cloud 啟用 YouTube Data API，建立 OAuth Web Client，填入 `YOUTUBE_CLIENT_ID`、`YOUTUBE_CLIENT_SECRET`。
5. 建立至少 32-byte 的 `YOUTUBE_TOKEN_ENCRYPTION_KEY` Worker Secret。
6. 正式自訂網域目前標記「待確認」，確認後再加入 Cloudflare route 與 Google OAuth redirect URI。

## YouTube 注意事項

Box Starry 的「本人／公開／分享連結」是應用層權限。若 YouTube 影片本身為 `private`，訪客無法播放；要對外分享需改為 `unlisted`。若有人取得原始 YouTube 連結，YouTube 本身不會套用 Box Starry 的密碼與效期，因此這不是 DRM。若未來需要無法繞過的嚴格私密分享，建議另開 Cloudflare Stream/R2 模式。
