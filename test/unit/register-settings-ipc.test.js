'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSettingsIpcHarness } = require('./helpers/settings-ipc-harness');

test('settings registrar preserves bare chrome reads and guarded internal mutations', () => {
  const h = makeSettingsIpcHarness();
  assert.equal(h.defaultSessionReads(), 0, 'registration must not touch Electron session before ready');
  assert.deepEqual([...h.bare.keys()].sort(), [
    'automation:get-activity', 'chrome-clipboard-write', 'settings-get',
    'shields-get', 'shields-pause', 'shields-set'
  ]);
  assert.deepEqual([...h.listeners.keys()], ['unpin-toolbar-item']);
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
