// @ts-check
'use strict';

// Per-type vault-item schema — the SINGLE SOURCE OF TRUTH for which fields are
// secret vs. non-secret on each item type (M12 Flight 3, Leg 2 / DD3, DD6, DD10).
//
// BOTH security-critical paths import this so the exclude-set and the preserve-set
// are EXACT COMPLEMENTS and can never drift to leak or drop a field:
//   - the metadata projection (`vault-store.listItemsMeta` → `metadataOf`) — a
//     POSITIVE WHITELIST that copies ONLY the declared non-secret fields;
//   - the save-merge (`vault-store.saveItemPreservingSecrets` → `secretFieldsFor`)
//     — the secret complement, the set of fields a masked-untouched editor field
//     may ask main to preserve.
// NEVER hardcode a per-field blacklist anywhere else.
//
// PLAIN CJS BY DESIGN (the reserved-ids.js precedent): consumed main-side by
// vault-store.js (require) + register-vault-ipc.js + tests. It is deliberately NOT
// served to the browser page as a module — the page's editor field LAYOUT lives in
// the ESM vault-editor-model.js and is pinned to THIS taxonomy by a cross-module
// consistency test. Keeping this main-only avoids a require(esm) at app boot for a
// security-critical module.

/**
 * @typedef {'login' | 'card' | 'note'} ItemType
 * @typedef {{ nonSecret: string[], secret: string[] }} TypeSchema
 */

// Per the flight Context taxonomy (Architect-flagged linchpin):
//   login — non-secret: title/username/origin; secret: password/totp/notes
//   card  — non-secret: title/cardholder/brand/last4; secret: number/cvv/expiry/notes
//   note  — non-secret: title; secret: body/notes
// `notes` is a secret free-text field on EVERY type (the F2 capture test proves it
// holds secrets and must survive edits).
/** @type {Record<ItemType, TypeSchema>} */
const SCHEMA = {
  login: { nonSecret: ['title', 'username', 'origin'], secret: ['password', 'totp', 'notes'] },
  card: { nonSecret: ['title', 'cardholder', 'brand', 'last4'], secret: ['number', 'cvv', 'expiry', 'notes'] },
  note: { nonSecret: ['title'], secret: ['body', 'notes'] },
};

/** @type {ItemType[]} */
const ITEM_TYPES = /** @type {ItemType[]} */ (Object.keys(SCHEMA));

/**
 * @param {string} type
 * @returns {TypeSchema}
 */
function specFor(type) {
  const spec = SCHEMA[/** @type {ItemType} */ (type)];
  if (!spec) throw new Error(`vault-item-schema: unknown item type "${type}"`);
  return spec;
}

/**
 * The type's secret field names (a fresh array — safe to mutate).
 * @param {string} type
 * @returns {string[]}
 */
function secretFieldsFor(type) {
  return specFor(type).secret.slice();
}

/**
 * The type's non-secret field names (a fresh array — safe to mutate).
 * @param {string} type
 * @returns {string[]}
 */
function nonSecretFieldsFor(type) {
  return specFor(type).nonSecret.slice();
}

/**
 * Project an item to its non-secret METADATA via a POSITIVE WHITELIST: only the
 * type's declared non-secret fields are ever copied, plus `id`/`type` and a derived
 * `hasTotp` boolean. No secret field (password / totp / notes / note `body` /
 * card `number` / `cvv` / ...) can pass — the whitelist never reads their values
 * (only `totp`'s presence is coerced to a boolean flag). Even a stray secret key
 * on the item is dropped, because the projection iterates the whitelist, not the
 * item's own keys.
 * `matchMode` (M12 F4 Leg 4 / DD5) is surfaced the SAME way as `hasTotp` — a derived
 * metadata flag, NOT a `nonSecret` text field (adding it to SCHEMA.login.nonSecret would
 * trip the editor drift-guard and render a text input). It is emitted for `login` items
 * ONLY, coerced to `'exact'` | `'registrable-domain'` (absent/legacy/any other value →
 * `'exact'`, the positive-test default). It is never a secret and never carries one.
 * @param {any} item
 * @returns {{ id: any, type: string, hasTotp: boolean, [k: string]: any }}
 */
function metadataOf(item) {
  const type = item && item.type;
  const spec = specFor(type);
  /** @type {any} */
  const meta = { id: item.id, type, hasTotp: Boolean(item.totp) };
  for (const f of spec.nonSecret) {
    meta[f] = item[f] ?? null;
  }
  if (type === 'login') {
    meta.matchMode = item.matchMode === 'registrable-domain' ? 'registrable-domain' : 'exact';
  }
  return meta;
}

module.exports = { SCHEMA, ITEM_TYPES, secretFieldsFor, nonSecretFieldsFor, metadataOf };
