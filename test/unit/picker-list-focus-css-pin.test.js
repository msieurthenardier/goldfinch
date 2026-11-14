'use strict';
// HAT: the picker list containers (vault picker + cert picker share .vault-picker-list) hold focus
// at open with no row selected; they must draw no focus ring of their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.vault-picker-list pins outline: none and has no focus ring/border/shadow rule', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/menu-overlay.css'), 'utf8');
  const m = /\n\.vault-picker-list\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!m) throw new Error('.vault-picker-list rule not found');
  assert.match(m[1], /outline:\s*none\s*;/);
  assert.doesNotMatch(m[1], /(?:^|\n)\s*(?:border|box-shadow)\s*:/);
  assert.doesNotMatch(css, /(?:vault|cert)-picker-list[^{,]*:focus/);
});
