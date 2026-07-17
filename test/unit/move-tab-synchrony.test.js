'use strict';

// DD1 synchrony pin (M09 Flight 8, Leg 1) — a source-scan test in the
// broadcast-invariant.test.js / window-closed-invariant.test.js house pattern, asserting
// the property DD1's "duplicate tabs are structurally impossible" claim rests on:
//
//   in the `tab-move-to-new-window` handler, NO SUSPENSION POINT may separate
//   `source.tabViews.delete(...)` from `target.tabViews.set(...)`.
//
// WHY THIS SHAPE. The two statements move a tab's registry entry between window records.
// Between them the tab exists in NEITHER record. Today that window is not observable,
// because the handler's callback is synchronous — no other code can run inside it. DD1's
// structural-impossibility claim is exactly that fact and nothing more.
//
// If an `await` enters between the two statements, the claim silently inverts: the
// handler yields with the tab in no record at all, and DD1 degrades from a LOUD duplicate
// (the bug it replaced) to a SILENT MISSING TAB — quieter than the bug it replaced, and
// squarely the S1 silent-success class. Until this pin landed, nothing in src/ said so and
// no test required main.js at all.
//
// WHAT IS PINNED, PRECISELY — and what is NOT. The pin forbids a SUSPENSION POINT
// between the delete and the set. It does NOT require the two statements to be ADJACENT:
// arbitrary SYNCHRONOUS code may sit between them, because synchronous code cannot
// suspend and therefore cannot expose the window. Stating the weaker, true property is
// deliberate — a pin whose prose claims more than it enforces is a proxy for the
// property, not the property.
//
// ANCHORING — on code identity, never a line number. Not the `F8` tag either
// (`grep -c "F8" src/main/main.js` → 17, verified; all M05/M06-era, NONE about this
// invariant).
//
// RE-ANCHORED BY M09 F8 LEG 3, AND THAT IS THIS PIN'S DESIGN WORKING, NOT A REGRESSION.
// Leg 1 anchored on the STRING LITERAL `'tab-move-to-new-window'` — the channel's
// identity — because the pair lived inside that ipcMain.handle callback. Leg 3 factored
// the move core OUT of that callback so drag tear-off and the menu path share one move,
// which is exactly the edit vacuity guard (b) below was written to catch. IT CAUGHT IT:
// run against leg 3's factored main.js, the leg-1 pin failed 4 of 8 with
//
//   the source.tabViews.delete(…) / target.tabViews.set(…) pair is no longer inside the
//   'tab-move-to-new-window' callback (delete found: false, set found: false, …)
//
// — a LOUD failure at the moment the invariant was most exposed, instead of the silent
// self-retirement an unguarded pin would have delivered. The subject did not move; only
// its home did, so the pin was re-anchored rather than deleted.
//
// The anchor is now the FUNCTION `moveTabIntoWindow` — the pair's home, and the same kind
// of thing the channel literal was: a name that cannot drift without the code's own
// identity changing. The channel literal is still asserted (guard (c)) because the handler
// must still reach the core: a renamed channel is now a DIFFERENT failure from a moved
// pair, and the pin says which.
//
// RE-ANCHORED AGAIN BY LEG 4, AND AGAIN THAT IS THE DESIGN WORKING. Leg 4 needed the core
// to move a tab into an EXISTING window as well as a new one, so the core was generalized
// over its target (`resolveTarget`) and RENAMED `moveTabIntoNewWindow` → `moveTabIntoWindow`
// — the old name would have been a lie the moment the target stopped always being new.
// Guard (a) caught the rename immediately: 9 of 11 failed against the renamed core, naming
// the missing anchor rather than passing on nothing. The PAIR never moved this time (leg 4
// deliberately kept it inside one synchronous function rather than factoring it a second
// time), so guard (b) is untouched; only the anchor's spelling and the call-site count
// changed. A pin that had been anchored on a LINE, or that had silently tolerated a missing
// anchor, would have retired itself here.
//
// WHY NOT A LINE NUMBER — measured, because the leg's own version of this claim was wrong.
// F7's artifacts recorded the pair at FOUR different lines: 2699-2700 (flight.md),
// 2639-2640 (leg 2's "correction"), 2712-2713 (leg 3), 2756-2757 (the debrief). The leg
// authorising this pin said all four were wrong. They were not: the fourth was CORRECT at
// this leg's start. Three of four is the true number — and the honest half of the story is
// that the site comment THIS leg added pushed the pair to 2764-2765, invalidating the one
// citation that was right. That is the argument for identity-anchoring, and it is stronger
// measured than overstated: a line number is not wrong because authors are careless, it is
// wrong because the NEXT edit above it moves it, and this leg is the proof.
//
// SCOPE — all of src/main/**, not main.js alone. Leg 1 wrote the tree walk against the
// possibility that the factoring would land the core in a NEW module; it landed in main.js
// instead, but the walk is what made re-anchoring a one-line change rather than a redesign,
// and it stays: leg 4 may yet move it.
//
// THE VACUITY GUARDS ARE THE POINT. An unguarded pin that finds an anchor with no pair
// inside it PASSES ON AN EMPTY BODY — retiring itself silently at the exact moment the
// code it protects is most exposed. All three guards fail loud:
//   (a) the anchor `moveTabIntoWindow` occurs EXACTLY ONCE across src/main/** — a
//       rename or a deleted core fails HERE rather than passing on nothing;
//   (b) the delete/set pair IS PRESENT, in that order, inside the anchored body — this
//       is the guard that fired on leg 3's factoring and forced this re-anchor;
//   (c) the `'tab-move-to-new-window'` channel still exists and still reaches the core,
//       so a pin that anchors on a function no handler calls cannot pass.
//
// MASKING IS DEFENSIVE HERE, NOT LOAD-BEARING — and this file says so rather than
// inheriting the claim. The leg specified the mask on the grounds that main.js's own site
// comment names `await` and would otherwise trip this pin. MEASURED, and it does not: run
// against the real src/main/** tree with the mask swapped for the identity function, the
// pin reads IDENTICALLY (anchors 1, async false, pair true, awaitBetween false). Both
// premises fail — the site comment sits ABOVE the delete, outside the delete..set slice
// this pin actually inspects, and src/main/move-tab-payload.js spells the channel in
// BACKTICKS, which the quoted anchor never matches. A justification with equal readings in
// both directions is the exact shape this flight exists to catch, so it is not repeated.
//
// The mask is kept anyway, on the honest ground: it is free, it is the house idiom
// (broadcast-invariant.test.js documents this footgun about itself), and it is protective
// against edits leg 4 is plausibly about to make — a comment BETWEEN the pair mentioning
// `await`, or a quoted channel mention in prose, would both false-positive an unmasked
// pin. The synthetic reading below is what proves the mask works; the real tree does not
// currently exercise it.
//
// MUTATION TESTS BELOW MUTATE THE REAL SOURCE, IN MEMORY. The house pattern commits
// synthetic-string regression tests and leaves real-source mutation as a by-hand step.
// This file reads the REAL main.js, mutates the string, and scans the string — no file is
// ever written. DD10 asks for the instrument's reading "on the real artifact, in the same
// run, in both directions"; an in-memory mutation of the real file is exactly that, it
// costs nothing, and it means a mutation cannot silently stop being run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket, collectSources } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '../..');
const MAIN_DIR = path.join(REPO_ROOT, 'src/main');
const MAIN_JS = path.join(MAIN_DIR, 'main.js');

