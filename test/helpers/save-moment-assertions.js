'use strict';

// The PINNED assertion vocabulary for the save-moment fixture corpus (Mission 21,
// Flight 1, Leg 4 — fixture-corpus; `offers`/`assertNoOffer` made REAL at Leg 5 —
// broadened-capture; `offers` split into `captures`/`offers` at Leg 6 —
// hat-and-alignment, see below).
//
// ⚠ Leg 6 (hat-and-alignment) HISTORY, recorded because it is the THIRD time
// this flight asserted a narrower property than it appeared to (Leg 4's design
// review caught the negative-tier version; Leg 5's design review caught the
// promotion-without-changing-`assert` version; this one was caught LIVE, by a
// human, against the running app). Leg 5's `assertOffersEntry` proved only that
// a gesture resolves a detected entry carrying a provenanced secret "worth
// holding" — i.e. CAPTURE-WORTHINESS. It never exercised DD4's RELEASE/SETTLE
// half (a main-side navigation commit or a preload-reported field detachment)
// at all, so a shape that can NEVER settle (checkout-submit-outside-form.html —
// a plain, unassociated `type="button"` outside any form, no script, no
// navigation) still passed a test named `assertOffersEntry`, gated at 100%,
// while never producing a real offer in an actual browser. The fix: the old
// body is renamed to `assertCapturesEntry` (it proves exactly what it always
// proved — nothing more), and a NEW, genuinely stronger `assertOffersEntry`
// additionally proves the ONE settle signal this headless corpus can honestly
// model without executing page script — see `wouldNativelySubmit` below.
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
//   assertCapturesEntry(doc, family, opts)  — REAL (Leg 5; renamed from
//                                              `assertOffersEntry` at Leg 6 —
//                                              hat-and-alignment, same body).
//                                              Exercises the main-world
//                                              GESTURE-POLICY layer headlessly:
//                                              builds a REAL
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
//                                              run. **Proves CAPTURE-WORTHINESS
//                                              ONLY** — a fixture asserting
//                                              only `captures` may legitimately
//                                              NEVER produce a real save offer
//                                              (see checkout-submit-outside-
//                                              form.html, tier known-unsolved).
//   assertOffersEntry(doc, family, opts)    — REAL, STRENGTHENED (Leg 6 —
//                                              hat-and-alignment). Runs
//                                              everything `assertCapturesEntry`
//                                              does, THEN additionally asserts
//                                              `wouldNativelySubmit(target)` —
//                                              that clicking the resolved
//                                              gesture element triggers a REAL
//                                              native HTML form submission
//                                              (DD4's navigation-commit settle
//                                              signal), the ONE settle path
//                                              this headless corpus can prove
//                                              without executing page script
//                                              (fixtures carry no `<script>` —
//                                              DD6's extractor never parses/
//                                              executes one — so a script-
//                                              driven fetch/XHR settle path,
//                                              the literal Jostens mechanism,
//                                              is unmodelable headlessly by
//                                              construction, not by omission).
//                                              A fixture only earns
//                                              `assert: 'offers'` when this
//                                              holds for its designated
//                                              gesture element; otherwise it
//                                              earns, at most, `captures`.
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
//                                              (Unaffected by the Leg 6 split:
//                                              "never captures" already implies
//                                              "never offers" — capture is a
//                                              strict prerequisite of settle —
//                                              so this negative direction was
//                                              never the vacuous one.)

const assert = require('node:assert/strict');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');
const { findAllIdentityFields, IDENTITY_ROLES } = require('../../src/preload/vault-identity-fields');
const { createEntryObserver, LOGIN_ROLES, CARD_ROLES } = require('../../src/preload/vault-entry-observer');
const {
  isCaptureGesture,
  resolveGestureTarget,
  snapshotHasProvenancedSecret
} = require('../../src/preload/vault-gesture-policy');

/**
 * Assert that detection finds an entry for `family` ('login' | 'card' |
 * 'identity') at `expectedOrdinal` (default 0) among ALL detected entries of
 * that family — an INTEGER index into the detector's own result array, never
 * a node reference (the corpus's own pinned manifest shape for multi-form
 * disambiguation). Returns the matched entry.
 *
 * THREE-WAY DISPATCH (Mission 21, Flight 2, Leg 2 — identity-boundary): before
 * this leg, this function was `family === 'card' ? findAllCardFields :
 * findAllLoginFields` — so `'identity'` silently fell through to the LOGIN
 * detector, meaning every positive identity fixture would have asserted
 * against the wrong family and could have passed for entirely the wrong
 * reason. Do not collapse this back to a binary ternary.
 * @param {any} doc
 * @param {'login'|'card'|'identity'} family
 * @param {{ expectedOrdinal?: number }} [opts]
 * @returns {any}
 */
