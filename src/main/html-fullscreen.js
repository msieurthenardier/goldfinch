// @ts-check
'use strict';

// HTML5 element fullscreen as a WINDOW-RECORD MODE (M14 F1 L1, flight DD1).
//
// The chrome renderer is the normal single source of bounds truth
// (sendActiveBounds → tab-set-bounds). While a tab holds fullscreen, MAIN
// becomes the single bounds writer: the mode lives on the WindowRecord as
//
//   record.htmlFullscreen = { wcId, savedBounds, pendingBounds }
//
// and register-tab-ipc's tab-set-bounds gate DEFERS the renderer's sends for
// that tab (stored as pendingBounds, never applied) instead of letting them
// overwrite the full-window rect. Exit applies pendingBounds || savedBounds
// and asks the renderer to re-send the authoritative slot rect
// ('trigger-send-bounds') so guest, find overlay, and sheet re-converge.
//
// Guest bounds are a discrete setBounds STEP, never animated (the
// native-surface invariant): enter and exit are exactly one step each.
//
// API shape is deliberate (leg ruling — do not "normalize"): enter/exit/
// isFullscreen take a wcId (event-driven callers: guest-wiring's Electron
// events + Esc branch), while forceExit/handleRendererBounds/
// handleWindowResize take a record (record-holding callers: register-tab-ipc
// handlers and window-factory's resize hooks).
//
// House pattern: Electron-free, dependency-injected — the registry, chrome
// lookup, and logger are injected so the module unit-tests offline with fakes.

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ wcId: number, savedBounds: Rect, pendingBounds: Rect | null }} FullscreenMode
 */

/**
 * @param {any} deps
 */
