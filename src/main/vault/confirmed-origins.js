'use strict';

// `confirmedOrigins` - the sites where the operator has already confirmed filling a CARD or IDENTITY item
// (Mission 23 Flight 1, leg `vault-picker-controls`, DD6). A fill of such an item on a site not listed here
// asks once first; after a confirmed fill the site is recorded and the item fills there without asking.
//
// A top-level array of origin strings on the stored item, outside the schema's field lists (like
// `matchMode`'s sibling bookkeeping): never in `metadataOf`, so never in the vault page's list payload;
// never rewritten on load; no vault format version change. This module is the small pure home of its three
// rules - the tolerant reader, the cap, the append - so every writer shares one definition.
//
// Electron-free and pure.

/** The most origins one item remembers; the oldest is dropped first (that site then asks again). */
const CONFIRMED_ORIGINS_CAP = 50;

/**
 * The item's confirmed origins. Tolerant: anything that is not an array reads as empty, and non-string
 * (or empty) entries are filtered out. Never throws, never mutates.
 * @param {any} item
 * @returns {string[]}
 */
function readConfirmedOrigins(item) {
  const raw = item && typeof item === 'object' ? item.confirmedOrigins : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((o) => typeof o === 'string' && o.length > 0);
}

/**
 * Append an origin: an origin already listed is a no-op (no duplicate, no reordering, `changed: false`, and
 * the caller must not write); past the cap the oldest entries are dropped.
 * @param {string[]} list
 * @param {string} origin
 * @param {number} [cap]
 * @returns {{ list: string[], changed: boolean }}
 */
function appendConfirmedOrigin(list, origin, cap = CONFIRMED_ORIGINS_CAP) {
  const current = Array.isArray(list) ? list : [];
  if (typeof origin !== 'string' || origin.length === 0 || current.includes(origin)) {
    return { list: current, changed: false };
  }
  const next = current.concat(origin);
  return { list: next.length > cap ? next.slice(next.length - cap) : next, changed: true };
}

/**
 * A shallow copy of the item without `confirmedOrigins` (cross-vault copy strips it; bundle-merge equality
 * ignores it).
 * @template {object} T
 * @param {T} item
 * @returns {T}
 */
function withoutConfirmedOrigins(item) {
  if (!item || typeof item !== 'object' || !('confirmedOrigins' in item)) return item;
  const copy = { ...item };
  delete (/** @type {any} */ (copy).confirmedOrigins);
  return copy;
}

module.exports = { CONFIRMED_ORIGINS_CAP, readConfirmedOrigins, appendConfirmedOrigin, withoutConfirmedOrigins };
