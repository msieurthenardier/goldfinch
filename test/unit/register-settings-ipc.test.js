'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSettingsIpcHarness } = require('./helpers/settings-ipc-harness');

test('settings registrar preserves bare chrome reads and guarded internal mutations', () => {
  const h = makeSettingsIpcHarness();
  assert.equal(h.defaultSessionReads(), 0, 'registration must not touch Electron session before ready');
  assert.deepEqual([...h.bare.keys()].sort(), [
    'automation:get-activity', 'chrome-clipboard-write', 'chrome-welcome-set', 'settings-get',
    'shields-get', 'shields-pause', 'shields-set'
  ]);
  assert.deepEqual([...h.listeners.keys()], ['unpin-toolbar-item', 'toggle-bookmarks-bar']);
  assert.deepEqual([...h.internal.keys()].sort(), [
    'automation:admin-key-mint', 'automation:admin-key-revoke', 'automation:find-free-port',
    'automation:get-status', 'automation:jar-key-mint', 'automation:jar-key-revoke',
    'automation:list-keys', 'automation:set-port', 'clipboard:write',
    'internal-settings-get', 'internal-settings-set', 'internal-shields-get', 'internal-shields-set'
  ]);
  assert.equal(h.bare.has('internal-settings-set'), false);
  assert.equal(h.internal.has('settings-get'), false);
});

test('settings writes broadcast before their live side effects', async () => {
  const h = makeSettingsIpcHarness();
  await h.invokeInternal('internal-settings-set', 'spellcheck', true);
  assert.equal(h.defaultSessionReads(), 1);
  assert.deepEqual(h.events.map((event) => event.slice(0, 2)), [
    ['set', 'spellcheck'],
    ['broadcast', 'settings-changed'],
    ['spellcheck', 'default'],
    ['spellcheck', 'jar'],
  ]);

  h.events.length = 0;
  const status = await h.invokeInternal('automation:set-port', 45123);
  assert.deepEqual(status, { enabled: true, port: 45123 });
  assert.deepEqual(h.events.map((event) => event.slice(0, 2)), [
    ['set', 'automationPort'],
    ['broadcast', 'settings-changed'],
    ['rebind'],
  ]);
});

test('automation key mutations and toolbar allowlist always broadcast settings-changed', async () => {
  const h = makeSettingsIpcHarness();
  for (const [channel, arg] of [
    ['automation:jar-key-mint', 'personal'],
    ['automation:jar-key-revoke', 'personal'],
    ['automation:admin-key-mint'],
    ['automation:admin-key-revoke'],
  ]) {
    h.events.length = 0;
    await h.invokeInternal(channel, arg);
    assert.equal(h.events.some((event) => event[0] === 'broadcast' && event[1] === 'settings-changed'), true, channel);
  }
  h.events.length = 0;
  h.send('unpin-toolbar-item', 'unknown');
  assert.deepEqual(h.events, []);
  h.send('unpin-toolbar-item', 'media');
  assert.equal(h.values.toolbarPins.media, false);
  assert.equal(h.events.at(-1)[1], 'settings-changed');
});

// M16 F2 Leg 1 (DD1): chrome-welcome-set — restricted to homePage/searchEngine,
// settings.set( direct + its own broadcast (the toggle-bookmarks-bar shape),
// and a validator throw returns {ok:false} rather than propagating.
test('chrome-welcome-set: an unknown key is refused with no mutation and no broadcast', async () => {
  const h = makeSettingsIpcHarness();
  h.events.length = 0;
  const result = await h.invoke('chrome-welcome-set', { key: 'toolbarPins', value: {} });
  assert.deepEqual(result, { ok: false, error: 'unknown key' });
  assert.deepEqual(h.events, []);
});

test('chrome-welcome-set: homePage/searchEngine write through settings.set( and broadcast, returning {ok:true}', async () => {
  const h = makeSettingsIpcHarness();
  h.events.length = 0;
  const result = await h.invoke('chrome-welcome-set', { key: 'homePage', value: 'https://example.test/' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events.map((e) => e.slice(0, 2)), [['set', 'homePage'], ['broadcast', 'settings-changed']]);
  assert.equal(h.values.homePage, 'https://example.test/');
});

test('chrome-welcome-set: a validator throw returns {ok:false, error} rather than propagating, with no broadcast', async () => {
  const { registerSettingsIpc } = require('../../src/main/register-settings-ipc');
  const bare = new Map();
  const events = [];
  const settings = {
    get: () => undefined,
    getAll: () => ({}),
    set: () => { throw new TypeError('invalid homePage'); },
  };
  registerSettingsIpc({
    ipcMain: { handle: (c, fn) => bare.set(c, fn), on: () => {} },
    registerInternalHandler: () => {},
    settings,
    shields: { get: () => ({}), set: () => ({}), setPaused: () => ({}) },
    broadcast: (channel) => events.push(['broadcast', channel]),
    applyAutomationEnabledChange: async () => {},
    applySpellcheck: () => {},
    getDefaultSession: () => ({}),
    getAllWebContents: () => [],
    currentAutomationStatus: () => ({}),
    rebindMcpServer: async () => {},
    freePortInRange: async () => 0,
    clipboard: { writeText: () => {} },
    jars: { list: () => [] },
    mintJarKey: () => '', revokeJarKey: () => {}, mintAdminKey: () => '', revokeAdminKey: () => {},
    getMcpServer: () => null, adminEnabled: () => false,
  });
  const result = await bare.get('chrome-welcome-set')({}, { key: 'homePage', value: 'not-a-url' });
  assert.deepEqual(result, { ok: false, error: 'invalid homePage' });
  assert.deepEqual(events, []);
});

test('toggle-bookmarks-bar flips the stored value and broadcasts itself (Ctrl+Shift+B / Settings converge)', () => {
  const h = makeSettingsIpcHarness();
  assert.equal(h.values.bookmarksBarEnabled, false);
  h.events.length = 0;

  h.send('toggle-bookmarks-bar');
  assert.equal(h.values.bookmarksBarEnabled, true);
  assert.deepEqual(h.events.map((event) => event.slice(0, 2)), [
    ['set', 'bookmarksBarEnabled'],
    ['broadcast', 'settings-changed'],
  ]);

  h.events.length = 0;
  h.send('toggle-bookmarks-bar');
  assert.equal(h.values.bookmarksBarEnabled, false);
  assert.equal(h.events.at(-1)[1], 'settings-changed');
});
