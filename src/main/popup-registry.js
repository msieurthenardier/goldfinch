// @ts-check
'use strict';

// Popup registry (M14 Flight 2, DD1a/DD1f — leg 1). The main-side record store
// for script-opened popup BrowserWindows (flight DD1, Option B): one entry per
// live popup webContents, keyed by the popup's wcId and carrying the opener
// linkage leg 2's census/challenge/addressability parity consumes.
//
//   { popupWcId, openerWcId, openerRecord, partition, win }
//
// - `openerRecord` is the OWNING WindowRecord — the window the popup closes
//   with (DD1f). It re-keys when the opener tab moves windows
//   (rekeyForRecord) so DD1f always closes popups with their CURRENT owning
//   window. It is TOLERATED-DEAD-OPENER by design: the opener TAB closing
//   leaves the entry (and popup) alive with a dangling `openerWcId` — leg 2's
//   eligibility rule must not depend on the opener contents staying alive
//   (flight-log seam note).
// - `partition` is captured EAGERLY at register time (from the opener's
//   tabViews entry) because census/attribution needs it after the opener tab
//   dies — a live lookup would come back empty exactly when it matters.
// - Chained popups (a popup opening a popup) parent FLAT to the same
//   openerRecord — a named simplification, not a tree (leg 1 edge ruling).
// - DD1e: registration NEVER touches the record's `tabViews` — popups are
//   structurally invisible to session snapshot / closed-tab capture, which
//   iterate `tabViews` only (pinned in popup-registry.test.js).
//
// Deliberately ELECTRON-FREE (window-registry precedent): `win` handles are
// injected and only ever compared/`.isDestroyed()`/`.destroy()`ed, so the
// module unit-tests offline with fakes. `cancelChallengesForPopup(popupWcId)`
// is the DD1f cancel seam — since M14 F2 L2 main.js wires the REAL popup-
// challenge cancel through it (a thin `authChallenges.cancelForTab(popupWcId,
// 'tab-close')` delegation; window-factory's cancelForWindow still runs first
// and the exactly-once ledger makes the double-cancel harmless).

/**
 * @typedef {{
 *   popupWcId: number,
 *   openerWcId: number,
 *   openerRecord: any,
 *   partition: string | undefined,
 *   win: any
 * }} PopupEntry
 */

/**
 * @param {{ cancelChallengesForPopup?: (popupWcId: number) => void, logger?: any }} [deps]
 */
function createPopupRegistry({ cancelChallengesForPopup = () => {}, logger = console } = {}) {
  /** @type {Map<number, PopupEntry>} */
  const popups = new Map();

  /**
   * Register a popup at `did-create-window` time.
   * @param {number} popupWcId
   * @param {{ openerWcId: number, openerRecord: any, partition: string | undefined, win: any }} parts
   * @returns {PopupEntry}
   */
  function register(popupWcId, { openerWcId, openerRecord, partition, win }) {
    const entry = { popupWcId, openerWcId, openerRecord, partition, win };
    popups.set(popupWcId, entry);
    return entry;
  }

  /** @param {number} popupWcId */
  function remove(popupWcId) {
    popups.delete(popupWcId);
  }

  /**
   * @param {number | null | undefined} wcId
   * @returns {PopupEntry | null}
   */
  function getByWcId(wcId) {
    if (wcId == null) return null;
    return popups.get(wcId) || null;
  }

  /**
   * The membership predicate leg 2's `resolve.js` addressability widening
   * consumes (DD1a seam note).
   * @param {number | null | undefined} wcId
   * @returns {boolean}
   */
  function isPopupWcId(wcId) {
    return wcId != null && popups.has(wcId);
  }

  /**
   * Every popup owned by the given WindowRecord (identity compare), in
   * registration order.
   * @param {any} record
   * @returns {PopupEntry[]}
   */
  function listForRecord(record) {
    const out = [];
    for (const entry of popups.values()) {
      if (entry.openerRecord === record) out.push(entry);
    }
    return out;
  }

  /**
   * Re-key every popup opened by `openerWcId` to the destination record — the
   * `moveTabIntoWindow` hook (leg 1 step 3b): after a cross-window tab move,
   * DD1f must close these popups with the DESTINATION window, not the source.
   * SYNCHRONOUS — called from inside the synchrony-pinned move core.
   * @param {number} openerWcId
   * @param {any} record destination WindowRecord
   */
  function rekeyForRecord(openerWcId, record) {
    for (const entry of popups.values()) {
      if (entry.openerWcId === openerWcId) entry.openerRecord = record;
    }
  }

  /**
   * DD1f: close every popup owned by `record`, in the pre-ruled order —
   * cancel popup challenges FIRST (the seam; stubbed this leg), then destroy
   * the popup windows. The list is SNAPSHOTTED before any destroy: each
   * destroy fires the popup's own teardown hooks, which call remove() and
   * would otherwise mutate the map mid-iteration.
   * @param {any} record
   */
  function closeAllForRecord(record) {
    const snapshot = listForRecord(record);
    for (const entry of snapshot) {
      try {
        cancelChallengesForPopup(entry.popupWcId);
      } catch (err) {
        logger.error('[popup-registry] cancel-challenges seam threw:', err);
      }
    }
    for (const entry of snapshot) {
      // destroy(), not close(): synchronous teardown inside the owner window's
      // own `close` dispatch; `closed`/`destroyed` still fire (the teardown
      // hooks deregister there — destroy() only skips `close`, which popups
      // don't use: DD1e means there is nothing to capture).
      try {
        if (entry.win && !entry.win.isDestroyed()) entry.win.destroy();
      } catch (err) {
        logger.error('[popup-registry] popup destroy failed:', err);
      }
      // Defensive: teardown hooks normally remove the entry; a hook that never
      // fired (already-destroyed win) must not leave a zombie entry behind.
      popups.delete(entry.popupWcId);
    }
  }

  return {
    register,
    remove,
    getByWcId,
    isPopupWcId,
    listForRecord,
    rekeyForRecord,
    closeAllForRecord
  };
}

module.exports = { createPopupRegistry };
