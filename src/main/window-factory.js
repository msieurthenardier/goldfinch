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
        sandbox: false
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
        sandbox: false
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

      const accelChrome = !record.chromeView.webContents.isDestroyed()
        ? record.chromeView.webContents
        : null;
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
    const frameOpts = platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 } }
      : { frame: false };
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
        ...(isAutomationEnabled(argv) && !isPackaged
          ? { additionalArguments: ['--automation-dev'] }
          : {})
      }
    });
    win.contentView.addChildView(chromeView);
    chromeView.setBackgroundColor('#1e1f25');
    chromeView.setBounds({ x: 0, y: 0, width: initialWidth, height: initialHeight });
    chromeView.webContents.loadFile(paths.chromeHtml);

    const record = registry.create({ win, chromeView, noBootTab });
    broadcastMoveTargetsChanged();
    const winId = win.id;
    win.on('focus', () => registry.noteFocus(winId));

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
      focusChrome: (attWin) => chromeForAttachment(attWin)?.focus()
    });

    const tearoffOverlay = createTearoffOverlayManager({
      getContentView: () => (win.isDestroyed() ? null : win.contentView),
      createOverlayView: createTearoffOverlayView
    });

    record.findOverlay = findOverlay;
    record.sheet = sheet;
    record.tearoffOverlay = tearoffOverlay;

    win.on('close', () => {
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
      sendToOwnChrome('trigger-send-bounds');
    });
    win.on('maximize', () => {
      sendToOwnChrome('window-maximized-change', true);
      sendToOwnChrome('trigger-send-bounds');
    });
    win.on('unmaximize', () => {
      sendToOwnChrome('window-maximized-change', false);
      sendToOwnChrome('trigger-send-bounds');
    });

    return record;
  }

  return { createWindow };
}

module.exports = { createWindowFactory, onWindowClosed };
