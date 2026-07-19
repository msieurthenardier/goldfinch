'use strict';

const { registerSettingsIpc } = require('../../../src/main/register-settings-ipc');

function makeSettingsIpcHarness() {
  const bare = new Map();
  const listeners = new Map();
  const internal = new Map();
  const events = [];
  const values = {
    toolbarPins: { media: true, shields: true, devtools: true },
    automationKeyHashes: {},
    automationAdminKeyHash: '',
  };
  const settings = {
    get: (key) => values[key],
    getAll: () => ({ ...values }),
    set(key, value) { values[key] = value; events.push(['set', key, value]); return value; },
  };
  const ipcMain = {
    handle(channel, fn) { bare.set(channel, fn); },
    on(channel, fn) { listeners.set(channel, fn); },
  };
  const registerInternalHandler = (_ipc, channel, fn) => internal.set(channel, fn);
  const defaultSession = { id: 'default' };
  let defaultSessionReads = 0;
  const jarSession = { id: 'jar' };
  const internalSession = { id: 'internal', __goldfinchInternal: true };

  registerSettingsIpc({
    ipcMain,
    registerInternalHandler,
    settings,
    shields: {
      get: () => ({ blockAds: true }),
      set: (patch) => ({ ...patch }),
      setPaused: (site, paused) => ({ site, paused }),
    },
    broadcast: (channel, payload) => events.push(['broadcast', channel, payload]),
    applyAutomationEnabledChange: async (enabled) => events.push(['automation-enabled', enabled]),
    applySpellcheck: (session, enabled) => events.push(['spellcheck', session.id, enabled]),
    getDefaultSession: () => { defaultSessionReads++; return defaultSession; },
    getAllWebContents: () => [
      { session: jarSession }, { session: jarSession }, { session: internalSession }
    ],
    currentAutomationStatus: () => ({ enabled: true, port: values.automationPort || 0 }),
    rebindMcpServer: async () => events.push(['rebind']),
    freePortInRange: async () => 43123,
    clipboard: { writeText: (text) => events.push(['clipboard', text]) },
    jars: { list: () => [{ id: 'personal', name: 'Personal', color: '#fff' }] },
    mintJarKey: (id, store) => { store.set('automationKeyHashes', { [id]: 'hash' }); return 'jar-key'; },
    revokeJarKey: (id, store) => store.set('automationKeyHashes', { [id]: undefined }),
    mintAdminKey: (store) => { store.set('automationAdminKeyHash', 'hash'); return 'admin-key'; },
    revokeAdminKey: (store) => store.set('automationAdminKeyHash', ''),
    getMcpServer: () => null,
    adminEnabled: () => true,
  });

  return {
    bare,
    listeners,
    internal,
    events,
    values,
    defaultSessionReads: () => defaultSessionReads,
    invoke: (channel, ...args) => bare.get(channel)({}, ...args),
    invokeInternal: (channel, ...args) => internal.get(channel)({}, ...args),
    send: (channel, ...args) => listeners.get(channel)({}, ...args),
  };
}

module.exports = { makeSettingsIpcHarness };
