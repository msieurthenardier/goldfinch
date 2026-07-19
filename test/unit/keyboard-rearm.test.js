'use strict';

// L2 keyboard-cycling re-arm code-shape pin (M09 Flight 10, Leg 2) — a self-deriving
// source-scan test in the window-closed-invariant.test.js / broadcast-invariant.test.js
// house pattern, using the shared toolkit (test/helpers/source-scan.js) so a shaped
// mention inside a COMMENT (including this file's own docstring) cannot trip it.
//
// WHAT IT PINS, AND WHY. The T3 bug: from page-content focus, the first Ctrl+# jump
// works but subsequent tab-cycling/jump chords do nothing until a tab is clicked —
// because `tab-set-active` swaps guest visibility but never re-focuses the newly-active
// guest, orphaning OS keyboard focus. The design-review fix (main-only, no renderer/
// preload change) is: read whether the OUTGOING active guest holds OS focus BEFORE the
// visibility swap (`isFocused()`), and focus the INCOMING guest IFF it did. This test
// pins that exact code SHAPE on the real src/main/main.js `tab-set-active` handler:
//
//   (1) it READS the outgoing guest's isFocused() into a captured guard, AND
//   (2) it CONDITIONALLY calls .focus() on the incoming guest, gated by that guard.
//
// A mutation in EITHER direction fails this net:
//   - remove the conditional focus (never .focus() the incoming) → (2) breaks;
//   - remove the read / focus unconditionally (no isFocused guard) → (1) breaks.
// The synthetic-mutation tests at the bottom exercise both directions on fixture
// strings (never real source mutation).
//
// HONEST SCOPE — THIS IS A CODE-SHAPE PIN, NOT A RUNTIME PROOF. main.js is NEVER
// executed by the unit suite; a source scan cannot prove OS focus actually re-routes.
// The RUNTIME reading — two consecutive Ctrl+# from page-content focus with NO
// intervening click both landing, on the real WSLg rig — is the MANUAL HAT verification
// pass (leg AC3), the only instrument that exercises real OS focus. The `tab-cycling`
// behavior test's incoming-guest `document.hasFocus()` assertion (AC4) is the automated
// regression net; MCP `pressKey` injects via sendInputEvent-by-wcId and BYPASSES OS
// focus routing, so a "two-chords-no-click" automated step would pass regardless of the
// bug — hence the hasFocus() observable, and hence the two-chords-no-click case lives in
// the MANUAL pass, not here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN_JS = path.join(__dirname, '../../src/main/register-tab-ipc.js');
const HANDLER = 'tab-set-active';

// --- the scan -------------------------------------------------------------------

/**
 * Locate the `ipcMain.on('<eventName>', (…) => { … })` handler in already-comment-masked
 * source and return its body text (the arrow function's `{ … }`, braces included), or
 * null if not found. Bracket-balanced via the shared toolkit so nested braces/strings do
 * not desync the extraction.
 * @param {string} masked
 * @param {string} eventName
 * @returns {string | null}
 */
function extractHandlerBody(masked, eventName) {
  const startRe = new RegExp(`ipcMain\\.on\\(\\s*'${eventName}'\\s*,`);
  const m = masked.match(startRe);
  if (!m || m.index === undefined) return null;
  const arrowIdx = masked.indexOf('=>', m.index);
  if (arrowIdx === -1) return null;
  const braceIdx = masked.indexOf('{', arrowIdx);
  if (braceIdx === -1) return null;
  const closeIdx = findMatchingBracket(masked, braceIdx, '{', '}');
  if (closeIdx === -1) return null;
  return masked.slice(braceIdx, closeIdx + 1);
}

/**
 * Analyze a (comment-masked) handler body for the two halves of the L2 fix.
 *
 *   readsIsFocused — the body calls isFocused() at all.
 *   guardVar       — the identifier a `const/let/var … = … isFocused(…)` captures the
 *                    read into (null if the read is not captured into a variable).
 *   focusesGuarded — some `if (… guardVar …) { … .focus() … }` gates a .focus() call on
 *                    that captured guard (the CONDITIONAL incoming-guest focus).
 *
 * @param {string} body
 * @returns {{ readsIsFocused: boolean, guardVar: string | null, focusesGuarded: boolean }}
 */
