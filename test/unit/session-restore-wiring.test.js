'use strict';

// Session-restore wiring pins (M09 Flight 9, Leg 3). Main/renderer composition claims
// remain narrow masked source checks; the extracted window factory's close-time setting
// gate and snapshot-before-destroy order run through a strict fake-window harness.
//
// Two readings per AC (DD10), on the REAL source, mutated IN MEMORY (no file written):
// the real source reads as claimed; a described mutation flips the reading, proving the scan
// is not vacuous. The DISCRIMINATION comes from the mutation flipping the reading — that is
// what makes each scan non-vacuous, not any single count in isolation.
//
// MASKING (leg-1's source-scan helper) is applied and is CORRECT for src/main/main.js, whose
// documented regex-literal blind-spot pattern reads 0 (source-scan.js header): the main.js
// bodies below (whenReady, before-quit, window-boot-config) mask cleanly, so a comment
// that happens to name a scanned token cannot trip those scans. src/renderer/renderer.js is
// DIFFERENT: it trips maskComments' documented regex-literal blind spot BEFORE the boot loop,
// so masking is unreliable in that region. The renderer scans below are therefore designed to
// extract a PURE-CODE branch body — the restore branch's descriptive comments (which name
// restoreHistory / inheritContainerFromPartition in prose) are deliberately kept OUTSIDE the
// `if (…restoreTabs…) { … }` braces, so the extracted body carries no comment text and no
// quote characters, and findMatchingBracket balances regardless of the upstream mask state.
// The mutations inject/remove CODE, so they flip the reading independent of masking.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');
const { createHarness } = require('./helpers/window-factory-harness');

const MAIN_JS = path.join(__dirname, '../../src/main/app-lifecycle.js');
const RENDERER_JS = path.join(__dirname, '../../src/renderer/renderer.js');

/** The real main.js, read fresh. @returns {string} */
function mainSource() {
  return fs.readFileSync(MAIN_JS, 'utf8');
}
/** The real renderer.js, read fresh. @returns {string} */
function rendererSource() {
  return fs.readFileSync(RENDERER_JS, 'utf8');
}

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

// Extract the brace-matched body that FOLLOWS a unique literal anchor whose LAST char is the
// opening `{` (every anchor below ends in `=> {` or `) {`). Operates on already-masked text.
/** @returns {string} the `{...}` slice including both braces */
function bodyAfter(masked, anchor) {
  const at = masked.indexOf(anchor);
  assert.notEqual(at, -1, `anchor not found — re-anchor this pin: ${anchor}`);
  const braceIdx = at + anchor.length - 1; // the anchor's trailing '{'
  assert.equal(masked[braceIdx], '{', `anchor does not end at its opening brace: ${anchor}`);
  const end = findMatchingBracket(masked, braceIdx, '{', '}');
  assert.notEqual(end, -1, `unbalanced body for anchor: ${anchor}`);
  return masked.slice(braceIdx, end + 1);
}

// The text in the `span` chars immediately BEFORE `needle` in `body` — used to answer
// "is this call settings-gated?" (does its preceding window carry the restoreSession guard?).
function precedingWindow(body, needle, span = 90) {
  const idx = body.indexOf(needle);
  assert.notEqual(idx, -1, `needle not found in body: ${needle}`);
  return body.slice(Math.max(0, idx - span), idx);
}

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

// --- anchors (pure code; identical masked and unmasked) ---
const WHENREADY = 'const ready = app.whenReady().then(() => {';
const BEFORE_QUIT = "app.on('before-quit', () => {";
const BOOT_CONFIG = "ipcMain.handle('window-boot-config', (event) => {";
const REBUILD_BRANCH = 'if (restoreSnapshot) {';
const RENDERER_BRANCH =
  'if (bootConfig && Array.isArray(bootConfig.restoreTabs) && bootConfig.restoreTabs.length) {';

const GUARD = "settings.get('restoreSession')";
const LOAD_STMT = 'sessionStore.load(userDataPath);';
const READ_TERNARY = "settings.get('restoreSession') === true ? sessionStore.read() : null";
const BQ_GUARD_EXPR = "settings.get('restoreSession') === true && registry.records().length";
const WRITE_CALL = 'sessionStore.write(';

