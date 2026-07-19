'use strict';

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
  isSafeTabUrl,
  getChromeContents,
  session,
  registrableDomain,
  hostnameOf,
  shields,
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
