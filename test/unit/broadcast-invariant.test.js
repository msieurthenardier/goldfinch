'use strict';

// DD8 broadcast-invariant net (M06 Flight 4, Leg 1) — a self-deriving source-scan
// test asserting the project convention the F7 bug violated (CLAUDE.md "Convention
// — settings writes from a handler must broadcast"): every IPC handler body that
// mutates settings (directly via `settings.set(`, or transitively via a helper
// that does — `mintJarKey(` / `revokeJarKey(` / `mintAdminKey(` / `revokeAdminKey(`)
// must broadcast `settings-changed` in that SAME body. The net derives its handler
// inventory from the source itself (never a hand-kept list), so a new mutating
// handler added later without a broadcast makes this test fail WITHOUT anyone
// editing it.
//
// Two extraction strategies, one per file (leg spec implementation guidance):
//   - src/main/main.js: every handler is registered with an INLINE callback
//     (`ipcMain.handle('chan', (…) => {…})` / `ipcMain.on(…)` /
//     `registerInternalHandler(ipcMain, 'chan', (…) => {…})`), so the callback
//     body is scanned right at the REGISTRATION SITE — paren-balanced from the
//     call's opening '(' to its matching ')'.
// Jar IPC was moved to domain registrars by issue #99. Its mutation/broadcast
// contract is now exercised through captured runtime handlers below rather
// than parsing a facade or a god file.
//
// The extraction is deliberately dumb (a convention tripwire, not a parser), but
// two real footguns are guarded against explicitly:
//   1. Comments that happen to CONTAIN registration-shaped text (main.js:996 has
//      a doc comment literally reading `ipcMain.handle('tab-create')`, which
//      would otherwise register a bogus, coincidentally-balanced match) — fixed
//      by masking out // and /* */ comment bodies (replaced with spaces,
//      newlines preserved so offsets/labels stay accurate) before any regex or
//      bracket-balance scan runs.
//   2. Marker text that happens to appear only inside a comment INSIDE a real
//      handler body (e.g. a body that mentions "settings.set(" in a doc comment
//      without calling it) — fixed by running the mutatesSettings /
//      broadcastsSettingsChanged marker checks against the SAME masked text, so
//      only live code can trip (or satisfy) the net.
// String literal contents are left untouched by the mask (so `'http://...'`
// keeps its `//`; the string branch intentionally never re-enters comment
// detection while inside quotes).
//
// This file ORIGINATED maskComments + findMatchingBracket (M06 F4 L1) and carried them
// locally until M09 F8 leg 1 extracted them to test/helpers/source-scan.js — proving the
// move by BYTE-IDENTITY of the function bodies rather than by "the suite still passes".
// This file's copies are the ones that survived the extraction verbatim; see the helper's
// header for that ruling and for maskComments's known regex-literal blind spot.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');
const { makeHarness } = require('./helpers/jar-ipc-harness');

const MAIN_JS = path.join(__dirname, '../../src/main/main.js');

const MUTATION_MARKERS = ['settings.set(', 'mintJarKey(', 'revokeJarKey(', 'mintAdminKey(', 'revokeAdminKey('];
const BROADCAST_MARKER = 'settings-changed';

// Deliberate exceptions (leg spec: "explicit in-test allowlist entry with a
// comment"). Empty by design: the automation:set-port gap this net found (DD8)
// is FIXED in this same leg (main.js's automation:set-port handler now
// broadcasts settings-changed), so the net passes with ZERO allowlist entries —
// pinned by the dedicated test below.
/** @type {Set<string>} */
const ALLOWLIST = new Set([]);

/** @param {string} slice */
function mutatesSettings(slice) {
  return MUTATION_MARKERS.some((m) => slice.includes(m));
}

/** @param {string} slice */
function broadcastsSettingsChanged(slice) {
  return slice.includes(BROADCAST_MARKER);
}

