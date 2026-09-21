'use strict';

// The save-moment fixture corpus HARNESS (Mission 21, Flight 1, Leg 4 —
// fixture-corpus, DD6). Reads test/fixtures/save-moment/manifest.js — THE ONLY
// SOURCE OF TIER — and runs each fixture through the pinned assertion vocabulary
// (test/helpers/save-moment-assertions.js). This leg tests DETECTION (and, from
// Leg 5, the trigger) by reusing the pure detection modules directly — never a
// reimplementation of either.
//
// Tiers, mechanically distinguished:
//   'negative-detection'  ordinary test, assertNoDetectableEntry.   Gated NOW.
//   'negative-gesture'    ordinary test, assertNoOffer (real as of Leg 5).
//   'known-unsolved'      `{ todo: true }` test — assertDetectsEntry (pure
//                          detection unsolved) or assertCapturesEntry (Leg 6 —
//                          hat-and-alignment: capture-worthy but PROVABLY
//                          cannot settle, e.g. checkout-submit-outside-form,
//                          or settle depends on machinery this corpus does not
//                          simulate, e.g. spa-submit-no-navigation). The gated
//                          set may legitimately be EMPTY at this leg's landing
//                          — that is expected, not a failure; promotion is an
//                          edit to manifest.js's `tier` AND `assert` fields
//                          together, never a rewrite of this harness.
//   'gated'                ordinary test — assertDetectsEntry, assertCapturesEntry,
//                          assertOffersEntry, or assertOffersFamilies, per the
//                          entry's own `assert`.
//
// 'captures' vs 'offers' (Leg 6 — hat-and-alignment, Flight 1, a live HAT
// finding — see flight-log.md and save-moment-assertions.js's own module
// header): 'captures' proves a gesture WOULD create a held, settle-pending
// capture; 'offers' proves that PLUS a real settle signal. A shape only earns
// `assert: 'offers'` once a settle signal is honestly provable for it
// headlessly — never assigned merely because the gesture/detection layer
// looks correct.
//
// 'offers-multi' (Mission 21, Flight 3, Leg 6 — gesture-holds-every-family):
// the multi-family sibling of 'offers' — one gesture PLANS a capture for
// every family in the entry's own `families` list, in order, via the REAL
// `resolveGestureTargets` + `planCaptures` (see assertOffersFamilies). This is
// the corpus's regression net for the combined-form gap the HAT's Step 4a
// found in THIS flight (single-family precedence made identity capture
// impossible on a form shared with card or login).
//
// No snapshot / golden-file baselines anywhere in this file (house rule) —
// every assertion is DOM-shape / detection-outcome based.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractFixtureFile } = require('../helpers/fixture-extractor');
const {
  assertDetectsEntry,
  assertNoDetectableEntry,
  assertCapturesEntry,
  assertOffersEntry,
  assertOffersFamilies,
  assertNoOffer
} = require('../helpers/save-moment-assertions');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'save-moment');
const MANIFEST = require(path.join(FIXTURES_DIR, 'manifest.js'));

const KNOWN_TIERS = new Set(['gated', 'known-unsolved', 'negative-detection', 'negative-gesture']);
// 'offers' split from 'captures' at Leg 6 (hat-and-alignment, Flight 1) — see
// save-moment-assertions.js's module header for why: 'captures' proves only
// that a gesture WOULD create a held, settle-pending capture; 'offers' proves
// that PLUS a real settle signal (native navigation) fires for it too.
// 'offers-multi' (Mission 21, Flight 3, Leg 6 — gesture-holds-every-family) is
// the multi-family sibling — see manifest.js's own entry-shape doc and
// save-moment-assertions.js's assertOffersFamilies.
const KNOWN_ASSERTS = new Set(['detects', 'no-detect', 'captures', 'offers', 'offers-multi', 'no-offer']);
// Tiers whose real-world outcome cannot be computed yet — the mechanism the
// flight settled on for clean promotion (Node 22.22.0-verified in the flight
// log: a todo that starts passing does not fail the run). Leg 5
// (broadened-capture): `assertNoOffer` is now REAL (no longer a throwing
// stub), so 'negative-gesture' is no longer a todo tier — it runs, and gates,
// like every other populated tier.
const TODO_TIERS = new Set(['known-unsolved']);

