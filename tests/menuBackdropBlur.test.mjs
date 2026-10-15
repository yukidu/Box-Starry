import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/PerformanceOverrides.css', import.meta.url), 'utf8');

test('menu uses 4px full-page blur and theme-specific dark overlay while panel stays clear', () => {
  assert.doesNotMatch(main, /MenuBackdropBlur\.css/);
  assert.match(main, /import '\.\/PerformanceOverrides\.css'/);
  assert.match(css, /\.topbar\s*\{[^}]*backdrop-filter:\s*none\s*!important/s);
  assert.match(css, /\.menu-panel\s*\{[^}]*backdrop-filter:\s*none\s*!important/s);
  assert.match(css, /\.menu-panel\s*\{[^}]*animation:\s*none\s*!important/s);
  assert.match(css, /\.starline span\s*\{[^}]*animation:\s*none\s*!important/s);
  assert.match(css, /\.hamburger\[aria-expanded="true"\]/);
  assert.match(css, /background:\s*rgba\(15,\s*23,\s*42,\s*\.8\)/);
  assert.match(css, /background:\s*rgba\(3,\s*8,\s*18,\s*\.8\)/);
  assert.match(css, /backdrop-filter:\s*blur\(4px\)/);
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(4px\)/);
  assert.match(css, /\.menu-wrap\s*\{[^}]*z-index:\s*101/s);
});
