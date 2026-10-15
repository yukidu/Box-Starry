import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cover = readFileSync(new URL('../src/CoverStudio.tsx', import.meta.url), 'utf8');
const upload = readFileSync(new URL('../src/UploadStudioPage.tsx', import.meta.url), 'utf8');
const studioWorker = readFileSync(new URL('../worker/youtubeStudio.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const types = readFileSync(new URL('../worker/types.ts', import.meta.url), 'utf8');

test('AI cover generation is the first cover method and shows editable visual brief, headline, and exclusions', () => {
  const aiIndex = cover.indexOf('Cloudflare AI 自動生圖');
  const timelineIndex = cover.indexOf('拖曳影片時間軸抓圖');
  assert.ok(aiIndex >= 0 && timelineIndex > aiIndex);
  assert.match(cover, /<span>1<\/span><div><b>Cloudflare AI 自動生圖/);
  assert.match(cover, /影片背景圖與主視覺/);
  assert.doesNotMatch(cover, /<span>影片標題<\/span>/);
  assert.match(cover, /封面標題文字/);
  assert.match(cover, /不要納入生圖/);
  assert.match(cover, /EXCLUDE_PLACEHOLDER = '不要產品圖，不要人物'/);
  assert.match(cover, /const \[excludeText, setExcludeText\] = useState\(''\)/);
  assert.match(cover, /placeholder=\{EXCLUDE_PLACEHOLDER\}/);
  assert.match(cover, /輸入「不要文字」時，只禁止 AI 從背景圖與主視覺自動加字/);
  assert.match(cover, /body: JSON\.stringify\(\{ videoTitle, coverTitleText: coverText, excludeText: exclusions \}\)/);
  assert.doesNotMatch(cover, /aiMode/);
  assert.doesNotMatch(cover, /自訂文字與條件/);
});

test('cover studio supports timeline capture and six local video frames', () => {
  assert.match(cover, /<span>2<\/span><div><b>拖曳影片時間軸抓圖/);
  assert.match(cover, /<span>3<\/span><div><b>自動挑選 6 張影片縮圖/);
  assert.match(cover, /captureFrame/);
  assert.match(cover, /sixMoments/);
  assert.match(cover, /type="range"/);
  assert.match(cover, /全部在你的裝置上擷取/);
});

test('cover studio keeps custom image upload as the fourth method', () => {
  assert.match(cover, /<span>4<\/span><div><b>上傳自訂圖片/);
  assert.match(cover, /accept="image\/jpeg,image\/png"/);
  assert.match(cover, /\/api\/youtube\/studio\/cover-ai/);
});

test('upload page uses the selected cover for YouTube thumbnail upload', () => {
  assert.match(upload, /CoverStudio/);
  assert.match(upload, /value={thumbnail}/);
  assert.match(upload, /onChange={setThumbnail}/);
  assert.match(upload, /\/api\/youtube\/studio\/thumbnail/);
});

test('Workers AI treats 不要文字 as no auto text while preserving the custom headline', () => {
  assert.match(wrangler, /\[ai\]/);
  assert.match(wrangler, /binding = "AI"/);
  assert.match(types, /WorkersAILike/);
  assert.match(types, /response\?: string/);
  assert.match(studioWorker, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
  assert.match(studioWorker, /@cf\/black-forest-labs\/flux-2-dev/);
  assert.match(studioWorker, /splitExcludeRules/);
  assert.match(studioWorker, /不要\\s\*文字/);
  assert.match(studioWorker, /suppressAutoText/);
  assert.match(studioWorker, /BACKGROUND & MAIN VISUAL BRIEF/);
  assert.match(studioWorker, /NO AUTO TEXT FROM BACKGROUND BRIEF/);
  assert.match(studioWorker, /This rule does NOT prohibit the user-supplied COVER HEADLINE/);
  assert.match(studioWorker, /The only readable text allowed is exactly this user-supplied cover headline/);
  assert.match(studioWorker, /Never derive, invent, or render text from the background and main-visual brief/);
  assert.match(studioWorker, /genericExcludeText/);
  assert.match(studioWorker, /STRICT EXCLUSIONS/);
  assert.match(studioWorker, /suppressAutoText\n    \}/);
  assert.match(studioWorker, /Preserve the wording and language exactly/);
  assert.match(studioWorker, /multipart/);
  assert.match(studioWorker, /form\.append\('width', '1280'\)/);
  assert.match(studioWorker, /form\.append\('height', '720'\)/);
  assert.match(studioWorker, /form\.append\('steps', '20'\)/);
  assert.doesNotMatch(studioWorker, /flux-1-schnell/);
});