function assertDetectsEntry(doc, family, opts = {}) {
  const expectedOrdinal = opts.expectedOrdinal ?? 0;
  const entries =
    family === 'card'
      ? findAllCardFields(doc)
      : family === 'identity'
        ? findAllIdentityFields(doc)
        : findAllLoginFields(doc);
  assert.ok(
    entries.length > expectedOrdinal,
    `expected a detectable ${family} entry at ordinal ${expectedOrdinal}, found ${entries.length} ${family} entries`
  );
  const entry = entries[expectedOrdinal];
  const anchor = family === 'card' ? entry.number : family === 'identity' ? entry.anchor : entry.password;
  assert.ok(anchor, `${family} entry at ordinal ${expectedOrdinal} has no anchor field`);
  return entry;
}

/**
 * Assert that NO family (login, card, or identity) detects anything at all in
 * `doc`. Extended to identity at Leg 2 (identity-boundary) — without this,
 * every existing negative-detection fixture would silently stop covering the
 * new family the moment it was added: the corpus would look green while
 * testing less than it did before.
 * @param {any} doc
 */
function assertNoDetectableEntry(doc) {
  assert.deepEqual(findAllLoginFields(doc), [], 'expected no detectable login entry');
  assert.deepEqual(findAllCardFields(doc), [], 'expected no detectable card entry');
  assert.deepEqual(findAllIdentityFields(doc), [], 'expected no detectable identity entry');
}

/**
 * A real `vault-entry-observer` over `doc`, with provenance GRANTED for every
 * detected field that carries a non-empty `.value` — the corpus's stand-in for
 * "the operator typed this" (a static HTML fixture has no live keystroke to
 * simulate; `_grant` is the same test-only entry point
 * `vault-entry-observer.test.js` itself uses). THREE-WAY (M21 F3 Leg 4) —
 * identity joins login/card, never a binary observer. Returns
 * `{ observer, logins, cards, identities, snapshot }`.
 * @param {any} doc
 * @returns {{ observer: any, logins: any[], cards: any[], identities: any[], snapshot: { logins: any[], cards: any[], identities: any[] } }}
 */