// The move core's name — the pin's anchor since leg 3, re-spelled at leg 4 (see the
// header). `\b`-bounded so the DEFINITION and the call sites are counted by the same token,
// and so the bound matters: an unbounded `moveTabIntoWindow` would also match a
// `moveTabIntoWindowSomething`, which is the kind of near-miss that makes a count lie.
const ANCHOR = 'moveTabIntoWindow';
const ANCHOR_RE = /\bmoveTabIntoWindow\b/g;
const DEFINITION_RE = /(?:\basync\s+)?function\s+moveTabIntoWindow\s*\(/;

// Guard (c): the channel must still exist and still reach the core. Quoted deliberately —
// the BARE substring also matches move-tab-payload.js's prose mention (masked out anyway),
// and the quoted form is what a registration must contain.
const CHANNEL = "'tab-move-to-new-window'";
const CHANNEL_RE = /'tab-move-to-new-window'/g;
const REGISTRATION_RE = /\bipcMain\.handle\(\s*'tab-move-to-new-window'\s*,/;

// Receiver-qualified deliberately: `tabViews.delete(` alone also matches main.js's
// unrelated owner.tabViews.delete(wcId) in the tab-close path.
const DELETE_MARKER = 'source.tabViews.delete(';
const SET_MARKER = 'target.tabViews.set(';

const SUSPENSION_RE = /\bawait\b/;

/**
 * Locate the anchored move core and judge it.
 *
 * `asyncFn` is detected on the CORE'S OWN DECLARATION — not on `async` appearing anywhere
 * in the body slice. The looser form false-positives on a nested async thunk
 * (`queueChromeSend(target, async () => …)`), which is a deferred callback run at delivery
 * time and NOT a suspension point of the core. main.js already contains two such thunks.
 *
 * The between-slice spans the delete's START to the set's start, so an `await` in the
 * delete's own arguments counts too — deliberately: that is also a suspension inside the
 * critical region.
 * @param {string} source
 * @param {string} label
 * @returns {{ anchors: number, channels: number, registrations: number, callsCore: boolean,
 *   core: null | { label: string, asyncFn: boolean, deleteFound: boolean, setFound: boolean,
 *   pairFound: boolean, awaitBetween: boolean, line: number, violations: string[] } }}
 */
function scanSource(source, label) {
  const masked = maskComments(source);
  const anchors = (masked.match(ANCHOR_RE) || []).length;
  const channels = (masked.match(CHANNEL_RE) || []).length;

  // Guard (c): the channel registration, and whether its body reaches the core. The
  // handler is no longer where the pair lives, so this is a REACHABILITY check, not the
  // synchrony check — a core no handler calls is a pin anchored on dead code.
  const reg = masked.match(REGISTRATION_RE);
  let registrations = 0;
  let callsCore = false;
  if (reg && reg.index !== undefined) {
    registrations = 1;
    const regBrace = masked.indexOf('{', reg.index);
    const regEnd = findMatchingBracket(masked, regBrace, '{', '}');
    assert.notEqual(regEnd, -1, `unbalanced ${CHANNEL} callback body in ${label}`);
    callsCore = masked.slice(regBrace, regEnd + 1).includes(`${ANCHOR}(`);
  }

  const m = masked.match(DEFINITION_RE);
  if (!m || m.index === undefined) return { anchors, channels, registrations, callsCore, core: null };

  const asyncFn = /^\s*async\b/.test(m[0]);
  const braceIdx = masked.indexOf('{', m.index + m[0].length);
  const bodyEnd = findMatchingBracket(masked, braceIdx, '{', '}');
  assert.notEqual(bodyEnd, -1, `unbalanced ${ANCHOR} body in ${label}`);
  const body = masked.slice(braceIdx, bodyEnd + 1);

  const dIdx = body.indexOf(DELETE_MARKER);
  const sIdx = body.indexOf(SET_MARKER);
  const pairFound = dIdx !== -1 && sIdx !== -1 && sIdx > dIdx;
  const awaitBetween = pairFound && SUSPENSION_RE.test(body.slice(dIdx, sIdx));

  /** @type {string[]} */
  const violations = [];
  if (asyncFn) {
    violations.push(
      `${label}: ${ANCHOR} is \`async\` — it may suspend between ` +
        `${DELETE_MARKER}…) and ${SET_MARKER}…), leaving the tab in NEITHER window record`
    );
  }
  if (awaitBetween) {
    violations.push(
      `${label}: a suspension point (\`await\`) separates ${DELETE_MARKER}…) from ` +
        `${SET_MARKER}…) — the tab is observably in no window record across that yield`
    );
  }

  return {
    anchors,
    channels,
    registrations,
    callsCore,
    core: {
      label,
      asyncFn,
      deleteFound: dIdx !== -1,
      setFound: sIdx !== -1,
      pairFound,
      awaitBetween,
      line: masked.slice(0, m.index).split('\n').length,
      violations
    }
  };
}

/**
 * Scan the real src/main/** tree.
 * @returns {{ anchors: number, channels: number, registrations: number, callsCore: boolean,
 *   cores: any[], violations: string[] }}
 */
function scanTree() {
  const files = collectSources(MAIN_DIR);
  // Sanity: fail loudly if the file walk itself breaks rather than scanning nothing.
  assert.ok(files.length > 5, `expected the src/main tree, found ${files.length} files`);

  let anchors = 0;
  let channels = 0;
  let registrations = 0;
  let callsCore = false;
  /** @type {any[]} */
  const cores = [];
  /** @type {string[]} */
  const violations = [];
  for (const file of files) {
    const res = scanSource(fs.readFileSync(file, 'utf8'), path.relative(REPO_ROOT, file));
    anchors += res.anchors;
    channels += res.channels;
    registrations += res.registrations;
    callsCore = callsCore || res.callsCore;
    if (res.core) {
      cores.push(res.core);
      violations.push(...res.core.violations);
    }
  }
  return { anchors, channels, registrations, callsCore, cores, violations };
}

// ---------------------------------------------------------------------------
// The net
// ---------------------------------------------------------------------------

test('no suspension point separates the tabViews delete from the set in the move core', () => {
  const { anchors, channels, registrations, callsCore, cores, violations } = scanTree();

  // Vacuity guard (a) — anchor presence. The expected violation count is ZERO, so a
  // vacuous pass (a renamed core, a deleted core, a broken mask) looks identical to a real
  // one. Asserting the core was DEFINED exactly once, and that its name occurs the exact
  // number of times the current call graph has (1 definition + the 2 handler call sites),
  // is what makes this fail loudly instead of passing for the wrong reason.
  assert.equal(cores.length, 1, `expected exactly ONE ${ANCHOR} definition (found ${cores.length})`);
  assert.equal(
    anchors,
    4,
    `expected the ${ANCHOR} token 4× in src/main/** — 1 definition + the menu, tear-off and ` +
      `cross-window-move call sites (found ${anchors}). A NEW caller is not a defect: bump ` +
      'this number once you have checked the new call site is a real one, and keep the ' +
      'guard. Leg 4 bumped it 3 → 4 for the DD8 cross-window move.'
  );

  // Vacuity guard (b) — pair presence. THIS is the guard that fired on leg 3's factoring.
  // If the pair leaves the anchored body again, this FAILS and forces a re-anchor to its
  // new home. Without it the pin would find an anchor with an empty body and pass,
  // retiring itself in silence.
  const h = cores[0];
  assert.equal(
    h.pairFound,
    true,
    `the ${DELETE_MARKER}…) / ${SET_MARKER}…) pair is no longer inside ${ANCHOR} ` +
      `(delete found: ${h.deleteFound}, set found: ${h.setFound}, in order: ` +
      `${h.deleteFound && h.setFound}). If the move core was factored again, RE-ANCHOR THIS ` +
      'PIN to the pair\'s new home — do not delete this test. The invariant did not move.'
  );

  // Vacuity guard (c) — reachability. The core is only worth pinning if the shipped IPC
  // surface still runs it. A pin anchored on a function no handler calls is a pin on dead
  // code, which passes forever and protects nothing.
  assert.equal(channels, 1, `expected EXACTLY ONE ${CHANNEL} anchor in src/main/** (found ${channels})`);
  assert.equal(registrations, 1, `expected exactly ONE ${CHANNEL} registration (found ${registrations})`);
  assert.equal(callsCore, true, `the ${CHANNEL} handler no longer calls ${ANCHOR} — the pin is on dead code`);

  assert.deepEqual(
    violations,
    [],
    `DD1's synchrony invariant is broken: ${violations.join('; ')}. DD1's claim that ` +
      'duplicate tabs are structurally impossible rests ENTIRELY on the move core not ' +
      'suspending between the delete and the set. An await here turns a loud duplicate ' +
      'into a silent missing tab.'
  );
});

// ---------------------------------------------------------------------------
// DD10 — the instrument's reading on the REAL artifact, mutated so the property does not
// hold. Every mutation below is applied to an in-memory copy of the real main.js; no file
// is ever written.
// ---------------------------------------------------------------------------

/** The real main.js, read fresh. @returns {string} */
function realSource() {
  return fs.readFileSync(MAIN_JS, 'utf8');
}

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

test('the pin is anchored on code identity, not a line number — a 40-line shift does not lose it', () => {
  const real = realSource();
  const before = scanSource(real, 'main.js');
  assert.equal(before.core === null, false, 'the core is found in the real file');
  assert.equal(before.core.pairFound, true);
  assert.deepEqual(before.core.violations, []);

  // Shift the whole file down. A line-anchored pin (a lines.slice(), a HANDLER_LINE
  // constant, a byte-offset slice) loses the pair here; an identity-anchored one does not.
  const shifted = '\n'.repeat(40) + real;
  const after = scanSource(shifted, 'main.js');
  assert.equal(after.core === null, false, 'the core is still found in the shifted file');
  assert.equal(after.core.pairFound, true, 'the pair is still found in the shifted file');
  assert.deepEqual(after.core.violations, [], 'the shifted file is still clean');
  assert.equal(after.core.line, before.core.line + 40, 'the core really did move 40 lines down');
});

test('the pin FAILS a move core that is async', () => {
  const real = realSource();
  assert.deepEqual(scanSource(real, 'main.js').core.violations, [], 'real → 0 violations');

  const mutated = real.replace(
    'function moveTabIntoWindow(source, p, resolveTarget) {',
    'async function moveTabIntoWindow(source, p, resolveTarget) {'
  );
  assertMutated(real, mutated, 'async-core');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.core.asyncFn, true);
  assert.equal(res.core.violations.length >= 1, true, 'mutated → at least one violation');
  assert.match(res.core.violations[0], /is `async`/);
});

test('a nested async thunk is NOT a violation — it is not a suspension point of the core', () => {
  // Detection is on the CORE'S DECLARATION specifically. main.js already passes async-free
  // thunks to queueChromeSend. A looser "async anywhere in the body" check would fire on
  // this and generate false positives against code a later leg will plausibly write.
  const real = realSource();
  const mutated = real.replace(
    'queueChromeSend(target, () => [\'adopt-tab\', buildAdoptPayload(p, wc)]);',
    'queueChromeSend(target, async () => [\'adopt-tab\', await buildAdoptPayload(p, wc)]);'
  );
  assertMutated(real, mutated, 'nested-async-thunk');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.core.asyncFn, false, 'the CORE is still sync');
  assert.deepEqual(res.core.violations, [], 'a deferred thunk that runs at delivery time is not a yield here');
});

