// @ts-check
'use strict';

// Closed-tab capture + pop rules (M09 Flight 6, DD4) — the pure part of the
// closed-tab stack's two capture sites and the reopen handler's stripIndex
// decision. The stack module itself (src/shared/closed-tab-stack.js) stays
// entry-shape-agnostic and untouched; the `windowId` tag lives HERE, on the
// entries the capture sites build.
//
// Deliberately ELECTRON-FREE (the window-registry precedent): webContents
// handles are read through the injected tabViews entries only (`getURL`/
// `getTitle`/`navigationHistory`/`isDestroyed`), so the module unit-tests
// offline with fakes. All Electron wiring (event registration, the stack
// singleton, the size broadcast) stays in main.js.
//
// The persist-jar allowlist predicate is single-sourced in persist-jar-gate.js
// (M09 F9 L2 AC0) — both this module and session-snapshot.js call it, so the
// mission's burner boundary has ONE definition two suites cannot drift on.

const { resolvePersistJar } = require('./persist-jar-gate');

/**
 * `stripIndex` append sentinel (M09 F4): "position unknown / not this strip" —
 * the renderer's reopen path treats any negative insertAt as append-at-end.
 */
const APPEND_SENTINEL = -1;

/**
 * A closed-tab-stack entry as built since F6 DD4: the F4 shape plus the
 * capturing window's id. The stack stores it as-is (entry-shape-agnostic).
 * @typedef {{
 *   url: string,
 *   title: string,
 *   jarId: string,
 *   stripIndex: number,
 *   navEntries: unknown[],
 *   navIndex: number,
 *   closedAt: number,
 *   windowId: number
 * }} TaggedClosedTabEntry
 */

/**
 * Capture ONE dying tab as a closed-tab-stack entry, or `null` when the tab
 * fails the positive persist-jar allowlist (the history-recorder idiom, F4):
 * the tab's partition must resolve against the injected jars snapshot — burner
 * (`burner:<n>`) and internal partitions structurally match nothing here, so
 * they are never captured, with NO negative "is it a burner" check anywhere.
 * `!trusted` is belt-and-suspenders (the internal partition already fails the
 * allowlist on its own). A destroyed webContents is uncapturable (nothing left
 * to read) and resolves `null` too.
 * @param {{
 *   tabEntry: { view: { webContents: any }, partition: string, trusted: boolean },
 *   jarsList: Array<{ id: string, partition: string }>,
 *   stripIndex: number,
 *   windowId: number
 * }} parts
 * @returns {TaggedClosedTabEntry | null}
 */
function captureClosedTabEntry({ tabEntry, jarsList, stripIndex, windowId }) {
  const jar = resolvePersistJar(tabEntry, jarsList);
  if (!jar) return null;
  const wc = tabEntry.view.webContents;
  if (!wc || wc.isDestroyed()) return null;
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    jarId: jar.id,
    stripIndex,
    navEntries: wc.navigationHistory.getAllEntries(),
    navIndex: wc.navigationHistory.getActiveIndex(),
    closedAt: Date.now(),
    windowId,
  };
}

/**
 * Whole-window capture (DD4): every persist-jar tab of a dying window as an
 * ordinary entry, in tabViews INSERTION order, each with the append sentinel
 * and the dying window's id. Insertion order because main does not know strip
 * order (it is renderer DOM order, and no renderer round-trip is available
 * during close); per-entry stripIndex would be dead weight anyway — a
 * whole-window entry's windowId can never match the invoking window at pop
 * time (that window is gone), so the pop rule below already forces append.
 * @param {{
 *   tabViews: Map<number, any>,
 *   jarsList: Array<{ id: string, partition: string }>,
 *   windowId: number
 * }} parts
 * @returns {TaggedClosedTabEntry[]}
 */
function captureWindowCloseEntries({ tabViews, jarsList, windowId }) {
  const out = [];
  for (const tabEntry of tabViews.values()) {
    const entry = captureClosedTabEntry({ tabEntry, jarsList, stripIndex: APPEND_SENTINEL, windowId });
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Pop rule (DD4): a popped entry's stripIndex is meaningful ONLY in the origin
 * window's strip — honored iff `entry.windowId` matches the INVOKING window's
 * id; otherwise the append sentinel. `windowId` is optional on the parameter
 * type so pre-tag entries (or a null sender resolve) degrade to append, never
 * to a wrong-strip position.
 * @param {{ stripIndex: number, windowId?: number }} entry
 * @param {number | null} invokingWindowId
 * @returns {number}
 */
function reopenStripIndex(entry, invokingWindowId) {
  return invokingWindowId != null && entry.windowId === invokingWindowId
    ? entry.stripIndex
    : APPEND_SENTINEL;
}

module.exports = {
  APPEND_SENTINEL,
  captureClosedTabEntry,
  captureWindowCloseEntries,
  reopenStripIndex,
};
