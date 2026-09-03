// @ts-check
'use strict';

// Per-owning-window held-import store (PR#112 finding 5; re-modeled M18 F3 Leg 3 / DD2
// ruling 1, DD5 ruling 4). The portable-vault RESTORE flow is a multi-step transaction:
// the vault page picks a bundle file (main-side dialog + read), the chrome-owned secret
// sheet verifies it (a store PREVIEW — no write), and the page's mapping modal collects a
// per-vault directive before the operator commits. The record is HELD main-side across
// all of that — never on the page, never on the sheet.
//
// PER-OWNING-WINDOW (PR#112 finding 5): the record is keyed by the OWNING CHROME
// webContents id (the shared identity of both the page tab, via chromeForTab(tabId), and
// the secret sheet, which renders IN that chrome). Every accessor is window-scoped, so one
// window can never read, mutate, clear, or consume another window's import. Each record
// also carries an opaque `handle` minted at hold time.
//
// RECORD LIFECYCLE (DD2 ruling 1): `hold()` at file-pick creates `{ bundle, handle }` —
// NO destination, NO overwrite flag; both are commit-time concerns the mapping step binds.
// A successful secret step (`stashSecret`) ADDS `{ secret (Buffer), secretKind, labels }` —
// the store's non-secret preview labels — and arms the bounded SAFETY-DROP timer (DD5
// ruling 4, the `vault-human.js` `CAPTURE_DROP_MS` precedent: injected setTimeout/
// clearTimeout so the suite runs wall-clock-free). `take()` CANCELS the timer as part of
// consuming the record (cycle-2 HIGH — the take()/timer race: a commit started just before
// expiry must not have its buffer zeroized out from under it by the dangling timer, exactly
// the `vault-human.js` `dropCapture` choke-point discipline). Every OTHER exit — `clear`
// (explicit cancel/dismiss), `drop` (lock / window-close / expiry) — zeroizes the secret
// buffer (when present) and cancels the timer. `chromeIds()` mirrors the compromise-reveal
// store's enumeration (DD5 ruling 4) for the vault-lock bulk-drop hook.
//
// ELECTRON-FREE + PURE (the dialog/file read live in main.js): unit-tested headlessly.

// The held-record safety-drop timeout, secret-bearing phase only (DD5 ruling 4): mapping is
// operator-paced reading, longer than a vault-human capture decision, but still bounded.
const SAFETY_DROP_MS = 5 * 60 * 1000;

/**
 * @typedef {Object} PendingImportLabel
 * @property {string} sourceId
 * @property {{ name: string, color: string } | null} jarMeta
 * @property {number} itemCount
 */

/**
 * @typedef {Object} PendingImportRecord
 * @property {any} bundle  the parsed (ciphertext) bundle.
 * @property {string} handle  the opaque per-transaction token.
 * @property {Buffer} [secret]  the VERIFIED bundle secret — present only post-preview.
 * @property {'master'|'recovery'} [secretKind]
 * @property {PendingImportLabel[]} [labels]  the store preview's non-secret labels.
 * @property {any} [timer]  the injected safety-drop timer handle (secret-bearing phase only).
 */

/**
 * @param {{
 *   mintHandle: () => string,
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (handle: any) => void,
 * }} deps
 * @returns {{
 *   hold: (chromeId: number, parts: { bundle: any }) => string,
 *   stashSecret: (chromeId: number, parts: { secret: Buffer, secretKind?: 'master'|'recovery', labels: PendingImportLabel[] }, handle?: string) => void,
 *   clear: (chromeId: number, handle?: string) => void,
 *   take: (chromeId: number) => PendingImportRecord | null,
 *   peek: (chromeId: number) => PendingImportRecord | null,
 *   peekLabels: (chromeId: number) => { handle: string, labels: PendingImportLabel[] } | null,
 *   chromeIds: () => number[],
 *   dropAll: () => void,
 * }}
 */
