'use strict';

// The PINNED assertion vocabulary for the save-moment fixture corpus (Mission 21,
// Flight 1, Leg 4 — fixture-corpus; `offers`/`assertNoOffer` made REAL at Leg 5 —
// broadened-capture).
//
//   assertDetectsEntry(doc, family, opts)   — pure detection. Gates the
//                                              detection-negative tier and any
//                                              shape that stays known-unsolved
//                                              for a reason OTHER than the
//                                              gesture/policy layer (e.g.
//                                              framework-rerender-field-
//                                              replacement — an honest,
//                                              documented provenance gap) or
//                                              a shape whose OFFER outcome
//                                              depends on settle machinery
//                                              this helper module deliberately
//                                              does not simulate (DD4's SPA
//                                              trade-off — see
//                                              spa-submit-no-navigation).
//   assertNoDetectableEntry(doc)            — REAL, gates the detection-negative
//                                              tier.
//   assertOffersEntry(doc, family, opts)    — REAL (Leg 5). Exercises the
//                                              main-world GESTURE-POLICY layer
//                                              headlessly: builds a REAL
//                                              `vault-entry-observer` over
//                                              `doc`, grants provenance for
//                                              every detected field that
//                                              carries a non-empty value (the
//                                              corpus's own stand-in for "the
//                                              operator typed this" — a static
//                                              fixture has no real keystroke
//                                              to simulate), resolves the
//                                              fixture's designated gesture
//                                              element (`opts.gestureSelector`,
//                                              default: the first button-like
//                                              element), classifies it via the
//                                              real `vault-gesture-policy`
//                                              module, resolves the entry
//                                              ORDINAL the gesture targets, and
//                                              asserts that ordinal both
//                                              matches `expectedOrdinal` AND
//                                              carries a provenanced secret
//                                              worth holding — i.e. this
//                                              gesture WOULD create a held,
//                                              settle-pending capture. Never a
//                                              reimplementation of the policy
//                                              — the exact production modules
//                                              run.
//   assertNoOffer(doc, opts)                — REAL (Leg 5). The inverse: the
//                                              designated gesture element (for
//                                              decoy-cancel-beside-password,
//                                              `opts.gestureSelector: '#cancel'`
//                                              — the whole point is WHICH
//                                              control is clicked) must NOT
//                                              resolve to an entry carrying a
//                                              provenanced secret. Passes
//                                              whether the gesture fails to
//                                              classify at all, fails to
//                                              resolve an entry, or resolves
//                                              an entry with nothing
//                                              provenanced — every one of
//                                              those is "no offer" and this
//                                              helper does not care which.

const assert = require('node:assert/strict');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');
const { createEntryObserver, LOGIN_ROLES, CARD_ROLES } = require('../../src/preload/vault-entry-observer');
const {
  isCaptureGesture,
  resolveGestureTarget,
  snapshotHasProvenancedSecret
} = require('../../src/preload/vault-gesture-policy');

/**
 * Assert that detection finds an entry for `family` ('login' | 'card') at
 * `expectedOrdinal` (default 0) among ALL detected entries of that family — an
 * INTEGER index into the detector's own result array, never a node reference
 * (the corpus's own pinned manifest shape for multi-form disambiguation).
 * Returns the matched entry.
 * @param {any} doc
 * @param {'login'|'card'} family
 * @param {{ expectedOrdinal?: number }} [opts]
 * @returns {any}
 */
function assertDetectsEntry(doc, family, opts = {}) {
  const expectedOrdinal = opts.expectedOrdinal ?? 0;
  const entries = family === 'card' ? findAllCardFields(doc) : findAllLoginFields(doc);
  assert.ok(
    entries.length > expectedOrdinal,
    `expected a detectable ${family} entry at ordinal ${expectedOrdinal}, found ${entries.length} ${family} entries`
  );
  const entry = entries[expectedOrdinal];
  const anchor = family === 'card' ? entry.number : entry.password;
  assert.ok(anchor, `${family} entry at ordinal ${expectedOrdinal} has no anchor field`);
  return entry;
}

/**
 * Assert that NEITHER family detects anything at all in `doc`.
 * @param {any} doc
 */
function assertNoDetectableEntry(doc) {
  assert.deepEqual(findAllLoginFields(doc), [], 'expected no detectable login entry');
  assert.deepEqual(findAllCardFields(doc), [], 'expected no detectable card entry');
}

/**
 * A real `vault-entry-observer` over `doc`, with provenance GRANTED for every
 * detected field that carries a non-empty `.value` — the corpus's stand-in for
 * "the operator typed this" (a static HTML fixture has no live keystroke to
 * simulate; `_grant` is the same test-only entry point
 * `vault-entry-observer.test.js` itself uses). Returns
 * `{ observer, logins, cards, snapshot }`.
 * @param {any} doc
 * @returns {{ observer: any, logins: any[], cards: any[], snapshot: { logins: any[], cards: any[] } }}
 */
