'use strict';

// Source-scan wiring pins (squawk 0073 — "the session snapshot is written ONLY at
// before-quit / per-window close, so a hard kill loses every tab"). The fix's Electron-
// free MECHANICS (debounce/flush/cancel, dedupe, the boot-restore gate) are unit-tested
// directly in session-snapshot-scheduler.test.js / session-restore-gate.test.js — this
// file pins that every REQUIRED topology-changing call site actually ARMS the scheduler,
// in the house source-scan style (test/unit/session-restore-wiring.test.js,
// test/unit/move-tab-synchrony.test.js): read the real source, assert the property, then
// mutate the real source IN MEMORY (no file written) and assert the property flips — so
// a pin that would pass on an empty body is caught rather than passing vacuously.
//
// Missing one of these call sites is a SILENT staleness bug (the app keeps working; the
// on-disk snapshot just quietly stops tracking that one kind of topology change), so each
// site gets its own discriminating mutation rather than one aggregate count.
//
// REGEX-TARGET MUTATION PINS (CLAUDE.md, "Regex-target mutation pins", Flight 5 M17): the
// seven `.replace()` targets below that remove an ADDED `scheduleSnapshot?.()` arm site
// (tab-create / tab-close / tab-hide / tab-set-active / moveTabIntoWindow / did-navigate /
// did-navigate-in-page) are wrap-insensitive regexes, not exact multi-line string literals
// — `\s*` between tokens (a Prettier re-wrap of the long anchor statements can't silently
// stale the match), metacharacters escaped, and a captured anchor group so the replacement
// never re-types code that could itself drift from the source. Two pairs of sites
// (tab-hide/tab-set-active, did-navigate/did-navigate-in-page) share byte-identical Squawk
// 0073 comment text, so disambiguation comes from each regex's own distinguishing anchor
// statement, not the comment — and the did-navigate(-in-page) pair additionally bounds its
// non-greedy middle section with a negative lookahead against the next `wc.on(` so a scan
// can never cross from one handler's arm site into its sibling's. Every one of the seven
// was neuter-verified (real call site temporarily commented out, pin confirmed RED, call
// site restored, pin confirmed GREEN again) — see squawks/0073-… Verification.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const REGISTER_TAB_IPC = path.join(__dirname, '../../src/main/register-tab-ipc.js');
const GUEST_WIRING = path.join(__dirname, '../../src/main/guest-wiring.js');
const WINDOW_FACTORY = path.join(__dirname, '../../src/main/window-factory.js');
const APP_LIFECYCLE = path.join(__dirname, '../../src/main/app-lifecycle.js');
const MAIN_JS = path.join(__dirname, '../../src/main/main.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

/** The `{...}` body (incl. both braces) of the FIRST match of `anchorRe`, whose match
 * text must end at the body's opening `{`. Operates on already-masked text. */
function bodyAfterRe(masked, anchorRe, label) {
  const m = masked.match(anchorRe);
  assert.ok(m && m.index !== undefined, `anchor not found — re-anchor this pin: ${label}`);
  const braceIdx = m.index + m[0].length - 1;
  assert.equal(masked[braceIdx], '{', `anchor does not end at its opening brace: ${label}`);
  const end = findMatchingBracket(masked, braceIdx, '{', '}');
  assert.notEqual(end, -1, `unbalanced body for anchor: ${label}`);
  return masked.slice(braceIdx, end + 1);
}

/** The `(...)` call body (incl. both parens) of the FIRST match of `anchorRe`, whose
 * match text must start at (or before) the call's opening `(`. Used for guest-wiring's
 * multi-line `wc.on(\n  'event',\n  guard(() => {...}))` shape, which has no single
 * brace immediately after a fixed-text anchor. */
function callBodyAfterRe(masked, anchorRe, label) {
  const m = masked.match(anchorRe);
  assert.ok(m && m.index !== undefined, `anchor not found — re-anchor this pin: ${label}`);
  const openParen = masked.indexOf('(', m.index);
  assert.notEqual(openParen, -1, `no opening paren after anchor: ${label}`);
  const end = findMatchingBracket(masked, openParen, '(', ')');
  assert.notEqual(end, -1, `unbalanced call for anchor: ${label}`);
  return masked.slice(openParen, end + 1);
}

const CALL = 'scheduleSnapshot?.()';

// ---------------------------------------------------------------------------
// register-tab-ipc.js — deps destructure + five call sites.
// ---------------------------------------------------------------------------

test('register-tab-ipc.js destructures scheduleSnapshot from deps', () => {
  const masked = maskComments(read(REGISTER_TAB_IPC));
  assert.equal(/\bscheduleSnapshot\b/.test(masked), true, 'real → scheduleSnapshot is referenced');

  const mutated = read(REGISTER_TAB_IPC).replace(/^\s*scheduleSnapshot,\n/m, '');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'scheduleSnapshot-destructure-removed');
  assert.equal(
    /scheduleSnapshot,\n\s*logger\n\s*} = deps;/.test(maskComments(mutated)),
    false,
    'mutated → the destructure entry is gone and this pin FAILS'
  );
});

