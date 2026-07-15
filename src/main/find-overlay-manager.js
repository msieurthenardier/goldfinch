'use strict';
// @ts-check

// Find-overlay lifecycle + find-session state machine (M05 Flight 7, DD1/DD2/DD4/
// DD6/DD9; extracted to a PER-WINDOW factory M09 F7 Leg 1, DD5). Electron-free:
// every live Electron handle is injected (the automation resolve.js /
// menu-overlay-manager precedent), so this module is `node --test`-able with fakes
// and never imports Electron. main.js constructs ONE instance PER WINDOW and stores
// it on that window's registry record (`rec.findOverlay`); the deps close over THAT
// window's record/handles. main.js injects:
//   - getContentView(): THIS window's contentView (null when the window is gone).
//     A per-window instance IS its own scope, so there is no attachment record and
//     no cross-window re-resolve: the F4 review's named hide-time-re-resolve defect
//     (removing a child from a non-parent contentView is documented-undefined) holds
//     BY CONSTRUCTION here — there is no other window to re-resolve to.
//   - createOverlayView(): constructs the transparent chrome-class WebContentsView
//     (webPreferences, setBackgroundColor('#00000000'), loadFile — all Electron
//     construction stays in main.js)
//   - getActiveGuestBounds(): THIS window record's LIVE active-guest DIP bounds
//     (null when the record has no live active guest) — the per-call show-path fetch
//   - computeBounds(guest): the pure find-overlay-geometry helper, injected so the
//     module stays offline-testable
//   - getTabContents(wcId): the guest webContents (null when destroyed/gone)
//   - isFindableTab(wcId): DD4's web-tab-only refusal for THIS window — true iff the
//     wcId is a present, non-trusted, live tab of this window's record
//   - notifyChrome(channel, payload): class-1b emitter to THIS window's chrome. Under
//     per-window instances the find session's tab always belongs to THIS window (open
//     is owner-resolved; a tab that moves windows closes its session at the move —
//     main.js's tab:move-new-window), so the session tab's owning chrome IS this
//     window's chrome.
//
// PER-INSTANCE STATE, NOT MODULE STATE (DD5 / recon S9). Every var below is closure
// state. `lastGuestBounds` in particular was a SHARED module slot in main.js that any
// window's tab-set-bounds polluted at the WRITE (main.js:2812/:2861 pre-F7; DD7 had
// fixed only the read). The CONCEPT survives — a per-instance last-resort show
// fallback — but the sharing does not, and the shared-slot bug is unrepresentable
// once the state is closure-local.
//
// Cache freshness contract for `lastGuestBounds`: source of truth = this window's
// active guest's bounds. Rebuild trigger = INVALIDATION EVENT (tab-set-bounds on the
// active tab → syncBounds). Max staleness = one bounds event. The show path
// additionally does a per-call getActiveGuestBounds() fetch and falls back to
// lastGuestBounds only when the record has no live active guest.
//
// Lifecycle: lazy singleton (created on first show — a window that never opens find
// pays nothing); destroyed-recreate guard; render-process-gone self-teardown; show =
// position + add-after-guest (the re-add RAISES — callers in tab-set-active must call
// this strictly AFTER the guest re-add or the guest buries the bar); hide =
// visibility-gated removeChildView (never setVisible(false)-only — a hidden-but-
// present sibling still occupies the compositing stack); syncBounds store-always/
// apply-while-visible; teardown destroys the webContents (the SOLE destruction caller
// is the per-window `close` handler — F7 DD5).

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
 * }} OverlayViewLike
 * @typedef {{
 *   addChildView: (v: OverlayViewLike) => void,
 *   removeChildView: (v: OverlayViewLike) => void
 * }} ContentViewLike
 * @typedef {{ text?: any, findNext?: any, forward?: any, matchCase?: any }} QueryPayload
 */

/**
 * @param {{
 *   getContentView: () => (ContentViewLike | null),
 *   createOverlayView: () => OverlayViewLike,
 *   getActiveGuestBounds?: () => (Bounds | null),
 *   computeBounds: (guest: Bounds) => Bounds,
 *   getTabContents?: (wcId: number) => any,
 *   isFindableTab?: (wcId: number) => boolean,
 *   notifyChrome?: (channel: string, payload: any) => void
 * }} deps
 */
