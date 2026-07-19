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
  registerInternalHandler(ipcMain, 'clipboard:write', (_event, text) => {
    clipboard.writeText(String(text == null ? '' : text));
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
}

module.exports = { registerSettingsIpc };