// ---------------------------------------------------------------------------
// AC2 — sessionStore.load() is wired in whenReady, UNCONDITIONALLY (not settings-gated).
// ---------------------------------------------------------------------------

test('AC2: whenReady calls sessionStore.load — masked, real → 1, deleted → 0', () => {
  const body = bodyAfter(maskComments(mainSource()), WHENREADY);
  assert.equal(count(body, 'sessionStore.load('), 1, 'load() is wired in whenReady (masked)');

  const mutated = mainSource().replace(LOAD_STMT, '');
  assertMutated(mainSource(), mutated, 'load-deleted');
  assert.equal(count(bodyAfter(maskComments(mutated), WHENREADY), 'sessionStore.load('), 0, 'deleted → gone');
});

test('AC2: sessionStore.load is NOT settings-gated — real → ungated, wrapping in a guard → gated', () => {
  const realPre = precedingWindow(bodyAfter(maskComments(mainSource()), WHENREADY), 'sessionStore.load(');
  assert.equal(realPre.includes('restoreSession'), false, 'real → load() is not behind a restoreSession guard');

  // Wrap the load in a setting guard (the exact AC6-violating mutation): its preceding window
  // now carries the guard, so the "ungated" reading flips.
  const mutated = mainSource().replace(
    LOAD_STMT,
    "if (settings.get('restoreSession') === true) " + LOAD_STMT
  );
  assertMutated(mainSource(), mutated, 'load-gated');
  const mutPre = precedingWindow(bodyAfter(maskComments(mutated), WHENREADY), 'sessionStore.load(');
  assert.equal(mutPre.includes('restoreSession'), true, 'mutated → load() is now gated and this pin FAILS');
});

// ---------------------------------------------------------------------------
// AC3 — both write sites settings-gated; the close-site write precedes the destroy.
// ---------------------------------------------------------------------------

test('AC3: the before-quit write is settings-gated — real → gated, guard removed → ungated', () => {
  const realBody = bodyAfter(maskComments(mainSource()), BEFORE_QUIT);
  assert.equal(count(realBody, WRITE_CALL), 1, 'before-quit writes the snapshot (masked)');
  assert.equal(
    precedingWindow(realBody, WRITE_CALL).includes('restoreSession'),
    true,
    'real → the before-quit write is behind the restoreSession guard'
  );

  const mutated = mainSource().replace(BQ_GUARD_EXPR, 'registry.records().length');
  assertMutated(mainSource(), mutated, 'before-quit-guard-removed');
  assert.equal(
    precedingWindow(bodyAfter(maskComments(mutated), BEFORE_QUIT), WRITE_CALL).includes('restoreSession'),
    false,
    'mutated → the guard is gone and this pin FAILS'
  );
});

test('AC3: close snapshot is settings-gated and precedes guest destruction at runtime', () => {
  let enabled = false;
  const h = createHarness({ settings: { get: () => enabled } });
  const first = h.factory.createWindow();
  first.win.emit('close');
  assert.equal(h.log.includes('snapshot-write'), false, 'disabled → close does not write');

  enabled = true;
  const second = h.factory.createWindow();
  const guest = new h.FakeWebContentsView({});
  second.tabViews.set(guest.webContents.id, { view: guest, trusted: false });
  h.log.length = 0;
  second.win.emit('close');
  const write = h.log.indexOf('snapshot-write');
  const destroy = h.log.indexOf(`destroy-wc:${guest.webContents.id}`);
  assert.notEqual(write, -1, 'enabled → close writes');
  assert.notEqual(destroy, -1, 'guest is destroyed');
  assert.ok(write < destroy, 'snapshot is written while guest state is still live');

  const quitting = createHarness({
    settings: { get: () => true },
    isSessionQuitting: () => true
  });
  quitting.factory.createWindow().win.emit('close');
  assert.equal(quitting.log.includes('snapshot-write'), false, 'before-quit ownership suppresses close writes');
});

