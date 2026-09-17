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
  // Mission 20 Flight 2 Leg 2 (DD1): the certificate-error trust decision —
  // registered top-level beside 'login' below, same before-whenReady rationale.
  certTrust,
  // M18 F2 L4 (H2 resurface): optional hook fired after a chrome's
  // window-boot-config invoke is served (queued sends flushed, subscriptions
  // provably live) — main re-keys any orphaned pending compromise reveal to
  // the freshly booted window there. Optional: offline harnesses omit it.
  onChromeBooted,
  // Mission 20 Flight 3 Leg 3 (DD5): `window-boot-config`'s `recoverTabs`
  // branch reconciles a reloaded chrome from the registry — chromeRecovery
  // is the same instance window-factory.js's crash hook already resets
  // `bootConfigServed`/`recoverTabs` through; `buildAdoptPayload`/
  // `getDefaultJar` are the pieces `buildRecoveryAdopts` needs to rebuild
  // each container main-side.
  chromeRecovery,
  buildAdoptPayload,
  getDefaultJar,
  // Mission 20 Flight 3 Leg 3 (DD8/AC7): pruned once at app.ready.
  pruneCrashDumps,
  // Mission 20 Flight 3 Leg 3 (DD2/DD7): gpu/utility/other child-process
  // crashes, registered top-level beside 'login'/'certificate-error' below.
  onChildProcessGone,
  getAllWindows,
  argv,
  env,
  platform,
  stdout,
  // Squawk 0073: the continuous-snapshot scheduler's flush(), threaded from main.js
  // (which owns construction — every dep the scheduler's write callback needs is
  // already in scope there). Optional/no-op default so offline harnesses that don't
  // care about the continuous-snapshot feature stay unaffected.
  flushSessionSnapshotScheduler = () => {},
  logger = console
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

  // Mission 20 Flight 2 Leg 2 (DD1): certificate errors. Registered at
  // TOP-LEVEL scope, same rationale as 'login'/'select-client-certificate'
  // above — the first window's first navigation can hit a bad certificate
  // before whenReady's tail runs. preventDefault() ALWAYS — Electron would
  // otherwise refuse the load itself with no chance to remember an operator
  // override; from here `cert-trust.js` answers the callback EXACTLY ONCE,
  // synchronously (never queued — DD1's "answer at once" shape, the opposite
  // of the auth-challenge store's held-callback model).
  app.on('certificate-error', (event, webContents, url, error, certificate, callback, isMainFrame) => {
    event.preventDefault();
    certTrust.handleCertificateError(webContents, url, error, certificate, callback, isMainFrame);
  });

  // Mission 20 Flight 3 Leg 3 (DD2/DD7): GPU/utility/other child-process
  // crashes — a record with no `url`/`partition`/`windowId` (there is no
  // guest, tab, or window a non-renderer child process belongs to).
  // Registered top-level, same rationale as the auth/cert handlers above.
  app.on('child-process-gone', (_event, details) => onChildProcessGone(details));

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
    // Squawk 0073: timestamp the boot-config serve so isRestorePending's settle timeout
    // (session-snapshot-scheduler.js) has a reference point — a saved URL that never
    // arrives (rejected by isSafeTabUrl at tab-create) must not gate the continuous
    // snapshot forever.
    rec.bootConfigServedAt = Date.now();

    // Mission 20 Flight 3 Leg 3 (DD5): chrome reload-and-reconcile. Checked
    // and consumed BEFORE the queue flush below, and BEFORE the `restoreTabs`
    // branch — `recoverTabs` wins when both are set, and `restoreTabs` is
    // left INTACT either way (never nulled: `isRestorePending` still needs
    // it for the boot-restore hazard gate).
    let recovered = false;
    if (rec.recoverTabs) {
      rec.recoverTabs = false;
      recovered = true;
      if (rec.tabViews.size > 0) {
        for (const [channel, payload] of chromeRecovery.buildRecoveryAdopts(rec, {
          jarsList: listJars(),
          defaultJar: getDefaultJar(),
          buildAdoptPayload
        })) {
          if (rec.chromeView.webContents.isDestroyed()) break;
          rec.chromeView.webContents.send(channel, payload);
        }
      }
    }

    // The gap queue: built first (every thunk invoked exactly once), then
    // deduped LAST-WINS per (payload.wcId, channel) — the survivor takes the
    // LAST occurrence's position (a `Map` re-set after `delete` moves a key
    // to the end); a message with no `wcId` gets a unique key so it is never
    // collapsed and keeps its original relative order.
    const queued = rec.pendingChromeSends.splice(0);
    const built = queued.map((buildMessage) => buildMessage());
    const orderMap = new Map();
    let anonSeq = 0;
    for (const [channel, payload] of built) {
      const hasWcId = payload && typeof payload === 'object' && 'wcId' in payload;
      const key = hasWcId ? `${payload.wcId}:${channel}` : `__no-wcid-${anonSeq++}`;
      if (orderMap.has(key)) orderMap.delete(key);
      orderMap.set(key, [channel, payload]);
    }
    const chrome = rec.chromeView.webContents;
    for (const [channel, payload] of orderMap.values()) {
      if (chrome.isDestroyed()) break;
      chrome.send(channel, payload);
    }
    // M18 F2 L4 (H2 resurface): the chrome document's subscriptions are provably
    // live here (this invoke is issued from module tail code, past every onVault*
    // registration), so this is the earliest safe point to re-open an orphaned
    // pending compromise reveal's recovery-show sheet on the new window.
    onChromeBooted?.(rec);
    if (recovered) {
      // A rebooted chrome with zero adoptable tabs boots a home/welcome tab
      // through the normal path instead of an empty chrome (leg edge case).
      return { bootTab: rec.tabViews.size === 0 ? !rec.noBootTab : false };
    }
    return rec.restoreTabs ? { bootTab: false, restoreTabs: rec.restoreTabs } : { bootTab: !rec.noBootTab };
  });
  ipcMain.on('app-quit', () => app.quit());

  const ready = app.whenReady().then(() => {
    initProfileAndStores(app, profileStores);
    const userDataPath = getUserDataPath();
    historyStore.open(userDataPath);
    sessionStore.load(userDataPath);
    setHistoryRecorder(createHistoryRecorder({ store: historyStore, listJars, broadcast }));

    // Mission 20 Flight 3 Leg 3 (DD8/AC7): prune old minidumps to the newest
    // 20 at every ready — after initProfileAndStores, so `app.getPath(
    // 'crashDumps')` already resolves the -dev profile under a dev launch.
    // Acceptance-run fix pass F2: `crashDumps` is already the Crashpad
    // database directory itself (its `pending`/`completed`/`new`
    // subdirectories sit directly under it, never nested under a second
    // `Crashpad/` segment) — logged once at debug level so a live run can
    // confirm the resolved root without any page/profile content in it.
    const crashDumpsDir = app.getPath('crashDumps');
    logger.debug?.('[app-lifecycle] pruning crash dumps under', crashDumpsDir);
    pruneCrashDumps?.(crashDumpsDir);

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
        // M15 F3 L1 (DD1/DD1b) — the menuType half of the sheet gate, threaded here so this
        // dev seam and main.js's MCP engine stay in parity (the house dual-site rule; both
        // sites are grep-pinned because the fallback is SILENT).
        //
        // ⚠ READ BEFORE EDITING THIS SEAM. This engine does NOT thread `isSheetContents`, so
        // resolveContents' guard 3 is inert here today and the sheet is refused by guard 5
        // (`non-tab-contents`) — this seam never sets `allowInternal`. Keep the pair together:
        // adding `isSheetContents` WITHOUT `sheetMenuFor` would make guard 3 absolute here
        // while the MCP engine admits three ops (fail-closed, but a silent divergence that
        // breaks the sheet a11y read and the DD8 probe readback over this seam). The FAIL-OPEN
        // edit is the mirror one: adding `allowInternal: true` (or dropping `isTabViewWcId`)
        // here lifts guard 5 while guard 3 has no `isSheetContents` to fire on — the sheet
        // would then be fully drivable, master-password keylogging included.
        sheetMenuFor: (contents) => registry.sheetMenuFor(contents),
        chromeForTab,
        raiseWindowForTab,
        getHistoryReads: {
          listRecent: (id, options) => historyStore.listRecent(id, options),
          search: (id, query, options) => historyStore.search(id, query, options)
        },
        isKnownJar
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

    if (
      shouldBindAutomation({
        automationEnabled: settings.get('automationEnabled') === true,
        devForceBind: devOverride
      })
    ) {
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
    // Squawk 0073: cancel the continuous-snapshot debounce timer FIRST — otherwise a
    // timer armed by recent browsing could still be pending when will-quit closes
    // appDb, firing a write against a closed database. flush() performs any pending
    // debounced write now (through its own restore-pending gate) and cancels the
    // timer; the existing unconditional write immediately below is UNCHANGED and
    // stays the authoritative quit-time snapshot.
    try {
      flushSessionSnapshotScheduler();
    } catch (error) {
      logger.error('[session-snapshot-scheduler] before-quit flush failed:', error);
    }
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
    try {
      historyStore.close();
    } catch {
      /* best effort */
    }
    try {
      appDb.close();
    } catch {
      /* best effort */
    }
  });

  return { ready };
}

module.exports = { registerAppLifecycle };