function buildProvenancedObserver(doc) {
  const observer = createEntryObserver({ document: doc, findAllLoginFields, findAllCardFields });
  const logins = findAllLoginFields(doc);
  const cards = findAllCardFields(doc);
  for (const entry of logins) {
    for (const role of LOGIN_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  for (const entry of cards) {
    for (const role of CARD_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  return { observer, logins, cards, snapshot: observer.snapshot() };
}

/**
 * Resolve the fixture's designated gesture element. `selector` starting with
 * `#` resolves via `getElementById` (works for any legal id, unlike the
 * extractor's own deliberately-narrow `querySelectorAll`, which supports only
 * single simple clauses — no descendant combinators); otherwise it is handed
 * to `doc.querySelectorAll` as-is. Omitted → the first button-like element in
 * document order (tag/type list mirrors `vault-gesture-policy.isButtonLikeElement`).
 * @param {any} doc
 * @param {string} [selector]
 * @returns {any}
 */
function resolveGestureElement(doc, selector) {
  if (selector) {
    if (selector.startsWith('#')) return doc.getElementById(selector.slice(1));
    const matches = doc.querySelectorAll(selector);
    return matches[0] || null;
  }
  const candidates = doc.querySelectorAll('button, input[type=submit], input[type=button], input[type=image]');
  return candidates[0] || null;
}

/**
 * REAL policy-level assertion (Leg 5): the fixture's designated gesture
 * element, clicked, resolves via the real gesture-policy module to a detected
 * `family` entry at `expectedOrdinal` that carries a provenanced secret worth
 * holding.
 * @param {any} doc
 * @param {'login'|'card'} family
 * @param {{ expectedOrdinal?: number, gestureSelector?: string }} [opts]
 */
function assertOffersEntry(doc, family, opts = {}) {
  const expectedOrdinal = opts.expectedOrdinal ?? 0;
  const { logins, cards, snapshot } = buildProvenancedObserver(doc);

  const target = resolveGestureElement(doc, opts.gestureSelector);
  assert.ok(
    target,
    `no gesture element resolved (selector: ${opts.gestureSelector || '(default: first button-like)'})`
  );

  const event = { type: 'click', isTrusted: true, target };
  assert.ok(isCaptureGesture(event), "expected the designated element's click to qualify as a capture gesture");

  const resolved = resolveGestureTarget(target, { logins, cards });
  assert.ok(resolved, 'expected the gesture to resolve to a detected entry');
  assert.equal(resolved.kind, family, `expected the gesture to resolve a ${family} entry, resolved ${resolved.kind}`);
  assert.equal(
    resolved.ordinal,
    expectedOrdinal,
    `expected the gesture to resolve ordinal ${expectedOrdinal}, resolved ${resolved.ordinal}`
  );

  const entrySnapshot = (resolved.kind === 'card' ? snapshot.cards : snapshot.logins)[resolved.ordinal];
  assert.ok(
    snapshotHasProvenancedSecret(entrySnapshot, resolved.kind),
    `expected the resolved ${family} entry at ordinal ${expectedOrdinal} to carry a provenanced secret worth capturing`
  );
}

/**
 * REAL negative assertion (Leg 5): the fixture's designated gesture element
 * must NOT resolve to a detected entry carrying a provenanced secret — whether
 * because the click does not classify as a capture gesture at all, because no
 * entry resolves for it, or because the resolved entry carries nothing
 * provenanced. Every one of those is "no offer"; this helper does not
 * distinguish between them, because the corpus's own negative fixtures each
 * document WHY their particular case lands here.
 * @param {any} doc
 * @param {{ gestureSelector?: string }} [opts]
 */
function assertNoOffer(doc, opts = {}) {
  const { logins, cards, snapshot } = buildProvenancedObserver(doc);

  const target = resolveGestureElement(doc, opts.gestureSelector);
  assert.ok(
    target,
    `no gesture element resolved (selector: ${opts.gestureSelector || '(default: first button-like)'})`
  );

  const event = { type: 'click', isTrusted: true, target };
  if (!isCaptureGesture(event)) return; // not even a qualifying gesture — definitely no offer

  const resolved = resolveGestureTarget(target, { logins, cards });
  if (!resolved) return; // no entry resolves — nothing to capture

  const entrySnapshot = (resolved.kind === 'card' ? snapshot.cards : snapshot.logins)[resolved.ordinal];
  assert.ok(
    !snapshotHasProvenancedSecret(entrySnapshot, resolved.kind),
    `expected NO provenanced secret to be available for capture via this gesture (resolved ${resolved.kind} ordinal ${resolved.ordinal})`
  );
}

module.exports = { assertDetectsEntry, assertNoDetectableEntry, assertOffersEntry, assertNoOffer };
