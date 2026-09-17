'use strict';

// Mission 20 F1 Leg 2 (DD10): the load-failure surface's frozen DOM contract
// (every id, the `hidden` toggles, and the no-innerHTML-from-data rule) —
// grep-shape, the welcome-controller.js precedent
// (search-engines.test.js's DOM-contract test). Also pins the two other
// cross-file wiring points a behavioral fake-DOM harness can't cheaply cover:
// the onTabTitle title-clobber guard (AC5) and the F6 focus-content routing
// (AC7).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CONTROLLER_PATH = path.join(__dirname, '../../src/renderer/chrome/load-failure-controller.js');
const CONTEXT_PATH = path.join(__dirname, '../../src/renderer/chrome/context.js');
const RENDERER_PATH = path.join(__dirname, '../../src/renderer/renderer.js');
const SHORTCUT_PATH = path.join(__dirname, '../../src/renderer/chrome/shortcut-controller.js');
const INDEX_HTML_PATH = path.join(__dirname, '../../src/renderer/index.html');

test('load-failure-controller.js assigns every DOM-contract id (AC1/DD10), including the crash Reload button (F3 L2)', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  const CONTRACT_IDS = [
    'load-failure-heading',
    'load-failure-body',
    'load-failure-url',
    'load-failure-code',
    'load-failure-retry',
    'load-failure-reload'
  ];
  for (const id of CONTRACT_IDS) {
    const re = new RegExp("\\.id = '" + id + "'");
    assert.ok(re.test(src), `load-failure-controller.js must assign the DOM-contract id "${id}"`);
  }
});

test('index.html defines the hang-notice DOM-contract ids (F3 L2, DD3/DD12)', () => {
  const src = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  for (const id of ['hang-notice', 'hang-notice-wait', 'hang-notice-kill']) {
    assert.ok(src.includes(`id="${id}"`), `index.html must define #${id}`);
  }
});

test('context.js registers the hang-notice IDS entries (F3 L2)', () => {
  const src = fs.readFileSync(CONTEXT_PATH, 'utf8');
  assert.ok(/hangNotice: 'hang-notice'/.test(src));
  assert.ok(/hangNoticeWait: 'hang-notice-wait'/.test(src));
  assert.ok(/hangNoticeKill: 'hang-notice-kill'/.test(src));
});

test('load-failure-controller.js toggles the panel and Retry via `hidden` only (AC1/AC6/AC10)', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.ok(/root\.classList\.remove\('hidden'\)/.test(src), 'show() must remove `hidden` from the root section');
  assert.ok(/root\.classList\.add\('hidden'\)/.test(src), 'hide() must add `hidden` to the root section');
  assert.ok(
    /retry\.classList\.toggle\('hidden'/.test(src),
    "render() must toggle Retry's `hidden` class by the classification's retryable flag"
  );
});

test('load-failure-controller.js never assigns innerHTML from data (house rule: textContent only)', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.ok(!/\.innerHTML\s*=/.test(src), 'load-failure-controller.js must build/update its DOM via textContent only');
});

test('load-failure-controller.js exports createLoadFailureController returning show/hide/focusHeading/applyStripState/onTabDidNavigate', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.ok(/export function createLoadFailureController\(deps\)/.test(src));
  // HAT H2b: onTabDidNavigate added — clears a (possibly synthetic) crash
  // record on the tab's next committed navigation.
  assert.ok(/return \{ show, hide, focusHeading, applyStripState, onTabDidNavigate \};/.test(src));
});

// Mission 20 Flight 3 Leg 2 (DD1): REWRITTEN, not deleted — the strip now has
// THREE states (crashed/failed/hung) derived from ONE function rather than a
// single field-scoped literal. The pin is now on the DERIVATION, not a
// hardcoded 'failed' string: exactly one `dataset.loadState =` write site in
// the whole file, and its value must come from `deriveStripLoadState(`.
test('applyStripState is the ONLY writer of data-load-state / .tab-status, and its value derives from deriveStripLoadState (renamed/rewritten F3 L2)', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  const fnMatch = src.match(/function applyStripState\(tab\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fnMatch, 'load-failure-controller.js must define function applyStripState(tab) { ... }');
  assert.ok(
    /const state = deriveStripLoadState\(tab\);/.test(fnMatch[1]),
    'applyStripState must derive its state from deriveStripLoadState(tab)'
  );
  assert.ok(
    /if \(state\) tab\.btn\.dataset\.loadState = state;/.test(fnMatch[1]),
    'the one dataset.loadState write must assign the value returned by deriveStripLoadState, never a literal'
  );
  assert.ok(
    /else delete tab\.btn\.dataset\.loadState;/.test(fnMatch[1]),
    'applyStripState must clear the load-state on recovery (state === null)'
  );
  // Nowhere else in the file writes dataset.loadState — exactly one site.
  const allWrites = src.match(/dataset\.loadState = /g) || [];
  assert.equal(allWrites.length, 1, 'only applyStripState may write .tab.dataset.loadState');
  // No literal state string is ever assigned directly (the old 'failed'
  // hardcode this test used to pin) — every value flows through the shared
  // derivation.
  assert.equal(
    /dataset\.loadState = '(crashed|failed|hung)'/.test(src),
    false,
    'no hardcoded load-state literal may be assigned directly — every value must come from deriveStripLoadState'
  );
});

test("context.js registers loadFailureSurface: 'load-failure-surface' in IDS", () => {
  const src = fs.readFileSync(CONTEXT_PATH, 'utf8');
  assert.ok(/loadFailureSurface: 'load-failure-surface'/.test(src));
});

test('renderer.js onTabTitle short-circuits before touching the DOM while tab.loadFailure OR tab.crash is set (AC5, widened F3 L2)', () => {
  const src = fs.readFileSync(RENDERER_PATH, 'utf8');
  const handlerMatch = src.match(/window\.goldfinch\.onTabTitle\(\(\{ wcId, title \}\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(handlerMatch, 'renderer.js must define the onTabTitle subscription in its documented shape');
  const body = handlerMatch[1];
  const guardIndex = body.indexOf('if (tab.loadFailure || tab.crash) return;');
  const domWriteIndex = body.indexOf(".querySelector('.tab-title').textContent");
  assert.ok(guardIndex >= 0, 'onTabTitle must early-return while tab.loadFailure OR tab.crash is set');
  assert.ok(
    domWriteIndex >= 0,
    'onTabTitle must still write the ordinary title DOM on the non-failed/non-crashed path'
  );
  assert.ok(guardIndex < domWriteIndex, 'the loadFailure/crash guard must run BEFORE any DOM title write');
});

test("shortcut-controller.js's focus-content case routes to the load-failure heading when the active tab is failed OR crashed (AC7, widened F3 L2)", () => {
  const src = fs.readFileSync(SHORTCUT_PATH, 'utf8');
  const caseMatch = src.match(/case 'focus-content':([\s\S]*?)case 'focus-chrome':/);
  assert.ok(caseMatch, "shortcut-controller.js must define case 'focus-content'");
  const body = caseMatch[1];
  assert.ok(/activeTab\(\)\?\.loadFailure/.test(body), "focus-content must check the active tab's loadFailure");
  assert.ok(/activeTab\(\)\?\.crash/.test(body), "focus-content must ALSO check the active tab's crash");
  assert.ok(/focusLoadFailureHeading\(\)/.test(body), 'focus-content must call the injected focusLoadFailureHeading()');
  assert.ok(
    /window\.goldfinch\.focusActiveGuest\(\)/.test(body),
    'focus-content must keep the ordinary focusActiveGuest() fallback'
  );
});