// ---------------------------------------------------------------------------
// AC4 — the whenReady restore read is settings-gated; boot-config serves restoreTabs;
// no adopt (removeChildView/addChildView) on the whenReady rebuild branch.
// ---------------------------------------------------------------------------

test('AC4: the whenReady restore read is settings-gated — real → gated, ungated → fails', () => {
  const realBody = bodyAfter(maskComments(mainSource()), WHENREADY);
  assert.equal(count(realBody, 'sessionStore.read()'), 1, 'whenReady reads the snapshot (masked)');
  assert.equal(
    precedingWindow(realBody, 'sessionStore.read()').includes('restoreSession'),
    true,
    'real → read() is behind the restoreSession guard (off ⇒ read() is never called)'
  );

  const mutated = mainSource().replace(READ_TERNARY, 'sessionStore.read()');
  assertMutated(mainSource(), mutated, 'read-ungated');
  assert.equal(
    precedingWindow(bodyAfter(maskComments(mutated), WHENREADY), 'sessionStore.read()').includes('restoreSession'),
    false,
    'mutated → read() is unconditional and this pin FAILS'
  );
});

test('AC4: window-boot-config returns restoreTabs — real → present, stripped → absent', () => {
  const realBody = bodyAfter(maskComments(mainSource()), BOOT_CONFIG);
  assert.equal(realBody.includes('restoreTabs'), true, 'real → boot-config serves restoreTabs to the renderer');

  const mutated = mainSource().replace(
    "return rec.restoreTabs\n      ? { bootTab: false, restoreTabs: rec.restoreTabs }\n      : { bootTab: !rec.noBootTab };",
    'return { bootTab: !rec.noBootTab };'
  );
  assertMutated(mainSource(), mutated, 'boot-config-restoreTabs-stripped');
  assert.equal(
    bodyAfter(maskComments(mutated), BOOT_CONFIG).includes('restoreTabs'),
    false,
    'mutated → boot-config no longer serves restoreTabs and this pin FAILS'
  );
});