// ---------------------------------------------------------------------------
// main.js: registration-site extraction
// ---------------------------------------------------------------------------
const REGISTRATION_RE = /\bipcMain\.handle\(|\bipcMain\.on\(|\bregisterInternalHandler\(ipcMain,/g;

/**
 * @param {string} source
 * @returns {Array<{ label: string, slice: string }>}
 */
function extractMainRegistrations(source) {
  const masked = maskComments(source);
  /** @type {Array<{ label: string, slice: string }>} */
  const out = [];
  let m;
  REGISTRATION_RE.lastIndex = 0;
  while ((m = REGISTRATION_RE.exec(masked))) {
    // Every matched prefix's own '(' is the call's opening paren (true for both
    // `ipcMain.handle(` / `ipcMain.on(`, where it's the last matched char, and
    // `registerInternalHandler(ipcMain,`, where it's the first '(' after the
    // callee name) — so just take the first '(' from the match start.
    const openIdx = masked.indexOf('(', m.index);
    const closeIdx = findMatchingBracket(masked, openIdx, '(', ')');
    assert.notEqual(closeIdx, -1, `unbalanced call starting at main.js offset ${m.index}`);
    const origSlice = source.slice(m.index, closeIdx + 1);
    const maskedSlice = masked.slice(m.index, closeIdx + 1);
    const chanMatch = origSlice.match(/'([^']+)'/);
    out.push({ label: chanMatch ? chanMatch[1] : `<offset ${m.index}>`, slice: maskedSlice });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The net
// ---------------------------------------------------------------------------
test('every settings-mutating IPC handler in main.js broadcasts settings-changed in the same body', () => {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  const registrations = extractMainRegistrations(source);
  // Sanity: fail loudly if the extraction itself breaks (e.g. a future refactor
  // changes the registration shape) rather than silently scanning zero handlers.
  assert.ok(registrations.length > 40, `expected dozens of main.js registrations, found ${registrations.length}`);

  const violations = registrations
    .filter((r) => mutatesSettings(r.slice) && !broadcastsSettingsChanged(r.slice))
    .filter((r) => !ALLOWLIST.has(r.label))
    .map((r) => r.label);
  assert.deepEqual(violations, [], `handler(s) mutate settings without broadcasting settings-changed: ${violations.join(', ')}`);
});

test('jar removal revokes settings then broadcasts settings-changed before jars-changed', async (t) => {
  const harness = makeHarness(t);
  const result = await harness.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.deepEqual(
    harness.events
      .filter((event) => event.fn === 'revokeJarKey' || event.fn === 'broadcast')
      .map((event) => (event.fn === 'broadcast' ? event.channel : event.fn)),
    ['revokeJarKey', 'settings-changed', 'jars-changed']
  );
});

test('the allowlist is empty — the automation:set-port gap this net found is fixed, not allowlisted', () => {
  assert.equal(ALLOWLIST.size, 0);
});

// ---------------------------------------------------------------------------
// Regression insurance for the net's masking/marker logic itself (does not
// touch real source — the leg's manual "remove a broadcast and re-run" sanity
// check is a Verification Step done by hand, not committed as a mutation test).
// ---------------------------------------------------------------------------
test('mutatesSettings/broadcastsSettingsChanged classify a synthetic mutating-without-broadcasting handler', () => {
  const bad = "ipcMain.handle('x', () => { settings.set('k', 1); return true; })";
  const good = "ipcMain.handle('x', () => { settings.set('k', 1); broadcastToChromeAndInternal('settings-changed', settings.getAll()); })";
  assert.equal(mutatesSettings(bad), true);
  assert.equal(broadcastsSettingsChanged(bad), false);
  assert.equal(mutatesSettings(good), true);
  assert.equal(broadcastsSettingsChanged(good), true);
});

test('maskComments blanks comment bodies but leaves string literal contents (incl. embedded //) untouched', () => {
  // The URL string lives in real CODE here (not inside the comment) — a // line
  // comment legitimately consumes everything to the newline, quotes included, so
  // testing "strings survive" requires the string to sit outside the comment.
  const src = "const url = 'http://x'; // settings.set(  not real code\nconst b = /* mintJarKey( */ 2;";
  const masked = maskComments(src);
  assert.equal(masked.length, src.length);
  assert.ok(!masked.includes('settings.set('));
  assert.ok(!masked.includes('mintJarKey('));
  assert.ok(masked.includes("'http://x'")); // string content (with its own //) survives
  assert.ok(masked.includes('const url ='));
  assert.ok(masked.includes('const b ='));
});

test('a registration-shaped mention inside a comment (main.js:996 precedent) is not picked up as a real registration', () => {
  const src = "// see ipcMain.handle('tab-create') for details\nipcMain.handle('real-channel', () => {});";
  const registrations = extractMainRegistrations(src);
  assert.deepEqual(
    registrations.map((r) => r.label),
    ['real-channel']
  );
});
