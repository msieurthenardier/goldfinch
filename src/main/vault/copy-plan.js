// @ts-check
'use strict';

// Cross-vault copy planner (Sortie 04 DD2/DD3). PURE and Electron-free: given the
// item being copied and the destination vault's decrypted items, decide whether the
// item is NEW there, IDENTICAL to something already there, or collides with one or
// more existing items (a MATCH). `VaultStore.copyItem` owns every read and write;
// this module only classifies, so the match rule is unit-testable without a store.
//
// Match rule (same type only):
//   login    — `canonicalOrigin(origin)` + `(username ?? '')`. `canonicalOrigin` returns
//              `null` for a non-URL and the STRING 'null' for an opaque origin
//              (chrome://, file:, data:, android://); BOTH never match, on either side.
//   card     — `digitsOf(number)` equal and non-empty.
//   note     — `title` equal after trim, case-sensitive (two untitled notes therefore
//              match: '' === '' — accepted).
//   identity — the destination's FIRST identity (`identityProfileOf`) is the one match,
//              so `matchIds` is length 0 or 1. Extra identities are never touched.
// Identical = every schema field (nonSecret ∪ secret, plus login `matchMode`) equal,
// with undefined/null/'' alike. Never compared over `Object.keys` (ids and timestamps
// differ by design, and unknown extras are not part of the contract).

const { canonicalOrigin } = require('./browser-import');
const { digitsOf } = require('./card-identity');
const { identityProfileOf } = require('./identity-profile');
const { SCHEMA } = require('../../shared/vault-item-schema');

/**
 * Local login identity key (browser-import's `identityKey` is not exported and is a
 * trivial concat). `null` when the origin is a non-URL or opaque — never matches.
 * @param {any} origin
 * @param {any} username
 * @returns {string | null}
 */
function loginKey(origin, username) {
  const o = canonicalOrigin(origin);
  if (o === null || o === 'null') return null;
  return `${o} ${username ?? ''}`;
}

/**
 * @param {any} v
 * @returns {string}
 */
function trimmedTitle(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {any} v
 * @returns {string}
 */
function cardDigits(v) {
  return typeof v === 'string' ? digitsOf(v) : '';
}

/**
 * Login `matchMode` normalized: absent IS exact (origin-match.js, metadataOf).
 * @param {any} v
 * @returns {'exact' | 'registrable-domain'}
 */
function normMatchMode(v) {
  return v === 'registrable-domain' ? 'registrable-domain' : 'exact';
}

/**
 * @param {any} v
 * @returns {any}
 */
function blankAlike(v) {
  return v === undefined || v === null || v === '' ? '' : v;
}

/**
 * Whether two same-type items carry the same schema fields (see header).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function isIdenticalItem(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const spec = SCHEMA[/** @type {keyof typeof SCHEMA} */ (a.type)];
  if (!spec) return false;
  for (const f of [...spec.nonSecret, ...spec.secret]) {
    if (blankAlike(a[f]) !== blankAlike(b[f])) return false;
  }
  if (a.type === 'login' && normMatchMode(a.matchMode) !== normMatchMode(b.matchMode)) return false;
  return true;
}

/**
 * @param {any} item  the item being copied.
 * @param {any[]} destItems  the destination's decrypted items.
 * @returns {{ kind: 'new' } | { kind: 'identical', matchIds: string[] } | { kind: 'match', matchIds: string[] }}
 */
function planCopy(item, destItems) {
  const dest = Array.isArray(destItems) ? destItems : [];
  const candidates = dest.filter((d) => d && d.type === item.type);
  /** @type {any[]} */
  let matches = [];
  if (item.type === 'login') {
    const key = loginKey(item.origin, item.username);
    if (key !== null) matches = candidates.filter((d) => loginKey(d.origin, d.username) === key);
  } else if (item.type === 'card') {
    const digits = cardDigits(item.number);
    if (digits !== '') matches = candidates.filter((d) => cardDigits(d.number) === digits);
  } else if (item.type === 'note') {
    const title = trimmedTitle(item.title);
    matches = candidates.filter((d) => trimmedTitle(d.title) === title);
  } else if (item.type === 'identity') {
    const { profile } = identityProfileOf(dest);
    if (profile) matches = [profile];
  }
  if (matches.length === 0) return { kind: 'new' };
  const matchIds = matches.map((m) => m.id);
  if (matches.some((m) => isIdenticalItem(item, m))) return { kind: 'identical', matchIds };
  return { kind: 'match', matchIds };
}

/**
 * The resolutions the operator may be offered for a `match` plan (DD3).
 * @param {{ kind: string, matchIds?: string[] }} plan
 * @param {{ type?: string }} item
 * @returns {Array<'skip' | 'replace' | 'keep-both'>}
 */
function allowedFor(plan, item) {
  if (item && item.type === 'identity') return ['replace'];
  const n = plan.matchIds ? plan.matchIds.length : 0;
  return n === 1 ? ['skip', 'replace', 'keep-both'] : ['skip', 'keep-both'];
}

module.exports = { planCopy, allowedFor, isIdenticalItem };