test('the pin FAILS a suspension point between the delete and the set', () => {
  const real = realSource();
  assert.equal(scanSource(real, 'main.js').core.awaitBetween, false, 'real → no await between');

  // `async` on the core AND the `await` between the statements, TOGETHER. An `await`
  // inserted into a sync function is a SyntaxError — an unreachable source state, and a
  // scan that reports it "discharges" the AC while proving it detects something that can
  // never exist.
  const mutated = real
    .replace(
      'function moveTabIntoWindow(source, p, resolveTarget) {',
      'async function moveTabIntoWindow(source, p, resolveTarget) {'
    )
    .replace(
      '  source.tabViews.delete(p.wcId);\n  target.tabViews.set(p.wcId, entry);',
      '  source.tabViews.delete(p.wcId);\n  await Promise.resolve();\n  target.tabViews.set(p.wcId, entry);'
    );
  assertMutated(real, mutated, 'await-between');
  // The mutated source must be REACHABLE — it parses.
  assert.doesNotThrow(() => new Function(`(${'async (event, payload) => { await Promise.resolve(); }'})`));

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.core.awaitBetween, true, 'mutated → a suspension point between the pair');
  assert.equal(res.core.violations.some((v) => /suspension point/.test(v)), true);
});

test('guard (a) FAILS a renamed core rather than passing on nothing', () => {
  const real = realSource();
  assert.equal(scanSource(real, 'main.js').anchors, 4, 'real → the anchor token 4× (1 definition + 3 call sites)');

  const mutated = real.replaceAll('moveTabIntoWindow', 'moveTabIntoOtherWindow');
  assertMutated(real, mutated, 'renamed-core');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.anchors, 0, 'mutated → the anchor is gone, and the net asserts anchors === 4');
  assert.equal(res.core, null, 'no definition is found — a vacuous pass is impossible');
});

