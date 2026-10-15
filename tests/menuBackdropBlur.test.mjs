import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/PerformanceOverrides.css', import.meta.url), 'utf8');

test('heavy menu effects are disabled for better mobile performance', () => {
  assert.doesNotMatch(main, /MenuBackdropBlur\.css/);
  assert.match(main, /import '\.\/PerformanceOverrides\.css'/);
  assert.match(css, /\.topbar\s*\{[^}]*backdrop-filter:\s*none\s*!important/s);
  assert.match(css, /-webkit-backdrop-filter:\s*none\s*!important/);
  assert.match(css, /\.menu-panel\s*\{[^}]*animation:\s*none\s*!important/s);
  assert.match(css, /\.starline span\s*\{[^}]*animation:\s*none\s*!important/s);
});
