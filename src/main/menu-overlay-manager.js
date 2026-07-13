'use strict';
// @ts-check

// Menu-overlay sheet lifecycle + menu-open state machine (M05 Flight 8,
// DD2/DD4/DD5/DD9). Electron-free: every live Electron handle is injected (the
// automation resolve.js / createEngine precedent), so this module is
// `node --test`-able with fakes and never imports Electron. main.js injects:
//   - getContentView(): the BaseWindow's contentView (or null during startup/teardown)
//   - createSheetView(): constructs the transparent chrome-class WebContentsView
//     (webPreferences, setBackgroundColor('#00000000'), loadFile — all Electron
//     construction stays in main.js)
//   - sendToChrome(channel, payload): channel-7 emitter (getChromeContents()?.send)
//   - hideFindOverlay(): DD5 sheet-show hook
//   - restoreFindOverlay(reason): DD5 close hook — the main.js impl skips the
//     tab-lifecycle reasons ('tab-switch'/'tab-hide'/'tab-close', the three-reason
//     skip set) and re-shows iff the find session targets the active tab
//   - focusChrome(): main-side half of the reason-resolved refocus contract
//     (getChromeContents()?.focus()) — chrome-side element focus alone cannot move
//     view-level keyboard focus off the sheet in a multi-view BaseWindow (F7 precedent)
//
// Lifecycle (Leg 1, unchanged): lazy singleton; destroyed-recreate guard;
// render-process-gone self-teardown; show = add-after-guest (re-add raises;
// callers order after guest + find re-adds); hide = visibility-gated
// removeChildView (never setVisible(false)-only — F7 DD7); syncBounds
// store-always/apply-while-visible (DD12 identity).
//
// Menu-open protocol (Leg 2, DD4):
//   - openMenu(payload) — channel-1 entry. Open-while-open = MODEL-REPLACE (no
//     hide/re-show flicker): the superseded menu gets channel 7
//     {reason:'superseded'} with ITS token, no hide. Show + hideFindOverlay +
//     init delivery (pending-init queue for the first-load race, latest wins —
//     F7 pendingOverlayInit shape) + webContents.focus() AFTER init delivery.
//     Leg 1's "show() never focuses" contract is superseded by real menu
//     semantics: focus enters the sheet ONLY via openMenu (show() itself still
//     never focuses — the tab-set-active re-add path must not steal focus).
//   - closeMenuOverlay(reason, token?) — the ONLY sheet-hide path for menu
//     closes. IDEMPOTENT (no-op when no menu open — app-switch fires BaseWindow
//     blur AND sheet blur; chrome must see exactly one channel-7 close and the
//     DD5 restore must run once). A provided token that mismatches the current
//     menu is a STALE sheet report — dropped (the open-token discipline closing
//     the same-menuType keyboard-re-open race). Emits channel 7, calls
//     focusChrome() for 'escape'/'activated' only, runs restoreFindOverlay(reason).
//   - There is deliberately NO main→sheet close channel: the hidden sheet keeps
//     its rendered menu DOM; the next menu-overlay:init rebuilds it, and the
//     page's late dismissed{blur} is dropped by the stale-token check.

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{
 *   webContents: {
 *     on: (event: string, cb: (...a: any[]) => void) => any,
 *     isDestroyed: () => boolean,
 *     destroy?: () => void,
 *     send?: (channel: string, payload?: any) => void,
 *     focus?: () => void
 *   },
 *   setBounds: (b: Bounds) => void,
 *   setVisible: (v: boolean) => void
 * }} SheetViewLike
 * @typedef {{
 *   addChildView: (v: SheetViewLike) => void,
 *   removeChildView: (v: SheetViewLike) => void
 * }} ContentViewLike
 * @typedef {{ menuType: string, model: Array<{id: string, label: string}>,
 *   anchor: any, startIndex?: number, token: number, noFocus?: boolean }} MenuOpenPayload
 */