test('AC4: the whenReady rebuild branch uses NO adopt path — real → absent, injected → present', () => {
  const realBody = bodyAfter(maskComments(mainSource()), REBUILD_BRANCH);
  assert.equal(realBody.includes('addChildView'), false, 'real → the rebuild never adopts (addChildView)');
  assert.equal(realBody.includes('removeChildView'), false, 'real → the rebuild never adopts (removeChildView)');

  const mutated = mainSource().replace(
    'rec.restoreTabs = savedWindow.tabs;',
    'rec.restoreTabs = savedWindow.tabs; win.contentView.addChildView(x);'
  );
  assertMutated(mainSource(), mutated, 'adopt-injected-into-rebuild');
  assert.equal(
    bodyAfter(maskComments(mutated), REBUILD_BRANCH).includes('addChildView'),
    true,
    'injected → an adopt call appears on the rebuild branch and this pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// AC5 — the renderer restore branch: resolveRestoreContainer + createTab, continue on null,
// and NO restoreHistory / NO inheritContainerFromPartition / NO adopt on this path.
// ---------------------------------------------------------------------------

test('AC5: the restore branch calls resolveRestoreContainer + createTab and drops (continue) on null', () => {
  const realBody = bodyAfter(maskComments(rendererSource()), RENDERER_BRANCH);
  assert.equal(realBody.includes('resolveRestoreContainer('), true, 'real → resolves the jar via the pure helper');
  assert.equal(realBody.includes('createTab('), true, 'real → creates each saved tab fresh');
  assert.equal(realBody.includes('continue'), true, 'real → drops (continue) when the jar no longer resolves');

  // Remove the drop: the deleted-jar entry would fall through to createTab with a null
  // container — the privacy-critical home-substitution DD4 forbids.
  const mutated = rendererSource().replace('if (!container) continue;', 'if (!container) void 0;');
  assertMutated(rendererSource(), mutated, 'drop-removed');
  assert.equal(
    bodyAfter(maskComments(mutated), RENDERER_BRANCH).includes('continue'),
    false,
    'mutated → the drop is gone and this pin FAILS'
  );
});

test('AC5: the restore branch references NO restoreHistory and NO inheritContainerFromPartition (masked)', () => {
  const realBody = bodyAfter(maskComments(rendererSource()), RENDERER_BRANCH);
  assert.equal(realBody.includes('restoreHistory'), false, 'real (masked) → no restoreHistory on the restore path (DD5)');
  assert.equal(
    realBody.includes('inheritContainerFromPartition'),
    false,
    'real → no inheritContainerFromPartition (its default-jar fallback would re-home a deleted jar, DD4)'
  );
  assert.equal(realBody.includes('addChildView'), false, 'real → no adopt (addChildView) — tabs are created fresh');
  assert.equal(realBody.includes('removeChildView'), false, 'real → no adopt (removeChildView)');

  // Inject the forbidden inheritContainerFromPartition onto the path.
  const mutated = rendererSource().replace(
    'const container = resolveRestoreContainer(t.jarId, jarsClient.containers);',
    'const container = jarsClient.inheritContainerFromPartition(t.jarId);'
  );
  assertMutated(rendererSource(), mutated, 'inherit-injected');
  assert.equal(
    bodyAfter(maskComments(mutated), RENDERER_BRANCH).includes('inheritContainerFromPartition'),
    true,
    'injected → the forbidden re-home helper appears and this pin FAILS'
  );
});

// ---------------------------------------------------------------------------
// AC6 — all three behavioral touch points are settings-gated, and load() is NOT.
// Main owns read + before-quit; the extracted close path is runtime-pinned above.
// ---------------------------------------------------------------------------

test('AC6: main keeps the read/before-quit guards; close gating is runtime-pinned above', () => {
  assert.equal(count(maskComments(mainSource()), GUARD), 2, 'main owns the read and before-quit guards');

  // Removing the read guard (one of the three) drops the count — the default-off byte-identity
  // guarantee weakens the instant any one guard is lost.
  const mutated = mainSource().replace(READ_TERNARY, 'sessionStore.read()');
  assertMutated(mainSource(), mutated, 'one-guard-removed');
  assert.equal(count(maskComments(mutated), GUARD), 1, 'mutated → a main lifecycle guard is gone');
});

test('AC6: the guard is on read()/write()/write() but NOT on load()', () => {
  const body = bodyAfter(maskComments(mainSource()), WHENREADY);
  // load() ungated (reasserted here as the AC6 half AC2 also pins).
  assert.equal(precedingWindow(body, 'sessionStore.load(').includes('restoreSession'), false, 'load() ungated');
  // read() gated.
  assert.equal(precedingWindow(body, 'sessionStore.read()').includes('restoreSession'), true, 'read() gated');
});

// ---------------------------------------------------------------------------
// The renderer restore branch extracts as a PURE-CODE body — the descriptive comment that
// names restoreHistory in prose is kept OUTSIDE the branch, so the branch body (which the AC5
// scans read) genuinely carries no restoreHistory text and findMatchingBracket balances even
// though renderer.js's mask is unreliable in this region. This test PROVES that property: the
// comment naming restoreHistory sits before the `if`, NOT inside the extracted body.
// ---------------------------------------------------------------------------

test('the renderer restore branch body is pure code — no comment text, no quote chars', () => {
  const branch = bodyAfter(maskComments(rendererSource()), RENDERER_BRANCH);
  // The prose "restoreHistory" mention lives in the comment ABOVE the branch, so it is absent
  // from the extracted body — which is exactly why the AC5 exclude-scans are robust here.
  assert.equal(branch.includes('restoreHistory'), false, 'branch body carries no restoreHistory prose');
  // No quote characters in the body → findMatchingBracket can never desync on a stray apostrophe
  // even when the upstream mask is inverted (the reason the comments are kept outside).
  assert.equal(/['"`]/.test(branch), false, 'branch body has no quote characters');
  // And the naming comment really does exist just above the branch (the reader is not misled).
  const anchorAt = rendererSource().indexOf(RENDERER_BRANCH);
  const preamble = rendererSource().slice(Math.max(0, anchorAt - 900), anchorAt);
  assert.ok(preamble.includes('restoreHistory'), 'the branch preamble comment names restoreHistory');
});
