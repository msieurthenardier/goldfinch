'use strict';
// Squawk 0140: dimmed panel Shields rows must stay WCAG AA (4.5:1) over --bg-3.
// --accent (#f5c518) counts sit inside the dimmed row: 0.65 -> 4.14:1 (fails), 0.7 -> 4.55:1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('styles.css .shield-row.dim opacity >= 0.7 (AA for fg and accent count on --bg-3)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/styles.css'), 'utf8');
  const m = /\.shield-row\.dim\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, '.shield-row.dim rule present');
  const op = /opacity:\s*([\d.]+)/.exec(m[1]);
  assert.ok(op && Number(op[1]) >= 0.7, 'dim opacity keeps >=4.5:1');
  assert.ok(!/pointer-events/.test(m[1]), 'rows stay operable');
});