function createHtmlFullscreen(deps) {
  // M14 F1 L2: optional onExited(record) observer (the manager-onClosed additive
  // pattern) — fires at the end of every restore, i.e. on EVERY exit edge (page
  // exit, Esc, force-exit, activation-away…). main.js wires it to the auth
  // pending-challenge store's notifyFullscreenExited re-present trigger.
  const { registry, chromeForTab, logger, onExited = () => {} } = deps;

  /**
   * The single restore path every exit edge funnels through. Clears the mode
   * FIRST: Blink's native Esc handling and our own page-exit ask can both fire
   * 'leave-html-full-screen' → exit() — idempotence rests on the cleared mode,
   * not on caller discipline. A destroyed/absent entry skips all view work
   * (record cleanup only — the restore path must never touch destroyed views).
   * @param {any} record
   */
  function restore(record) {
    const mode = /** @type {FullscreenMode | null} */ (record.htmlFullscreen);
    if (!mode) return;
    record.htmlFullscreen = null;
    const entry = record.tabViews.get(mode.wcId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      // One discrete step back to the last known slot rect: a renderer send
      // that arrived during fullscreen (deferred as pending) wins over the
      // enter-time snapshot — no stale-rect flash on exit after a resize.
      const restored = mode.pendingBounds || mode.savedBounds;
      entry.view.setBounds(restored);
      // AC6b mirror (register-tab-ipc's tab-set-active restore branch): the
      // find session SURVIVES fullscreen (hidden on enter, restored here).
      // show()'s re-add also re-asserts the overlay's z-order above the guest.
      if (record.findOverlay?.isSessionActive(mode.wcId)) {
        record.findOverlay.syncBounds(restored);
        record.findOverlay.show();
      }
    }
    // Renderer convergence: ask the owning chrome to re-measure and re-send
    // the authoritative slot rect (the existing resize-path channel). Resolves
    // null harmlessly when the tab is already gone (tab-close edge).
    chromeForTab(mode.wcId)?.send('trigger-send-bounds');
    // M14 F1 L2: exit observer — strictly LAST, after the mode is cleared and
    // geometry restored, so an observer-driven sheet open lands on a normal
    // window.
    onExited(record);
  }

  /**
   * Fire-and-forget page-side exit ask. The page's own exitFullscreen() fires
   * 'leave-html-full-screen', which lands in exit() — a no-op once the mode is
   * cleared, so asking is always safe.
   * @param {any} entry
   */
  function askPageToExit(entry) {
    if (!entry || entry.view.webContents.isDestroyed()) return;
    entry.view.webContents.executeJavaScript('document.exitFullscreen()').catch(() => {});
  }

  /**
   * 'enter-html-full-screen' handler body.
   * @param {number} wcId
   */
  function enter(wcId) {
    const record = registry.getWindowForGuest(wcId);
    if (!record || record.win.isDestroyed()) return;
    const entry = record.tabViews.get(wcId);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    if (wcId !== record.activeTabWcId) {
      // A BACKGROUND tab cannot seize the window (MCP evaluate can trigger
      // requestFullscreen without focus): refuse, and ask the page to exit so
      // it does not believe it is fullscreen while its view stays hidden.
      logger.warn('[html-fullscreen] refused enter from background tab', wcId);
      askPageToExit(entry);
      return;
    }
    if (record.htmlFullscreen) {
      // Double enter from the same tab is idempotent — re-snapshotting here
      // would capture the full-window rect and wedge the restore.
      if (record.htmlFullscreen.wcId === wcId) return;
      // Defense-in-depth: the activation edge already force-exits, but if
      // another tab somehow still holds the mode, restore it first.
      forceExit(record);
    }
    const savedBounds = entry.view.getBounds();
    // Mode is armed BEFORE the expand so an in-flight renderer bounds send
    // (rAF race) arriving next tick defers as pending instead of shrinking us.
    record.htmlFullscreen = { wcId, savedBounds, pendingBounds: null };
    const { width, height } = record.win.getContentBounds();
    entry.view.setBounds({ x: 0, y: 0, width, height });
    // Raise above the chrome view (re-add = raise-to-top).
    record.win.contentView.addChildView(entry.view);
    // Mirror the tab-hide overlay path: the guest now covers the window, so
    // the find bar hides (session SURVIVES — restore() re-shows it) and any
    // open sheet menu closes with a tab-lifecycle-family reason.
    record.findOverlay?.hide();
    record.sheet?.closeMenuOverlay('tab-hide');
  }

  /**
   * 'leave-html-full-screen' handler body. No-op unless this tab holds the
   * mode (leave after a force-exit must not restore twice).
   * @param {number} wcId
   */
  function exit(wcId) {
    const record = registry.getWindowForGuest(wcId);
    if (!record || !record.htmlFullscreen || record.htmlFullscreen.wcId !== wcId) return;
    restore(record);
  }

  /**
   * Exit for whatever tab holds the record's mode — the shared edge for
   * activation-away, tab-hide, tab-close, and cross-window move. Asks the
   * live page to leave (so page-side fullscreen state stays honest), then
   * restores. MUST return synchronously (the page ask is fire-and-forget):
   * callers include the synchrony-pinned moveTabIntoWindow.
   * @param {any} record
   */
  function forceExit(record) {
    const mode = /** @type {FullscreenMode | null} */ (record.htmlFullscreen);
    if (!mode) return;
    askPageToExit(record.tabViews.get(mode.wcId));
    restore(record);
  }

  /**
   * Membership query for guest-wiring's defensive Esc branch (no direct
   * record-peeking from guest-wiring).
   * @param {number} wcId
   * @returns {boolean}
   */
  function isFullscreen(wcId) {
    const record = registry.getWindowForGuest(wcId);
    return !!record && !!record.htmlFullscreen && record.htmlFullscreen.wcId === wcId;
  }

  /**
   * The tab-set-bounds/tab-set-active gate: returns true (handled — caller
   * must NOT apply the rect or fan it out to the overlays) only when this tab
   * holds the record's mode; the rect is stored as pendingBounds for exit.
   * Any OTHER tab returns false and the caller applies normally — deliberate:
   * background-tab bounds are harmless to apply, and silent drops wedge
   * nothing.
   * @param {any} record
   * @param {number} wcId
   * @param {Rect} rounded
   * @returns {boolean}
   */
  function handleRendererBounds(record, wcId, rounded) {
    const mode = /** @type {FullscreenMode | null} */ (record.htmlFullscreen);
    if (!mode || mode.wcId !== wcId) return false;
    mode.pendingBounds = rounded;
    return true;
  }

  /**
   * Window resize (and maximize/unmaximize) while fullscreen: re-expand the
   * guest to the new content bounds in one discrete step. The renderer's
   * triggered bounds send lands in the gate above and keeps pendingBounds
   * current for exit.
   * @param {any} record
   */
  function handleWindowResize(record) {
    const mode = /** @type {FullscreenMode | null} */ (record.htmlFullscreen);
    if (!mode || record.win.isDestroyed()) return;
    const entry = record.tabViews.get(mode.wcId);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    const { width, height } = record.win.getContentBounds();
    entry.view.setBounds({ x: 0, y: 0, width, height });
  }

  return { enter, exit, forceExit, isFullscreen, handleRendererBounds, handleWindowResize };
}

module.exports = { createHtmlFullscreen };
