'use strict';

// Electron-free ownership of app readiness, restore, activation, and quit order.
// Electron handles are injected; this module only coordinates their public shape.

function registerAppLifecycle({
  app,
  ipcMain,
  sessionRuntime,
  initProfileAndStores,
  profileStores,
  historyStore,
  sessionStore,
  getUserDataPath,
  createHistoryRecorder,
  setHistoryRecorder,
  listJars,
  broadcast,
  pruneAllJars,
  scheduleInterval,
  createDownloadsManager,
  downloadsStore,
  setDownloadsManager,
  getDownloadsManager,
  wireDownloadHandler,
  applyShields,
  applySpellcheck,
  settings,
  defaultSession,
  fromPartition,
  internalPartition,
  setCreatingInternalSession,
  handleInternal,
  createWindow,
  registry,
  isMcpAutomationEnabled,
  shouldBindAutomation,
  shouldAutoMint,
  setDevEnableOverride,
  startMcpServerInstance,
  createEngine,
  getChromeContents,
  grabWindow,
  listWindows,
  enumerateWindows,
  chromeForTab,
  raiseWindowForTab,
  isKnownJar,
  resolveAutoMintTarget,
  mintJarKey,
  mintAdminKey,
  getMcpServer,
  setSessionQuitting,
  buildSessionSnapshot,
  appDb,
  getAllWindows,
  argv,
  env,
  platform,
  stdout,
  logger = console,
}) {
  app.on('session-created', sessionRuntime.onSessionCreated);

  ipcMain.handle('window-boot-config', (event) => {
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec) return { bootTab: true };
    rec.bootConfigServed = true;
    const queued = rec.pendingChromeSends.splice(0);
    const chrome = rec.chromeView.webContents;
    for (const buildMessage of queued) {
      if (chrome.isDestroyed()) break;
      const [channel, payload] = buildMessage();
      chrome.send(channel, payload);
    }
    return rec.restoreTabs
      ? { bootTab: false, restoreTabs: rec.restoreTabs }
      : { bootTab: !rec.noBootTab };
  });
  ipcMain.on('app-quit', () => app.quit());

  const ready = app.whenReady().then(() => {
    initProfileAndStores(app, profileStores);
    const userDataPath = getUserDataPath();
    historyStore.open(userDataPath);
    sessionStore.load(userDataPath);
    setHistoryRecorder(createHistoryRecorder({ store: historyStore, listJars, broadcast }));

    pruneAllJars();
    scheduleInterval(pruneAllJars, 60 * 60 * 1000).unref();
    const downloadsManager = createDownloadsManager(downloadsStore);
    setDownloadsManager(downloadsManager);
    wireDownloadHandler(defaultSession);
    applyShields(defaultSession);
    applySpellcheck(defaultSession, settings.get('spellcheck'));

    setCreatingInternalSession(true);
    const internalSession = fromPartition(internalPartition);
    setCreatingInternalSession(false);
    internalSession.__goldfinchInternal = true;
    internalSession.protocol.handle('goldfinch', handleInternal);

    const restoreSnapshot = settings.get('restoreSession') === true ? sessionStore.read() : null;
    if (restoreSnapshot) {
      for (const savedWindow of restoreSnapshot.windows) {
        const rec = createWindow({ noBootTab: true });
        rec.restoreTabs = savedWindow.tabs;
      }
    } else {
      createWindow();
    }

    const devOverride = !app.isPackaged && isMcpAutomationEnabled(argv);
    setDevEnableOverride(devOverride);

    if (isMcpAutomationEnabled(argv) && !app.isPackaged) {
      const engine = createEngine(getChromeContents, {
        getDownloads: () => getDownloadsManager().listAll(),
        grabWindow,
        listWindows,
        enumerateWindows,
        isTabViewWcId: (id) => registry.isTabViewWcId(id),
        isChromeContents: (contents) => registry.isChromeContents(contents),
        chromeForTab,
        raiseWindowForTab,
        getHistoryReads: {
          listRecent: (id, options) => historyStore.listRecent(id, options),
          search: (id, query, options) => historyStore.search(id, query, options)
        },
        isKnownJar,
      });
      ipcMain.handle('automation:dev-invoke', async (event, payload) => {
        if (!registry.getWindowForChrome(event.sender)) {
          throw new Error('automation: dev-seam is chrome-renderer-only');
        }
        const { op, args } = payload || {};
        if (typeof engine[op] !== 'function') throw new Error('automation: unknown op ' + op);
        return engine[op](...(Array.isArray(args) ? args : []));
      });
    }

    if (shouldBindAutomation({
      automationEnabled: settings.get('automationEnabled') === true,
      devForceBind: devOverride
    })) {
      void startMcpServerInstance();
    }

    if (devOverride && shouldAutoMint(argv, env)) {
      try {
        const target = resolveAutoMintTarget(profileStores.jars);
        if (target === null) {
          logger.error('[mcp] dev auto-mint skipped: default is Burner (no persistent jars)');
        }
        const key = target === null ? null : mintJarKey(target, settings, profileStores.jars);
        const adminKey = env.GOLDFINCH_AUTOMATION_ADMIN ? mintAdminKey(settings) : null;
        stdout.write('AUTOMATION_DEV_MINT ' + JSON.stringify({ key, adminKey }) + '\n');
      } catch (error) {
        logger.error('[mcp] dev auto-mint failed:', error && error.message);
      }
    }

    app.on('activate', () => {
      if (getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    setSessionQuitting(true);
    try {
      if (settings.get('restoreSession') === true && registry.records().length) {
        sessionStore.write(buildSessionSnapshot({ windows: registry.records(), jarsList: listJars() }));
      }
    } catch (error) {
      logger.error('[session-store] before-quit snapshot write failed:', error);
    }
    getDownloadsManager()?.flushInterrupted();
    getMcpServer()?.stop();
  });

  app.on('window-all-closed', () => {
    if (platform !== 'darwin') {
      getMcpServer()?.stop();
      app.quit();
    }
  });

  app.on('will-quit', () => {
    try { historyStore.close(); } catch { /* best effort */ }
    try { appDb.close(); } catch { /* best effort */ }
  });

  return { ready };
}

module.exports = { registerAppLifecycle };
