'use strict';

// Electron-free registration for chrome-trusted settings reads and the guarded
// goldfinch://settings mutation/automation surface.

function registerSettingsIpc({
  ipcMain,
  registerInternalHandler,
  settings,
  shields,
  broadcast,
  applyAutomationEnabledChange,
  applySpellcheck,
  getDefaultSession,
  getAllWebContents,
  currentAutomationStatus,
  rebindMcpServer,
  freePortInRange,
  clipboard,
  jars,
  mintJarKey,
  revokeJarKey,
  mintAdminKey,
  revokeAdminKey,
  getMcpServer,
  adminEnabled,
}) {
  const broadcastSettings = () => broadcast('settings-changed', settings.getAll());

  ipcMain.handle('settings-get', (_event, key) => key ? settings.get(key) : settings.getAll());
  ipcMain.handle('shields-get', () => shields.get());
  ipcMain.handle('shields-set', (_event, patch) => {
    const config = shields.set(patch || {});
    broadcast('shields-changed', config);
    return config;
  });
  ipcMain.handle('shields-pause', (_event, payload) => {
    const { site, paused } = /** @type {any} */ (payload || {});
    const config = shields.setPaused(site, paused);
    broadcast('shields-changed', config);
    return config;
  });

  registerInternalHandler(ipcMain, 'internal-settings-get', (_event, key) =>
    key ? settings.get(key) : settings.getAll()
  );
  registerInternalHandler(ipcMain, 'internal-settings-set', async (_event, key, value) => {
    const config = settings.set(key, value);
    broadcastSettings();
    if (key === 'automationEnabled') await applyAutomationEnabledChange(value === true);
    if (key === 'spellcheck') {
      const enabled = value === true;
      applySpellcheck(getDefaultSession(), enabled);
      const seen = new Set();
      for (const wc of getAllWebContents()) {
        const ses = wc.session;
        if (!ses || ses.__goldfinchInternal || seen.has(ses)) continue;
        seen.add(ses);
        applySpellcheck(ses, enabled);
      }
    }
    return config;
  });
  registerInternalHandler(ipcMain, 'internal-shields-get', () => shields.get());
  registerInternalHandler(ipcMain, 'internal-shields-set', (_event, patch) => {
    const config = shields.set(patch || {});
    broadcast('shields-changed', config);
    return config;
  });

  registerInternalHandler(ipcMain, 'automation:get-status', () => currentAutomationStatus());
  registerInternalHandler(ipcMain, 'automation:set-port', async (_event, port) => {
    settings.set('automationPort', port);
    broadcastSettings();
    await rebindMcpServer();
    return currentAutomationStatus();
  });
  registerInternalHandler(ipcMain, 'automation:find-free-port', async () => ({ port: await freePortInRange() }));

  // clipboard:write is the generic internal clipboard sink: the vault's secret Copy
  // (vault.js) AND the settings page's navigator.clipboard fallback (DD4/copyText)
  // both ride it. Squawk 0021: a copied vault SECRET must not sit in the OS
  // clipboard forever. Scoped via an explicit `opts.secret` flag (an optional 3rd
  // arg — every existing caller that omits it keeps its exact prior behavior, no
  // bridge-shape change) rather than a new channel. One pending timer, re-armed per
  // copy; cleared only if the clipboard STILL holds exactly what we wrote (never
  // clobber a later copy). Electron-free / no injection seam by design (the
  // capture-timeout.js precedent): the only ambient dependency is the global
  // setTimeout/clearTimeout pair, driven in tests by node:test MockTimers.
  const CLIPBOARD_SECRET_CLEAR_MS = 20000;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let clipboardClearTimer = null;
  registerInternalHandler(ipcMain, 'clipboard:write', (_event, text, opts) => {
    const value = String(text == null ? '' : text);
    clipboard.writeText(value);

    if (clipboardClearTimer !== null) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }

    if (opts && opts.secret === true) {
      clipboardClearTimer = setTimeout(() => {
        clipboardClearTimer = null;
        // Only clear if the clipboard still holds exactly what we copied — an
        // empty/changed clipboard means the operator copied something else since,
        // and that copy must never be clobbered.
        if (clipboard.readText() === value) clipboard.writeText('');
      }, CLIPBOARD_SECRET_CLEAR_MS);
      if (typeof clipboardClearTimer.unref === 'function') clipboardClearTimer.unref();
    }

    return { ok: true };
  });

  registerInternalHandler(ipcMain, 'automation:list-keys', () => {
    const hashes = settings.get('automationKeyHashes') || {};
    return {
      jars: jars.list().map((jar) => ({
        id: jar.id,
        name: jar.name,
        color: jar.color,
        hasKey: !!hashes[jar.id]
      })),
      adminEnabled: !!adminEnabled(),
      adminKeySet: (settings.get('automationAdminKeyHash') || '') !== '',
    };
  });
  registerInternalHandler(ipcMain, 'automation:jar-key-mint', (_event, jarId) => {
    const key = mintJarKey(jarId, settings, jars);
    broadcastSettings();
    return { key };
  });
  registerInternalHandler(ipcMain, 'automation:jar-key-revoke', (_event, jarId) => {
    revokeJarKey(jarId, settings);
    broadcastSettings();
    return { ok: true };
  });
  registerInternalHandler(ipcMain, 'automation:admin-key-mint', () => {
    const key = mintAdminKey(settings);
    broadcastSettings();
    return { key };
  });
  registerInternalHandler(ipcMain, 'automation:admin-key-revoke', () => {
    revokeAdminKey(settings);
    broadcastSettings();
    return { ok: true };
  });

  ipcMain.handle('automation:get-activity', () => {
    const server = getMcpServer();
    return server ? server.getActivity() : { sessions: [], log: [] };
  });

  ipcMain.handle('chrome-clipboard-write', (_event, text) => {
    clipboard.writeText(String(text == null ? '' : text));
  });

  ipcMain.on('unpin-toolbar-item', (_event, item) => {
    if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;
    settings.set('toolbarPins', { ...settings.get('toolbarPins'), [item]: false });
    broadcastSettings();
  });

  // toggle-bookmarks-bar (M15 F1 Leg 3, DD7 / Ctrl+Shift+B): the unpin-toolbar-item
  // shape — a one-way chrome-initiated mutation that flips its own setting and
  // broadcasts itself (CLAUDE.md's "any handler mutating settings directly must
  // broadcast settings-changed itself" rule). The Settings checkbox and the
  // shortcut converge on this SAME stored value — no divergent state.
  ipcMain.on('toggle-bookmarks-bar', () => {
    settings.set('bookmarksBarEnabled', !settings.get('bookmarksBarEnabled'));
    broadcastSettings();
  });

  // chrome-welcome-set (M16 F2 Leg 1, DD1): the welcome surface's chrome-bridge
  // write — the toggle-bookmarks-bar shape above, but ipcMain.handle (not .on)
  // so the panel can react to a validator rejection, and restricted to the two
  // welcome-relevant keys. `settings.set(` stays literal in this body — the
  // broadcast-invariant net's detection half is a call-shape regex (squawk
  // 0003) — and broadcastSettings() is this handler's own call, per CLAUDE.md's
  // "any handler mutating settings directly must broadcast itself" rule.
  ipcMain.handle('chrome-welcome-set', (_event, { key, value }) => {
    if (key !== 'homePage' && key !== 'searchEngine') return { ok: false, error: 'unknown key' };
    try {
      settings.set(key, value);
      broadcastSettings();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  });
}

module.exports = { registerSettingsIpc };
