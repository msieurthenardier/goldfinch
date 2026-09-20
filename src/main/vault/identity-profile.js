// @ts-check
'use strict';

// Identity-profile helpers (Mission 21, Flight 2, Leg 3 / DD2, LD2, LD3) — pure,
// main-only CJS, the `card-identity.js` precedent (no Electron, no vault-store state;
// every function takes plain data in and returns plain data out).
//
// Two concerns live here, both required by this leg even though NEITHER has a live
// caller yet — Flight 3 wires detection/capture/fill to the store this leg only
// prepares:
//   - `identityProfileOf(items)` — LD2's CANONICAL "the identity profile" read. A
//     future caller doing `items.find(it => it.type === 'identity')` would silently
//     pick whichever item sorts first and HIDE a duplicate rather than surface one —
//     exactly the failure mode the store's own write-path uniqueness enforcement
//     (`vault-store.js`: `_saveItem`'s refusal, `mergeVaultItems`'s collision skip,
//     `capSingleIdentity`'s import-time cap) exists to prevent in the first place.
//   - `classifyCapture(stored, captured)` — DD2's conflict rule, promoted from a
//     paper decision to a pure, unit-tested function per flight DD2 / leg LD3:
//     "Not trusted until proven" (DD1's own language) applies here too — a rule
//     asserted and never attacked is exactly what shipped squawks 0090 and 0091.
//
// IDENTITY_FIELDS is DERIVED from vault-item-schema.js's SCHEMA.identity (minus
// `title`, which is the item's own nickname, not a captured identity field) rather
// than hand-typed again — a THIRD hardcoded copy of Leg 2's eleven detector role
// names is exactly the drift risk AC8 forbids ("matching Leg 2's detector role names
// exactly, with no translation layer").
//
// STATED, not yet built (leg AC): `fullName` may be COMPOSED from `firstName` +
// `lastName` when a form splits the name into two fields — Leg 2's detector resolves
// `firstName`/`lastName` independently of `fullName` (see the `alternatives`
// discipline in `vault-identity-fields.js`), so a captured record can carry either or
// both. This module does not compose them (no caller exists yet — that composition,
// like every other wiring, is Flight 3's job); until Flight 3 does it, a picker row
// for a profile saved from a split-name form may show `title` alone, with `fullName`
// left unset. Documented here so that gap is a stated leg residual, not a
// Flight-3-discovered surprise.

const { nonSecretFieldsFor, secretFieldsFor } = require('../../shared/vault-item-schema');

/** @type {string[]} */
const IDENTITY_FIELDS = [...nonSecretFieldsFor('identity'), ...secretFieldsFor('identity')].filter(
  (f) => f !== 'title'
);

/**
 * True when `v` is a real, present value — not absent, not an empty string. Used
 * for both the stored profile and the captured record: an empty/missing field is a
 * gap, never a conflict, on EITHER side.
 * @param {any} v
 * @returns {boolean}
 */
function isPresent(v) {
  return typeof v === 'string' ? v.length > 0 : v != null;
}

/**
 * LD2's canonical "the identity profile" accessor. NEVER `items.find(it => it.type
 * === 'identity')` — that silently picks whichever item sorts first if the store's
 * write-path uniqueness invariant were ever violated (a channel this leg didn't
 * reach, a hand-edited `.gfvault`, ...) and hides the duplicate instead of surfacing
 * it. Returns the FIRST identity item (array order) as `profile` (or `null` when
 * none exists) plus `extra`: every OTHER identity item found, so a caller can detect
 * and report a violation rather than quietly discarding it.
 * @param {any[]} items
 * @returns {{ profile: any | null, extra: any[] }}
 */
function identityProfileOf(items) {
  const list = Array.isArray(items) ? items : [];
  const identities = list.filter((it) => it && it.type === 'identity');
  return { profile: identities.length > 0 ? identities[0] : null, extra: identities.slice(1) };
}

/**
 * DD2's conflict rule (flight DD2, leg LD3): classify a captured identity record
 * against the vault's stored profile (or `null`/`undefined` on a fresh profile —
 * every field a captured value is present for is then a gap, DD2's own residual).
 *
 * Only fields PRESENT in `captured` are ever judged — a capture only speaks to what
 * a form actually carried. For each such field:
 *   - absent/empty in `stored`  -> a GAP: `gapFilled` gets `{ field, to }`.
 *   - present in `stored`, and equal to the captured value -> a MATCH (no entry).
 *   - present in `stored`, and NOT equal -> a CONFLICT: `conflicting` gets
 *     `{ field, from, to }`.
 *
 * Equality is BYTE-EXACT — no normalisation, no trimming, no case-folding. `"555-
 * 1234"` vs `"5551234"` is a conflict; normalising would be a judgement call this
 * module has no business making silently. `kind` is `'conflict'` when ANY field
 * conflicts (DD2: "never silently overwrite"), else `'gap-fill'` when at least one
 * gap was filled (DD2: "offer a merge"), else `'match'` (DD2: "no offer,
 * unchanged") — including the vacuous case where `captured` supplies nothing at
 * all, or a stored profile and an empty capture: no fields are judged, so nothing
 * can conflict or gap-fill.
 * @param {any} stored  the vault's existing identity item, or null/undefined.
 * @param {any} captured  a plain record of captured identity field values.
 * @returns {{ kind: 'match' | 'gap-fill' | 'conflict', gapFilled: Array<{ field: string, to: any }>, conflicting: Array<{ field: string, from: any, to: any }> }}
 */
function classifyCapture(stored, captured) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const cap = captured && typeof captured === 'object' ? captured : {};

  /** @type {Array<{ field: string, to: any }>} */
  const gapFilled = [];
  /** @type {Array<{ field: string, from: any, to: any }>} */
  const conflicting = [];

  for (const field of IDENTITY_FIELDS) {
    const capVal = cap[field];
    if (!isPresent(capVal)) continue; // nothing captured for this field — not judged.
    const storedVal = src[field];
    if (!isPresent(storedVal)) {
      gapFilled.push({ field, to: capVal });
      continue;
    }
    if (storedVal === capVal) continue; // byte-exact match — no entry either way.
    conflicting.push({ field, from: storedVal, to: capVal });
  }

  const kind = conflicting.length > 0 ? 'conflict' : gapFilled.length > 0 ? 'gap-fill' : 'match';
  return { kind, gapFilled, conflicting };
}

module.exports = { IDENTITY_FIELDS, identityProfileOf, classifyCapture };
