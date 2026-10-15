import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/MenuBackdropBlur.css', import.meta.url), 'utf8');

test('main menu loads full-page backdrop blur while keeping panel clear', () => {
  assert.match(main, /import '\.\/MenuBackdropBlur\.css'/);
  assert.match(css, /\.hamburger\[aria-expanded="true"\]/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /backdrop-filter:\s*blur\(14px\)/);
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(14px\)/);
  assert.match(css, /\.menu-panel/);
  assert.match(css, /backdrop-filter:\s*none/);
  assert.match(css, /\.menu-wrap/);
});
