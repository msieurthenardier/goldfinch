// @ts-check
'use strict';

// Window registry (M09 Flight 6, DD2/DD3/DD8) — the per-window record store that
// replaced main.js's single-window singletons (mainWindow / chromeView / tabViews /
// activeTabWcId). One record per BaseWindow, keyed by BaseWindow.id (Electron-unique):
//
//   { win, chromeView, tabViews: Map<wcId, entry>, activeTabWcId }
//
// Per-window OVERLAY MANAGER slots (M09 F7 Leg 1, DD5): `findOverlay` / `sheet` carry
// THIS window's own find-overlay and menu-sheet manager instances, retiring the roaming
// module-scope singletons. They are seeded null here and ASSIGNED BY MAIN.JS right after
// create() — this module is Electron-free and cannot construct managers (nor import their
// types; hence `any`). main.js's per-window `close` handler tears both managers down and
// NULLS both slots in the same breath, so the record path fails safe across the
// close→closed gap — every owner-resolved read must be null-tolerant.
//
// Deliberately ELECTRON-FREE (the resolve.js / menu-overlay-manager precedent): the
// win / chromeView handles are INJECTED at create() and only ever compared by identity
// or read for `.id` / `.webContents`, so the module unit-tests offline with fakes.
// All Electron wiring (event registration, view construction) stays in main.js.
//
// Last-focused tracking (DD8): the accessor interim for the automation surface and
// every other ownerless window pick. SEEDED at create and (by the caller) at
// programmatic win.focus() — under WSLg programmatic focus() fires NO focus event and
// BaseWindow.getFocusedWindow() goes stale indefinitely (leg-1 spike, verdict 4), so
// main-side tracking is mandatory, never Electron's focus APIs. noteFocus is
// latest-event-wins (the spike observed idle focus/blur flapping on Wayland); reads
// are MEMBERSHIP-VALIDATED (pass-2 L-c): a last-focused id whose record is gone falls
// back to the first record in insertion order.

/**
 * @typedef {{ id: number, [k: string]: any }} WinLike
 * @typedef {{ webContents: any, [k: string]: any }} ChromeViewLike
 * @typedef {{
 *   win: WinLike,
 *   chromeView: ChromeViewLike,
 *   tabViews: Map<number, any>,
 *   activeTabWcId: number | null,
 *   noBootTab: boolean,
 *   bootConfigServed: boolean,
 *   pendingChromeSends: Array<() => [string, any]>,
 *   findOverlay: any,
 *   sheet: any,
 *   restoreTabs?: Array<{ url: string, jarId: string, active: boolean }>
 * }} WindowRecord
 */

function createWindowRegistry() {
  /** @type {Map<number, WindowRecord>} */
  const windows = new Map();
  /** @type {number | null} */
  let lastFocusedId = null;

  /**
   * Create + register a record for a window. Seeds last-focused (DD8 — creation is
   * a focus-equivalent even when the compositor never delivers a focus event).
   *
   * `noBootTab` (M09 F6 DD5): boot-tab suppression is part of the CREATE CHAIN,
   * not a renderer guess — a move-created window must not boot a home tab (it
   * receives the moved tab instead). Served to the chrome document via the
   * `window-boot-config` invoke (main.js).
   *
   * H1 readiness barrier (F6 leg-4 design review): `bootConfigServed` flips true
   * when the chrome document's `window-boot-config` invoke is served (the invoke
   * arriving proves module evaluation completed — a send to a pre-boot document
   * is silently dropped, no retry exists); until then, adopt-protocol sends are
   * queued as thunks in `pendingChromeSends` and flushed by the invoke handler.
   * @param {{ win: WinLike, chromeView: ChromeViewLike, noBootTab?: boolean }} parts
   * @returns {WindowRecord}
   */
  function create({ win, chromeView, noBootTab = false }) {
    /** @type {WindowRecord} */
    const record = {
      win,
      chromeView,
      tabViews: new Map(),
      activeTabWcId: null,
      noBootTab,
      bootConfigServed: false,
      pendingChromeSends: [],
      // F7 DD5 per-window overlay managers — main.js assigns both immediately after
      // create() (this module is Electron-free and cannot construct them).
      findOverlay: null,
      sheet: null,
    };
    windows.set(win.id, record);
    lastFocusedId = win.id;
    return record;
  }

  /**
   * @param {number} winId
   * @returns {WindowRecord | null}
   */
  function get(winId) {
    return windows.get(winId) || null;
  }

  /** @param {number} winId */
  function remove(winId) {
    // lastFocusedId is deliberately NOT cleared here: reads validate membership
    // (getLastFocused), so a stale id degrades to the first-record fallback.
    windows.delete(winId);
  }

  /** @returns {WindowRecord[]} insertion order (first record = fallback order) */
  function records() {
    return [...windows.values()];
  }

  /** @returns {number} */
  function size() {
    return windows.size;
  }

  /**
   * Latest-event-wins focus note. Ignores unregistered ids so a late blur/focus
   * from a window mid-teardown cannot clobber the tracker.
   * @param {number} winId
   */
  function noteFocus(winId) {
    if (windows.has(winId)) lastFocusedId = winId;
  }

  /**
   * The DD8 accessor read: last-focused record, MEMBERSHIP-VALIDATED, falling back
   * to the first record in insertion order; null when no windows exist.
   * @returns {WindowRecord | null}
   */
  function getLastFocused() {
    const rec = lastFocusedId != null ? windows.get(lastFocusedId) : undefined;
    if (rec) return rec;
    const first = windows.values().next();
    return first.done ? null : first.value;
  }

  /**
   * Reverse lookup: the record whose chrome webContents IS the given sender
   * (identity compare — the same discipline as the sender-identity IPC checks).
   * @param {any} sender
   * @returns {WindowRecord | null}
   */
  function getWindowForChrome(sender) {
    if (!sender) return null;
    for (const rec of windows.values()) {
      if (rec.chromeView.webContents === sender) return rec;
    }
    return null;
  }

  /**
   * Reverse lookup: the record whose tabViews owns the given guest wcId.
   * @param {number | null | undefined} wcId
   * @returns {WindowRecord | null}
   */
  function getWindowForGuest(wcId) {
    if (wcId == null) return null;
    for (const rec of windows.values()) {
      if (rec.tabViews.has(wcId)) return rec;
    }
    return null;
  }

  /**
   * Class-3 owner routing (DD2): the OWNING window's chrome webContents for a tab,
   * resolved at event time. Null when the tab is unowned (closed / mid-teardown).
   * @param {number | null | undefined} wcId
   * @returns {any | null}
   */
  function getChromeForTab(wcId) {
    const rec = getWindowForGuest(wcId);
    return rec ? rec.chromeView.webContents : null;
  }

  /**
   * All-windows tab membership (DD8 widening of the F8 DD8 predicate).
   * @param {number} wcId
   * @returns {boolean}
   */
  function isTabViewWcId(wcId) {
    return getWindowForGuest(wcId) != null;
  }

  /**
   * "Is any registered chrome" (DD8 — the jar-tier chrome-exclusion / classify
   * widening predicate).
   * @param {any} wc
   * @returns {boolean}
   */
  function isChromeContents(wc) {
    return getWindowForChrome(wc) != null;
  }

  return {
    create,
    get,
    remove,
    records,
    size,
    noteFocus,
    getLastFocused,
    getWindowForChrome,
    getWindowForGuest,
    getChromeForTab,
    isTabViewWcId,
    isChromeContents,
  };
}

module.exports = { createWindowRegistry };
