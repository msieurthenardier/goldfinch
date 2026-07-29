'use strict';

// Electron-free ownership of app readiness, restore, activation, and quit order.
// Electron handles are injected; this module only coordinates their public shape.

// DD7 (Mission 13 Flight 1 / Leg 2): one-time default-session hygiene purge
// marker. Versioned (migrate-once discipline, same shape as the other
// appDb-backed stores) so a future need to re-purge is a marker-value bump,
// not a new store/gate.
const HYGIENE_PURGE_MARKER = 'default-session-purge-v1';

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
  getDefaultSession,
  fromPartition,
  internalPartition,
  setCreatingInternalSession,
  handleInternal,
  getTabContents,
  isInternalContents,
  createMediaProxyHandler,
  parseMediaProxyUrl,
  isSafeTabUrl,
  isInternalPageUrl,
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
  listPopups,
  isPopupWcId,
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
  authChallenges,
  getAllWindows,
  argv,
  env,
  platform,
  stdout,
  logger = console,
}) {
  app.on('session-created', sessionRuntime.onSessionCreated);

  // M14 F1 L2 (flight DD2): HTTP auth challenges. Registered at TOP-LEVEL scope
  // (not inside whenReady — same reasoning as web-contents-created below: the
  // first window's first navigation can challenge before whenReady's tail).
  // preventDefault() ALWAYS — Electron would otherwise cancel the auth attempt
  // immediately; from here every callback is owned by the pending-challenge
  // store's exactly-once ledger (guard cancels included).
  app.on('login', (event, webContents, details, authInfo, callback) => {
    event.preventDefault();
    authChallenges.handleLogin(webContents, details, authInfo, callback);
  });

  // M14 F1 L3 (flight DD4, design-review corrected: select-client-certificate
  // is an APP-level event, not a session event). Same top-level registration
  // rationale as 'login' above. preventDefault() ALWAYS — Electron would
  // otherwise auto-select the first certificate in the list; from here every
  // callback is owned by the store's exactly-once ledger (guard cancels
  // included). An empty candidate list never reaches this handler (Electron
  // continues cert-less before emitting) — the store's empty-list guard is
  // defense-in-depth.
  app.on('select-client-certificate', (event, webContents, url, list, callback) => {
    event.preventDefault();
    authChallenges.handleSelectClientCertificate(webContents, url, list, callback);
  });

  // Mission 13 Flight 3 / Leg 3 (DD3, AC2): every webContents (chrome, overlays,
  // sheets, DevTools frontend, the built-in PDF viewer) gets a window-open denial
  // and a navigation guard — a catch-all net beneath the explicit guest wiring.
  // Registered at TOP-LEVEL scope (not inside app.whenReady().then(...)) because
  // createWindow() runs inside whenReady and constructs the first chrome view —
  // a listener attached only after whenReady would miss that first webContents.
  //
  // Latch semantics (design review, MEDIUM — the crux of this leg): this event
  // fires SYNCHRONOUSLY during `new WebContentsView()`, before wireGuestContents
  // runs, so at ATTACH time this handler cannot yet tell a future guest tab from
  // a chrome/overlay view. Its listeners are additive and stay attached to guest
  // contents for their whole lifetime. So the guard reads the
  // `__goldfinchNavGuarded` latch INSIDE the handler (not at attach time) and
  // early-returns for guests — wireGuestContents sets that latch synchronously
  // before any navigation can occur, so by the time any 'will-navigate' /
  // 'will-frame-navigate' / 'will-redirect' actually fires, the latch is already
  // set for every guest. Skipping this and unconditionally guarding here would
  // fire on every real guest navigation and break web browsing wholesale.
  //
  // `setWindowOpenHandler` is a setter (last call wins), so the guest's own
  // handler — installed later by wireGuestContents — safely overrides this
  // catch-all's deny; no clobber risk there.
  const ALLOWED_NONGUEST_SCHEMES = ['devtools:', 'file:', 'chrome-extension:', 'about:'];
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event) => {
      if (contents.__goldfinchNavGuarded) return; // guests: own predicate already covers them
      const url = event.url || '';
      if (isSafeTabUrl(url) || isInternalPageUrl(url)) return;
      // DevTools frontend, extension pages, file:/source-map links, and about:
      // are trusted non-guest surfaces — blocking these breaks DevTools/PDF viewer.
      if (ALLOWED_NONGUEST_SCHEMES.some((scheme) => url.startsWith(scheme))) return;
      event.preventDefault();
    };
    contents.on('will-navigate', guard);
    contents.on('will-frame-navigate', guard);
    contents.on('will-redirect', guard);
  });

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
    const defaultSession = getDefaultSession();
    wireDownloadHandler(defaultSession);
    applyShields(defaultSession);
    applySpellcheck(defaultSession, settings.get('spellcheck'));

    // Media proxy (Mission 13 Flight 1 / Leg 2 — DD2/AC2): registered on the DEFAULT
    // session ONLY (the chrome's session) — jar-partitioned guest sessions never see this
    // scheme, mirroring the internal-session trust model just below. Built here (not
    // main.js) so getTabContents/isInternalContents are threaded through this call's
    // deps rather than assumed already-available — Phase A of leg 2 wires this; the
    // renderer's five media-assignment sites are wired in Phase B pending the FD's live
    // seek smoke against this handler (electron/electron#38749, #51442).
    defaultSession.protocol.handle(
      'goldfinch-media',
      createMediaProxyHandler({ getTabContents, isInternalContents, parseMediaProxyUrl })
    );

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
        // M14 F2 L2 (DD1a): popup census rows + addressability predicate —
        // the dev-seam twin of main.js's MCP injection site (both grep-pinned;
        // the fallbacks are silent, the listWindows precedent).
        listPopups,
        isPopupWcId,
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

    // DD7 (Mission 13 Flight 1 / Leg 2): one-time default-session cookie +
    // HTTP-cache purge, gated by an appDb marker (migrate-once discipline).
    // Placement is deliberate: END of the ready callback, after
    // createWindow()/session-restore/automation wiring above, so first paint
    // is NEVER gated on this — fire-and-forget with a terminal catch. A
    // failed purge means no marker write, so the next boot retries; it can
    // never block or crash boot. Safe because the chrome holds zero web
    // storage of its own (DD4's verified premise) — only PRE-FIX-planted
    // default-session state is at stake, not anything currently in use.
    const hygieneStore = appDb.createDocumentStore('hygiene');
    if (hygieneStore.read() !== HYGIENE_PURGE_MARKER) {
      Promise.resolve()
        .then(() => defaultSession.clearStorageData({ storages: ['cookies'] }))
        .then(() => defaultSession.clearCache())
        .then(() => hygieneStore.write(HYGIENE_PURGE_MARKER))
        .catch((error) => {
          logger.error('[app-lifecycle] default-session hygiene purge failed (will retry next boot):', error);
        });
    }
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
