'use strict';

// Squawk 0044 pin: #kebab ("More") and #bookmarks-overflow ("More bookmarks")
// must keep a visible keyboard focus ring. Both reach it through the shared
// `.icon-btn:focus-visible` rule (neither id carries its own outline reset), so
// the pin asserts (1) each element in index.html carries the `icon-btn` class,
// (2) `.icon-btn:focus-visible` declares a non-`none` outline, and (3) no
// id-level rule for either element resets the outline. Source-scan; throws
// rather than passing vacuously.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs
  .readFileSync(path.join(__dirname, '../../src/renderer/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

const IDS = ['kebab', 'bookmarks-overflow'];

/** [selectorList, body] for every rule whose selector list contains `sel`. */
function rulesWith(sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const list = m[1].split(',').map((s) => s.trim());
    if (list.includes(sel)) out.push(m[2]);
  }
  return out;
}

test('#kebab and #bookmarks-overflow carry the icon-btn class', () => {
  for (const id of IDS) {
    const tag = html.match(new RegExp(`<button[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(tag, `button #${id} not found in index.html`);
    assert.match(tag[0], /\bclass="[^"]*\bicon-btn\b/, `#${id} lost its icon-btn class`);
  }
});

test('.icon-btn:focus-visible draws a non-none outline', () => {
  const bodies = rulesWith('.icon-btn:focus-visible');
  assert.ok(bodies.length > 0, '.icon-btn:focus-visible rule not found');
  assert.ok(
    bodies.some((b) => /outline:\s*(?![\s]|none)[^;]*\S/.test(b)),
    'no non-none outline on .icon-btn:focus-visible'
  );
});

test('no id-level rule resets the outline on #kebab / #bookmarks-overflow', () => {
  for (const id of IDS) {
    const bodies = [...rulesWith(`#${id}`), ...rulesWith(`#${id}:focus`), ...rulesWith(`#${id}:focus-visible`)];
    for (const b of bodies) assert.doesNotMatch(b, /outline:\s*(none|0)\b/, `#${id} resets its outline`);
  }
});