function createPendingImportStore({
  mintHandle,
  setTimeout: _setTimeout = setTimeout,
  clearTimeout: _clearTimeout = clearTimeout
}) {
  /** @type {Map<number, PendingImportRecord>} */
  const byChrome = new Map();

  /** @param {PendingImportRecord} rec */
  function cancelTimer(rec) {
    if (rec.timer != null) {
      _clearTimeout(rec.timer);
      rec.timer = undefined;
    }
  }

  /** @param {PendingImportRecord} rec */
  function zeroize(rec) {
    if (rec.secret && typeof rec.secret.fill === 'function') rec.secret.fill(0);
  }

  /**
   * Drop THIS window's record for ANY reason (DD5's ONE drop helper — lock, window-close,
   * pagehide, safety-drop expiry, explicit cancel all funnel here): cancel the safety-drop
   * timer, zeroize the secret buffer when present, remove the record. No-op on a missing
   * record (every drop path is safe to call unconditionally).
   * @param {number} chromeId
   */
  function drop(chromeId) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    cancelTimer(rec);
    zeroize(rec);
    byChrome.delete(chromeId);
  }

  /**
   * Hold a freshly picked bundle for a window, minting + returning its opaque handle.
   * Overwrites this window's OWN prior record only (a re-pick in the same window) — never
   * another window's — safely dropping (zeroize + cancel) whatever it replaces.
   * @param {number} chromeId
   * @param {{ bundle: any }} parts
   * @returns {string}
   */
  function hold(chromeId, { bundle }) {
    drop(chromeId);
    const handle = mintHandle();
    byChrome.set(chromeId, { bundle, handle });
    return handle;
  }

  /**
   * Bind the store preview's VERIFIED secret + non-secret labels onto THIS window's record
   * and arm the safety-drop timer (DD5 ruling 4). No-op on a missing record or a mismatched
   * handle (the `setOverwrite`-guard idiom).
   * @param {number} chromeId
   * @param {{ secret: Buffer, secretKind?: 'master'|'recovery', labels: PendingImportLabel[] }} parts
   * @param {string} [handle]
   */
  function stashSecret(chromeId, { secret, secretKind, labels }, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    if (handle != null && handle !== rec.handle) return;
    cancelTimer(rec); // defensive — a re-submit replaces any prior timer.
    rec.secret = secret;
    rec.secretKind = secretKind;
    rec.labels = labels;
    rec.timer = _setTimeout(() => drop(chromeId), SAFETY_DROP_MS);
  }

  /** Drop THIS window's record; no-op on a missing record or a mismatched handle. */
  function clear(chromeId, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    if (handle != null && handle !== rec.handle) return;
    drop(chromeId);
  }

  /**
   * Consume + remove THIS window's record (or null) — the commit path. CANCELS the safety-
   * drop timer WITHOUT zeroizing (cycle-2 HIGH — the take()/timer race): a commit that
   * started at T-1s must hold the live buffer by reference while the timer would otherwise
   * zeroize it mid-scrypt. The consumer now owns the secret buffer's lifetime.
   * @param {number} chromeId
   * @returns {PendingImportRecord | null}
   */
  function take(chromeId) {
    const rec = byChrome.get(chromeId) || null;
    if (rec) {
      cancelTimer(rec);
      byChrome.delete(chromeId);
    }
    return rec;
  }

  /** Read THIS window's record without consuming it (or null) — tests / diagnostics. */
  function peek(chromeId) {
    return byChrome.get(chromeId) || null;
  }

  /**
   * The page's window-scoped labels fetch (DD2 ruling 3(c)): a NON-SECRET projection —
   * `{ handle, labels }` — or null when this window holds nothing past the secret step yet
   * (no record, or a record still awaiting its secret). Never returns the bundle or secret.
   * @param {number} chromeId
   * @returns {{ handle: string, labels: PendingImportLabel[] } | null}
   */
  function peekLabels(chromeId) {
    const rec = byChrome.get(chromeId);
    if (!rec || rec.labels === undefined) return null;
    return { handle: rec.handle, labels: rec.labels };
  }

  /** The chromeIds with a held record — the vault-lock bulk-drop enumeration (DD5 ruling 4). */
  function chromeIds() {
    return [...byChrome.keys()];
  }

  /** Drop EVERY held record (vault lock, manual or idle — DD5 ruling 4). */
  function dropAll() {
    for (const chromeId of chromeIds()) drop(chromeId);
  }

  return { hold, stashSecret, clear, take, peek, peekLabels, chromeIds, dropAll };
}

module.exports = { createPendingImportStore, SAFETY_DROP_MS };
