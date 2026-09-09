// @ts-check
'use strict';

// Held plaintext-payload store for a browser CSV credential import (M19 F1
// Leg 1 / DD6). A SIBLING module to `pending-imports.js` (the portable-vault
// restore hold store) — NOT a second instance of its `createPendingImportStore`
// factory. Reason (leg ruling 1): that factory's record shape is pinned to
// EXACTLY `['bundle','handle']` (`test/unit/vault-pending-imports.test.js:75`),
// its safety-drop timer arms only at `stashSecret` (`:108`) — a LATER, distinct
// step — and its `zeroize` wipes only `rec.secret` (`pending-imports.js`). A
// browser import has no analogous two-step shape: the read Buffer IS the
// plaintext credentials from the moment it is held, so the timer must arm AT
// `hold`, and the record itself carries the raw payload, never a bundle. A
// second instance of the UNCHANGED restore factory cannot express either of
// those — hence a sibling module, keeping restore's pinned lifecycle
// byte-untouched.
//
// PER-OWNING-WINDOW, same discipline as `pending-imports.js`: keyed by the
// owning chrome webContents id (the shared identity of both the vault page
// tab and any future secret-adjacent surface for this flow). One window can
// never read, mutate, clear, or consume another window's held import.
//
// `hold` refuses (throws `TypeError`, nothing held) a non-Buffer payload or
// one exceeding `MAX_PAYLOAD_BYTES` — checked BEFORE anything is dropped or
// stored, so a refused hold never disturbs a window's prior record. A
// same-window re-hold drops (zeroize + cancel) whatever it replaces.
// `peekSummary` is the ONLY page-facing projection — `{ handle, summary }`,
// NEVER the payload. `take` is HANDLE-GUARDED (unlike restore's `take`), so a
// stale commit can never consume a superseded record; it cancels the timer
// WITHOUT zeroizing — Leg 2's commit handler owns the buffer's lifetime from
// that point and must zeroize it itself after use (the DD6
// `finally { payload.fill(0) }` mirror of the restore commit,
// `main.js:1218-1222`). Every OTHER exit — `clear` (explicit cancel/dismiss),
// `dropAll` (lock), timer expiry, a same-window re-hold — zeroizes the
// payload and cancels the timer, all funneled through one `drop`.
//
// This module never keeps the idle auto-lock timer from firing on its
// account — structural: it imports nothing that could pause it (the same
// DD5/DD6 reasoning as `pending-imports.js`: a held plaintext must never
// keep the vault unlocked). Grep-pinned in `pending-browser-imports.test.js`.
//
// ELECTRON-FREE + PURE: unit-tested headlessly with injected timer fns.

const { MAX_PAYLOAD_BYTES } = require('./browser-import');

// The held-record safety-drop timeout (leg ruling 8): the restore store's
// `SAFETY_DROP_MS` value, kept as a SEPARATE constant so the two can diverge
// deliberately later.
const HOLD_DROP_MS = 5 * 60 * 1000;

/**
 * @typedef {Object} PendingBrowserImportSummary
 * @property {number} candidateCount
 * @property {Array<{ line: number, reason: string, scheme?: string }>} skipped
 */

/**
 * @typedef {Object} PendingBrowserImportRecord
 * @property {string} handle  the opaque per-transaction token.
 * @property {Buffer} payload  the read (and size-capped) export file bytes.
 * @property {PendingBrowserImportSummary} summary  the caller's non-secret projection.
 * @property {any} [timer]  the injected safety-drop timer handle.
 */

/**
 * @param {{
 *   mintHandle: () => string,
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (handle: any) => void,
 * }} deps
 * @returns {{
 *   hold: (chromeId: number, parts: { payload: Buffer, summary: PendingBrowserImportSummary }) => string,
 *   peekSummary: (chromeId: number) => { handle: string, summary: PendingBrowserImportSummary } | null,
 *   take: (chromeId: number, handle: string) => PendingBrowserImportRecord | null,
 *   clear: (chromeId: number, handle?: string) => void,
 *   chromeIds: () => number[],
 *   dropAll: () => void,
 * }}
 */
