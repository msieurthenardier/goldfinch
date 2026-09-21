'use strict';

// Main-world GESTURE CLASSIFICATION (Mission 21, Flight 1, Leg 5 — broadened-
// capture; identity's third arm added at Flight 3 Leg 4, AC5/AC6). NEW logic —
// nothing in src/preload or src/shared had a button-like / type=submit / role
// helper before this leg, and the entry observer's own keydown listener
// (vault-entry-observer.js) grants PROVENANCE on every keystroke (correct — DD3
// wants that), which is a DIFFERENT concept from a CAPTURE GESTURE (DD1/DD3): a
// trusted click on any button-like element, or a trusted Enter while focus is in
// a field. This module owns only that second, narrower classification, plus the
// entry-ORDINAL resolution a gesture needs to disambiguate a multi-form page
// (ordinal recovers the PR#112 finding-9 precision Leg 3 accepted losing for
// fill — see the flight log).
//
// Pure, Electron-free, DOM-shape-only (no `require('electron')`, no `window`/
// `document` globals referenced at module scope) — `require()`-able under
// `node --test` (the corpus's own `assertOffersEntry`/`assertNoOffer` exercise
// it headlessly) AND consumed by `webview-preload.js` in the real guest main
// world.
//
// SECURITY NOTE (why this module may safely run in the spoofable main world,
// per DD1's own reasoning): every decision here is about WHICH element was
// gestured at and WHICH detected entry it maps to — never a VALUE. A forged or
// mislabeled result here can only cause a read at the wrong MOMENT, or of the
// wrong (but still real, still provenance-gated) entry — both budgeted as
// wrong-moment cost (DD4), never a wrong-VALUE hard-zero. The isolated world
// (vault-entry-observer.js) remains the sole source of any VALUE that reaches
// main, via its own value-bound provenance check.

/** Roles `resolveOrdinalInFamily` matches against, mirroring the observer's own sets. */
const LOGIN_ROLES = ['username', 'password'];
const CARD_ROLES = ['number', 'cardholder', 'expiry', 'expMonth', 'expYear', 'csc'];
// Identity's eleven roles (M21 F3 Leg 4, AC5) — imported, never hand-typed a third
// time (the AC3b precedent Leg 3 set for the observer): the single source is
// vault-identity-fields.js's own derived union. `POSTAL_ROLES`/`NON_POSTAL_ROLES`
// back AC6's value-layer gate below.
const { IDENTITY_ROLES, POSTAL_ROLES, NON_POSTAL_ROLES } = require('./vault-identity-fields');

/** Input `.type` values that never count as a text-entry-ish "tracked field" for the Enter gesture. */
const NON_FIELD_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'hidden']);

/**
 * Is `el` a "button-like" element — the DD1 gesture trigger's broad target set.
 * Deliberately NOT limited to `type="submit"` or elements inside a `<form>`: the
 * motivating shape is a plain `<button>` with NO `type` attribute, sitting
 * OUTSIDE every form, wired to a JS click handler (issue #152's Jostens
 * reference / checkout-submit-outside-form.html). A `role="button"` element is
 * included for the same reason — the gesture stays broad; disambiguation and
 * value-admission happen elsewhere (ordinal resolution, DD3 provenance).
 * @param {any} el
 * @returns {boolean}
 */
function isButtonLikeElement(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON') return true;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : '';
    return type === 'submit' || type === 'button' || type === 'image';
  }
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return role === 'button';
}

/**
 * Is `el` a plausible target for the "trusted Enter" gesture — any genuinely
 * text-entry-ish `<input>`/`<select>`/`<textarea>` the operator could be
 * focused in while typing a credential. Deliberately broad (no detection
 * lookup here — see the module header): worst case is a wasted snapshot read
 * that finds nothing provenanced, never a wrong value.
 * @param {any} el
 * @returns {boolean}
 */
function isFieldElement(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
  return !NON_FIELD_INPUT_TYPES.has(type);
}

/**
 * The gesture classification itself (DD1/DD3): a trusted `click` on a
 * button-like element, or a trusted `keydown` with `key === 'Enter'` while the
 * event target is a tracked-field-shaped element. `event.isTrusted` is
 * expected to have already been read through the caller's own captured native
 * getter (the `isTrustedGet` discipline `webview-preload.js` already carries)
 * — this function trusts the boolean it is handed, it does not re-derive it.
 * @param {{ type: string, isTrusted: boolean, target: any, key?: string }} event
 * @returns {boolean}
 */
function isCaptureGesture(event) {
  if (!event || event.isTrusted !== true) return false;
  if (event.type === 'click') return isButtonLikeElement(event.target);
  if (event.type === 'keydown') return event.key === 'Enter' && isFieldElement(event.target);
  return false;
}

