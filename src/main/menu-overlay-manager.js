'use strict';
// @ts-check

// Menu-overlay sheet lifecycle + menu-open state machine (M05 Flight 8,
// DD2/DD4/DD5/DD9; DD7 roaming attachment tracking M09 F6 Leg 4). Electron-free:
// every live Electron handle is injected (the automation resolve.js /
// createEngine precedent), so this module is `node --test`-able with fakes and
// never imports Electron. main.js injects:
//   - getContentView(): FALLBACK contentView resolve (last-focused record) —
//     used only when no attachment is recorded (defensive; every real open
//     supplies an attachment)
//   - createSheetView(): constructs the transparent chrome-class WebContentsView
//     (webPreferences, setBackgroundColor('#00000000'), loadFile — all Electron
//     construction stays in main.js)
//   - sendToChrome(channel, payload, win): channel-7 emitter. `win` is the
//     ATTACHMENT window handle recorded at show (null when none) — main.js
//     resolves THAT window's chrome (DD7: wrong-window delivery = stuck
//     aria-expanded), falling back to the accessor only for a null win
//   - hideFindOverlay(): DD5 sheet-show hook
//   - restoreFindOverlay(reason): DD5 close hook — the main.js impl skips the
//     tab-lifecycle reasons ('tab-switch'/'tab-hide'/'tab-close', the three-reason
//     skip set) and re-shows iff the find session targets the active tab
//   - focusChrome(win): main-side half of the reason-resolved refocus contract —
//     focuses the ATTACHMENT window's chrome webContents (F7 precedent; DD7)
//
// DD7 ATTACHMENT TRACKING (M09 F6, review M1 — the named defect was the
// hide-time getContentView() RE-RESOLVE: removing a child from a non-parent
// contentView is documented-undefined, and with two windows the re-resolve can
// pick the wrong one). The manager records `{ contentView, win, bounds }` at
// show (openMenu receives it, resolved by main.js from the open-sender's
// record, bounds = that window's CURRENT active-guest bounds — the per-window
// bounds fetch replacing the any-window-polluted single slot); hide()/teardown()
// remove from the RECORDED attachment; the re-raise show() (tab-set-active
// path) uses the recorded attachment and never re-resolves. A cross-window
// model-replace (open in B while A's menu is open) detaches from A's recorded
// contentView before attaching to B's.
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
//     focusChrome() for 'escape'/'activated'/'input-empty' (the last covers an
//     automatically emptied focused sheet), runs restoreFindOverlay(reason).
//   - reassertFocus() — the KEEP-FOCUS re-grab (issue: the locked-vault
//     unlock-to-save prompt). A menu opened with `keepFocus: true` is one the
//     spawning gesture ALSO navigates away from (a login-form submit spawns the
//     capture offer AND loads the next page), and the loading guest pulls OS
//     focus out of the sheet. The sheet reports that blur back (the sheet→main
//     refocus channel) and this re-grabs it, so a master password typed into a
//     visibly-focused card can never land in the page's own fields instead.
//     Bounded by KEEP_FOCUS_MAX per menu session so a page that re-steals focus
//     on a loop cannot turn this into a focus tug-of-war; inert for every menu
//     that did not opt in (the flag defaults false and resets on close).
//   - M15 F3 L1 (DD1f) REVERSES the old "there is deliberately NO main→sheet
//     close channel" rule. There is now exactly one: `menu-overlay:close`, sent
//     by closeMenuOverlay (and by openMenu's model-replace branch when the
//     menuType actually CHANGES), whose sheet-side handler runs
//     report.silence() + menuController.closeAll() immediately. The page's late
//     dismissed{blur} is still dropped by the stale-token check, unchanged.
//
//     WHY IT EXISTS — it is a SECURITY mechanism, not tidiness. The sheet is one
//     persistent document that renders every menu, and it used to keep a closed
//     menu's DOM (including a one-time recovery key's textContent) until the NEXT
//     open's init landed. Since M15 F3 the automation resolver admits readDom /
//     readAxTree / captureScreenshot on the sheet while its CURRENT menuType is
//     allowlisted (resolve.js's guard 3), and openMenu sets currentMenu + show()
//     SYNCHRONOUSLY before deliverInit crosses the IPC hop. In that window main
//     reports an allowlisted menuType while the DOM still holds the PRIOR menu's
//     secret — a window far narrower than human timing and therefore invisible to
//     every check this flight has. The eager scrub removes the premise instead of
//     racing it: the DOM is emptied at CLOSE, so there is nothing to read later.
//     Do not "simplify" this back into a lazy scrub-on-next-init.
//
//     `<body>` data attributes are deliberately NOT cleared by the scrub — DD8's
//     drag-probe readback depends on its counters surviving the menu close.