function createPendingBrowserImportStore({
  mintHandle,
  setTimeout: _setTimeout = setTimeout,
  clearTimeout: _clearTimeout = clearTimeout
}) {
  /** @type {Map<number, PendingBrowserImportRecord>} */
  const byChrome = new Map();

  /** @param {PendingBrowserImportRecord} rec */
  function cancelTimer(rec) {
    if (rec.timer != null) {
      _clearTimeout(rec.timer);
      rec.timer = undefined;
    }
  }

  /**
   * Drop THIS window's record for ANY reason — cancel the safety-drop timer,
   * zeroize the payload IN PLACE, remove the record. No-op on a missing
   * record (every drop path is safe to call unconditionally). Inlined
   * (rather than a separate zeroize helper) so `take` and `drop` are the
   * ONLY two places in this module that ever read the `payload` field back
   * (leg ruling 9(c) / AC21) — `peekSummary` never touches it.
   * @param {number} chromeId
   */
  function drop(chromeId) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    cancelTimer(rec);
    if (rec.payload && typeof rec.payload.fill === 'function') rec.payload.fill(0);
    byChrome.delete(chromeId);
  }

  /**
   * Hold a freshly read export payload for a window, minting + returning its
   * opaque handle. Refuses (throws `TypeError`, nothing held) a non-Buffer
   * payload or one exceeding `MAX_PAYLOAD_BYTES` — checked BEFORE dropping
   * any prior record, so a refused hold leaves the window's existing record
   * (if any) untouched. Otherwise drops this window's OWN prior record only
   * (zeroize + cancel) and arms the safety-drop timer IMMEDIATELY — the
   * record is sensitive from the moment it is held (leg ruling 8), unlike
   * restore's two-step hold/stashSecret shape.
   * @param {number} chromeId
   * @param {{ payload: Buffer, summary: PendingBrowserImportSummary }} parts
   * @returns {string}
   */
  function hold(chromeId, { payload, summary }) {
    if (!Buffer.isBuffer(payload)) {
      throw new TypeError('pending-browser-imports: payload must be a Buffer');
    }
    if (payload.length > MAX_PAYLOAD_BYTES) {
      throw new TypeError(`pending-browser-imports: payload exceeds MAX_PAYLOAD_BYTES (${payload.length})`);
    }
    drop(chromeId);
    const handle = mintHandle();
    /** @type {PendingBrowserImportRecord} */
    const rec = { handle, payload, summary, timer: undefined };
    rec.timer = _setTimeout(() => drop(chromeId), HOLD_DROP_MS);
    byChrome.set(chromeId, rec);
    return handle;
  }

  /**
   * The page's window-scoped summary fetch — the ONLY page-facing
   * projection. Never the payload, never candidate field content. Null when
   * this window holds nothing.
   * @param {number} chromeId
   * @returns {{ handle: string, summary: PendingBrowserImportSummary } | null}
   */
  function peekSummary(chromeId) {
    const rec = byChrome.get(chromeId);
    if (!rec) return null;
    return { handle: rec.handle, summary: rec.summary };
  }

  /**
   * Consume + remove THIS window's record — the commit path. HANDLE-GUARDED
   * (unlike restore's `take`): a missing record or a MISMATCHED handle
   * returns null and leaves the record (and its timer) fully intact, so a
   * stale commit can never consume a superseded record. On a match, cancels
   * the safety-drop timer WITHOUT zeroizing the payload — the consumer now
   * owns the buffer's lifetime and must zeroize it after use.
   * @param {number} chromeId
   * @param {string} handle
   * @returns {PendingBrowserImportRecord | null}
   */
  function take(chromeId, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec || rec.handle !== handle) return null;
    cancelTimer(rec);
    byChrome.delete(chromeId);
    return rec;
  }

  /**
   * Drop THIS window's record; no-op on a missing record or a mismatched
   * handle (the `handle` argument, when supplied, guards a stale cancel the
   * same way `take` does).
   * @param {number} chromeId
   * @param {string} [handle]
   */
  function clear(chromeId, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    if (handle != null && handle !== rec.handle) return;
    drop(chromeId);
  }

  /** The chromeIds with a held record — the vault-lock bulk-drop enumeration. */
  function chromeIds() {
    return [...byChrome.keys()];
  }

  /** Drop EVERY held record (vault lock, manual or idle). */
  function dropAll() {
    for (const chromeId of chromeIds()) drop(chromeId);
  }

  return { hold, peekSummary, take, clear, chromeIds, dropAll };
}

module.exports = { createPendingBrowserImportStore, HOLD_DROP_MS };
