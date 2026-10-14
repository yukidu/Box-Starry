import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const library = readFileSync(new URL('../src/YoutubeLibrary.tsx', import.meta.url), 'utf8');
const denseCss = readFileSync(new URL('../src/YoutubeLibraryDense.css', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const libraryRouter = readFileSync(new URL('../worker/youtubeLibraryRouter.ts', import.meta.url), 'utf8');
const youtube = readFileSync(new URL('../worker/youtube.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../worker/auth.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('uses Starry custom confirmation modal, not native confirm/alert', () => {
  assert.match(app, /ConfirmModal/);
  assert.doesNotMatch(app, /window\.confirm\s*\(/);
  assert.doesNotMatch(app, /window\.alert\s*\(/);
  assert.doesNotMatch(app, /(^|[^A-Za-z0-9_.])alert\s*\(/m);
  assert.match(css, /rgb\(255,251,235\)/);
  assert.match(css, /rgb\(217,119,6\)/);
  assert.match(css, /width:min\(80vw,32rem\)/);
});

test('main menu follows pin and sticky requirements and is opaque', () => {
  assert.match(css, /position:sticky/);
  assert.match(app, /box-pins/);
  assert.match(app, /安裝到桌面/);
  assert.match(app, /註冊或登入 Starry ID/);
  assert.match(app, /切換淺色|切換深色/);
  assert.match(app, /隱私權政策/);
  assert.match(app, /使用條款/);
  assert.match(denseCss, /menu-panel\{background:var\(--solid\)!important/);
  assert.match(denseCss, /backdrop-filter:none!important/);
});

test('share model supports password, fixed expiry and first-open expiry', () => {
  assert.match(migration, /password_hash/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /first_opened_at/);
  assert.match(migration, /expire_after_first_open_days/);
  assert.match(worker, /verifyPassword/);
  assert.match(worker, /first_opened_at/);
});

test('Starry ID app id is isolated for Box Starry', () => {
  assert.match(auth, /APP_ID = 'boxstarry'/);
  assert.match(migration, /starry_identities/);
  assert.match(migration, /youtube_connections/);
});

test('production config binds both databases and routes through YouTube library router', () => {
  assert.match(wrangler, /main = "worker\/youtubeLibraryRouter\.ts"/);
  assert.match(wrangler, /pattern = "box\.starry\.phd"/);
  assert.match(wrangler, /custom_domain = true/);
  assert.match(wrangler, /binding = "DB"/);
  assert.match(wrangler, /database_name = "box-starry-db"/);
  assert.match(wrangler, /binding = "STARRY_ID_DB"/);
  assert.match(wrangler, /database_name = "starry_id_db"/);
});

test('YouTube upload supports three privacy modes and requests only upload plus readonly scopes', () => {
  assert.match(app, /privacy==='public'/);
  assert.match(app, /privacy==='private'/);
  assert.match(app, /privacy==='unlisted'/);
  assert.match(youtube, /\['private', 'unlisted', 'public'\]/);
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.upload/);
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/);
  assert.doesNotMatch(youtube, /youtube\.force-ssl/);
  assert.match(app, /YouTube 服務條款/);
});

test('video management reads the authenticated channel uploads and marks Box Starry uploads', () => {
  assert.match(youtube, /youtube\/v3\/channels/);
  assert.match(youtube, /mine', 'true'/);
  assert.match(youtube, /youtube\/v3\/playlistItems/);
  assert.match(youtube, /youtube\/v3\/videos/);
  assert.match(youtube, /box-starry-upload/);
  assert.match(libraryRouter, /\/api\/youtube\/library/);
  assert.match(libraryRouter, /uploadedViaBox/);
  assert.match(library, /✦ 繁星膠囊上傳/);
  assert.match(library, /YouTube 原有影片/);
  assert.match(app, /YoutubeLibraryPage/);
});

test('library sync shows first-run message, progress bar and auto-syncs on page entry', () => {
  assert.match(library, /第一次同步 YouTube 影片會等比較久一點/);
  assert.match(library, /sync-bar/);
  assert.match(library, /setProgress/);
  assert.match(library, /useEffect\(\(\)=>\{load\(\);\}/);
  assert.match(apiSource, /syncYoutubeLibraryInBackground/);
  assert.match(apiSource, /path === '\/api\/videos'/);
  assert.match(apiSource, /box-youtube-sync-requested/);
});

test('video manager uses compact horizontal rows and a large gear menu', () => {
  assert.match(library, /yt-library-row/);
  assert.match(library, /yt-library-thumb/);
  assert.match(library, /yt-gear/);
  assert.match(library, /修改名稱/);
  assert.match(library, /修改縮圖/);
  assert.match(library, /新增／修改播放清單/);
  assert.match(library, /修改影片日期/);
  assert.match(denseCss, /grid-template-columns:180px minmax\(0,1fr\) 56px/);
});

test('gear share always uses Box Starry share controls and native share only after link creation', () => {
  assert.match(library, /繁星膠囊分享控制/);
  assert.match(library, /不是 YouTube 原生分享/);
  assert.match(library, /registerForBox/);
  assert.match(library, /\/api\/videos/);
  assert.match(library, /呼叫手機分享/);
  assert.match(library, /shareLink\(video\.title,url\)/);
});

test('tagged Box uploads self-heal local management records', () => {
  assert.match(libraryRouter, /uploadedViaBoxTag/);
  assert.match(libraryRouter, /INSERT OR IGNORE INTO videos/);
  assert.match(libraryRouter, /youtube_video_id/);
});

test('YouTube authorization can be revoked and Box-specific data can be deleted', () => {
  assert.match(youtube, /oauth2\.googleapis\.com\/revoke/);
  assert.match(youtube, /DELETE FROM youtube_connections WHERE user_id=\?/);
  assert.match(worker, /\/api\/youtube\/disconnect/);
  assert.match(worker, /\/api\/account/);
  assert.match(worker, /DELETE FROM share_links WHERE owner_user_id=\?/);
  assert.match(worker, /DELETE FROM videos WHERE owner_user_id=\?/);
  assert.match(worker, /DELETE FROM users WHERE id=\?/);
  assert.match(library, /刪除我的 Box Starry 資料/);
});

test('public privacy policy discloses YouTube read and upload data handling', () => {
  assert.match(library, /function PrivacyPolicyPage/);
  assert.match(library, /YouTube API Services/);
  assert.match(library, /Google 隱私權政策/);
  assert.match(library, /唯讀取得你自己的頻道與影片清單/);
  assert.match(app, /path==='\/privacy'/);
  assert.match(app, /path==='\/terms'/);
});