/**
 * @param {any} entry
 * @returns {any}  an extracted document, with `simulate` (if any) already applied.
 */
function loadFixtureDoc(entry) {
  assert.ok(entry.file, `manifest entry "${entry.id}" carries no file — a simulate-only entry needs its own loader`);
  const doc = extractFixtureFile(path.join(FIXTURES_DIR, entry.file));
  if (typeof entry.simulate === 'function') entry.simulate(doc);
  return doc;
}

function runAssertion(entry) {
  const doc = loadFixtureDoc(entry);
  if (entry.assert === 'detects') {
    assert.ok(entry.family, `manifest entry "${entry.id}" has assert:'detects' but no family`);
    assertDetectsEntry(doc, entry.family, { expectedOrdinal: entry.expectedOrdinal ?? 0 });
    return;
  }
  if (entry.assert === 'no-detect') {
    assertNoDetectableEntry(doc);
    return;
  }
  if (entry.assert === 'captures') {
    assert.ok(entry.family, `manifest entry "${entry.id}" has assert:'captures' but no family`);
    assertCapturesEntry(doc, entry.family, {
      expectedOrdinal: entry.expectedOrdinal ?? 0,
      gestureSelector: entry.gestureSelector
    });
    return;
  }
  if (entry.assert === 'offers') {
    assert.ok(entry.family, `manifest entry "${entry.id}" has assert:'offers' but no family`);
    assertOffersEntry(doc, entry.family, {
      expectedOrdinal: entry.expectedOrdinal ?? 0,
      gestureSelector: entry.gestureSelector
    });
    return;
  }
  if (entry.assert === 'offers-multi') {
    assert.ok(
      Array.isArray(entry.families) && entry.families.length > 0,
      `manifest entry "${entry.id}" has assert:'offers-multi' but no (or empty) families`
    );
    assertOffersFamilies(doc, entry.families, { gestureSelector: entry.gestureSelector });
    return;
  }
  if (entry.assert === 'no-offer') {
    assertNoOffer(doc, { gestureSelector: entry.gestureSelector });
    return;
  }
  throw new Error(`manifest entry "${entry.id}" carries an unknown assert kind: ${entry.assert}`);
}

// --- manifest well-formedness (defensive — cheap, catches typos early) --------

test('every manifest entry carries a known tier and a known assert kind', () => {
  for (const entry of MANIFEST) {
    assert.ok(KNOWN_TIERS.has(entry.tier), `entry "${entry.id}" has unknown tier "${entry.tier}"`);
    assert.ok(KNOWN_ASSERTS.has(entry.assert), `entry "${entry.id}" has unknown assert "${entry.assert}"`);
  }
});

test('every manifest entry with a file references a real, resolvable fixture on disk', () => {
  for (const entry of MANIFEST) {
    if (!entry.file) continue;
    const full = path.join(FIXTURES_DIR, entry.file);
    assert.ok(fs.existsSync(full), `entry "${entry.id}" references missing file ${entry.file}`);
  }
});

// --- orphan detection: every .html fixture file must be referenced -----------

/**
 * @param {string} dir
 * @returns {string[]}  absolute paths of every .html file under `dir`, recursive.
 */
