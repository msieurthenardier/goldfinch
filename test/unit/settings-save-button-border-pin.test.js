'use strict';
// Squawk 0200: #home-page-save must keep the same border box as .settings-btn
// (1px transparent) so it matches the 30px Clear button beside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/settings.css'), 'utf8');

function borderOf(selector) {
  const esc = selector.replace(/[.#]/g, '\\$&');
  const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(m, 'rule not found: ' + selector);
  const b = /\n\s*border:\s*([^;]+);/.exec(m[1]);
  assert.ok(b, 'no border declaration in ' + selector);
  return b[1].trim();
}

test('#home-page-save border matches .settings-btn', () => {
  assert.equal(borderOf('#home-page-save'), borderOf('.settings-btn'));
});

function declOf(selector, prop) {
  const esc = selector.replace(/[.#]/g, '\\$&');
  const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(m, 'rule not found: ' + selector);
  const d = new RegExp('(?:^|[\\n;{\\s])' + prop + ':\\s*([^;]+);').exec(m[1]);
  assert.ok(d, 'no ' + prop + ' declaration in ' + selector);
  return d[1].trim();
}

test('#home-page-save and #home-page-clear share the same vertical-align', () => {
  assert.equal(declOf('#home-page-save', 'vertical-align'), declOf('#home-page-clear', 'vertical-align'));
  assert.equal(declOf('#home-page-clear', 'vertical-align'), declOf('#home-page-input', 'vertical-align'));
});
