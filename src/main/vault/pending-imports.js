// @ts-check
'use strict';

// Per-owning-window held-import store (PR#112 finding 5). The portable-vault IMPORT flow is a
// two-surface, multi-step transaction: the vault page picks a destination + bundle (main-side
// dialog + read), then the chrome-owned secret sheet unlocks it. The ciphertext bundle + the
// destination are HELD main-side between those steps.
//
// Previously this was ONE process-global record, so in a multi-window session window A's pick
// could be overwritten by window B, and A's Continue / secret-submit / overwrite-flag / cancel
// then acted on B's record — a cross-window destination + destructive-overwrite confusion. This
// store keys every record by the OWNING CHROME webContents id (the shared identity of both the
// page tab, via chromeForTab(tabId), and the secret sheet, which renders IN that chrome). Each
// record also carries an opaque `handle` minted at hold time; the page echoes it on the mutating
// steps as a per-transaction guard within one window. Every accessor is window-scoped, so one
// window can never read, mutate, clear, or consume another window's import.
//
// ELECTRON-FREE + PURE (the dialog/file read live in main.js): unit-tested headlessly.

/**
 * @typedef {Object} PendingImportRecord
 * @property {any} bundle  the parsed (ciphertext) bundle.
 * @property {string} destinationTarget  `'global'` or a persistent jar id.
 * @property {boolean} overwrite  the Replace-existing decision (bound at Continue).
 * @property {string} handle  the opaque per-transaction token.
 */

/**
 * @param {() => string} mintHandle  opaque-handle generator (main injects crypto.randomUUID).
 * @returns {{
 *   hold: (chromeId: number, parts: { bundle: any, destinationTarget: string }) => string,
 *   setOverwrite: (chromeId: number, overwrite: boolean, handle?: string) => void,
 *   clear: (chromeId: number, handle?: string) => void,
 *   take: (chromeId: number) => PendingImportRecord | null,
 *   peek: (chromeId: number) => PendingImportRecord | null,
 * }}
 */
function createPendingImportStore(mintHandle) {
  /** @type {Map<number, PendingImportRecord>} */
  const byChrome = new Map();

  /**
   * Hold a freshly picked bundle for a window, minting + returning its opaque handle. Overwrites
   * this window's OWN prior record only (a re-pick in the same window) — never another window's.
   */
  function hold(chromeId, { bundle, destinationTarget }) {
    const handle = mintHandle();
    byChrome.set(chromeId, { bundle, destinationTarget, overwrite: false, handle });
    return handle;
  }

  /** Bind `overwrite` on THIS window's record; no-op on a missing record or a mismatched handle. */
  function setOverwrite(chromeId, overwrite, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    if (handle != null && handle !== rec.handle) return;
    rec.overwrite = overwrite === true;
  }

  /** Drop THIS window's record; no-op on a missing record or a mismatched handle. */
  function clear(chromeId, handle) {
    const rec = byChrome.get(chromeId);
    if (!rec) return;
    if (handle != null && handle !== rec.handle) return;
    byChrome.delete(chromeId);
  }

  /** Consume + remove THIS window's record (or null). The secret-submit path calls this. */
  function take(chromeId) {
    const rec = byChrome.get(chromeId) || null;
    if (rec) byChrome.delete(chromeId);
    return rec;
  }

  /** Read THIS window's record without consuming it (or null) — tests / diagnostics. */
  function peek(chromeId) {
    return byChrome.get(chromeId) || null;
  }

  return { hold, setOverwrite, clear, take, peek };
}

module.exports = { createPendingImportStore };