/**
 * @param {{
 *   getContentView: () => (ContentViewLike | null),
 *   createSheetView: () => SheetViewLike,
 *   sendToChrome?: (channel: string, payload: any) => void,
 *   hideFindOverlay?: () => void,
 *   restoreFindOverlay?: (reason: string) => void,
 *   focusChrome?: () => void
 * }} deps
 */
function createMenuOverlayManager({
  getContentView,
  createSheetView,
  sendToChrome = () => {},
  hideFindOverlay = () => {},
  restoreFindOverlay = () => {},
  focusChrome = () => {}
}) {
  /** @type {SheetViewLike | null} */
  let view = null;
  let visible = false;
  let ready = false;
  /** @type {Bounds | null} */
  let lastGuestBounds = null;
  /** @type {{ menuType: string, token: number } | null} */
  let currentMenu = null;
  /** @type {MenuOpenPayload | null} */
  let pendingInit = null; // at most ONE queued init (latest wins — F7 pattern)

  // Deliver channel 3 + focus the sheet webContents (focus AFTER init delivery —
  // the page's init handler builds/focuses the menu DOM; view-level focus makes
  // the roving item the real OS focus target).
  /** @param {MenuOpenPayload} payload */
  function deliverInit(payload) {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.send?.('menu-overlay:init', payload);
    if (!payload.noFocus) view.webContents.focus?.();
  }

  // Full teardown (crash recovery + window `closed`): remove from the stack if
  // present, destroy the webContents if still alive, reset all state — the next
  // show recreates cleanly. Menu-close bookkeeping (channel 7 etc.) is the
  // caller's job via closeMenuOverlay('teardown') BEFORE teardown.
  function teardown() {
    if (view) {
      if (visible) {
        const cv = getContentView();
        if (cv) cv.removeChildView(view);
      }
      const wc = view.webContents;
      if (!wc.isDestroyed() && typeof wc.destroy === 'function') {
        wc.destroy();
      }
    }
    view = null;
    visible = false;
    ready = false;
    pendingInit = null;
  }

  // Lazy-construct the sheet view. Destroyed-recreate guard: a destroyed
  // webContents means the view is dead — null it so a fresh one is built
  // (ready flag reset with it).
  function ensureView() {
    if (view && view.webContents.isDestroyed()) {
      view = null;
      visible = false;
      ready = false;
      pendingInit = null;
    }
    if (view) return view;
    ready = false;
    view = createSheetView();
    view.webContents.on('did-finish-load', () => {
      ready = true;
      // First-load init race (F7 AC7 precedent): a queued open's init (+ focus)
      // is delivered here. Guard on currentMenu — a close while loading cleared
      // the queue, and a stale seed must never fire against a closed menu.
      if (pendingInit && currentMenu) {
        const seed = pendingInit;
        pendingInit = null;
        deliverInit(seed);
      } else {
        pendingInit = null;
      }
    });
    view.webContents.on('render-process-gone', () => {
      // Sheet crash while a menu is open: emit the close family's 'teardown'
      // close FIRST (channel 7 + DD5 restore — chrome aria/focus state never
      // orphans), then destroy; the next open rebuilds (Leg-1 machinery).
      closeMenuOverlay('teardown');
      teardown();
    });
    return view;
  }

  // Show = (re)apply stored guest bounds + addChildView + setVisible(true).
  // The re-add of an existing child RAISES it (same idiom as the guest re-add in
  // tab-set-active); callers in tab-set-active must call this strictly AFTER the
  // guest re-add and the find-overlay re-assert, or the sheet is buried.
  // State-preserving no-op when the window is gone (F7 parity — `visible` must
  // NOT flip). NEVER focuses the sheet's webContents — focus enters the sheet
  // ONLY via openMenu's post-init focus (the re-add/restore path must not steal it).
  function show() {
    const cv = getContentView();
    if (!cv) return;
    const v = ensureView();
    if (lastGuestBounds) v.setBounds(lastGuestBounds);
    cv.addChildView(v);
    v.setVisible(true);
    visible = true;
  }

  // Hide = removeChildView, gated on visibility (never setVisible(false)-only).
  // Idempotent; the view is kept for reuse. Lifecycle-only — menu closes MUST
  // route through closeMenuOverlay (AC2: the single close path).
  function hide() {
    if (!visible) return;
    const cv = getContentView();
    if (cv && view) cv.removeChildView(view);
    visible = false;
  }

  /**
   * Open a menu on the sheet (channel-1 entry; DD4). See module header for the
   * model-replace / pending-init / focus contract.
   * @param {MenuOpenPayload} payload
   */
  function openMenu(payload) {
    if (!payload || typeof payload.menuType !== 'string' || typeof payload.token !== 'number') return;
    if (!getContentView()) return; // window gone — nothing to open on
    const wasOpen = !!currentMenu;
    if (currentMenu) {
      // Mutual exclusion: model-replace (NO hide/re-show flicker); the superseded
      // menu's channel 7 carries ITS token so chrome resets the right trigger.
      sendToChrome('menu-overlay-closed', {
        menuType: currentMenu.menuType,
        reason: 'superseded',
        token: currentMenu.token
      });
    }
    currentMenu = { menuType: payload.menuType, token: payload.token };
    show();
    // DD5: find bar hidden while a menu is open (parity) — only on the FIRST
    // open of a session (model-replace keeps the same open session; the call
    // is idempotent anyway, this just avoids redundant per-keystroke calls).
    if (!wasOpen) hideFindOverlay();
    if (ready && view && !view.webContents.isDestroyed()) {
      pendingInit = null;
      deliverInit(payload);
    } else {
      // First-open init race: queue exactly one seed (latest wins); the
      // construction-time did-finish-load listener delivers init + focus.
      pendingInit = payload;
    }
  }

  /**
   * The ONLY close path for menu closes (DD4). Idempotent; stale-token-safe.
   * @param {string} reason  'escape' | 'outside-click' | 'blur' | 'toggle' |
   *   'activated' | 'superseded' | 'tab-switch' | 'tab-hide' | 'tab-close' | 'teardown'
   * @param {number} [token]  when provided (sheet-reported closes), must match
   *   the current menu's token or the close is dropped as stale
   */
  function closeMenuOverlay(reason, token) {
    if (!currentMenu) return; // idempotent — double-blur (app switch) safe
    if (token !== undefined && token !== currentMenu.token) return; // stale sheet report
    const closed = currentMenu;
    currentMenu = null;
    pendingInit = null;
    hide();
    sendToChrome('menu-overlay-closed', { menuType: closed.menuType, reason, token: closed.token });
    // Reason-resolved refocus, main-side half: escape/activated move keyboard
    // focus back to the chrome view (webContents-level); chrome then focuses the
    // trigger element on channel 7. Every other reason moves NO focus ('toggle'
    // — the physical click already OS-focused chrome; 'blur' — never steal focus
    // from the other app; tab lifecycle/teardown — the incoming guest keeps it).
    if (reason === 'escape' || reason === 'activated') focusChrome();
    restoreFindOverlay(reason);
  }

  /**
   * Store the latest active-guest DIP bounds (always); apply 1:1 while visible
   * (DD12 — bounds identity with the active guest, no math).
   * @param {Bounds} rounded
   */
  function syncBounds(rounded) {
    lastGuestBounds = rounded;
    if (visible && view) view.setBounds(rounded);
  }

  return {
    ensureView,
    show,
    hide,
    openMenu,
    closeMenuOverlay,
    syncBounds,
    teardown,
    isVisible: () => visible,
    isReady: () => ready,
    getView: () => view,
    getCurrentMenu: () => currentMenu,
    isMenuOpen: () => currentMenu != null
  };
}

module.exports = { createMenuOverlayManager };
