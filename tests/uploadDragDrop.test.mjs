import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/UploadStudioPage.tsx', import.meta.url), 'utf8');

test('desktop upload box accepts dragged video files', () => {
  assert.match(source, /onDragEnter=/);
  assert.match(source, /onDragOver=/);
  assert.match(source, /onDrop=/);
  assert.match(source, /dataTransfer\.files/);
  assert.match(source, /選擇影片或拖曳到這裡/);
  assert.match(source, /請拖曳影片檔案/);
});