test('guard (c) FAILS a channel that no longer reaches the core — a pin on dead code', () => {
  const real = realSource();
  const before = scanSource(real, 'main.js');
  assert.equal(before.callsCore, true, 'real → the handler calls the core');
  assert.equal(before.channels, 1, 'real → exactly one channel anchor');

  // The core survives, the pair survives, no await appears — and the handler stops calling
  // it. Guards (a) and (b) BOTH still pass here; this is the shape they cannot see.
  const mutated = real.replace(
    '  const r = moveTabIntoWindow(source, p, () => newWindowForMove(source));',
    '  const r = { ok: false };'
  );
  assertMutated(real, mutated, 'orphaned-core');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.core.pairFound, true, 'the pair is still there — guard (b) passes');
  assert.deepEqual(res.core.violations, [], 'and no suspension point — an unguarded pin would PASS here');
  assert.equal(res.callsCore, false, 'mutated → the net FAILS on the unreachable core');
});

test('guard (c) FAILS a renamed channel rather than passing on nothing', () => {
  const real = realSource();
  assert.equal(scanSource(real, 'main.js').channels, 1, 'real → exactly one channel anchor');

  const mutated = real.replace("ipcMain.handle('tab-move-to-new-window',", "ipcMain.handle('tab-move-to-other-window',");
  assertMutated(real, mutated, 'renamed-channel');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.channels, 0, 'mutated → the channel is gone, and the net asserts channels === 1');
  assert.equal(res.registrations, 0, 'no registration is found');
});

