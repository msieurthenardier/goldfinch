'use strict';

const { resolvePersistJar } = require('./persist-jar-gate');

const PAGE_CONTEXT_ACTIONS = new Set(['cut', 'copy', 'paste', 'undo', 'redo']);
const EMPTY_COOKIES = Object.freeze({ firstParty: null, first: 0, third: 0, total: 0, list: [] });

function registerBrowserIpc({
  ipcMain,
  webContents,
  chromeForTab,
  getTabContents,
  applyZoom,
  isInternalContents,
  toggleDevTools,
  registerInternalHandler,
  jars,
  registry,
  createWindow,
  broadcastJarsChanged,
  isSafeTabUrl,
  getChromeContents,
  session,
  registrableDomain,
  hostnameOf,
  shields,
  getVaultHuman,
  random = Math.random,
  logger = console,
}) {
  const farbleSeeds = new WeakMap();
  function seedForSession(sess) {
    let seed = farbleSeeds.get(sess);
    if (seed == null) {
      seed = Math.floor(random() * 0xffffffff) >>> 0;
      farbleSeeds.set(sess, seed);
    }
    return seed;
  }
  function rerollSeed(sess) {
    farbleSeeds.set(sess, Math.floor(random() * 0xffffffff) >>> 0);
  }

  ipcMain.on('shields-farble', (event, url) => {
    const site = registrableDomain(hostnameOf(url || ''));
    event.returnValue = {
      farble: shields.active('farble', site),
      seed: seedForSession(event.sender.session)
    };
  });

  ipcMain.on('window-minimize', (event) => {
    registry.getWindowForChrome(event.sender)?.win.minimize();
  });
  ipcMain.on('window-toggle-maximize', (event) => {
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec) return;
    if (rec.win.isMaximized()) rec.win.unmaximize();
    else rec.win.maximize();
  });
  ipcMain.on('window-close', (event) => {
    registry.getWindowForChrome(event.sender)?.win.close();
  });
  ipcMain.handle('window-is-maximized', (event) => {
    const rec = registry.getWindowForChrome(event.sender);
    return !!(rec && rec.win.isMaximized());
  });
  ipcMain.handle('window-create', (event) => {
    if (!registry.getWindowForChrome(event.sender)) return null;
    return createWindow().win.id;
  });
  ipcMain.handle('new-container-create', async (_event, payload) => {
    const name = payload && payload.name;
    if (!name || typeof name !== 'string') return null;
    const container = jars.add(name);
    broadcastJarsChanged();
    return container;
  });

  // Vault lock-icon eligibility (M12 F2 Leg 1, DD9): the guest preload queries this
  // synchronously at init (shields-farble idiom) to decide whether to inject the
  // decorative lock icon. Eligible ONLY when the tab's session resolves to a
  // PERSISTENT jar (resolvePersistJar) — burner/non-persistent tabs are not
  // eligible, so no icon, no gesture wiring. The wcId is the trusted sender id; we
  // resolve the tab entry from the registry, never from renderer-supplied data.
  ipcMain.on('vault-eligible', (event) => {
    const entry = registry.getWindowForGuest(event.sender.id)?.tabViews.get(event.sender.id);
    event.returnValue = Boolean(entry && resolvePersistJar(entry, jars.list()));
  });

  // Vault gesture (M12 F2 Leg 1, DD1/DD3): a TRUSTED click on the injected lock
  // icon arrives here carrying NO secret ({}). Derive the trusted wcId from
  // event.sender.id (never a renderer-supplied id) and forward a bare trigger to
  // the owning window's chrome — mirrors the guest-media-list → chromeForTab idiom.
  ipcMain.on('guest-vault-gesture', (event) => {
    const wcId = event.sender.id;
    chromeForTab(wcId)?.send('vault-gesture', { wcId });
  });

  // Vault capture (M12 F2 Leg 4, DD7/DD9): a submitted login form's credential arrives
  // here as { username, password } (password a Uint8Array). The trusted wcId is
  // event.sender.id; the ORIGIN is derived in main from the sender URL (never the
  // guest-supplied value — none is sent). getVaultHuman().capture applies the
  // set-up/unlocked/persistent-jar gate and holds the password in a MAIN-SIDE record;
  // it returns { captureId, model } (model carries NO password) or null (dropped). On a
  // returned offer, forward it to the owning window's chrome — the guest-media-list →
  // chromeForTab idiom. Gated on the getVaultHuman injection (offline tests omit it).
  ipcMain.on('guest-vault-capture', (event, payload) => {
    if (!getVaultHuman) return;
    const wcId = event.sender.id;
    const { username, password } = /** @type {any} */ (payload || {});
    const offer = getVaultHuman().capture({ wcId, username, passwordBytes: password });
    if (offer) {
      chromeForTab(wcId)?.send('vault-capture-offer', { captureId: offer.captureId, model: offer.model });
    }
  });

  // Vault capture DISMISS (M12 F2 Leg 4, DD7): the chrome invokes this when the
  // vault-capture sheet closes WITHOUT a save (Cancel / Escape / outside-click / a
  // lifecycle close), so main drops+zeroizes the held record immediately rather than
  // waiting for the 2-min safety timeout. Chrome-trust bare handle (the same class as
  // vault-fill-human); the captureId is an opaque main-minted handle, not a secret.
  ipcMain.handle('vault-capture-dismiss', (_event, captureId) => {
    if (getVaultHuman && typeof captureId === 'string') getVaultHuman().captureDismiss(captureId);
  });

  ipcMain.on('guest-media-list', (event, mediaList) => {
    const wcId = event.sender.id;
    chromeForTab(wcId)?.send('tab-media-list', { wcId, mediaList });
  });
  ipcMain.on('guest-privacy-fp', (event, fpCounts) => {
    const wcId = event.sender.id;
    chromeForTab(wcId)?.send('tab-privacy-fp', { wcId, fpCounts });
  });
  ipcMain.on('rescan-media', (_event, payload) => {
    const { wcId } = /** @type {any} */ (payload || {});
    if (wcId == null) return;
    const wc = getTabContents(wcId);
    if (!wc || wc.isDestroyed()) return;
    wc.send('rescan-media');
  });

  function externalContents(payload) {
    const id = payload && payload.webContentsId;
    const wc = typeof id === 'number' ? webContents.fromId(id) : null;
    return wc && !wc.isDestroyed() && !isInternalContents(wc) ? wc : null;
  }

  ipcMain.on('zoom-apply', (_event, payload) => {
    const wc = externalContents(payload);
    if (wc) applyZoom(wc, payload.action);
  });
  ipcMain.handle('get-zoom', (_event, payload) => externalContents(payload)?.getZoomFactor() ?? null);
  ipcMain.on('print', (_event, payload) => {
    const wc = externalContents(payload);
    if (!wc) return;
    wc.print({}, (ok, reason) => { if (!ok) logger.warn('print failed:', reason); });
  });
  ipcMain.handle('toggle-devtools', (_event, payload) => {
    const wc = externalContents(payload);
    return wc ? toggleDevTools(wc) : false;
  });
  ipcMain.handle('is-devtools-open', (_event, payload) => {
    const wc = externalContents(payload);
    return wc ? wc.isDevToolsOpened() : false;
  });
  ipcMain.handle('page-context-correct', (_event, payload) => {
    const wc = externalContents(payload);
    if (!wc) return;
    const word = payload && payload.word;
    if (typeof word === 'string' && word) {
      wc.focus();
      wc.replaceMisspelling(word);
    }
  });
  ipcMain.handle('page-context-action', (_event, payload) => {
    const wc = externalContents(payload);
    if (!wc) return;
    const action = payload && payload.action;
    if (!PAGE_CONTEXT_ACTIONS.has(action)) return;
    wc[action]();
  });

  registerInternalHandler(ipcMain, 'internal-open-tab-in-jar', (_event, payload) => {
    if (payload === null || typeof payload !== 'object') {
      return { ok: false, error: 'open-tab-in-jar — malformed-payload' };
    }
    const entry = jars.list().find((jar) => jar.id === payload.jarId);
    if (!entry) return { ok: false, error: 'open-tab-in-jar — unknown-jar' };
    if (typeof payload.url !== 'string' || !isSafeTabUrl(payload.url)) {
      return { ok: false, error: 'open-tab-in-jar — bad-args' };
    }
    getChromeContents()?.send('open-tab', { url: payload.url, openerPartition: entry.partition });
    return { ok: true };
  });

  ipcMain.handle('identity-new', async (_event, payload) => {
    const partition = payload && payload.partition;
    if (!partition) return { ok: false };
    const sess = session.fromPartition(partition);
    if (sess.__goldfinchInternal) return { ok: false };
    try {
      await sess.clearStorageData();
      await sess.clearCache();
      rerollSeed(sess);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  });

  ipcMain.handle('privacy-cookies', async (_event, payload) => {
    const { webContentsId, url } = /** @type {any} */ (payload || {});
    const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.session.__goldfinchInternal) return { ...EMPTY_COOKIES, list: [] };
    const firstParty = registrableDomain(hostnameOf(url || wc.getURL() || ''));
    const all = await wc.session.cookies.get({});
    let first = 0;
    let third = 0;
    const list = all.map((cookie) => {
      const domain = registrableDomain(cookie.domain.replace(/^\./, ''));
      const isThird = !!firstParty && domain !== firstParty;
      if (isThird) third++; else first++;
      return {
        name: cookie.name,
        domain: cookie.domain,
        third: isThird,
        secure: cookie.secure,
        session: !cookie.expirationDate
      };
    }).sort((a, b) => a.third === b.third ? 0 : a.third ? 1 : -1);
    return { firstParty, first, third, total: all.length, list: list.slice(0, 300) };
  });

  ipcMain.handle('privacy-clear-cookies', async (_event, payload) => {
    const { webContentsId, scope, url } = /** @type {any} */ (payload || {});
    const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.session.__goldfinchInternal) return { removed: 0 };
    const firstParty = registrableDomain(hostnameOf(url || wc.getURL() || ''));
    const all = await wc.session.cookies.get({});
    let removed = 0;
    for (const cookie of all) {
      const isThird = !!firstParty && registrableDomain(cookie.domain.replace(/^\./, '')) !== firstParty;
      if (scope !== 'all' && !(scope === 'third' && isThird)) continue;
      const host = cookie.domain.replace(/^\./, '');
      try {
        await wc.session.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`, cookie.name);
        removed++;
      } catch {
        // Individual cookie removal failures do not abort the bounded sweep.
      }
    }
    return { removed };
  });

  ipcMain.handle('privacy-clear-storage', async (_event, payload) => {
    const { url, webContentsId } = /** @type {any} */ (payload || {});
    const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.session.__goldfinchInternal) return { ok: false, error: 'no-tab' };
    try {
      const origin = new URL(url).origin;
      await wc.session.clearStorageData({ origin });
      return { ok: true, origin };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  });

  return { rerollSeed };
}

module.exports = { registerBrowserIpc };
