import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const about = readFileSync(new URL('../public/about.html', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
const terms = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
const youtube = readFileSync(new URL('../worker/youtube.ts', import.meta.url), 'utf8');

test('OAuth public homepage is review-ready and links policy pages', () => {
  assert.match(about, /繁星視界 Starry Eye/);
  assert.match(about, /YouTube/);
  assert.match(about, /\/privacy\.html/);
  assert.match(about, /\/terms\.html/);
  assert.match(about, /為什麼需要 Google \/ YouTube 權限/);
});

test('privacy page discloses Google data handling and Limited Use', () => {
  assert.match(privacy, /Google API Services User Data Policy/);
  assert.match(privacy, /Limited Use requirements/);
  assert.match(privacy, /同步你自己的 YouTube 影片與播放清單/);
  assert.match(privacy, /自訂縮圖/);
  assert.match(privacy, /明確勾選的 YouTube 播放清單/);
  assert.match(privacy, /不販售 Google \/ YouTube 使用者資料/);
  assert.match(privacy, /解除 YouTube 授權/);
  assert.match(privacy, /AES-GCM/);
  assert.match(privacy, /HTTPS/);
  assert.match(privacy, /youtube.force-ssl/);
});

test('terms identify YouTube integration and revocation controls', () => {
  assert.match(terms, /連接自己的 YouTube 帳戶/);
  assert.match(terms, /解除授權/);
  assert.match(terms, /Google 帳戶/);
});

test('verification documentation matches production scopes in code', () => {
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.upload/);
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly/);
  assert.match(youtube, /https:\/\/www\.googleapis\.com\/auth\/youtube\.force-ssl/);
});
