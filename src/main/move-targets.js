// @ts-check
'use strict';

// F8 DD8 — the "Move to window …" target list backing the tab context menu's
// flat cross-window move items.
//
// This module is deliberately ELECTRON-FREE, duck-typed over the registry's
// records exactly as window-census.js is, so it never imports Electron and
// unit-tests offline with plain fakes. main.js is unit-test-exempt
// (Electron-bound); extracting this builder is what makes DD8's AC3 —
// "mutate the registry order between build and dispatch, and the SAME window is
// still targeted" — expressible as a test at all. A builder living in main.js
// could only be read as text, never run.
//
// ZERO STATE, the window-census.js thesis: every row is derived from the live
// records at call time. Nothing is cached here and there is nothing to
// invalidate. (main.js pushes the built list to each chrome so the menu opener
// stays synchronous — that CACHE lives renderer-side and holds only the LABEL;
// see the AUTHORITY note below for why its staleness cannot mis-target.)
//
// AUTHORITY (main.js:270 / automation/tabs.js:63, restated at this seam): the
// registry — never a renderer's claim — decides which window owns a tab. A row's
// `windowId` is a DESTINATION REQUEST when the renderer echoes it back, and main
// re-resolves it through registry.get() and re-validates tab ownership against
// the SENDER's own record. That is why keying on `windowId` rather than an
// ordinal is safe to hand a renderer, and why a stale LABEL degrades to a
// cosmetic wrong caption rather than a move into the wrong window.

/**
 * @typedef {{ view: { webContents: any, [k: string]: any }, [k: string]: any }} TabEntryLike
 * @typedef {{ win: { id: number, [k: string]: any }, tabViews?: Map<number, TabEntryLike>, activeTabWcId?: number | null, [k: string]: any }} RecordLike
 * @typedef {{ windowId: number, label: string }} MoveTarget
 */

/** The caption for a window with no readable active-tab title — renderer.js's own idiom. */
const FALLBACK_LABEL = 'New tab';

/** A title longer than this is elided: a menu item is not a place for a 200-char <title>. */
const MAX_LABEL = 40;

/**
 * A window's caption: its ACTIVE tab's live title (DD8 — "labeled from the
 * target's active tab title").
 *
 * Read off the live webContents, not off the tabViews entry: an entry is
 * `{ view, partition, trusted, active }` and carries NO title (the closed-tab
 * stack's entries do — a different structure with the same word in it). Total
 * and never-throwing at every hop, the window-census.js viewWcId contract: a
 * record can hold a stale activeTabWcId whose wc is already destroyed (the
 * last-tab close leaves no tab-set-active behind it), and a destroyed handle can
 * throw on the guard itself.
 *
 * @param {RecordLike} rec
 * @returns {string}
 */
function activeTabLabel(rec) {
  try {
    const wcId = rec.activeTabWcId;
    if (typeof wcId !== 'number') return FALLBACK_LABEL;
    const wc = rec.tabViews?.get(wcId)?.view?.webContents;
    if (!wc || wc.isDestroyed?.()) return FALLBACK_LABEL;
    const title = typeof wc.getTitle === 'function' ? wc.getTitle() : '';
    if (typeof title !== 'string' || !title.trim()) return FALLBACK_LABEL;
    const trimmed = title.trim();
    return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}…` : trimmed;
  } catch {
    return FALLBACK_LABEL;
  }
}

/**
 * The move targets a tab in `source` can be sent to: one row per OTHER window
 * (DD8 — flat items, one per other window; no submenu is assumed of the sheet).
 *
 * The source's own window is excluded by RECORD IDENTITY, the window-census.js
 * lastFocused precedent — not by id equality, so a caller that hands a record
 * from a different registry gets no accidental match.
 *
 * Insertion order is preserved, and it is DECORATIVE: the row carries its own
 * `windowId`, so nothing downstream resolves a target by position. That is
 * exactly DD8's reversal of the ordinal scheme — an ordinal-keyed list re-points
 * at a different window the moment this order changes, which is the mis-target
 * DD8 exists to prevent.
 *
 * @param {RecordLike[]} records  registry.records(), in INSERTION order
 * @param {RecordLike | null | undefined} source  the record whose tab is moving
 * @returns {MoveTarget[]}  one row per OTHER live window
 */
function buildMoveTargets(records, source) {
  /** @type {MoveTarget[]} */
  const out = [];
  for (const rec of records || []) {
    if (!rec || !rec.win) continue;
    if (source && rec === source) continue; // no item for the tab's own window
    out.push({ windowId: rec.win.id, label: activeTabLabel(rec) });
  }
  return out;
}

module.exports = { buildMoveTargets, FALLBACK_LABEL, MAX_LABEL };