function analyzeHandler(body) {
  const readsIsFocused = /isFocused\s*\(/.test(body);
  const assign = body.match(/(?:const|let|var)\s+(\w+)\s*=\s*[^;]*isFocused\s*\(/);
  const guardVar = assign ? assign[1] : null;

  let focusesGuarded = false;
  if (guardVar) {
    const guardRe = new RegExp(`\\b${guardVar}\\b`);
    const ifRe = /if\s*\(/g;
    let im;
    while ((im = ifRe.exec(body))) {
      const condOpen = im.index + im[0].length - 1; // the '(' of the condition
      const condClose = findMatchingBracket(body, condOpen, '(', ')');
      if (condClose === -1) continue;
      const cond = body.slice(condOpen, condClose + 1);
      if (!guardRe.test(cond)) continue;
      const blockOpen = body.indexOf('{', condClose);
      if (blockOpen === -1) continue;
      const blockClose = findMatchingBracket(body, blockOpen, '{', '}');
      if (blockClose === -1) continue;
      if (/\.focus\s*\(/.test(body.slice(blockOpen, blockClose + 1))) {
        focusesGuarded = true;
        break;
      }
    }
  }
  return { readsIsFocused, guardVar, focusesGuarded };
}

// --- the net --------------------------------------------------------------------

test("register-tab-ipc `tab-set-active` reads outgoing focus and conditionally focuses the incoming guest", () => {
  const body = extractHandlerBody(maskComments(fs.readFileSync(MAIN_JS, 'utf8')), HANDLER);

  // Vacuity guard: fail loudly if the handler was renamed/refactored out of reach rather
  // than passing for the wrong reason on an empty body.
  assert.notEqual(body, null, `could not locate the ipcMain.on('${HANDLER}', …) handler in main.js`);

  const { readsIsFocused, guardVar, focusesGuarded } = analyzeHandler(/** @type {string} */ (body));

  assert.ok(
    readsIsFocused && guardVar,
    `${HANDLER} must capture the OUTGOING active guest's isFocused() into a guard before the ` +
      'visibility swap (the "focus was in the page" signal). It does not.'
  );
  assert.ok(
    focusesGuarded,
    `${HANDLER} must CONDITIONALLY .focus() the incoming guest, gated by the captured ` +
      `isFocused() guard (\`${guardVar}\`), so a page-focused Ctrl+#/Ctrl+Tab does not orphan ` +
      'OS focus — while an unfocused-outgoing activation (strip nav / find / sheet) does NOT ' +
      'steal focus (AC5). No such guarded focus() was found.'
  );
});

// ---------------------------------------------------------------------------
// Regression insurance for the scan's own logic (synthetic strings — never real source
// mutation; the RUNTIME two-chords-no-click reading is the MANUAL HAT pass, AC3).
// ---------------------------------------------------------------------------

const GOOD = [
  "ipcMain.on('tab-set-active', (event, { wcId, bounds }) => {",
  '  const owner = registry.getWindowForGuest(wcId);',
  '  if (!owner) return;',
  '  const wasPageFocused = owner.activeTabWcId != null && !!getTabContents(owner.activeTabWcId)?.isFocused();',
  '  const entry = owner.tabViews.get(wcId);',
  '  if (entry) {',
  '    entry.view.setVisible(true);',
  '    owner.win.contentView.addChildView(entry.view);',
  '    if (wasPageFocused && !entry.view.webContents.isDestroyed()) {',
  '      entry.view.webContents.focus();',
  '    }',
  '  }',
  '});'
].join('\n');

test('the scan PASSES the real fix shape (read into guard + guarded incoming focus)', () => {
  const body = extractHandlerBody(maskComments(GOOD), HANDLER);
  assert.notEqual(body, null);
  const r = analyzeHandler(/** @type {string} */ (body));
  assert.ok(r.readsIsFocused && r.guardVar === 'wasPageFocused' && r.focusesGuarded);
});

test('direction 1 — removing the conditional focus (never .focus() the incoming) FAILS', () => {
  const mutated = GOOD
    .replace('    if (wasPageFocused && !entry.view.webContents.isDestroyed()) {\n', '')
    .replace('      entry.view.webContents.focus();\n', '')
    .replace('    }\n  }', '  }');
  const body = extractHandlerBody(maskComments(mutated), HANDLER);
  assert.notEqual(body, null);
  const r = analyzeHandler(/** @type {string} */ (body));
  assert.equal(r.readsIsFocused, true, 'the isFocused() read still present');
  assert.equal(r.focusesGuarded, false, 'but with no incoming focus() the net must fail');
});

test('direction 2 — focusing unconditionally (no isFocused guard) FAILS', () => {
  const mutated = GOOD
    .replace('  const wasPageFocused = owner.activeTabWcId != null && !!getTabContents(owner.activeTabWcId)?.isFocused();\n', '')
    .replace('    if (wasPageFocused && !entry.view.webContents.isDestroyed()) {', '    if (!entry.view.webContents.isDestroyed()) {');
  const body = extractHandlerBody(maskComments(mutated), HANDLER);
  assert.notEqual(body, null);
  const r = analyzeHandler(/** @type {string} */ (body));
  assert.equal(r.readsIsFocused, false, 'the isFocused() read was removed');
  assert.equal(r.guardVar, null, 'no captured guard');
  assert.equal(r.focusesGuarded, false, 'an unconditional focus() is not a guarded one — the net must fail');
});

test('a .focus()/isFocused() mention inside a COMMENT does not satisfy the net', () => {
  const commented = [
    "ipcMain.on('tab-set-active', (event, { wcId, bounds }) => {",
    '  const entry = owner.tabViews.get(wcId);',
    '  // const wasPageFocused = getTabContents(x)?.isFocused();',
    '  // if (wasPageFocused) entry.view.webContents.focus();',
    '  entry.view.setVisible(true);',
    '});'
  ].join('\n');
  const body = extractHandlerBody(maskComments(commented), HANDLER);
  assert.notEqual(body, null);
  const r = analyzeHandler(/** @type {string} */ (body));
  assert.equal(r.readsIsFocused, false, 'the read is masked out (comment)');
  assert.equal(r.focusesGuarded, false, 'the focus is masked out (comment)');
});
