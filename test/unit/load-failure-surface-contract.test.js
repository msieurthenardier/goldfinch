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

test('load-failure-controller.js assigns every DOM-contract id (AC1/DD10)', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  const CONTRACT_IDS = [
    'load-failure-heading',
    'load-failure-body',
    'load-failure-url',
    'load-failure-code',
    'load-failure-retry'
  ];
  for (const id of CONTRACT_IDS) {
    const re = new RegExp("\\.id = '" + id + "'");
    assert.ok(re.test(src), `load-failure-controller.js must assign the DOM-contract id "${id}"`);
  }
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

test('load-failure-controller.js exports createLoadFailureController returning show/hide/focusHeading/applyStripState', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.ok(/export function createLoadFailureController\(deps\)/.test(src));
  assert.ok(/return \{ show, hide, focusHeading, applyStripState \};/.test(src));
});

test('applyStripState is the only writer of data-load-state / .tab-status', () => {
  const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  const fnMatch = src.match(/function applyStripState\(tab\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fnMatch, 'load-failure-controller.js must define function applyStripState(tab) { ... }');
  assert.ok(/dataset\.loadState = 'failed'/.test(fnMatch[1]), 'applyStripState must set the failed load-state');
  assert.ok(
    /delete tab\.btn\.dataset\.loadState/.test(fnMatch[1]),
    'applyStripState must clear the load-state on recovery'
  );
  // Nowhere else in the file writes dataset.loadState.
  const allWrites = src.match(/dataset\.loadState = /g) || [];
  assert.equal(allWrites.length, 1, 'only applyStripState may write .tab.dataset.loadState');
});

test("context.js registers loadFailureSurface: 'load-failure-surface' in IDS", () => {
  const src = fs.readFileSync(CONTEXT_PATH, 'utf8');
  assert.ok(/loadFailureSurface: 'load-failure-surface'/.test(src));
});

test('renderer.js onTabTitle short-circuits before touching the DOM while tab.loadFailure is set (AC5)', () => {
  const src = fs.readFileSync(RENDERER_PATH, 'utf8');
  const handlerMatch = src.match(/window\.goldfinch\.onTabTitle\(\(\{ wcId, title \}\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(handlerMatch, 'renderer.js must define the onTabTitle subscription in its documented shape');
  const body = handlerMatch[1];
  const guardIndex = body.indexOf('if (tab.loadFailure) return;');
  const domWriteIndex = body.indexOf(".querySelector('.tab-title').textContent");
  assert.ok(guardIndex >= 0, 'onTabTitle must early-return while tab.loadFailure is set');
  assert.ok(domWriteIndex >= 0, 'onTabTitle must still write the ordinary title DOM on the non-failed path');
  assert.ok(guardIndex < domWriteIndex, 'the loadFailure guard must run BEFORE any DOM title write');
});

test("shortcut-controller.js's focus-content case routes to the load-failure heading when the active tab is failed (AC7)", () => {
  const src = fs.readFileSync(SHORTCUT_PATH, 'utf8');
  const caseMatch = src.match(/case 'focus-content':([\s\S]*?)case 'focus-chrome':/);
  assert.ok(caseMatch, "shortcut-controller.js must define case 'focus-content'");
  const body = caseMatch[1];
  assert.ok(/activeTab\(\)\?\.loadFailure/.test(body), "focus-content must check the active tab's loadFailure");
  assert.ok(/focusLoadFailureHeading\(\)/.test(body), 'focus-content must call the injected focusLoadFailureHeading()');
  assert.ok(
    /window\.goldfinch\.focusActiveGuest\(\)/.test(body),
    'focus-content must keep the ordinary focusActiveGuest() fallback'
  );
});
