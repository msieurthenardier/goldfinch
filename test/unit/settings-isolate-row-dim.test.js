'use strict';

// Squawk 0151: the goldfinch://settings Isolate row must not be dimmed by the master-off rule while
// isolation is in force (DD6: dim = not in force). No controller harness exists for internal pages,
// so this is a source-scan pin of the CSS exemption + the controller toggle driven by the shared model.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '../../src/renderer/pages');
const css = fs.readFileSync(path.join(PAGES, 'settings.css'), 'utf8');
const js = fs.readFileSync(path.join(PAGES, 'settings.js'), 'utf8');
const { isolationModel } = require('../../src/shared/shields-isolation-model.js');

test('master-off dim rule excludes the .isolate-enforced row', () => {
  const m = css.match(/\.shields-group:has\(#shield-enabled:not\(:checked\)\)([^{]*)\{[^}]*opacity:\s*0\.65/);
  assert.ok(m, 'master-off dim rule with 0.65 opacity present');
  assert.match(m[1], /:not\(\.isolate-enforced\)/);
});

test('renderIsolation toggles .isolate-enforced from the model isolateRow.dim', () => {
  const body = js.match(/function renderIsolation\(\)\s*\{[\s\S]*?\n {2}\}\n/);
  assert.ok(body, 'renderIsolation found');
  assert.match(body[0], /classList\.toggle\(\s*'isolate-enforced'\s*,\s*!\s*m\.isolateRow\.dim\s*\)/);
  assert.match(body[0], /closest\(\s*'\.shield-row'\s*\)/);
});

test('model: master off + in force => not dimmed; not in force => dimmed', () => {
  const base = { cfg: { enabled: false, isolate: true }, operatorOverride: null, paused: false };
  assert.equal(isolationModel({ ...base, isolateEffective: true }).isolateRow.dim, false);
  assert.equal(isolationModel({ ...base, isolateEffective: false }).isolateRow.dim, true);
});
