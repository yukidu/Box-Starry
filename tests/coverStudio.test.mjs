import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cover = readFileSync(new URL('../src/CoverStudio.tsx', import.meta.url), 'utf8');
const upload = readFileSync(new URL('../src/UploadStudioPage.tsx', import.meta.url), 'utf8');
const studioWorker = readFileSync(new URL('../worker/youtubeStudio.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const types = readFileSync(new URL('../worker/types.ts', import.meta.url), 'utf8');

test('cover studio supports timeline capture and six local video frames', () => {
  assert.match(cover, /拖曳影片時間軸抓圖/);
  assert.match(cover, /自動挑選 6 張影片縮圖/);
  assert.match(cover, /captureFrame/);
  assert.match(cover, /sixMoments/);
  assert.match(cover, /type="range"/);
  assert.match(cover, /全部在你的裝置上擷取/);
});

test('cover studio keeps custom image upload and Cloudflare AI generation', () => {
  assert.match(cover, /上傳自訂圖片/);
  assert.match(cover, /accept="image\/jpeg,image\/png"/);
  assert.match(cover, /Cloudflare AI 自動生圖/);
  assert.match(cover, /依影片標題/);
  assert.match(cover, /自訂文字與條件/);
  assert.match(cover, /\/api\/youtube\/studio\/cover-ai/);
});

test('upload page uses the selected cover for YouTube thumbnail upload', () => {
  assert.match(upload, /CoverStudio/);
  assert.match(upload, /value={thumbnail}/);
  assert.match(upload, /onChange={setThumbnail}/);
  assert.match(upload, /\/api\/youtube\/studio\/thumbnail/);
});

test('Workers AI is bound and uses FLUX.2 dev with smart title understanding', () => {
  assert.match(wrangler, /\[ai\]/);
  assert.match(wrangler, /binding = "AI"/);
  assert.match(types, /WorkersAILike/);
  assert.match(types, /response\?: string/);
  assert.match(studioWorker, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
  assert.match(studioWorker, /@cf\/black-forest-labs\/flux-2-dev/);
  assert.match(studioWorker, /buildSmartCoverPrompt/);
  assert.match(studioWorker, /multipart/);
  assert.match(studioWorker, /form\.append\('width', '1280'\)/);
  assert.match(studioWorker, /form\.append\('height', '720'\)/);
  assert.match(studioWorker, /form\.append\('steps', '20'\)/);
  assert.doesNotMatch(studioWorker, /flux-1-schnell/);
});