test('the pair guard FAILS a handler the delete has left rather than passing on an empty body', () => {
  const real = realSource();
  assert.equal(scanSource(real, 'main.js').core.pairFound, true, 'real → the pair is found');

  // The shape leg 3's factoring had, in miniature: the anchor survives, the pair does not.
  const mutated = real.replace('  source.tabViews.delete(p.wcId);\n', '');
  assertMutated(real, mutated, 'pair-removed');

  const res = scanSource(mutated, 'main.js');
  assert.equal(res.anchors, 4, 'the anchor is still there — this is exactly the vacuous-pass shape');
  assert.equal(res.core.deleteFound, false);
  assert.equal(res.core.pairFound, false, 'mutated → the net FAILS on the missing pair');
  assert.deepEqual(res.core.violations, [], 'and it finds no suspension point — an unguarded pin would PASS here');
});

test('a core-shaped mention inside a COMMENT is not picked up as the definition', () => {
  // SYNTHETIC on purpose. The real tree does not currently exercise the mask (see the
  // header — measured), so this is what actually proves the mask discriminates. The shape
  // is plausible: a commented-out or documented core in prose. It matters MORE since leg 3
  // than it did at leg 1 — main.js's own JSDoc for the core now names `moveTabIntoWindow`
  // and the word `async` in the same block, which is exactly a false-positive waiting for
  // an unmasked scan.
  const commented = [
    '// async function moveTabIntoWindow(source, p, resolveTarget) {',
    '//   source.tabViews.delete(p.wcId);',
    '//   await Promise.resolve();',
    '//   target.tabViews.set(p.wcId, entry);',
    '// }',
    'const x = 1;'
  ].join('\n');
  const res = scanSource(commented, 'fake.js');
  assert.equal(res.anchors, 0, 'the anchor inside a comment is masked out');
  assert.equal(res.core, null, 'no definition is found — comment mentions are not code');

  // The same text UNCOMMENTED is a violation — otherwise the reading above is vacuous.
  const live = commented.split('\n').map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  const liveRes = scanSource(live, 'fake.js');
  assert.equal(liveRes.anchors, 1, 'uncommented → the anchor is real code');
  assert.equal(liveRes.core.asyncFn, true);
  assert.equal(liveRes.core.awaitBetween, true);
  assert.equal(liveRes.core.violations.length, 2, 'uncommented → both violations fire');
});