function buildProvenancedObserver(doc) {
  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields,
    findAllCardFields,
    findAllIdentityFields
  });
  const logins = findAllLoginFields(doc);
  const cards = findAllCardFields(doc);
  const identities = findAllIdentityFields(doc);
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
  for (const entry of identities) {
    for (const role of IDENTITY_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  return { observer, logins, cards, identities, snapshot: observer.snapshot() };
}

/**
 * The snapshot array for `kind` — THREE-WAY (M21 F3 Leg 4), replacing the
 * binary `resolved.kind === 'card' ? snapshot.cards : snapshot.logins` dispatch
 * (the Central Danger table's own class of defect: a missed identity site here
 * would silently read the LOGIN snapshot for an identity-resolved gesture).
 * @param {{ logins: any[], cards: any[], identities: any[] }} snapshot
 * @param {'login'|'card'|'identity'} kind
 * @returns {any[]}
 */
function snapshotEntriesFor(snapshot, kind) {
  if (kind === 'card') return snapshot.cards;
  if (kind === 'identity') return snapshot.identities;
  return snapshot.logins;
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
 * Shared core (Leg 5, extracted at Leg 6 — hat-and-alignment): the fixture's
 * designated gesture element, clicked, resolves via the real gesture-policy
 * module to a detected `family` entry at `expectedOrdinal` that carries a
 * provenanced secret worth holding. Proves CAPTURE-WORTHINESS only — see the
 * module header for why that is a deliberately narrower claim than "offers".
 * @param {any} doc
 * @param {'login'|'card'|'identity'} family
 * @param {{ expectedOrdinal?: number, gestureSelector?: string }} [opts]
 * @returns {{ target: any, resolved: { kind: 'login'|'card'|'identity', ordinal: number }, entrySnapshot: any }}
 */
function resolveCaptureWorthyGesture(doc, family, opts = {}) {
  const expectedOrdinal = opts.expectedOrdinal ?? 0;
  const { logins, cards, identities, snapshot } = buildProvenancedObserver(doc);

  const target = resolveGestureElement(doc, opts.gestureSelector);
  assert.ok(
    target,
    `no gesture element resolved (selector: ${opts.gestureSelector || '(default: first button-like)'})`
  );

  const event = { type: 'click', isTrusted: true, target };
  assert.ok(isCaptureGesture(event), "expected the designated element's click to qualify as a capture gesture");

  const resolved = resolveGestureTarget(target, { logins, cards, identities });
  assert.ok(resolved, 'expected the gesture to resolve to a detected entry');
  assert.equal(resolved.kind, family, `expected the gesture to resolve a ${family} entry, resolved ${resolved.kind}`);
  assert.equal(
    resolved.ordinal,
    expectedOrdinal,
    `expected the gesture to resolve ordinal ${expectedOrdinal}, resolved ${resolved.ordinal}`
  );

  const entrySnapshot = snapshotEntriesFor(snapshot, resolved.kind)[resolved.ordinal];
  assert.ok(
    snapshotHasProvenancedSecret(entrySnapshot, resolved.kind),
    `expected the resolved ${family} entry at ordinal ${expectedOrdinal} to carry a provenanced secret worth capturing`
  );

  return { target, resolved, entrySnapshot };
}

/**
 * REAL policy-level assertion (Leg 5, renamed from `assertOffersEntry` at
 * Leg 6 — hat-and-alignment; body unchanged). See the module header:
 * CAPTURE-WORTHINESS only, never a claim that an offer is ever released.
 * @param {any} doc
 * @param {'login'|'card'|'identity'} family
 * @param {{ expectedOrdinal?: number, gestureSelector?: string }} [opts]
 */
function assertCapturesEntry(doc, family, opts = {}) {
  resolveCaptureWorthyGesture(doc, family, opts);
}

/**
 * Does clicking `target` trigger a REAL native HTML form submission — the ONE
 * settle signal (DD4's navigation-commit path) this headless corpus can prove
 * without executing page script? (Leg 6 — hat-and-alignment.) NOT a
 * reimplementation of any production decision: production never computes
 * this at all — a real browser's own navigation is what fires `did-navigate`
 * main-side. This predicate exists solely so a static fixture can honestly
 * claim its gesture settles, per the HTML Standard's own "implicit submission"
 * rule: a submit-type control (a `<button>` with no `type` attribute or
 * `type="submit"`/`"image"`, or an `<input type="submit"|"image">`) whose
 * `.form` resolves — via containment OR a `form=` IDREF, the extractor's own
 * DD6 rule (b), now wired for `<button>` too (fixture-extractor.js) —
 * natively submits that form on click, with nothing in a script-free fixture
 * to intercept it. `type="button"`/`"reset"`, or no resolvable `.form` at
 * all (the unassociated "outside every form" shape wired to a JS click
 * handler in a real page — e.g. checkout-submit-outside-form.html), never
 * does.
 * @param {any} target
 * @returns {boolean}
 */
function wouldNativelySubmit(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toUpperCase();
  const rawType = typeof target.getAttribute === 'function' ? target.getAttribute('type') : null;
  const type = rawType ? rawType.toLowerCase() : '';
  const isSubmitter =
    (tag === 'BUTTON' && type !== 'button' && type !== 'reset') ||
    (tag === 'INPUT' && (type === 'submit' || type === 'image'));
  if (!isSubmitter) return false;
  return !!target.form;
}

/**
 * REAL, STRENGTHENED policy-level assertion (Leg 6 — hat-and-alignment; see
 * the module header for why the Leg 5 version of this name was vacuous for
 * the settle half). Everything `assertCapturesEntry` proves, PLUS
 * `wouldNativelySubmit(target)` — the resolved gesture element must actually
 * settle via native navigation for a fixture to earn `assert: 'offers'`.
 * @param {any} doc
 * @param {'login'|'card'|'identity'} family
 * @param {{ expectedOrdinal?: number, gestureSelector?: string }} [opts]
 */
function assertOffersEntry(doc, family, opts = {}) {
  const { target } = resolveCaptureWorthyGesture(doc, family, opts);
  assert.ok(
    wouldNativelySubmit(target),
    "expected the gesture element to trigger a REAL native form submission (DD4's navigation-commit " +
      "settle signal) — this fixture's gesture element is not a resolvable submit-type control, so it " +
      'would never settle in a real, script-free rendering of this markup; such a shape can only honestly ' +
      "earn assert:'captures', not assert:'offers' (see save-moment-assertions.js's module header)"
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
  const { logins, cards, identities, snapshot } = buildProvenancedObserver(doc);

  const target = resolveGestureElement(doc, opts.gestureSelector);
  assert.ok(
    target,
    `no gesture element resolved (selector: ${opts.gestureSelector || '(default: first button-like)'})`
  );

  const event = { type: 'click', isTrusted: true, target };
  if (!isCaptureGesture(event)) return; // not even a qualifying gesture — definitely no offer

  const resolved = resolveGestureTarget(target, { logins, cards, identities });
  if (!resolved) return; // no entry resolves — nothing to capture

  const entrySnapshot = snapshotEntriesFor(snapshot, resolved.kind)[resolved.ordinal];
  assert.ok(
    !snapshotHasProvenancedSecret(entrySnapshot, resolved.kind),
    `expected NO provenanced secret to be available for capture via this gesture (resolved ${resolved.kind} ordinal ${resolved.ordinal})`
  );
}

module.exports = {
  assertDetectsEntry,
  assertNoDetectableEntry,
  assertCapturesEntry,
  assertOffersEntry,
  assertNoOffer,
  wouldNativelySubmit
};
