'use strict';

// Tear-off overlay no-leak + creation pins (M09 F10 Leg L4-rebuild, AC4) — a source-scan
// in the broadcast-invariant.test.js / window-closed-invariant.test.js house pattern.
//
// The tear-off pill is a per-window native WebContentsView (the find/menu-overlay leak
// class — F6/F7): every per-window view MUST be destroyed at the window's `close`, and
// `close` fires exactly once, so a missing teardown leaks one WebContentsView per closed
// window for the app's lifetime. Two readings, both masked (a comment mention can never
// trip or satisfy them):
//
//   READING 1 — the SOLE destruction site. `tearoffOverlay.teardown(` appears INSIDE the
//     per-window `win.on('close', ...)` handler body (bracket-matched, not "somewhere in
//     the file"). Mutating the teardown call out of the close handler fails this.
//   READING 2 — creation via the manager. `createTearoffOverlayManager(` is constructed
//     in main.js (not an inlined ad-hoc view), so the view rides the shared lifecycle.
//
// The scan uses the shared toolkit (maskComments) so this file's own prose mentioning
// `tearoffOverlay.teardown` cannot self-satisfy the net.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN = path.join(__dirname, '../../src/main/main.js');

// Locate the per-window `win.on('close', () => { ... })` handler and return its
// bracket-matched body (masked). Throws (via assert) if it cannot be found/balanced — a
// refactor that renames the handler must fail LOUDLY here, never pass vacuously.
/** @param {string} masked @returns {string} */
function closeHandlerBody(masked) {
  const m = masked.match(/win\.on\(\s*'close'\s*,\s*\(\)\s*=>\s*\{/);
  assert.ok(m && m.index !== undefined, "could not locate the per-window win.on('close') handler in main.js");
  const openIdx = m.index + m[0].length - 1; // the matched trailing '{'
  const closeIdx = findMatchingBracket(masked, openIdx, '{', '}');
  assert.notEqual(closeIdx, -1, "unbalanced win.on('close') handler body");
  return masked.slice(openIdx, closeIdx + 1);
}

test('AC4 reading 1 — tearoffOverlay.teardown() is called inside the win.on(close) handler', () => {
  const masked = maskComments(fs.readFileSync(MAIN, 'utf8'));
  const body = closeHandlerBody(masked);
  assert.match(
    body,
    /tearoffOverlay\.teardown\(/,
    'the tear-off overlay must be torn down in the per-window `close` handler (the SOLE ' +
      'destruction site) — a missing teardown leaks one WebContentsView per closed window'
  );
});

test('AC4 reading 2 — the tear-off overlay is created via createTearoffOverlayManager', () => {
  const masked = maskComments(fs.readFileSync(MAIN, 'utf8'));
  assert.match(
    masked,
    /createTearoffOverlayManager\(/,
    'the pill view must ride the shared per-window manager lifecycle, not an inlined view'
  );
});

// --- Regression insurance for the scan's own logic (synthetic strings — never real
// source mutation). Proves the net FAILS when the teardown is mutated out of the
// close handler, and PASSES when it is present. ------------------------------------

test('the scan FAILS a close handler missing the tearoffOverlay teardown', () => {
  const src = [
    'function createWindow() {',
    "  win.on('close', () => {",
    '    findOverlay.teardown();',
    '    sheet.teardown();', // tearoffOverlay.teardown() removed — the leak
    '  });',
    '}'
  ].join('\n');
  const body = closeHandlerBody(maskComments(src));
  assert.doesNotMatch(body, /tearoffOverlay\.teardown\(/);
});

test('the scan PASSES a close handler that tears the tear-off overlay down', () => {
  const src = [
    'function createWindow() {',
    "  win.on('close', () => {",
    '    findOverlay.teardown();',
    '    tearoffOverlay.teardown();',
    '    sheet.teardown();',
    '  });',
    '}'
  ].join('\n');
  const body = closeHandlerBody(maskComments(src));
  assert.match(body, /tearoffOverlay\.teardown\(/);
});

test('a teardown mention in a COMMENT does not satisfy the close-handler reading', () => {
  const src = [
    'function createWindow() {',
    "  win.on('close', () => {",
    '    findOverlay.teardown();',
    '    // tearoffOverlay.teardown() belongs here — but this is only a comment',
    '  });',
    '}'
  ].join('\n');
  const body = closeHandlerBody(maskComments(src));
  assert.doesNotMatch(body, /tearoffOverlay\.teardown\(/, 'the mask blanks the comment mention');
});
