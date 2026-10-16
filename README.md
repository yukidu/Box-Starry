# 繁星膠囊 Box Starry

Starry.phd 生態系的會員影片膠囊：讓會員從手機錄影或電腦 Zoom 錄影快速上傳到自己的 YouTube，並在 Box Starry 管理影片清單與分享權限。

GitHub Repository：`yukidu/starry-eye`
正式網址：`https://box.starry.phd`

## 核心原則

- Web First、PWA Ready、Capacitor-ready。
- 共用 Starry ID 中央會員身份；Box Starry 的影片、分享連結、YouTube 授權資料獨立保存。
- 大型影片不經 Cloudflare Worker 中轉；Worker 建立 YouTube resumable upload session，瀏覽器直接把檔案送到 YouTube。
- 分享權限包含：只有本人、公開訪客、分享連結。
- 分享連結支援：固定失效日、自訂密碼、第一次成功開啟後 N 天自動失效。
- 所有確認視窗使用 Starry 規範的琥珀／橘色自訂視窗，不使用瀏覽器 confirm()/alert()。

## 正式環境

- GitHub Repo：`yukidu/starry-eye`。
- Box Starry D1：`box-starry-db`。
- 中央會員 D1：`starry_id_db`，綁定名稱 `STARRY_ID_DB`。
- Starry ID App ID：`boxstarry`。
- 正式自訂網域：`https://box.starry.phd`。
- GitHub `main` 推送會執行驗證、D1 migration、Cloudflare Production Deploy 與正式網址檢查。
- YouTube OAuth 使用 `YOUTUBE_CLIENT_ID`，`YOUTUBE_CLIENT_SECRET` 與 `YOUTUBE_TOKEN_ENCRYPTION_KEY` 必須以 Cloudflare Secrets 保存，不可寫入 GitHub 程式碼。
- YouTube OAuth callback：`https://box.starry.phd/auth/youtube/callback`。

> 備註：GitHub Repository 已由 `starry-box` 更名為 `starry-eye`。既有正式網域、Worker、D1 與 Starry ID App ID 屬於正式環境識別，為避免登入、OAuth、既有資料與加密 Token 中斷，目前維持原值。

## YouTube 注意事項

Box Starry 的「本人／公開／分享連結」是應用層權限。若 YouTube 影片本身為 `private`，訪客無法播放；要對外分享需改為 `unlisted`。若有人取得原始 YouTube 連結，YouTube 本身不會套用 Box Starry 的密碼與效期，因此這不是 DRM。若未來需要無法繞過的嚴格私密分享，建議另開 Cloudflare Stream/R2 模式。
