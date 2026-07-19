/** @param {any} deps */
export function createShortcutController(deps) {
  const {
    window, document, ctx, els, activeTab, isInternalTab, isWebTab,
    openFind, createTab, closeTab, jarsClient, announceTabStatus,
    togglePanel, togglePrivacy, openDownloads, orderedTabIds, activateTab,
    keydownToAction
  } = deps;
  /* --------------------------------------------------------------- shortcuts */

  /**
   * The IMPURE chrome-shortcut dispatch, extracted from the global keydown handler
   * (M05 F8 Leg 2 / DD13 — refactor, not duplicate): the SAME switch bodies now
   * serve the keydown handler below AND the sheet-forwarded `chrome-shortcut-action`
   * channel (accelerators pressed while a sheet menu holds keyboard focus).
   *
   * Returns whether the action was HANDLED — the keydown handler calls
   * preventDefault only on `true`, preserving the original conditional-
   * preventDefault semantics exactly: the internal-tab / null-wcId guarded branches
   * (devtools/zoom/find) returned WITHOUT preventDefault on a guard hit → false
   * here; reload and downloads preventDefault-ed BEFORE their tab guards → always
   * true here; the rest always preventDefault-ed → always true.
   *
   * @param {string} action  a keydownToAction / sheet-accelerator chrome-class action
   * @returns {boolean} whether the action was handled (caller preventDefaults on true)
   */
  function dispatchChromeAction(action) {
    switch (action) {
      // DevTools (F12 and Ctrl+Shift+I) — chrome-focused fallback (the page-focused case is
      // captured main-side in before-input-event). No-op on internal tabs / a tab with no live wcId.
      case 'devtools': {
        const t = activeTab();
        if (!t || isInternalTab(t) || t.wcId == null) return false;
        window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
        return true;
      }
      // Page-zoom fallback (DD6): route the active web tab's wcId to main.
      case 'zoom-in':
      case 'zoom-out':
      case 'zoom-reset': {
        const t = activeTab();
        if (!t || isInternalTab(t) || t.wcId == null) return false;
        const zoom = (action === 'zoom-out') ? 'out' : (action === 'zoom-reset') ? 'reset' : 'in';
        window.goldfinch.zoomApply({ webContentsId: t.wcId, action: zoom });
        return true;
      }
      // Chrome-focused Ctrl+F fallback (DD2 / AC2): no bar on internal tabs.
      case 'find': {
        const t = activeTab();
        if (!t || isInternalTab(t) || t.wcId == null) return false;
        openFind(t);
        return true;
      }
      case 'new-tab':
        createTab();
        return true;
      case 'close-tab':
        if (ctx.activeTabId) closeTab(ctx.activeTabId);
        return true;
      // New Window (M09 F6 Leg 4, DD5): Ctrl/Cmd+N through the one-classifier
      // path — the same body the kebab item runs. Main creates the window; the
      // new chrome document boots its home tab normally (window-boot-config).
      case 'new-window':
        window.goldfinch.windowCreate();
        return true;
      // reopen-closed-tab (M09 F4 Leg 2, DD2 step 3) — retires the Ctrl+Shift+T
      // reservation. Renderer-orchestrated two-invoke chain (design-review
      // correction: main never constructs a view itself): tabReopen() pops the
      // stack main-side; an empty stack resolves `null` and this is a SILENT
      // no-op (always returns true / swallows the key regardless, matching the
      // synchronous no-op precedent set by the 'downloads' case below). The
      // container resolves EXACTLY like a popup's does (inheritFromPartition's
      // existing fallback chain), so a jarFallback entry (partition omitted)
      // falls through to the same default-jar/burner resolution with zero new
      // code — announced via #tab-status only in that case.
      case 'reopen-closed-tab':
        window.goldfinch.tabReopen().then((entry) => {
          if (!entry) return; // empty stack — no-op (AC)
          const container = jarsClient.inheritContainerFromPartition(entry.partition);
          createTab(entry.url, container, {
            trusted: false,
            restoreHistory: { entries: entry.navEntries, index: entry.navIndex, title: entry.title },
            insertAt: entry.stripIndex,
          });
          if (entry.jarFallback) {
            announceTabStatus('Reopened tab — its cookie jar no longer exists; reopened in the default jar');
          }
        });
        return true;
      case 'focus-address':
        els.address.focus();
        els.address.select();
        return true;
      case 'toggle-panel':
        togglePanel();
        return true;
      case 'toggle-privacy':
        togglePrivacy();
        return true;
      case 'reload': {
        // preventDefault preceded the tab guard in the original handler — handled
        // (true) even when there is no / an internal active tab.
        const t = activeTab();
        // Internal tabs: reload keyboard shortcut is a no-op (internal pages are static).
        if (t && isWebTab(t) && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
        return true;
      }
      // Downloads (Ctrl+J) — chrome-focused fallback (the page-focused case is captured main-side
      // in before-input-event → onOpenDownloads). No-op if the active tab is already internal so a
      // second internal tab isn't stacked (DD2). preventDefault preceded the guard — always true.
      case 'downloads': {
        const t = activeTab();
        if (!(t && isInternalTab(t))) openDownloads();
        return true;
      }
      // Tab-cycle / tab-jump (M09 F3 Leg 1, DD1): global chrome shortcuts, work
      // regardless of focus location (address bar, guest content, internal tab) —
      // always handled/preventDefault-ed, even for an out-of-range jump (Chrome-
      // parity: Ctrl+7 with 5 tabs swallows the key and does nothing visible).
      // Follows VISUAL (DOM) order via orderedTabIds() — the F2 order authority —
      // so jumps/cycling track a keyboard/pointer reorder. A single-tab cycle is a
      // harmless self-activate (activateTab falls out of the modulo naturally).
      case 'tab-next':
      case 'tab-prev': {
        const ids = orderedTabIds();
        const len = ids.length;
        if (!len) return true; // never-zero invariant — defensive only
        const cur = Math.max(ids.indexOf(ctx.activeTabId), 0);
        const idx = action === 'tab-next' ? (cur + 1) % len : (cur - 1 + len) % len;
        activateTab(ids[idx]);
        return true;
      }
      case 'tab-jump-1':
      case 'tab-jump-2':
      case 'tab-jump-3':
      case 'tab-jump-4':
      case 'tab-jump-5':
      case 'tab-jump-6':
      case 'tab-jump-7':
      case 'tab-jump-8':
      case 'tab-jump-last': {
        const ids = orderedTabIds();
        const len = ids.length;
        if (!len) return true; // never-zero invariant — defensive only
        const idx = action === 'tab-jump-last' ? len - 1 : Number(action.slice('tab-jump-'.length)) - 1;
        if (idx >= len) return true; // out-of-range jump: Chrome-parity no-op
        activateTab(ids[idx]);
        return true;
      }
    }
    return false;
  }

  document.addEventListener('keydown', (e) => {
    // The pure decision — "given (key, mods, lightboxOpen), which action?" — lives in
    // keydownToAction (../shared/keydown-action.js, imported at the top of this
    // file, same route as isSafeTabUrl). It reproduces the live gating exactly: F12 before the
    // modifier gate, mod = ctrl||meta, zoom/find/F12/Ctrl+Shift+I lightbox-deferred,
    // the t/w/l/m/Shift+P/r chain not lightbox-gated, Ctrl+Shift+I vs Shift+P by key
    // letter. The IMPURE dispatch lives in dispatchChromeAction above (extracted,
    // M05 F8 Leg 2) — preventDefault fires only when it reports handled, preserving
    // the conditional-preventDefault of the guarded branches bit-for-bit.
    const action = keydownToAction({
      key: e.key,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      lightboxOpen: !els.lightbox.classList.contains('hidden'),
      // Real e.altKey threaded through (M09 F3, i18n ruling): AltGr digits report
      // ctrl+alt on European layouts and must not be misread as a tab-jump.
      alt: e.altKey,
    });
    if (!action) return;
    if (dispatchChromeAction(action)) e.preventDefault();
  });

  // DD13 (M05 F8): chrome-class accelerators forwarded from the menu-overlay sheet's
  // before-input-event (keyboard focus sits in the sheet while a menu is open — the
  // keydown handler above never sees them). Same dispatch, no event to preventDefault
  // (main already swallowed the sheet-side input).
  window.goldfinch.onChromeShortcutAction(({ action }) => {
    if (typeof action === 'string') dispatchChromeAction(action);
  });


  return { dispatchChromeAction };
}