// Ceiling on the keep-focus re-grabs one menu session may spend (see the header).
// A real post-submit navigation steals focus once or twice (redirect chains); a page
// that keeps stealing it hits this ceiling and simply keeps focus, rather than
// trading it back and forth with the sheet forever.
const KEEP_FOCUS_MAX = 5;

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
 *   anchor: any, startIndex?: number, token: number, noFocus?: boolean,
 *   dismissible?: boolean, jarId?: string, keepFocus?: boolean }} MenuOpenPayload
 * @typedef {{ contentView: ContentViewLike, win?: any, bounds?: (Bounds | null) }} Attachment
 */

/**
 * @param {{
 *   getContentView: () => (ContentViewLike | null),
 *   createSheetView: () => SheetViewLike,
 *   sendToChrome?: (channel: string, payload: any, win?: any) => void,
 *   hideFindOverlay?: () => void,
 *   restoreFindOverlay?: (reason: string) => void,
 *   focusChrome?: (win?: any) => void,
 *   onClosed?: (info: { menuType: string, reason: string }) => void
 * }} deps
 */
function createMenuOverlayManager({
  getContentView,
  createSheetView,
  sendToChrome = () => {},
  hideFindOverlay = () => {},
  restoreFindOverlay = () => {},
  focusChrome = () => {},
  // M14 F1 L2 (auth-challenges): optional close-observer, invoked on BOTH
  // close-emit paths — closeMenuOverlay after its channel-7 emit AND openMenu's
  // model-replace branch (which emits 'superseded' directly via sendToChrome
  // without ever calling closeMenuOverlay — hooking only closeMenuOverlay would
  // stall the auth queue on exactly the occlusion case it depends on). The
  // mapping consumer must therefore be path-agnostic about 'superseded'.
  onClosed = () => {}
}) {
  /** @type {SheetViewLike | null} */
  let view = null;
  let visible = false;
  let ready = false;
  /** @type {Bounds | null} */
  let lastGuestBounds = null;
  // HAT FIX 1 (M15 F2 Leg 4 HAT fixes): `jarId` is retained CONDITIONALLY —
  // only when the opening payload actually carries one (typeof === 'string')
  // — so non-bookmark opens keep this record's shape byte-identical to
  // before (menu-overlay-manager.test.js's two `getCurrentMenu()` shape
  // pins). register-overlay-ipc.js's bookmark-edit-submit handler reads it
  // back to consult the bookmarks store before closing the sheet.
  /** @type {{ menuType: string, token: number, jarId?: string } | null} */
  let currentMenu = null;
  // M12 F3 Leg 4 (first-run-setup, DD5): whether the current menu may be SOFT-dismissed
  // (Escape / outside-click / window-blur). vault-recovery-show opens with
  // `dismissible: false` so a casual dismiss (app switch, backdrop click) cannot lose the
  // one-time recovery key — only the deliberate acknowledge ('activated') or a hard
  // lifecycle close (tab/window teardown) closes it. Defaults true for every other menu.
  let currentDismissible = true;
  // KEEP-FOCUS (locked-vault unlock-to-save): whether the current menu asked to hold OS
  // focus across an incidental focus steal by the guest (see the module header). Opt-in
  // per open, reset on every close — a menu that never sets it behaves exactly as before.
  let currentKeepFocus = false;
  // Re-grabs spent by the current menu session; capped so a page that steals focus in a
  // loop cannot drive an unbounded focus tug-of-war.
  let keepFocusGrabs = 0;
  /** @type {MenuOpenPayload | null} */
  let pendingInit = null; // at most ONE queued init (latest wins — F7 pattern)
  // DD7 attachment (M09 F6): the contentView/window the sheet is attached to,
  // RECORDED at show — hide/teardown remove from THIS, never a re-resolve.
  /** @type {Attachment | null} */
  let attachment = null;

  // The contentView to operate on: the RECORDED attachment when one exists,
  // else the injected fallback resolve (defensive — pre-attachment paths only).
  function attachedContentView() {
    return attachment ? attachment.contentView : getContentView();
  }

  // Deliver channel 3 + focus the sheet webContents (focus AFTER init delivery —
  // the page's init handler builds/focuses the menu DOM; view-level focus makes
  // the roving item the real OS focus target).
  /** @param {MenuOpenPayload} payload */
  function deliverInit(payload) {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.send?.('menu-overlay:init', payload);
    if (!payload.noFocus) view.webContents.focus?.();
  }

  // DD1f (M15 F3 L1): the EAGER DOM SCRUB message — the one main→sheet close
  // channel. The sheet's handler runs report.silence() then menuController.closeAll(),
  // so no closed menu's content survives in the shared document. Same view/destroyed
  // guard as deliverInit; a not-yet-constructed or dead sheet has no DOM to scrub, so
  // the no-op is correct (not a swallowed failure). See the module header for why this
  // is load-bearing rather than tidy.
  function deliverCloseReset() {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.send?.('menu-overlay:close');
  }

  // Full teardown (crash recovery + window `closed`): remove from the stack if
  // present, destroy the webContents if still alive, reset all state — the next
  // show recreates cleanly. Menu-close bookkeeping (channel 7 etc.) is the
  // caller's job via closeMenuOverlay('teardown') BEFORE teardown.
  function teardown() {
    if (view) {
      if (visible) {
        // DD7: remove from the RECORDED attachment, never a re-resolve.
        const cv = attachedContentView();
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
    currentMenu = null;
    pendingInit = null;
    attachment = null;
  }

  // Lazy-construct the sheet view. Destroyed-recreate guard: a destroyed
  // webContents means the view is dead — null it so a fresh one is built
  // (ready flag reset with it).
  function ensureView() {
    if (view && view.webContents.isDestroyed()) {
      view = null;
      visible = false;
      ready = false;
      currentMenu = null;
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
  // DD7: operates on the RECORDED attachment (the tab-set-active re-raise must
  // never re-resolve — re-raising window A's open menu into window B's
  // contentView is exactly the wrong-window class M1 names).
  function show() {
    const cv = attachedContentView();
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
  // DD7: removes from the RECORDED attachment — the hide-time getContentView()
  // re-resolve was the review-M1 named defect (removing from a non-parent is
  // documented-undefined behavior).
  function hide() {
    if (!visible) return;
    const cv = attachedContentView();
    if (cv && view) cv.removeChildView(view);
    visible = false;
  }

  /**
   * Open a menu on the sheet (channel-1 entry; DD4). See module header for the
   * model-replace / pending-init / focus contract.
   * DD7 (M09 F6): `att` is the attachment resolved from the OPEN-SENDER's window
   * record — { contentView, win, bounds } — recorded here for the whole menu
   * session. `bounds` is the requesting window's CURRENT active-guest bounds
   * (per-window fetch at show; never trust the single syncBounds slot, which any
   * window's tab-set-bounds pollutes). Omitted att (unit-test/defensive paths)
   * falls back to the injected getContentView().
   * @param {MenuOpenPayload} payload
   * @param {Attachment} [att]
   */
  function openMenu(payload, att) {
    if (!payload || typeof payload.menuType !== 'string' || typeof payload.token !== 'number') return;
    const fallbackCv = att ? null : getContentView();
    /** @type {Attachment | null} */
    const nextAtt = att || (fallbackCv ? { contentView: fallbackCv, win: null, bounds: null } : null);
    if (!nextAtt) return; // window gone — nothing to open on
    const wasOpen = !!currentMenu;
    const crossWindow = wasOpen && attachment != null && attachment.contentView !== nextAtt.contentView;
    if (currentMenu) {
      // Mutual exclusion: model-replace (NO hide/re-show flicker); the superseded
      // menu's channel 7 carries ITS token so chrome resets the right trigger —
      // delivered to the SUPERSEDED menu's attachment window's chrome (DD7:
      // window B's open must reset window A's trigger, not B's).
      sendToChrome('menu-overlay-closed', {
        menuType: currentMenu.menuType,
        reason: 'superseded',
        token: currentMenu.token
      }, attachment ? attachment.win : null);
      // Close-observer, model-replace path (M14 F1 L2): the superseded menu is
      // over even though closeMenuOverlay never ran — observers (the auth
      // pending-challenge store) must see this close too.
      onClosed({ menuType: currentMenu.menuType, reason: 'superseded' });
      // DD1f, model-replace half (M15 F3 L1). closeMenuOverlay never runs on this path,
      // so without this the superseded menu's DOM — a vault card's textContent included —
      // would survive into the window where currentMenu already names the NEW (possibly
      // allowlisted) menuType. 'superseded' is in the leg's own enumerated set of
      // main-initiated closes, so it needs the same treatment as the others.
      //
      // GATED ON A menuType CHANGE, deliberately: a same-menuType model-replace is the
      // repaint path (downloads progress ticks, omnibox suggestion repaints), and
      // menu-overlay.js's in-place downloads update requires `menuController.current` to
      // still be the downloads entry. An unconditional scrub here would null it and force a
      // full rebuild — hide flash, stolen focus. A same-menuType replace also cannot leak
      // across a trust boundary: the residue is the same card's own prior model.
      if (currentMenu.menuType !== payload.menuType) deliverCloseReset();
      // Cross-window model-replace: detach from the OLD recorded attachment
      // before attaching to the new window (the one case where model-replace
      // must physically move the view).
      if (crossWindow && visible && view) {
        /** @type {Attachment} */ (attachment).contentView.removeChildView(view);
        visible = false;
      }
    }
    attachment = nextAtt;
    if (nextAtt.bounds) lastGuestBounds = nextAtt.bounds; // per-window bounds at show (DD7)
    // HAT FIX 1: conditional merge — a non-string/absent jarId (every
    // non-bookmark menuType, plus the bookmark-edit audit-seam fixture)
    // leaves the record at its pre-fix { menuType, token } shape exactly.
    currentMenu = typeof payload.jarId === 'string'
      ? { menuType: payload.menuType, token: payload.token, jarId: payload.jarId }
      : { menuType: payload.menuType, token: payload.token };
    currentDismissible = payload.dismissible !== false; // DD5 — non-dismissible opt-out
    // Keep-focus is per menu session (opt-in, default off) and its grab budget resets
    // with it — a model-replace into a different menu must not inherit the prior one's
    // flag, and a re-open of the same keep-focus menu gets a fresh budget.
    currentKeepFocus = payload.keepFocus === true;
    keepFocusGrabs = 0;
    show();
    // DD5: find bar hidden while a menu is open (parity) — on the FIRST open of
    // a session (model-replace keeps the same open session; the call is
    // idempotent anyway, this just avoids redundant per-keystroke calls), and on
    // a cross-window replace (the new window's find bar must hide too).
    if (!wasOpen || crossWindow) hideFindOverlay();
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
    // DD5 (M12 F3 Leg 4): a non-dismissible menu (vault-recovery-show) ignores the SOFT
    // dismiss reasons — Escape / outside-click / window-blur (window-factory's win.on
    // 'blur' → closeMenuOverlay('blur') is the main-initiated one). Only 'activated' (the
    // deliberate acknowledge) and hard lifecycle reasons (tab-switch/-hide/-close,
    // teardown, superseded) may close it — the one-time recovery key is unrecoverable.
    if (!currentDismissible && (reason === 'escape' || reason === 'outside-click' || reason === 'blur')) {
      return;
    }
    const closed = currentMenu;
    currentMenu = null;
    currentKeepFocus = false; // the session is over — a later stray refocus report is inert
    pendingInit = null;
    // DD1f (M15 F3 L1): scrub the sheet's DOM EAGERLY, before anything else this close
    // does. Ordered ahead of hide()/channel 7 so the scrub message is queued to the sheet
    // ahead of any subsequent open's init — the next menu's DOM is built on an empty root,
    // and no later read can find this menu's content.
    deliverCloseReset();
    hide(); // removes from the RECORDED attachment (DD7)
    const att = attachment;
    attachment = null; // the menu session is over — the next open records afresh
    // DD7: channel 7 + the refocus both target the ATTACHMENT window's chrome
    // (wrong-window delivery = stuck aria-expanded / focus into the wrong window).
    sendToChrome('menu-overlay-closed', { menuType: closed.menuType, reason, token: closed.token }, att ? att.win : null);
    // Close-observer, single-close-path half (M14 F1 L2): after the channel-7
    // emit, with currentMenu already null — an observer re-opening a menu (the
    // auth re-present) sees isMenuOpen() === false.
    onClosed({ menuType: closed.menuType, reason });
    // Reason-resolved refocus, main-side half: escape/activated move keyboard
    // focus back to the chrome view (webContents-level); chrome then focuses the
    // appropriate DOM target on channel 7. `input-empty` also restores chrome:
    // downloads can auto-close a focused sheet after cancellation/expiry. Every
    // other reason moves NO focus ('toggle'
    // — the physical click already OS-focused chrome; 'blur' — never steal focus
    // from the other app; tab lifecycle/teardown — the incoming guest keeps it).
    if (reason === 'escape' || reason === 'activated' || reason === 'input-empty') {
      focusChrome(att ? att.win : null);
    }
    restoreFindOverlay(reason);
  }

  /**
   * Re-grab OS focus for a keep-focus menu whose sheet was blurred by its own guest
   * (see the module header). No-op — never an error — for every other case: no menu
   * open, a menu that did not opt in, a hidden/dead sheet, or a session that has spent
   * its grab budget. The CALLER owns the "is this window still the focused one" check
   * (register-overlay-ipc.js): a real app-switch must never pull focus back.
   * @returns {boolean} whether focus was re-asserted
   */
  function reassertFocus() {
    if (!currentMenu || !currentKeepFocus || !visible) return false;
    if (!view || view.webContents.isDestroyed()) return false;
    if (keepFocusGrabs >= KEEP_FOCUS_MAX) return false;
    keepFocusGrabs++;
    view.webContents.focus?.();
    return true;
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
    reassertFocus,
    syncBounds,
    teardown,
    isVisible: () => visible,
    isReady: () => ready,
    getView: () => view,
    getCurrentMenu: () => currentMenu,
    isMenuOpen: () => currentMenu != null,
    // DD7 (M09 F6): the recorded attachment window (null when no menu session /
    // no window recorded). main.js conditions every cross-cutting hook on
    // owner-window === attachment-window through this read (tab-set-active's
    // syncBounds + tab-switch close + re-raise, tab-set-bounds' live sync,
    // tab-hide/tab-close closes, win 'blur'/'close' closes, accelerator scope,
    // channel-6/7 delivery).
    getAttachedWindow: () => (attachment ? attachment.win : null)
  };
}

module.exports = { createMenuOverlayManager };