function createFindOverlayManager({
  getContentView,
  createOverlayView,
  getActiveGuestBounds = () => null,
  computeBounds,
  getTabContents = () => null,
  isFindableTab = () => false,
  notifyChrome = () => {}
}) {
  /** @type {OverlayViewLike | null} */
  let view = null;
  // Tracks stack presence (removeChildView of a non-child is undefined behavior —
  // gate on this).
  let visible = false;
  // Overlay page readiness (AC7 init race): flipped by the construction-time
  // did-finish-load listener; reset whenever `view` is nulled/recreated.
  let ready = false;
  // Latest active-guest DIP bounds, for (re)positioning the overlay on show. Now
  // PER-INSTANCE (S9) — the last-resort fallback when this record has no live
  // active guest.
  /** @type {Bounds | null} */
  let lastGuestBounds = null;
  // Overlay find session: wcId of the tab the overlay currently targets (null =
  // closed). Single source of "overlay find is open, targeting tab X". DD9: per-tab
  // findText/findOpen stay in the renderer; main holds ONLY the live session.
  /** @type {number | null} */
  let sessionTabWcId = null;
  // Last text actually issued to wc.findInPage for the live overlay session (null =
  // none yet / reset). HAT-1 (M05 F7 Leg 4): Electron's FindInPageOptions.findNext
  // means "begin a NEW find session" (true) vs "follow-up in the current session"
  // (false) — the INVERSE of the legacy <webview>-era reading the retired chrome bar
  // used. A follow-up request does NOT re-search when the text changed (Chromium
  // keeps advancing the old session), so main tracks the last-queried text and forces
  // a new session on any text change. See query() for the mapping.
  /** @type {string | null} */
  let lastQueryText = null;
  // At most ONE queued init seed ({ findText }, latest wins), delivered (with focus)
  // by did-finish-load when the open raced the first page load. Cleared on session
  // close so a stale seed never fires against a closed session.
  /** @type {{ findText: string } | null} */
  let pendingInit = null;

  /** @param {number | null | undefined} wcId */
  function isSessionActive(wcId) {
    return wcId != null && wcId === sessionTabWcId;
  }

  // Send the init seed + focus the overlay (DD6: the view's webContents.focus() here;
  // the page focuses/selects its input in its onInit handler). Callers must have
  // checked readiness — openSession queues via pendingInit when not ready.
  /** @param {string} findText */
  function deliverInit(findText) {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.send?.('find-overlay:init', { findText });
    view.webContents.focus?.();
  }

  // Full overlay teardown (AC7 crash recovery + the per-window `close` handler —
  // F7 DD5's SOLE destruction site): remove from the stack if present, destroy the
  // webContents if still alive, drop the view, reset visibility/readiness, clear any
  // queued init AND the find session — the next open recreates cleanly.
  function teardown() {
    if (view) {
      if (visible) {
        const cv = getContentView();
        if (cv) cv.removeChildView(view);
      }
      const wc = view.webContents;
      if (!wc.isDestroyed() && typeof wc.destroy === 'function') {
        // destroy() is real but absent from the public WebContents type — the
        // any-cast lives in main.js's injected view type (same repo-precedented
        // pattern as the tab-close path).
        wc.destroy();
      }
    }
    view = null;
    visible = false;
    ready = false;
    pendingInit = null;
    sessionTabWcId = null;
    lastQueryText = null;
  }

  // Lazy-construct the overlay view. Destroyed-recreate guard: a destroyed
  // webContents means the view is dead — null it so a fresh one is built (ready
  // flag/init queue reset with it).
  function ensureView() {
    if (view && view.webContents.isDestroyed()) {
      view = null;
      visible = false;
      ready = false;
      pendingInit = null;
    }
    if (view) return view;
    ready = false;
    view = createOverlayView();
    // AC7 readiness + init-race handling: the listener is installed at construction
    // on THIS webContents, so a queued one-shot init always attaches to the live page.
    view.webContents.on('did-finish-load', () => {
      ready = true;
      if (pendingInit && sessionTabWcId != null) {
        const seed = pendingInit;
        pendingInit = null;
        deliverInit(seed.findText);
      } else {
        pendingInit = null;
      }
    });
    // AC7 crash recovery: after render-process-gone the WebContents object is ALIVE
    // (isDestroyed() stays false), so the recreate guard above never fires for a
    // crash — this listener is what guarantees the next open rebuilds instead of
    // re-showing a dead view.
    view.webContents.on('render-process-gone', () => {
      teardown();
    });
    return view;
  }

  // Show = position (when guest bounds are known) + addChildView + setVisible(true).
  // The re-add of an existing child RAISES it — the same idiom the guest re-add uses
  // in tab-set-active. DD2 invariant: callers in tab-set-active must call this
  // strictly AFTER the guest addChildView, or the guest buries the overlay.
  // State-preserving no-op when the window is gone (`visible` must NOT flip).
  //
  // DD5: no owner-routing resolve and no cross-window detach branch — the window is
  // fixed at construction, so this instance's contentView is the only one it can ever
  // attach to.
  function show() {
    const cv = getContentView();
    if (!cv) return;
    const v = ensureView();
    // Per-call live fetch of THIS record's active-guest bounds, falling back to the
    // per-instance last-seen bounds only when the record has no live active guest
    // (the pre-F7 behavior at main.js:419-422, preserved).
    const showBounds = getActiveGuestBounds() || lastGuestBounds;
    if (showBounds) {
      // Guard required: computeBounds does not tolerate null. If no guest bounds have
      // ever been seen, skip — the next tab-set-bounds corrects it.
      v.setBounds(computeBounds(showBounds));
    }
    cv.addChildView(v);
    v.setVisible(true);
    visible = true;
  }

  // Hide = removeChildView — NEVER setVisible(false)-only (a hidden-but-present
  // sibling still occupies the compositing stack). Idempotent; the view is kept for
  // reuse.
  function hide() {
    if (!visible) return;
    const cv = getContentView();
    if (cv && view) cv.removeChildView(view);
    visible = false;
  }

  /**
   * Open the overlay find session for a web tab (DD4). Shared entry for the
   * `find-overlay:open` IPC handler and the dev-gated Ctrl+F stimulus.
   * @param {number} wcId
   * @param {string} [findText]
   */
  function openSession(wcId, findText) {
    // Find is web-tab-only (DD4): refuse absent, internal (trusted), or destroyed
    // targets — and, structurally, any tab that is not THIS window's.
    if (!isFindableTab(wcId)) return;
    if (isSessionActive(wcId)) {
      // AC6e: re-open on the already-targeted tab re-focuses WITHOUT re-seeding
      // init — re-init would wipe whatever the user has typed in the overlay input.
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.focus?.();
      }
      return;
    }
    if (sessionTabWcId != null) {
      // Defensive retarget: a session open for a DIFFERENT tab is closed first
      // (clears the old guest's highlight; no refocus).
      closeSession({ refocusGuest: false });
    }
    sessionTabWcId = wcId;
    lastQueryText = null; // fresh session target — first query must begin a new engine session
    show();
    const seed = typeof findText === 'string' ? findText : '';
    if (ready) {
      deliverInit(seed);
    } else {
      // AC7 first-open init race: the page hasn't finished loading — queue exactly
      // one seed (latest wins); the construction-time did-finish-load delivers init
      // + focus.
      pendingInit = { findText: seed };
    }
  }

  /**
   * Close the overlay find session. `refocusGuest` MUST be true ONLY on the explicit
   * close path (Esc / ✕ → `find-overlay:close` from the overlay itself). Every
   * implicit close — tab-switch, tab-close, window teardown — passes false:
   * refocusing there would land OS focus on a hidden/destroyed view and steal focus
   * from tab-strip keyboard navigation (a pinned keyboard-nav contract). (AC5)
   * @param {{ refocusGuest: boolean }} opts
   */
  function closeSession({ refocusGuest }) {
    if (sessionTabWcId == null) return;
    const wc = getTabContents(sessionTabWcId); // null when destroyed/mid-destruction
    if (wc) {
      // Chrome-bar closeFind parity: clear the highlight on close.
      wc.stopFindInPage('clearSelection');
      if (refocusGuest) wc.focus();
    }
    hide();
    sessionTabWcId = null;
    lastQueryText = null;
    pendingInit = null;
  }

  /**
   * Store the latest active-guest DIP bounds (always); re-position the bar 1:1 off
   * them while visible. Per-instance (S9) — window B's bounds churn cannot reach
   * window A's bar because there is no shared slot to churn.
   * @param {Bounds} rounded
   */
  function syncBounds(rounded) {
    lastGuestBounds = rounded;
    if (visible && view) view.setBounds(computeBounds(rounded));
  }

  /**
   * The overlay's query half (the `find-overlay:query` body's session-state logic).
   * Forwards the query text to the chrome for per-tab state sync (DD9 — EVERY query,
   * empty included: deletion sync, so tab.findText tracks a delete-to-empty and
   * switch-back restores a blank bar, not resurrected text), then resolves the
   * session's target guest and runs findInPage. Empty text skips findInPage (the page
   * blanks its own count; NO stopFindInPage — the highlight persists until close). A
   * hidden-but-live guest is allowed — counts land when the overlay re-shows. A
   * stale/destroyed target resolves null → no-op.
   *
   * FLAG MAPPING (HAT-1 fix): the payload's `findNext` keeps the chrome-bar shape
   * ("this is a STEP request"), but Electron's FindInPageOptions.findNext means "begin
   * a NEW find session" — the inverse. A step continues the engine session (Electron
   * findNext:false) ONLY when the text is unchanged since the last issued query; every
   * text change — incremental typing, backspace edits — and every first query of a
   * session begins a NEW session (Electron findNext:true) so the edited term
   * re-searches immediately instead of advancing the stale session.
   * @param {QueryPayload} payload
   */
  function query(payload) {
    const wc = getTabContents(/** @type {number} */ (sessionTabWcId));
    if (!wc) return;
    const { text, findNext, forward, matchCase } = payload || {};
    if (typeof text !== 'string') return;
    // Class 1b: per-tab state sync goes to THIS window's chrome — under per-window
    // instances the session tab always belongs to this window.
    notifyChrome('find-overlay-text', { wcId: sessionTabWcId, text });
    if (!text) {
      // Deleted-to-empty: no engine call (highlight persists), but the session text is
      // gone — the next non-empty query must begin a new engine session.
      lastQueryText = null;
      return;
    }
    const isStep = !!findNext && text === lastQueryText;
    lastQueryText = text;
    wc.findInPage(text, { findNext: !isStep, forward: forward !== false, matchCase: !!matchCase });
  }

  return {
    ensureView,
    show,
    hide,
    openSession,
    closeSession,
    syncBounds,
    query,
    teardown,
    isVisible: () => visible,
    isReady: () => ready,
    getView: () => view,
    getSessionTabWcId: () => sessionTabWcId,
    isSessionActive
  };
}

module.exports = { createFindOverlayManager };