// Wrap-insensitive arm-site regexes (see the header note above): each captures the
// preceding anchor statement (group 1, kept in the mutated text) and matches through the
// trailing `// Squawk 0073: …` comment + `scheduleSnapshot?.();` call (dropped) — `\s*`
// between every token so a Prettier re-wrap of the (sometimes very long) anchor statement
// can't silently stale the match, and no code is re-typed in the replacement string.
// Mission 20 Flight 1 (AC2): the object literal grew two fields (`loadFailure`,
// `lastRequestedUrl`) — the anchor now matches through `lastRequestedUrl: …` rather
// than stopping dead at `active: false`, so a further field added later stays
// wrap-insensitive too. Mission 20 Flight 2 Leg 1 (#216): the object literal grew a
// THIRD field (`chromeNavPending`, plus its own provenance comment between it and
// `lastRequestedUrl`) — the tail is now a non-greedy `[\s\S]*?` through to the closing
// `});` instead of a fixed field list, so it tolerates both the interleaved comment and
// whatever further field a later leg adds, without re-widening this pin again.
const TAB_CREATE_ARM_RE =
  /(rec\.tabViews\.set\(\s*wcId,\s*\{\s*view,\s*partition:\s*trusted\s*\?\s*INTERNAL_PARTITION\s*:\s*partition,\s*trusted,\s*active:\s*false,\s*loadFailure:\s*null,\s*lastRequestedUrl:\s*initialLastRequestedUrl[\s\S]*?\}\s*\);)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;
const TAB_CLOSE_ARM_RE = /(owner\.tabViews\.delete\(\s*wcId\s*\);)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;
// tab-hide and tab-set-active share BYTE-IDENTICAL Squawk 0073 comment text ("`active` is
// part of the snapshot — …") — disambiguation comes entirely from each regex's own anchor
// statement (entry.active = false / the activeTabWcId null-out for tab-hide; the plain
// activeTabWcId assignment for tab-set-active), never from the comment.
const TAB_HIDE_ARM_RE =
  /(entry\.active\s*=\s*false;\s*if\s*\(owner\.activeTabWcId\s*===\s*wcId\)\s*owner\.activeTabWcId\s*=\s*null;)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;
const TAB_SET_ACTIVE_ARM_RE = /(owner\.activeTabWcId\s*=\s*wcId;)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;
// Bounded: the negative lookahead refuses to cross a subsequent `function `/`ipcMain.`
// boundary, so a scan starting inside moveTabIntoWindow can never run past its own body
// into a sibling handler's arm site.
const MOVE_ARM_RE =
  /(target\.tabViews\.set\(\s*p\.wcId,\s*entry\s*\);)(?:(?!\n\s*(?:function\s|ipcMain\.))[\s\S])*?scheduleSnapshot\?\.\(\);/;

