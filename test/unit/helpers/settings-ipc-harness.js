'use strict';

const { registerSettingsIpc } = require('../../../src/main/register-settings-ipc');

function makeSettingsIpcHarness(overrides = {}) {
  const bare = new Map();
  const listeners = new Map();
  const internal = new Map();
  const events = [];
  const values = {
    toolbarPins: { media: true, shields: true, devtools: true },
    automationKeyHashes: {},
    automationAdminKeyHash: '',
    bookmarksBarEnabled: false
  };
  const settings = {
    get: (key) => values[key],
    getAll: () => ({ ...values }),
    set(key, value) {
      values[key] = value;
      events.push(['set', key, value]);
      return value;
    }
  };
  const ipcMain = {
    handle(channel, fn) {
      bare.set(channel, fn);
    },
    on(channel, fn) {
      listeners.set(channel, fn);
    }
  };
  const registerInternalHandler = (_ipc, channel, fn) => internal.set(channel, fn);
  const defaultSession = { id: 'default' };
  let defaultSessionReads = 0;
  const jarSession = { id: 'jar' };
  const internalSession = { id: 'internal', __goldfinchInternal: true };

  // Fake OS clipboard: tracks the current value so squawk 0021's read-back-and-compare
  // auto-clear (clipboard:write's `opts.secret` path) can be exercised — a plain
  // write-only spy can't express "still holds what we wrote" vs. "changed since".
  let clipboardValue = '';
  const clipboard = {
    writeText: (text) => {
      clipboardValue = text;
      events.push(['clipboard', text]);
    },
    readText: () => clipboardValue
  };

  const shieldsCfg = {
    enabled: true,
    block: true,
    strip: true,
    isolate: true,
    farble: true,
    pausedSites: [],
    ...(overrides.shieldsCfg || {})
  };
  const chromeSender = { id: 'chrome-sender' };
  const calls = [];
  const app = {
    releaseSingleInstanceLock: () => calls.push(['releaseSingleInstanceLock', { ...env }]),
    relaunch: (opts) => calls.push(['relaunch', opts, { ...env }]),
    quit: () => calls.push(['quit'])
  };
  const env = { GOLDFINCH_AUTOMATION_DEV_MINT: '1', GOLDFINCH_AUTOMATION_ADMIN: '1', ...(overrides.env || {}) };
  const registry = {
    getWindowForChrome: (sender) => (sender === chromeSender ? { id: 1 } : null)
  };

  registerSettingsIpc({
    app,
    registry,
    env,
    ipcMain,
    registerInternalHandler,
    settings,
    shields: {
      // Realistic config (leg 02 business gate reads isolate/enabled through isolateConfigured).
      get: () => shieldsCfg,
      isolateConfigured: (cfg) => !!cfg.enabled && !!cfg.isolate,
      set: (patch) => ({ ...patch }),
      setPaused: (site, paused) => ({ site, paused })
    },
    isolateEffective: overrides.isolateEffective ?? true,
    operatorOverride: overrides.operatorOverride ?? null,
    broadcast: (channel, payload) => events.push(['broadcast', channel, payload]),
    applyAutomationEnabledChange: async (enabled) => events.push(['automation-enabled', enabled]),
    applySpellcheck: (session, enabled) => events.push(['spellcheck', session.id, enabled]),
    getDefaultSession: () => {
      defaultSessionReads++;
      return defaultSession;
    },
    getAllWebContents: () => [{ session: jarSession }, { session: jarSession }, { session: internalSession }],
    currentAutomationStatus: () => ({ enabled: true, port: values.automationPort || 0 }),
    rebindMcpServer: async () => events.push(['rebind']),
    freePortInRange: async () => 43123,
    clipboard,
    jars: { list: () => [{ id: 'personal', name: 'Personal', color: '#fff' }] },
    mintJarKey: (id, store) => {
      store.set('automationKeyHashes', { [id]: 'hash' });
      return 'jar-key';
    },
    revokeJarKey: (id, store) => store.set('automationKeyHashes', { [id]: undefined }),
    mintAdminKey: (store) => {
      store.set('automationAdminKeyHash', 'hash');
      return 'admin-key';
    },
    revokeAdminKey: (store) => store.set('automationAdminKeyHash', ''),
    getMcpServer: () => null,
    adminEnabled: () => true,
    defaultBrowser: {
      getStatus: (...args) => ({ fake: 'status', args }),
      makeDefault: async (...args) => ({ fake: 'made', args })
    }
  });

  return {
    bare,
    listeners,
    internal,
    events,
    values,
    clipboard,
    defaultSessionReads: () => defaultSessionReads,
    invoke: (channel, ...args) => bare.get(channel)({}, ...args),
    shieldsCfg,
    env,
    app,
    calls,
    chromeSender,
    invokeFrom: (channel, sender, ...args) => bare.get(channel)({ sender }, ...args),
    invokeInternal: (channel, ...args) => internal.get(channel)({}, ...args),
    send: (channel, ...args) => listeners.get(channel)({}, ...args)
  };
}

module.exports = { makeSettingsIpcHarness };