/**
 * Resolve which ordinal, among `entries` (one family's detection result array,
 * document order — an ordinal is an INTEGER index, never a node reference,
 * per this flight's own pinned corpus shape), a gesture on `target` belongs
 * to. Two resolution steps, in order:
 *   1. `target` IS one of the tracked fields itself (the Enter-in-a-field
 *      case) — match by identity against every role.
 *   2. `target`'s owning form (the `.form` IDREF-or-containment property the
 *      real DOM and this app's own extractor both expose) equals one of the
 *      entries' OWN `.form` — the multi-form disambiguation case
 *      (two-login-forms-second-target.html).
 * With NEITHER a field match NOR a form match, `target` carries no form
 * association at all (the motivating "outside every form" shape) — fall back
 * to the SOLE entry when exactly one exists (never guess among several: DD3g
 * rejected proximity as the VALUE-security mechanism, but using it here only
 * to pick among already-real, already-provenance-gated entries costs at most
 * wrong-moment, never a wrong value — the same reasoning `resolveTargetForAnchor`
 * documents for fill). Returns `null` when nothing resolves.
 * @param {any} target
 * @param {any[]} entries
 * @param {string[]} roles
 * @returns {number | null}
 */
function resolveOrdinalInFamily(target, entries, roles) {
  if (!target || !Array.isArray(entries) || entries.length === 0) return null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    for (const role of roles) {
      if (entry[role] && entry[role] === target) return i;
    }
  }

  const targetForm = target.form || (typeof target.closest === 'function' ? target.closest('form') : null);
  if (targetForm) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].form === targetForm) return i;
    }
    return null; // inside a real form, but not one of the detected entries' own forms
  }

  return entries.length === 1 ? 0 : null;
}

/**
 * The full gesture-target resolution across all three families (AC5, DD5's
 * precedence): login checked first, then card, then identity LAST. Returns
 * `{ kind, ordinal }` or `null`. Reuses `resolveOrdinalInFamily` with
 * `IDENTITY_ROLES` for the identity arm — no new resolver (Guidance 3).
 * @param {any} target
 * @param {{ logins?: any[], cards?: any[], identities?: any[] }} entries
 * @returns {{ kind: 'login' | 'card' | 'identity', ordinal: number } | null}
 */
function resolveGestureTarget(target, { logins = [], cards = [], identities = [] } = {}) {
  const loginOrdinal = resolveOrdinalInFamily(target, logins, LOGIN_ROLES);
  if (loginOrdinal !== null) return { kind: 'login', ordinal: loginOrdinal };
  const cardOrdinal = resolveOrdinalInFamily(target, cards, CARD_ROLES);
  if (cardOrdinal !== null) return { kind: 'card', ordinal: cardOrdinal };
  const identityOrdinal = resolveOrdinalInFamily(target, identities, IDENTITY_ROLES);
  if (identityOrdinal !== null) return { kind: 'identity', ordinal: identityOrdinal };
  return null;
}

/** The isolated-world three-state snapshot's secret-bearing role, per kind (login/card only —
 * AC6: identity has no single secret-bearing role, so `snapshotHasProvenancedSecret`'s identity
 * arm never calls this). */
function secretRoleForKind(kind) {
  return kind === 'card' ? 'number' : 'password';
}

/**
 * AC6 / flight DD2: identity's value-layer admission gate, mirroring Flight 2's
 * LD2 scope-anchor gate one layer up (detection -> value). True iff the
 * snapshot's `anchorRole` (LD3 — a plain role-name string the observer threads
 * onto the identity snapshot entry, never re-derived here) names a REAL postal
 * role whose field is provenanced (`value != null`) AND at least one
 * `NON_POSTAL_ROLES` field is also provenanced. A missing or unrecognised
 * `anchorRole` (not a member of `POSTAL_ROLES`) fails closed — false.
 * @param {any} entrySnapshot
 * @returns {boolean}
 */
function identitySnapshotHasProvenancedSecret(entrySnapshot) {
  const anchorRole = entrySnapshot.anchorRole;
  if (typeof anchorRole !== 'string' || !POSTAL_ROLES.has(anchorRole)) return false;
  const anchorField = entrySnapshot[anchorRole];
  if (!anchorField || anchorField.value == null) return false;
  for (const role of NON_POSTAL_ROLES) {
    const field = entrySnapshot[role];
    if (field && field.value != null) return true;
  }
  return false;
}

/**
 * Does a per-entry THREE-STATE snapshot record (DD3h shape:
 * `{ role: { detected: true, value: string|null } }`) carry a PROVENANCED
 * secret worth holding? `entrySnapshot` is the isolated world's own report for
 * one resolved entry — never re-derived from a live DOM value here (this
 * module never reads `.value` itself; it only inspects the already-gated
 * snapshot). A gesture whose resolved entry has no provenanced secret (nothing
 * was ever typed/filled) is a gesture worth recognizing but NOT worth holding
 * — never even worth creating a pending-settle record for. Identity (AC6) is
 * dispatched to `identitySnapshotHasProvenancedSecret` instead of
 * `secretRoleForKind` — identity has no single secret-bearing role.
 * @param {any} entrySnapshot
 * @param {'login' | 'card' | 'identity'} kind
 * @returns {boolean}
 */
function snapshotHasProvenancedSecret(entrySnapshot, kind) {
  if (!entrySnapshot) return false;
  if (kind === 'identity') return identitySnapshotHasProvenancedSecret(entrySnapshot);
  const field = entrySnapshot[secretRoleForKind(kind)];
  return !!field && field.value != null;
}

module.exports = {
  isButtonLikeElement,
  isFieldElement,
  isCaptureGesture,
  resolveOrdinalInFamily,
  resolveGestureTarget,
  snapshotHasProvenancedSecret,
  secretRoleForKind,
  LOGIN_ROLES,
  CARD_ROLES,
  IDENTITY_ROLES
};
