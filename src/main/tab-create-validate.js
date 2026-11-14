// @ts-check
'use strict';

// Main-side argument validation for `tab-create` and `identity-new` (Mission 23 Flight 1, leg
// `ipc-gate-complete`, finding 22c). Electron-free and pure: the URL predicates and the jars
// list are injected, so the whole matrix runs under `node --test`.
//
// The chrome is a trusted sender, but the arguments are re-validated here BEFORE any
// `webPreferences` are chosen (the two-point hostile-URL boundary's second point must not rest
// on the renderer having asked nicely): a `trusted` create may name only an internal page; an
// untrusted create may name only an http(s)/about:blank URL in a registered jar's partition or
// a burner partition, and never the internal partition.

const { INTERNAL_PARTITION } = require('../shared/internal-page');
// A burner partition by exact shape (`burner:<digits>`, as the renderer mints it) — one source.
const { isBurnerPartition } = require('../shared/burner');

/** Chromium keeps at most 50 session-history entries per tab; this is a generous ceiling. */
const MAX_RESTORE_ENTRIES = 200;

/**
 * ONE predicate for "a partition a tab (or an identity wipe) may name": a registered jar's own
 * partition or a burner partition by exact shape — never the internal partition.
 * @param {unknown} partition
 * @param {ReadonlyArray<{ partition?: unknown }>} jarsList
 * @returns {boolean}
 */
function isAdmissibleTabPartition(partition, jarsList) {
  if (typeof partition !== 'string' || partition === '') return false;
  if (partition === INTERNAL_PARTITION) return false;
  if (isBurnerPartition(partition)) return true;
  return Array.isArray(jarsList) && jarsList.some((jar) => jar && jar.partition === partition);
}

/**
 * Validate a `tab-create` payload. Returns the normalized arguments, or `null` (refused: the
 * caller returns `null` and constructs no view).
 * @param {any} payload
 * @param {{
 *   isSafeTabUrl: (url: unknown) => boolean,
 *   isInternalPageUrl: (url: unknown) => boolean,
 *   jarsList: ReadonlyArray<{ partition?: unknown }>
 * }} deps
 * @returns {{ url: string, partition: string | undefined, trusted: boolean,
 *   restoreHistory: { entries: any[], index: number } | null } | null}
 */
function validateTabCreate(payload, { isSafeTabUrl, isInternalPageUrl, jarsList }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { url, partition, trusted, restoreHistory } = payload;
  // Exactly true / false: a truthy string must never select the internal branch.
  if (trusted !== true && trusted !== false) return null;
  if (typeof url !== 'string' || url === '') return null;

  if (trusted) {
    if (!isInternalPageUrl(url)) return null;
  } else {
    if (!isSafeTabUrl(url)) return null;
    if (!isAdmissibleTabPartition(partition, jarsList)) return null;
  }

  /** @type {{ entries: any[], index: number } | null} */
  let restore = null;
  if (restoreHistory !== undefined && restoreHistory !== null) {
    if (typeof restoreHistory !== 'object' || Array.isArray(restoreHistory)) return null;
    // History restore is a web-tab feature (duplicate / reopen); an internal tab never has one.
    if (trusted) return null;
    const { entries, index } = restoreHistory;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_RESTORE_ENTRIES) return null;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return null;
    // An entry whose URL fails the check is DROPPED, not a reason to refuse the create (operator ruling
    // after leg `ipc-gate-complete`: a tab whose history holds one `file:` entry must still duplicate and
    // reopen). The index was validated against the ORIGINAL list above and is re-pointed to the surviving
    // entry nearest the original position (the same entry if it survived; on a tie the EARLIER one);
    // when no entry survives this is a plain create of `url` with no restore.
    const kept = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry && typeof entry === 'object' && isSafeTabUrl(entry.url)) kept.push({ entry, from: i });
    }
    if (kept.length > 0) {
      let best = kept[0];
      for (const k of kept) {
        if (Math.abs(k.from - index) < Math.abs(best.from - index)) best = k;
      }
      restore = { entries: kept.map((k) => k.entry), index: kept.indexOf(best) };
    }
  }

  return { url, partition: trusted ? undefined : partition, trusted, restoreHistory: restore };
}

module.exports = { isAdmissibleTabPartition, validateTabCreate, MAX_RESTORE_ENTRIES };
