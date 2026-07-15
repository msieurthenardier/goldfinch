// @ts-check
'use strict';

// F7 DD2 — the per-window census backing the `enumerateWindows` automation op,
// the flight's single window-topology discovery primitive.
//
// This module is deliberately ELECTRON-FREE. It is duck-typed over the registry's
// records exactly as window-registry.js is (WinLike = { id, [k]: any }), so it
// never imports Electron nor either overlay manager's type, and it unit-tests
// offline with plain fakes. main.js is unit-test-exempt (Electron-bound); this
// module is what makes DD2 provable at all.

/**
 * A manager (menu sheet / find overlay) as this module reads it: the ONLY two
 * members DD2 needs are isVisible() and getView(). Deliberately NOT the full
 * manager type — the census must not couple to either manager's shape.
 *
 * @typedef {{ isVisible?: () => boolean, getView?: () => any } | null | undefined} ManagerLike
 * @typedef {{ win: { id: number, [k: string]: any }, chromeView: { webContents: any, [k: string]: any }, tabViews?: Map<number, any>, activeTabWcId?: number | null, bootConfigServed?: boolean, findOverlay?: ManagerLike, sheet?: ManagerLike, [k: string]: any }} RecordLike
 * @typedef {{ windowId: number, chromeWcId: number, booted: boolean, activeTabWcId: number | null, lastFocused: boolean, sheetWcId?: number, sheetVisible: boolean, findWcId?: number, findVisible: boolean }} WindowCensusRow
 */

/**
 * The wcId of a manager's view, or undefined on ANY miss.
 *
 * ABSENT (undefined) means "never created" — the lazy-singleton contract (DD5):
 * a window that never opens a menu never instantiates a sheet. This is NOT
 * normalized to null, deliberately: a caller must be able to tell "no sheet has
 * ever existed in this window" from "the sheet exists but is hidden", which is
 * exactly why sheetVisible is a SEPARATE field from sheetWcId. A present id with
 * sheetVisible:false is "instantiated but hidden"; an absent id is "never shown".
 *
 * NULL-TOLERANT by contract at every hop: leg 1 nulls rec.findOverlay / rec.sheet
 * in the window's `close` handler (AC8b) while the record stays reachable until
 * registry.remove() at `closed`, so both slots can be null on a LIVE record. The
 * manager may also exist while getView() returns null (never shown), and a view's
 * webContents can be destroyed mid-teardown — a destroyed wc must not throw.
 *
 * @param {ManagerLike} mgr
 * @returns {number | undefined}
 */
function viewWcId(mgr) {
  const view = typeof mgr?.getView === 'function' ? mgr.getView() : null;
  const wc = view?.webContents;
  if (!wc) return undefined;
  try {
    if (wc.isDestroyed?.()) return undefined;
  } catch {
    return undefined; // a destroyed handle whose guard itself throws
  }
  return typeof wc.id === 'number' ? wc.id : undefined;
}

/**
 * Whether a manager currently shows its view. Null-tolerant; never throws.
 *
 * @param {ManagerLike} mgr
 * @returns {boolean}
 */
function viewVisible(mgr) {
  try {
    return typeof mgr?.isVisible === 'function' ? !!mgr.isVisible() : false;
  } catch {
    return false;
  }
}

/**
 * DD2's per-window rows, derived AT CALL TIME.
 *
 * ZERO STATE: nothing is cached, there is no rebuild trigger, and nothing to
 * invalidate — every field is read from the records on each call. That is the
 * strongest argument for the op, so it is pinned by test (mutate a record between
 * two calls; the second call sees it).
 *
 * `lastFocused` is compared by RECORD IDENTITY against registry.getLastFocused()'s
 * return (guidance step 2 option (a)) — window-registry.js does not export
 * lastFocusedId (:52 is closure-local), and identity comparison keeps that module
 * on this leg's pinned-unchanged list while inheriting its membership-validated
 * first-record fallback for free. The census NEVER invents a fallback of its own:
 * when lastFocusedRecord matches no record, ZERO rows are true.
 *
 * The name is the contract: `lastFocused`, NOT `focused`. It maps to
 * getLastFocused() (window-registry.js:130-135) — main-side tracked and
 * membership-validated, because programmatic focus() fires no focus event under
 * WSLg and getFocusedWindow() goes stale indefinitely (F6 spike verdict 4).
 * `focused` would read as an OS-focus claim this codebase deliberately refuses to
 * make.
 *
 * @param {RecordLike[]} records  registry.records(), in INSERTION order
 * @param {RecordLike | null | undefined} lastFocusedRecord  registry.getLastFocused()'s return
 * @returns {WindowCensusRow[]}  one row per record, insertion order preserved
 */
function buildWindowCensus(records, lastFocusedRecord) {
  const out = [];
  for (const rec of records || []) {
    if (!rec || !rec.win) continue;
    const sheetWcId = viewWcId(rec.sheet);
    const findWcId = viewWcId(rec.findOverlay);
    /** @type {WindowCensusRow} */
    const row = {
      windowId: rec.win.id,
      chromeWcId: rec.chromeView?.webContents?.id,
      booted: !!rec.bootConfigServed,
      activeTabWcId: rec.activeTabWcId ?? null,
      // Identity compare, never an invented fallback — see the note above.
      lastFocused: !!lastFocusedRecord && rec === lastFocusedRecord,
      sheetVisible: viewVisible(rec.sheet),
      findVisible: viewVisible(rec.findOverlay),
    };
    // ABSENT ⇒ never created. Assigned conditionally so the key does not exist at
    // all (rather than existing as undefined/null) — pinned by test.
    if (sheetWcId !== undefined) row.sheetWcId = sheetWcId;
    if (findWcId !== undefined) row.findWcId = findWcId;
    out.push(row);
  }
  return out;
}

module.exports = { buildWindowCensus };