test('tab-create arms the snapshot scheduler after the new tab lands in tabViews', () => {
  // Non-greedy up to the FIRST `) => {` — `[^{]*` would stop at the destructured
  // `{ url, partition, trusted, restoreHistory }` parameter's own brace instead of the
  // arrow function's body brace.
  const anchor = /ipcMain\.handle\(\s*'tab-create',[\s\S]*?\)\s*=>\s*\{/;
  const masked = maskComments(read(REGISTER_TAB_IPC));
  const body = bodyAfterRe(masked, anchor, 'tab-create');
  assert.equal(body.includes(CALL), true, 'real → tab-create arms the scheduler');
  assert.equal(TAB_CREATE_ARM_RE.test(read(REGISTER_TAB_IPC)), true, 'real → the arm-site regex matches');

  const mutated = read(REGISTER_TAB_IPC).replace(TAB_CREATE_ARM_RE, '$1');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'tab-create-schedule-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'tab-create').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
});

test('tab-close arms the snapshot scheduler after the closed tab leaves tabViews', () => {
  const anchor = /ipcMain\.on\(\s*'tab-close',[^{]*\{/;
  const masked = maskComments(read(REGISTER_TAB_IPC));
  const body = bodyAfterRe(masked, anchor, 'tab-close');
  assert.equal(body.includes(CALL), true, 'real → tab-close arms the scheduler');
  assert.equal(TAB_CLOSE_ARM_RE.test(read(REGISTER_TAB_IPC)), true, 'real → the arm-site regex matches');

  const mutated = read(REGISTER_TAB_IPC).replace(TAB_CLOSE_ARM_RE, '$1');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'tab-close-schedule-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'tab-close').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
});

test('tab-hide arms the snapshot scheduler (the active flag changed)', () => {
  const anchor = /ipcMain\.on\(\s*'tab-hide',[^{]*\{/;
  const masked = maskComments(read(REGISTER_TAB_IPC));
  const body = bodyAfterRe(masked, anchor, 'tab-hide');
  assert.equal(body.includes(CALL), true, 'real → tab-hide arms the scheduler');
  assert.equal(TAB_HIDE_ARM_RE.test(read(REGISTER_TAB_IPC)), true, 'real → the arm-site regex matches');

  const mutated = read(REGISTER_TAB_IPC).replace(TAB_HIDE_ARM_RE, '$1');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'tab-hide-schedule-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'tab-hide').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
  // The sibling tab-set-active site — sharing the SAME comment text — must be untouched.
  assert.equal(TAB_SET_ACTIVE_ARM_RE.test(mutated), true, 'mutated → tab-set-active’s own arm site survives');
});

test('tab-set-active arms the snapshot scheduler (the active flag changed)', () => {
  // Non-greedy up to the FIRST `) => {` — `[^{]*` would stop at the destructured
  // `{ wcId, bounds }` parameter's own brace instead of the arrow function's body brace.
  const anchor = /ipcMain\.on\(\s*'tab-set-active',[\s\S]*?\)\s*=>\s*\{/;
  const masked = maskComments(read(REGISTER_TAB_IPC));
  const body = bodyAfterRe(masked, anchor, 'tab-set-active');
  assert.equal(body.includes(CALL), true, 'real → tab-set-active arms the scheduler');
  assert.equal(TAB_SET_ACTIVE_ARM_RE.test(read(REGISTER_TAB_IPC)), true, 'real → the arm-site regex matches');

  const mutated = read(REGISTER_TAB_IPC).replace(TAB_SET_ACTIVE_ARM_RE, '$1');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'tab-set-active-schedule-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'tab-set-active').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
  // The sibling tab-hide site — sharing the SAME comment text — must be untouched.
  assert.equal(TAB_HIDE_ARM_RE.test(mutated), true, 'mutated → tab-hide’s own arm site survives');
});

test('the shared move core (moveTabIntoWindow) arms the snapshot scheduler — covers all four move/tear-off/adopt entry points', () => {
  const anchor = /function\s+moveTabIntoWindow\s*\([^)]*\)\s*\{/;
  const masked = maskComments(read(REGISTER_TAB_IPC));
  const body = bodyAfterRe(masked, anchor, 'moveTabIntoWindow');
  assert.equal(body.includes(CALL), true, 'real → the move core arms the scheduler');
  assert.equal(MOVE_ARM_RE.test(read(REGISTER_TAB_IPC)), true, 'real → the arm-site regex matches');

  const mutated = read(REGISTER_TAB_IPC).replace(MOVE_ARM_RE, '$1');
  assertMutated(read(REGISTER_TAB_IPC), mutated, 'move-core-schedule-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'moveTabIntoWindow').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// guest-wiring.js — deps destructure + did-navigate / did-navigate-in-page.
// ---------------------------------------------------------------------------

test('guest-wiring.js destructures scheduleSnapshot from deps', () => {
  const masked = maskComments(read(GUEST_WIRING));
  assert.equal(/\bscheduleSnapshot\b/.test(masked), true, 'real → scheduleSnapshot is referenced');

  const mutated = read(GUEST_WIRING).replace(/^\s*scheduleSnapshot,\n/m, '');
  assertMutated(read(GUEST_WIRING), mutated, 'scheduleSnapshot-destructure-removed');
  assert.equal(
    maskComments(mutated).includes('scheduleSnapshot,'),
    false,
    'mutated → the destructure entry is gone and this pin FAILS'
  );
});

// did-navigate and did-navigate-in-page share BYTE-IDENTICAL Squawk 0073 comment text
// ("the URL changed — …") AND an identical `getHistoryRecorder()?.handleNavigation(…)`
// call — disambiguation comes entirely from each regex's own `wc.on('did-navigate'` /
// `wc.on('did-navigate-in-page'` anchor prefix (the trailing comma after `'did-navigate'`
// cannot match inside the longer `'did-navigate-in-page'` string, so the two anchors are
// structurally exclusive — no lookahead needed to tell them apart). Each is still BOUNDED
// with a negative lookahead against a subsequent `wc.on(` registration, so if a handler's
// own arm site were ever missing, the non-greedy middle section could not silently walk
// forward into the NEXT handler's call and match there instead.
// Mission 20 Flight 1 (DD4/AC6): did-navigate's own handleNavigation call now reads
// the effectiveUrl-substituted local `url` (never a bare `wc.getURL()` — the census/
// history must never see a live chrome-error: document); did-navigate-in-page is
// UNCHANGED (AC6 — an in-page navigation cannot land on an error document), still
// `url: wc.getURL()`, which is exactly what disambiguates the two sibling anchors now
// that both are no longer byte-identical past their own `wc.on(` prefix.
const DID_NAVIGATE_ARM_RE =
  /(wc\.on\(\s*'did-navigate',(?:(?!\n\s*wc\.on\()[\s\S])*?getHistoryRecorder\(\)\?\.handleNavigation\(\{\s*wcId,\s*partition,\s*url\s*\}\);)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;
const DID_NAVIGATE_IN_PAGE_ARM_RE =
  /(wc\.on\(\s*'did-navigate-in-page',(?:(?!\n\s*wc\.on\()[\s\S])*?getHistoryRecorder\(\)\?\.handleNavigation\(\{\s*wcId,\s*partition,\s*url:\s*wc\.getURL\(\)\s*\}\);)\s*\/\/[^\n]*\n\s*scheduleSnapshot\?\.\(\);/;

test('did-navigate (top-level tab guest, not the popup variant) arms the snapshot scheduler', () => {
  // "wc.on(" — lowercase — never matches "popupWc.on(" (case-sensitive: that string
  // contains "Wc.on(" with a capital W), so this anchor is structurally scoped to
  // wireTabViewEvents' real-tab wiring, never the popup's slim event variant.
  const anchor = /wc\.on\(\s*'did-navigate',/;
  const masked = maskComments(read(GUEST_WIRING));
  const body = callBodyAfterRe(masked, anchor, 'did-navigate');
  assert.equal(body.includes(CALL), true, 'real → did-navigate arms the scheduler');
  assert.equal(DID_NAVIGATE_ARM_RE.test(read(GUEST_WIRING)), true, 'real → the arm-site regex matches');

  const mutated = read(GUEST_WIRING).replace(DID_NAVIGATE_ARM_RE, '$1');
  assertMutated(read(GUEST_WIRING), mutated, 'did-navigate-schedule-removed');
  assert.equal(
    callBodyAfterRe(maskComments(mutated), anchor, 'did-navigate').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
  // The sibling did-navigate-in-page site — same comment text, same handleNavigation call
  // shape — must be untouched.
  assert.equal(
    DID_NAVIGATE_IN_PAGE_ARM_RE.test(mutated),
    true,
    'mutated → did-navigate-in-page’s own arm site survives'
  );
});

test('did-navigate-in-page (top-level tab guest) arms the snapshot scheduler', () => {
  const anchor = /wc\.on\(\s*'did-navigate-in-page',/;
  const masked = maskComments(read(GUEST_WIRING));
  const body = callBodyAfterRe(masked, anchor, 'did-navigate-in-page');
  assert.equal(body.includes(CALL), true, 'real → did-navigate-in-page arms the scheduler');
  assert.equal(DID_NAVIGATE_IN_PAGE_ARM_RE.test(read(GUEST_WIRING)), true, 'real → the arm-site regex matches');

  const mutated = read(GUEST_WIRING).replace(DID_NAVIGATE_IN_PAGE_ARM_RE, '$1');
  assertMutated(read(GUEST_WIRING), mutated, 'did-navigate-in-page-schedule-removed');
  assert.equal(
    callBodyAfterRe(maskComments(mutated), anchor, 'did-navigate-in-page').includes(CALL),
    false,
    'mutated → the call is gone and this pin FAILS'
  );
  // The sibling did-navigate site — same comment text, same handleNavigation call shape —
  // must be untouched.
  assert.equal(DID_NAVIGATE_ARM_RE.test(mutated), true, 'mutated → did-navigate’s own arm site survives');
});

// ---------------------------------------------------------------------------
// window-factory.js — deps destructure + new-window creation.
// ---------------------------------------------------------------------------

test('window-factory.js destructures scheduleSnapshot and arms it at the end of createWindow()', () => {
  const masked = maskComments(read(WINDOW_FACTORY));
  assert.equal(/\bscheduleSnapshot\b/.test(masked), true, 'real → scheduleSnapshot is referenced');
  assert.equal(masked.includes(CALL), true, 'real → createWindow() arms the scheduler');

  const mutated = read(WINDOW_FACTORY).replace(
    '// Squawk 0073: a new window is new topology — debounced snapshot re-arm.\n    scheduleSnapshot?.();\n\n    return record;',
    'return record;'
  );
  assertMutated(read(WINDOW_FACTORY), mutated, 'new-window-schedule-removed');
  assert.equal(maskComments(mutated).includes(CALL), false, 'mutated → the call is gone and this pin FAILS');
});

// ---------------------------------------------------------------------------
// app-lifecycle.js — before-quit flush + bootConfigServedAt timestamp.
// ---------------------------------------------------------------------------

test('before-quit calls flushSessionSnapshotScheduler before the existing unconditional write', () => {
  const anchor = /app\.on\(\s*'before-quit',\s*\(\)\s*=>\s*\{/;
  const masked = maskComments(read(APP_LIFECYCLE));
  const body = bodyAfterRe(masked, anchor, 'before-quit');
  const flushIdx = body.indexOf('flushSessionSnapshotScheduler()');
  const writeIdx = body.indexOf('sessionStore.write(');
  assert.notEqual(flushIdx, -1, 'real → before-quit calls flushSessionSnapshotScheduler()');
  assert.notEqual(writeIdx, -1, 'real → before-quit still does its own unconditional write');
  assert.ok(flushIdx < writeIdx, 'real → flush() runs BEFORE the existing write (timer cancelled first)');

  const mutated = read(APP_LIFECYCLE).replace(
    /try \{\s*flushSessionSnapshotScheduler\(\);\s*\} catch \(error\) \{\s*logger\.error\([^)]*\);\s*\}\s*/,
    ''
  );
  assertMutated(read(APP_LIFECYCLE), mutated, 'before-quit-flush-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'before-quit').includes('flushSessionSnapshotScheduler()'),
    false,
    'mutated → the flush call is gone and this pin FAILS'
  );
});

test('window-boot-config timestamps rec.bootConfigServedAt (the settle-timeout reference point)', () => {
  const anchor = /ipcMain\.handle\(\s*'window-boot-config',\s*\(event\)\s*=>\s*\{/;
  const masked = maskComments(read(APP_LIFECYCLE));
  const body = bodyAfterRe(masked, anchor, 'window-boot-config');
  assert.equal(body.includes('rec.bootConfigServedAt = Date.now();'), true, 'real → the timestamp is stamped');

  const mutated = read(APP_LIFECYCLE).replace('rec.bootConfigServedAt = Date.now();\n', '');
  assertMutated(read(APP_LIFECYCLE), mutated, 'boot-config-served-at-removed');
  assert.equal(
    bodyAfterRe(maskComments(mutated), anchor, 'window-boot-config').includes('rec.bootConfigServedAt'),
    false,
    'mutated → the timestamp is gone and this pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// main.js — the scheduler is actually constructed and threaded into every deps object.
// ---------------------------------------------------------------------------

test('main.js constructs the scheduler and threads it into all four deps objects', () => {
  const masked = maskComments(read(MAIN_JS));
  assert.equal(masked.includes('createSessionSnapshotScheduler('), true, 'real → the scheduler is constructed');
  const threadCount = (masked.match(/scheduleSnapshot:\s*scheduleSessionSnapshot/g) || []).length;
  assert.equal(threadCount, 3, 'real → threaded into createWindowFactory, createGuestWiring, registerTabIpc');
  assert.equal(
    masked.includes('flushSessionSnapshotScheduler: () => sessionSnapshotScheduler.flush()'),
    true,
    'real → threaded into registerAppLifecycle'
  );

  const mutated = read(MAIN_JS).replace(/const sessionSnapshotScheduler = createSessionSnapshotScheduler\(\{/, '');
  // The construction call itself is intentionally left dangling by this replace (the
  // point is only to prove the scan is non-vacuous, never to produce runnable code) —
  // so this pin re-scans a STRING slice of the file rather than requiring it.
  assertMutated(read(MAIN_JS), mutated, 'scheduler-construction-removed');
  assert.equal(
    maskComments(mutated).includes('createSessionSnapshotScheduler({'),
    false,
    'mutated → the construction call is gone and this pin FAILS'
  );
});
