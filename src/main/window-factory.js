// @ts-check
'use strict';

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
    clearPendingAdoptAdminKey,
    defer,
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
        return !!entry && !entry.trusted && !entry.view.webContents.isDestroyed();
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
      onClosed: ({ menuType, reason }) => authChallenges?.notifySheetClosed(record, menuType, reason)
    });

    const tearoffOverlay = createTearoffOverlayManager({
      getContentView: () => (win.isDestroyed() ? null : win.contentView),
      createOverlayView: createTearoffOverlayView
    });

    record.findOverlay = findOverlay;
    record.sheet = sheet;
    record.tearoffOverlay = tearoffOverlay;

    win.on('close', () => {
      // M14 F1 L2 (DD2): cancel the WHOLE per-window auth queue FIRST — the
      // sheet's own 'teardown' close below only ever resolves the presented
      // head, not queued challenges (load-bearing; unit-pinned). Every native
      // login callback is answered before any view teardown runs.
      authChallenges?.cancelForWindow(record);
      // M17 F4 L3 (AC4): drop any pending fresh-adopt admin key held for THIS
      // window and clear the store's idle-autolock suppression. The recovery-show
      // sheet is torn down just below without an ack, so the ack-driven cleanup
      // (AC3) never runs for it. Keyed by the window's chrome id (still resolvable
      // during 'close', before registry.remove on 'closed'); a no-op when the
      // window held nothing pending.
      clearPendingAdoptAdminKey?.(chromeForAttachment(win)?.id);
      // M14 F2 L1 (DD1f): popups close WITH their owner window — after the
      // window-wide auth cancel above (unit-pinned to stay first), before any
      // sheet/overlay teardown. closeAllForRecord itself runs the DD1f order
      // (cancel popup challenges — a stub seam until leg 2, harmlessly
      // double-cancelling behind cancelForWindow — then destroy), snapshotting
      // its list first (deregister-on-`closed` mutates mid-iteration).
      popupRegistry?.closeAllForRecord(record);
      findOverlay.teardown();
      tearoffOverlay.teardown();
      sheet.closeMenuOverlay('teardown');
      sheet.teardown();

      const rec = registry.get(winId);
      if (rec) {
        rec.findOverlay = null;
        rec.tearoffOverlay = null;
        rec.sheet = null;
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

    return record;
  }

  return { createWindow };
}

module.exports = { createWindowFactory, onWindowClosed };