test('the mask is STILL not load-bearing on the real tree — re-measured at the new anchor', () => {
  // Leg 1 measured the mask as defensive-but-not-load-bearing and said so rather than
  // inheriting the claim. Leg 3 moved the anchor, so the reading was RE-TAKEN rather than
  // carried across — a measurement of the old anchor is not a measurement of the new one.
  //
  // The result is the same, and the honest version of it is worth more than a dramatic one.
  // This test was first written asserting that leg 3's JSDoc (which names the anchor and
  // the word `async` right above the definition) would inflate an unmasked reading. IT DOES
  // NOT, and the assertion failed on the real file: unmasked and masked read IDENTICALLY —
  // same definition offset, same anchor count of 3. DEFINITION_RE requires the `function`
  // keyword, which no prose carries, and main.js names the core in prose nowhere. The claim
  // was composed rather than measured; the measurement is what is recorded.
  //
  // ⚠ THE `3` ABOVE IS LEG-3 HISTORY, NOT THIS FILE'S ASSERTION — the count is 4 today.
  // Leg 4 added the cross-window-move call site and bumped it 3 → 4; the assertions below
  // read 4. The paragraph is left at 3 deliberately: it narrates a reading TAKEN AT LEG 3,
  // and rewriting the number would silently restate a measurement as though it had been
  // taken at a count that never existed when it was made. The equal-readings FINDING is
  // what carries forward, not the arity it was observed at — and re-measuring it at 4 is
  // exactly what the assertions below do.
  //
  // The mask stays on leg 1's ground: it is free, it is the house idiom, and it is
  // protective against edits that are plausible here (a commented-out core, a quoted
  // channel in prose). The SYNTHETIC test above is what proves it discriminates; the real
  // tree still does not exercise it. Both readings, stated, in both directions.
  const real = realSource();
  const masked = maskComments(real);
  assert.deepEqual(scanSource(real, 'main.js').core.violations, [], 'masked → 0 violations');

  const unmaskedDef = real.search(DEFINITION_RE);
  const maskedDef = masked.search(DEFINITION_RE);
  assert.notEqual(maskedDef, -1, 'the masked scan finds the real definition');
  assert.equal(unmaskedDef, maskedDef, 'the JSDoc does NOT shift the definition match — measured, not assumed');

  assert.equal((masked.match(ANCHOR_RE) || []).length, 4, 'masked → 1 definition + 3 call sites');
  assert.equal(
    (real.match(ANCHOR_RE) || []).length,
    4,
    'unmasked → the SAME 4. The mask changes nothing on this tree today, and saying so is ' +
      'the point: an instrument whose two readings are equal is proving nothing here.'
  );
});
