// @ts-check
'use strict';

// Mission 20 Flight 3 Leg 2 (DD1): the shared guest-takeover predicate.
const { guestTakenOver } = require('../shared/load-failure');
// Sortie 06 Leg 3: the prompt view's trusted key decision + the shared guest-focus predicate.
const { savePromptKeyAction } = require('./save-prompt-keys');
const { focusActiveGuest } = require('./focus-active-guest');
const { dismissesPickerContexts } = require('./vault/picker-dismissal');

/**
 * Register the sole sanctioned Electron `closed` listener. The primitive id is
 * captured while the window is alive, so the callback cannot reach through a
 * destroyed BaseWindow.
 * @param {any} win
 * @param {(winId: number) => void} handler
 */
function onWindowClosed(win, handler) {
  const winId = win.id;
  win.on('closed', () => handler(winId));
}

/**
 * Electron-free window/view composition. Every live Electron handle and every
 * application service is injected by main.js, which keeps this lifecycle runnable
 * under node:test with strict destroyed-window fakes.
 * @param {any} deps
 */
function createWindowFactory(deps) {
  const {
    BaseWindow,
    WebContentsView,
    platform,
    argv,
    isPackaged,
    paths,
    registry,
    isAutomationEnabled,
    broadcastMoveTargetsChanged,
    createFindOverlayManager,
    createMenuOverlayManager,
    createTearoffOverlayManager,
    // Sortie 06 Leg 1 (DD1): the corner save prompt. All four are OPTIONAL so a harness that
    // omits them (window-factory.test.js fakes) still constructs a window with no prompt.
    createSavePromptManager,
    computeSavePromptBounds,
    getVaultHuman,
    htmlFullscreen,
    authChallenges,
    computeFindOverlayBounds,
    getTabContents,
    chromeForAttachment,
    sheetAcceleratorAction,
    isInternalContents,
    isGuestActionAllowed,
    toggleDevTools,
    applyZoom,
    captureWindowCloseEntries,
    jars,
    closedTabStack,
    broadcastClosedTabStackChanged,
    settings,
    isSessionQuitting,
    sessionStore,
    buildSessionSnapshot,
    getHistoryRecorder,
    faviconFetcher,
    popupRegistry,
    releaseVaultHoldsForWindow,
    // Mission 23 Flight 1 (leg `vault-fill-trust`): drop the picker contexts of the given tabs (resolved
    // through main's memoized vault-human; never force-constructs it). Optional.
    dropVaultPickerContexts,
    defer,
    // Squawk 0073: arms the continuous session-snapshot debounce (built + owned in
    // main.js) on new-window creation — low-value on its own (a window with zero
    // tabs is dropped from the snapshot by buildSessionSnapshot), but listed
    // explicitly as a topology-changing site to cover. Optional-chained so an
    // offline harness that omits it stays unaffected.
    scheduleSnapshot,
    // Mission 20 Flight 3 Leg 3 (DD5/DD6): chrome reload-and-reconcile
    // (Electron-free — see chrome-recovery.js).
    chromeRecovery,
    // Mission 20 Flight 3 Leg 3 (DD7): the crash-record sink, threaded the
    // same optional way guest-wiring.js receives it.
    onCrash,
    logger
  } = deps;

  function loadViewFile(view, file, label) {
    view.webContents.loadFile(file).catch((err) => {
      logger.warn(`[${label}] loadFile rejected:`, err && (err.code || err.message || err));
    });
  }

  function createFindOverlayView() {
    const view = new WebContentsView({
      webPreferences: {
        preload: paths.findPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    view.setBackgroundColor('#00000000');
    loadViewFile(view, paths.findHtml, 'find-overlay');
    return view;
  }

  function createTearoffOverlayView() {
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    view.setBackgroundColor('#00000000');
    loadViewFile(view, paths.tearoffHtml, 'tearoff-overlay');
    return view;
  }

  // Sortie 06 Leg 1 (DD1/DD9): the corner save-prompt view - chrome-class, context-isolated,
  // sandboxed, transparent, with ONLY the narrow save-prompt preload. Never focused on show.
  function createSavePromptView() {
    const view = new WebContentsView({
      webPreferences: {
        preload: paths.savePromptPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    view.setBackgroundColor('#00000000');
    loadViewFile(view, paths.savePromptHtml, 'save-prompt');
    return view;
  }

  // Sortie 06 Leg 3 (DD2; R4/R6/R8): keys are read from the prompt view's TRUSTED
  // `before-input-event` (never a page channel), acted on only while the prompt is visible, and
  // scoped to THIS record by closure (a focused prompt in window A never moves focus in B).
  //   F6        -> focus the chrome THEN send focus-address (focus-then-send).
  //   Shift+F6  -> the active guest via the shared predicate; a taken-over/destroyed guest falls
  //                back to chrome focus + 'focus-content' (the chrome's load-failure heading path).
  //   Esc       -> close('dismissed') only on an interactive offer; otherwise swallowed (no-op).
  /**
   * @param {any} view  the freshly created prompt view (the manager builds it lazily)
   * @param {any} record
   */
  function attachSavePromptKeys(view, record) {
    view.webContents.on('before-input-event', (/** @type {any} */ event, /** @type {any} */ input) => {
      const manager = record.savePrompt;
      if (!manager || !manager.isVisible()) return;
      const action = savePromptKeyAction({
        type: input.type,
        key: input.key,
        control: input.control,
        meta: input.meta,
        shift: input.shift,
        alt: input.alt
      });
      if (!action) return;
      event.preventDefault();
      if (action === 'dismiss') {
        if (manager.canDismissByKey()) manager.close('dismissed');
        return;
      }
      if (input.isAutoRepeat) return;
      const chrome = !record.chromeView.webContents.isDestroyed() ? record.chromeView.webContents : null;
      if (action === 'to-address') {
        chrome?.focus();
        chrome?.send('chrome-shortcut-action', { action: 'focus-address' });
        return;
      }
      // to-guest (Shift+F6): never dead - a refused (taken-over) guest hands to the chrome.
      if (!focusActiveGuest(record)) {
        chrome?.focus();
        chrome?.send('chrome-shortcut-action', { action: 'focus-content' });
      }
    });
  }

  /** @param {any} record */
  function createSheetView(record) {
    const view = new WebContentsView({
      webPreferences: {
        preload: paths.menuPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    view.setBackgroundColor('#00000000');
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const hit = sheetAcceleratorAction({
        key: input.key,
        control: input.control,
        meta: input.meta,
        shift: input.shift,
        alt: input.alt
      });
      if (!hit) return;
      event.preventDefault();
      if (hit.autoRepeatGuard && input.isAutoRepeat) return;

      const accelChrome = !record.chromeView.webContents.isDestroyed() ? record.chromeView.webContents : null;
      if (hit.scope === 'chrome') {
        accelChrome?.send('chrome-shortcut-action', { action: hit.action });
        return;
      }

      const wc = record.activeTabWcId != null ? getTabContents(record.activeTabWcId) : null;
      if (!isGuestActionAllowed(hit.action, !wc || isInternalContents(wc))) return;
      switch (hit.action) {
        case 'devtools':
          if (wc) toggleDevTools(wc);
          break;
        case 'zoom-in':
          applyZoom(wc, 'in');
          break;
        case 'zoom-out':
          applyZoom(wc, 'out');
          break;
        case 'zoom-reset':
          applyZoom(wc, 'reset');
          break;
        case 'print':
          if (wc) {
            wc.print({}, (ok, reason) => {
              if (!ok) logger.warn('print failed:', reason);
            });
          }
          break;
        case 'find':
          record.sheet?.closeMenuOverlay('superseded');
          accelChrome?.send('open-find');
          break;
        case 'downloads':
          accelChrome?.send('open-downloads');
          break;
      }
    });
    loadViewFile(view, paths.menuHtml, 'menu-overlay');
    return view;
  }

  /** @param {{ noBootTab?: boolean, contentSize?: { width: number, height: number } | null }} [opts] */
  function createWindow({ noBootTab = false, contentSize = null } = {}) {
    const frameOpts =
      platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 } } : { frame: false };
    const initialWidth = contentSize ? contentSize.width : 1400;
    const initialHeight = contentSize ? contentSize.height : 900;
    const win = new BaseWindow({
      width: initialWidth,
      height: initialHeight,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#1e1f25',
      title: 'Goldfinch',
      icon: paths.icon,
      ...frameOpts
    });
    if (contentSize) win.setContentSize(contentSize.width, contentSize.height);

    const chromeView = new WebContentsView({
      webPreferences: {
        preload: paths.chromePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        ...(isAutomationEnabled(argv) && !isPackaged ? { additionalArguments: ['--automation-dev'] } : {})
      }
    });
    win.contentView.addChildView(chromeView);
    chromeView.setBackgroundColor('#1e1f25');
    chromeView.setBounds({ x: 0, y: 0, width: initialWidth, height: initialHeight });
    chromeView.webContents.loadFile(paths.chromeHtml);

    const record = registry.create({ win, chromeView, noBootTab });
    broadcastMoveTargetsChanged();
    const winId = win.id;
    // M14 F1 L2 (DD2): window refocus is a mandatory auth re-present trigger —
    // the 'blur' close below has no tab-activation counterpart, so without this
    // hook an app-switch would strand a pending challenge until some other
    // trigger fired.
    win.on('focus', () => {
      registry.noteFocus(winId);
      authChallenges?.notifyWindowFocused(record);
    });

    // Mission 20 Flight 2 Leg 1 (#216, DD12 H2/H3): the leg-1 live diagnostic run
    // found the stranded-focus defect's mechanism — the navigating GUEST
    // asserting itself as the window's focused child view a few ms into a
    // chrome-initiated navigation —
    // asynchronous relative to the tab-navigate handler, so a one-shot reassert
    // issued there raced the steal and lost. Reacting to the CHROME's own
    // `blur` instead catches the steal the instant it lands, however many
    // times it repeats. Gated on: (1) `entry.chromeNavPending` — armed ONLY for
    // a chrome-initiated `tab-navigate` that started while the chrome held
    // focus (register-tab-ipc.js), disarmed at `did-navigate`/`did-fail-load`
    // (guest-wiring.js); (2) `win.isFocused()` — a real app-switch (alt-tab to
    // another application) must never pull focus back, the same posture as the
    // menu-overlay sheet's keep-focus reassert (CLAUDE.md "Keep-focus opens");
    // (3) no sheet menu open — an open menu is the operator's focus to keep
    // (DD1's `findOverlay.hide()` posture).
    chromeView.webContents.on('blur', () => {
      if (!win.isFocused()) return;
      const entry = record.activeTabWcId != null ? record.tabViews.get(record.activeTabWcId) : null;
      if (!entry?.chromeNavPending) return;
      if (record.sheet?.isMenuOpen()) return;
      if (!chromeView.webContents.isDestroyed()) chromeView.webContents.focus();
    });

    const sendToOwnChrome = (channel, payload) => {
      const cc = chromeView.webContents;
      if (!cc.isDestroyed()) cc.send(channel, payload);
    };

    const findOverlay = createFindOverlayManager({
      getContentView: () => (win.isDestroyed() ? null : win.contentView),
      createOverlayView: createFindOverlayView,
      getActiveGuestBounds: () => {
        const entry = record.activeTabWcId != null ? record.tabViews.get(record.activeTabWcId) : null;
        return entry && !entry.view.webContents.isDestroyed() ? entry.view.getBounds() : null;
      },
      computeBounds: computeFindOverlayBounds,
      getTabContents,
      isFindableTab: (wcId) => {
        const entry = record.tabViews.get(wcId);
        // Mission 20 Flight 1 (DD6/AC8), widened Flight 3 Leg 2 (DD1): a
        // taken-over tab (a load failure OR a crash) has nothing to search —
        // its guest is hidden under the visibility invariant, and the panel
        // is the chrome panel, not the page.
        return !!entry && !entry.trusted && !guestTakenOver(entry) && !entry.view.webContents.isDestroyed();
      },
      notifyChrome: sendToOwnChrome
    });

    const sheet = createMenuOverlayManager({
      getContentView: () => (win.isDestroyed() ? null : win.contentView),
      createSheetView: () => createSheetView(record),
      sendToChrome: (channel, payload, attWin) => {
        const cc = chromeForAttachment(attWin);
        if (cc && !cc.isDestroyed()) cc.send(channel, payload);
      },
      hideFindOverlay: () => findOverlay.hide(),
      restoreFindOverlay: (reason) => {
        if (reason === 'tab-switch' || reason === 'tab-hide' || reason === 'tab-close') return;
        const sessionWcId = findOverlay.getSessionTabWcId();
        if (sessionWcId != null && record.activeTabWcId === sessionWcId) findOverlay.show();
      },
      focusChrome: (attWin) => chromeForAttachment(attWin)?.focus(),
      // M14 F1 L2: close-observer → the auth pending-challenge store's DD2
      // bucket mapping. Closes over `record` so the store gets window identity
      // natively (it holds no tokens). Fires on BOTH manager emit paths
      // (closeMenuOverlay AND the model-replace 'superseded' branch).
      onClosed: ({ menuType, reason }) => {
        authChallenges?.notifySheetClosed(record, menuType, reason);
        // Mission 23 Flight 1 (`vault-fill-trust`): a dismissed vault picker / unlock sheet ends the open.
        // Reads only the menu type and the reason (`onClosed` names no tab), so every tab of THIS window.
        if (dismissesPickerContexts(menuType, reason)) dropVaultPickerContexts?.([...record.tabViews.keys()]);
      },
      // Sortie 06 Leg 1 (AC16): the corner save prompt's `sheet` timer-pause input. Read via
      // `record.savePrompt` at CALL time (the prompt is constructed just below).
      onVisibilityChanged: (visible) => record.savePrompt?.setSheetVisible(visible)
    });

    const tearoffOverlay = createTearoffOverlayManager({
      getContentView: () => (win.isDestroyed() ? null : win.contentView),
      createOverlayView: createTearoffOverlayView
    });

    record.findOverlay = findOverlay;
    record.sheet = sheet;
    record.tearoffOverlay = tearoffOverlay;

    // Sortie 06 Leg 1 (DD1): the per-window corner save prompt. One instance per window; every
    // dep closes over THIS record, so window B's blur/focus/sheet/tab events never reach it.
    // The vault delegates resolve at CALL time (`getVaultHuman` may force-construct vault-human,
    // which is only reached when a capture is actually being saved/dismissed).
    if (typeof createSavePromptManager === 'function') {
      record.savePrompt = createSavePromptManager({
        getContentView: () => (win.isDestroyed() ? null : win.contentView),
        createView: () => {
          const v = createSavePromptView();
          attachSavePromptKeys(v, record);
          return v;
        },
        getActiveGuestBounds: () => {
          const entry = record.activeTabWcId != null ? record.tabViews.get(record.activeTabWcId) : null;
          return entry && !entry.view.webContents.isDestroyed() ? entry.view.getBounds() : null;
        },
        isFindVisible: () => !!record.findOverlay?.isVisible(),
        isSheetVisible: () => !!record.sheet?.isVisible(),
        isFullscreen: () => record.htmlFullscreen != null,
        computeBounds: computeSavePromptBounds,
        chromeZoomFactor: () => (chromeView.webContents.isDestroyed() ? 1 : chromeView.webContents.getZoomFactor()),
        sendToChrome: sendToOwnChrome,
        captureSave: (arg) => getVaultHuman().captureSave(arg),
        captureDismiss: (captureId) => getVaultHuman?.()?.captureDismiss(captureId),
        focusActiveGuest: () => focusActiveGuest(record)
      });
    }

    // Mission 20 Flight 3 Leg 3 (DD5/DD6): a dead chrome renderer. Registered
    // AFTER the overlay slots above are assigned — every hook closure reads
    // `record.sheet`/`record.findOverlay`/`record.tearoffOverlay` at CALL
    // time (a bound value captured at registration would freeze `undefined`,
    // the leg-1 TDZ anomaly class). The chrome wc is destroyed in `closed`
    // via `setImmediate` (below), so a post-`closed` event cannot reach a
    // live listener — the `isDestroyed()` guard covers the window itself
    // (a crash arriving for an entry whose window is mid-teardown).
    chromeView.webContents.on('render-process-gone', (_e, details) => {
      if (chromeView.webContents.isDestroyed()) return;
      chromeRecovery.onChromeGone(record, details, {
        windowId: winId,
        closeSheet: (r) => record.sheet?.closeMenuOverlay(r),
        hideFind: () => record.findOverlay?.hide(),
        hideTearoff: () => record.tearoffOverlay?.hide(),
        // Sortie 06 Leg 1 (AC13): a dead chrome takes its queue with it - close the prompt
        // `teardown` (drops the shown capture). Read at CALL time like the hooks above.
        closeSavePrompt: () => record.savePrompt?.close('teardown'),
        reload: () => chromeView.webContents.reload(),
        setTitle: (t) => {
          if (!win.isDestroyed()) win.setTitle(t);
        },
        onCrash
      });
    });

    win.on('close', () => {
      // Sortie 06 Leg 1 (AC13): the corner save prompt closes FIRST (reason `teardown`, which
      // drops the shown capture and emits its single `save-prompt-closed`), before the auth
      // queue cancel and before releaseVaultHoldsForWindow drops this window's captures - so
      // its close reason wins over the "expired" state those drops would otherwise cause.
      record.savePrompt?.close('teardown');
      // M14 F1 L2 (DD2): cancel the WHOLE per-window auth queue FIRST — the
      // sheet's own 'teardown' close below only ever resolves the presented
      // head, not queued challenges (load-bearing; unit-pinned). Every native
      // login callback is answered before any view teardown runs.
      authChallenges?.cancelForWindow(record);
      // M17 F4 L3 (AC4), re-modeled M18 F2 L4 (flight DD5): drop any pending
      // fresh-adopt admin key held for THIS window and release ALL of this
      // window's holds on the refcounted autolock-suppression holder. The
      // recovery-show sheet is torn down just below without an ack, so the
      // ack-driven cleanup never runs for it. The holder un-suppresses only when
      // NO window holds anything pending — another window's live dismiss-locked
      // reveal keeps suppression up (the DD5 cross-flow hazard this migration
      // closes). A pending COMPROMISE reveal survives the window (H2
      // hold-and-resurface — only its hold is released; the reveal re-keys and
      // re-holds at the next chrome boot). Keyed by the window's chrome id (still
      // resolvable during 'close', before registry.remove on 'closed'); a no-op
      // when the window held nothing pending.
      releaseVaultHoldsForWindow?.(chromeForAttachment(win)?.id);
      // M14 F2 L1 (DD1f): popups close WITH their owner window — after the
      // window-wide auth cancel above (unit-pinned to stay first), before any
      // sheet/overlay teardown. closeAllForRecord itself runs the DD1f order
      // (cancel popup challenges — a stub seam until leg 2, harmlessly
      // double-cancelling behind cancelForWindow — then destroy), snapshotting
      // its list first (deregister-on-`closed` mutates mid-iteration).
      popupRegistry?.closeAllForRecord(record);
      findOverlay.teardown();
      tearoffOverlay.teardown();
      record.savePrompt?.teardown();
      sheet.closeMenuOverlay('teardown');
      sheet.teardown();

      const rec = registry.get(winId);
      if (rec) {
        rec.findOverlay = null;
        rec.tearoffOverlay = null;
        rec.sheet = null;
        rec.savePrompt = null;
      }
      if (!rec) return;

      try {
        const captured = captureWindowCloseEntries({
          tabViews: rec.tabViews,
          jarsList: jars.list(),
          windowId: winId
        });
        for (const entry of captured) closedTabStack.push(entry);
        if (captured.length > 0) broadcastClosedTabStackChanged();
      } catch (err) {
        logger.error('[closed-tab-stack] window-close capture failed:', err);
      }

      try {
        if (settings.get('restoreSession') === true && !isSessionQuitting()) {
          sessionStore.write(buildSessionSnapshot({ windows: registry.records(), jarsList: jars.list() }));
        }
      } catch (err) {
        logger.error('[session-store] window-close snapshot write failed:', err);
      }

      const historyRecorder = getHistoryRecorder();
      for (const [wcId, entry] of rec.tabViews) {
        historyRecorder?.forgetTab(wcId);
        // Mission 13 Flight 1 / Leg 1: whole-window close teardown — the other
        // of the two sites that must call forget(wcId) (register-tab-ipc.js's
        // single tab-close is the other).
        faviconFetcher?.forget(wcId);
        if (!win.isDestroyed()) win.contentView.removeChildView(entry.view);
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.destroy();
      }
      rec.tabViews.clear();
      rec.activeTabWcId = null;
    });

    onWindowClosed(win, (closedWinId) => {
      registry.remove(closedWinId);
      broadcastMoveTargetsChanged();
      const chromeWc = chromeView.webContents;
      defer(() => {
        if (!chromeWc.isDestroyed()) chromeWc.destroy();
      });
    });

    win.on('blur', () => sheet.closeMenuOverlay('blur'));
    // Sortie 06 Leg 1 (AC16): the corner save prompt's `windowBlur` timer-pause input, fed from
    // EVENTS ONLY (blur/minimize -> true, focus/restore -> false). The initial value is false and
    // is deliberately NEVER seeded from win.isFocused() - that call is unreliable under WSLg /
    // dev-launch (window-census.js header); a missed pause costs at most a timeout, a stuck pause
    // would hold a credential for the whole 2-minute TTL. `record.savePrompt` is read at call time
    // and nulled at close, so a late event is a no-op.
    win.on('blur', () => record.savePrompt?.setWindowBlurred(true));
    win.on('minimize', () => record.savePrompt?.setWindowBlurred(true));
    win.on('focus', () => record.savePrompt?.setWindowBlurred(false));
    win.on('restore', () => record.savePrompt?.setWindowBlurred(false));
    win.on('resize', () => {
      if (chromeView.webContents.isDestroyed()) return;
      const { width, height } = win.getContentBounds();
      chromeView.setBounds({ x: 0, y: 0, width, height });
      // M14 F1 L1 (DD1): while a tab holds HTML fullscreen, re-expand it to
      // the NEW content bounds (one discrete step); the renderer's triggered
      // bounds send below lands in the tab-set-bounds gate and defers as
      // pending — that ordering is fine (exit applies the pending rect).
      htmlFullscreen.handleWindowResize(record);
      sendToOwnChrome('trigger-send-bounds');
    });
    // maximize/unmaximize send trigger-send-bounds independently and can
    // arrive WITHOUT a paired resize on some platforms — the fullscreen
    // re-expand hook rides both (M14 F1 L1; handleWindowResize is a cheap
    // no-op when no tab holds the mode).
    win.on('maximize', () => {
      sendToOwnChrome('window-maximized-change', true);
      htmlFullscreen.handleWindowResize(record);
      sendToOwnChrome('trigger-send-bounds');
    });
    win.on('unmaximize', () => {
      sendToOwnChrome('window-maximized-change', false);
      htmlFullscreen.handleWindowResize(record);
      sendToOwnChrome('trigger-send-bounds');
    });

    // Squawk 0073: a new window is new topology — debounced snapshot re-arm.
    scheduleSnapshot?.();

    return record;
  }

  return { createWindow };
}

module.exports = { createWindowFactory, onWindowClosed };
