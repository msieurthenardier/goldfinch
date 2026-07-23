'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

test('downloads popup keeps its footer reachable with a scroll-bounded row list', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/menu-overlay.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src/renderer/menu-overlay.js'), 'utf8');
  assert.match(css, /#sheet-downloads\s*\{[^}]*box-sizing:\s*border-box[^}]*max-height:\s*calc\(100vh - 8px\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.dl-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(js, /querySelectorAll\('\.dl-list, button'\)/);
  assert.match(js, /list\.className = 'dl-list';[\s\S]*list\.tabIndex = 0;[\s\S]*aria-label', 'Download items'[\s\S]*list\.appendChild\(row\);[\s\S]*downloadsNode\.appendChild\(footer\);/);
});