function collectHtmlFixtures(dir) {
  /** @type {string[]} */
  const out = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...collectHtmlFixtures(full));
    else if (dirent.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('every fixture .html file on disk is referenced by exactly one manifest entry (no orphans)', () => {
  const onDisk = collectHtmlFixtures(FIXTURES_DIR).map((p) => path.relative(FIXTURES_DIR, p).split(path.sep).join('/'));
  const referenced = new Set(MANIFEST.filter((e) => e.file).map((e) => e.file));
  const orphans = onDisk.filter((f) => !referenced.has(f));
  assert.deepEqual(orphans, [], `orphaned fixture file(s), referenced by no manifest entry: ${orphans.join(', ')}`);

  // The inverse direction too: a manifest entry pointing at a file that isn't
  // actually under this directory tree would otherwise pass silently.
  const onDiskSet = new Set(onDisk);
  const dangling = [...referenced].filter((f) => !onDiskSet.has(f));
  assert.deepEqual(dangling, [], `manifest entry(ies) reference file(s) not found on disk: ${dangling.join(', ')}`);
});

// --- the tiers themselves ------------------------------------------------------

for (const entry of MANIFEST) {
  const options = TODO_TIERS.has(entry.tier) ? { todo: true } : {};
  test(`[${entry.tier}] ${entry.id}`, options, () => {
    runAssertion(entry);
  });
}

// --- STANDING CANARY: proves the negative-tier harness has teeth --------------
//
// Not a one-time check — this runs every time the suite runs. It inverts the
// negative-detection tier's own assertion (assertNoDetectableEntry) against a
// KNOWN-POSITIVE fixture (guaranteed populated: the known-unsolved tier always
// carries at least one detectable-entry fixture, per this leg's own required
// shapes) and REQUIRES that inversion to fail. If assertNoDetectableEntry ever
// regressed into a vacuous pass (e.g. a refactor that silently no-ops its
// checks), this is what would catch it — the gated-tier equivalent was
// considered and rejected at design review, because the gated tier may
// legitimately be EMPTY at this leg's landing, which would make that version of
// the canary pass for having nothing to check rather than for genuinely
// exercising the assertion.

test('CANARY: assertNoDetectableEntry must FAIL against a known-positive fixture — proves the negative-tier harness has teeth, not a vacuous pass', () => {
  const positive = MANIFEST.find((e) => e.id === 'plain-login-form');
  assert.ok(positive, 'canary fixture "plain-login-form" must exist in the manifest');
  const doc = loadFixtureDoc(positive);
  assert.throws(
    () => assertNoDetectableEntry(doc),
    /expected no detectable/,
    'assertNoDetectableEntry unexpectedly PASSED against a fixture known to carry a detectable login entry — the negative-tier gate would be passing vacuously'
  );
});

// --- STANDING CANARY: proves assertOffersEntry's settle check has teeth ------
//
// The regression test for the HAT finding this leg (hat-and-alignment) fixed:
// Leg 5's `assertOffersEntry` proved only capture-worthiness and would have
// passed on checkout-submit-outside-form.html — a shape that, by construction
// (a plain, unassociated `type="button"` outside any form, no script), can
// NEVER settle in a real browser. `assertCapturesEntry` legitimately still
// passes against it (it IS capture-worthy); `assertOffersEntry` must FAIL
// against the exact same document, or this canary catches the regression the
// live HAT found instead of leaving it to another live walk to rediscover.

test('CANARY: assertOffersEntry must FAIL against a capture-worthy fixture whose gesture never settles — proves the settle check has teeth, not a vacuous pass', () => {
  const unsettleable = MANIFEST.find((e) => e.id === 'checkout-submit-outside-form');
  assert.ok(unsettleable, 'canary fixture "checkout-submit-outside-form" must exist in the manifest');
  assert.equal(
    unsettleable.assert,
    'captures',
    'canary fixture "checkout-submit-outside-form" is expected to be pinned at assert:\'captures\' — it can never settle'
  );
  const doc = loadFixtureDoc(unsettleable);
  // The weaker claim still holds — this is what makes the fixture worth
  // keeping in the corpus at all.
  assertCapturesEntry(doc, unsettleable.family, {
    expectedOrdinal: unsettleable.expectedOrdinal ?? 0,
    gestureSelector: unsettleable.gestureSelector
  });
  // The stronger claim must not.
  assert.throws(
    () =>
      assertOffersEntry(doc, unsettleable.family, {
        expectedOrdinal: unsettleable.expectedOrdinal ?? 0,
        gestureSelector: unsettleable.gestureSelector
      }),
    /native form submission/,
    'assertOffersEntry unexpectedly PASSED against a fixture whose gesture can never settle — the settle check would be passing vacuously, exactly the defect the live HAT found'
  );
});
