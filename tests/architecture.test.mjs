import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
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

test('main menu follows pin and sticky requirements', () => {
  assert.match(css, /position:sticky/);
  assert.match(app, /box-pins/);
  assert.match(app, /安裝到桌面/);
  assert.match(app, /註冊或登入 Starry ID/);
  assert.match(app, /切換淺色|切換深色/);
  assert.match(app, /隱私權政策/);
  assert.match(app, /使用條款/);
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

test('production config binds both databases and official Box Starry domain', () => {
  assert.match(wrangler, /pattern = "box\.starry\.phd"/);
  assert.match(wrangler, /custom_domain = true/);
  assert.match(wrangler, /binding = "DB"/);
  assert.match(wrangler, /database_name = "box-starry-db"/);
  assert.match(wrangler, /binding = "STARRY_ID_DB"/);
  assert.match(wrangler, /database_name = "starry_id_db"/);
});

test('YouTube upload offers public, private and unlisted while requesting upload-only scope', () => {
  assert.match(app, /privacy==='public'/);
  assert.match(app, /privacy==='private'/);
  assert.match(app, /privacy==='unlisted'/);
  assert.match(youtube, /\['private', 'unlisted', 'public'\]/);
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.upload/);
  assert.doesNotMatch(youtube, /youtube\.force-ssl/);
  assert.doesNotMatch(youtube, /auth\/youtube['"`]/);
  assert.match(app, /YouTube 服務條款/);
});

test('YouTube authorization can be revoked and Box-specific data can be deleted', () => {
  assert.match(youtube, /oauth2\.googleapis\.com\/revoke/);
  assert.match(youtube, /DELETE FROM youtube_connections WHERE user_id=\?/);
  assert.match(worker, /\/api\/youtube\/disconnect/);
  assert.match(worker, /\/api\/account/);
  assert.match(worker, /DELETE FROM share_links WHERE owner_user_id=\?/);
  assert.match(worker, /DELETE FROM videos WHERE owner_user_id=\?/);
  assert.match(worker, /DELETE FROM users WHERE id=\?/);
  assert.match(app, /刪除我的 Box Starry 資料/);
});

test('public privacy policy and terms pages disclose YouTube data handling', () => {
  assert.match(app, /function PrivacyPage/);
  assert.match(app, /function TermsPage/);
  assert.match(app, /YouTube API Services/);
  assert.match(app, /Google 隱私權政策/);
  assert.match(app, /path==='\/privacy'/);
  assert.match(app, /path==='\/terms'/);
});
