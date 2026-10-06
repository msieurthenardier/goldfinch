'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSettingsIpcHarness } = require('./helpers/settings-ipc-harness');

// Let the microtask queue drain around single-step MockTimers ticks (the real
// setImmediate survives MockTimers' setTimeout interception) — CLAUDE.md's
// MockTimers recipe, exemplar test/unit/capture-timeout.test.js.
const drain = () => new Promise((r) => setImmediate(r));

test('settings registrar preserves bare chrome reads and guarded internal mutations', () => {
  const h = makeSettingsIpcHarness();
  assert.equal(h.defaultSessionReads(), 0, 'registration must not touch Electron session before ready');
  assert.deepEqual([...h.bare.keys()].sort(), [
    'automation:get-activity',
    'chrome-clipboard-write',
    'chrome-welcome-set',
    'settings-get',
    'shields-get',
    'shields-isolation-state',
    'shields-pause',
    'shields-restart-to-apply',
    'shields-set'
  ]);
  assert.deepEqual([...h.listeners.keys()], ['unpin-toolbar-item', 'toggle-bookmarks-bar']);
  assert.deepEqual([...h.internal.keys()].sort(), [
    'automation:admin-key-mint',
    'automation:admin-key-revoke',
    'automation:find-free-port',
    'automation:get-status',
    'automation:jar-key-mint',
    'automation:jar-key-revoke',
    'automation:list-keys',
    'automation:set-port',
    'clipboard:write',
    'default-browser:get-status',
    'default-browser:make-default',
    'internal-settings-get',
    'internal-settings-set',
    'internal-shields-get',
    'internal-shields-isolation-state',
    'internal-shields-restart-to-apply',
    'internal-shields-set'
  ]);
  assert.equal(h.bare.has('internal-settings-set'), false);
  assert.equal(h.internal.has('settings-get'), false);
});

test('shields isolation-state pair returns the read-only startup decision', async () => {
  const h = makeSettingsIpcHarness({ isolateEffective: false, operatorOverride: 'disabled' });
  assert.deepEqual(await h.bare.get('shields-isolation-state')({}), {
    isolateEffective: false,
    operatorOverride: 'disabled'
  });
  assert.deepEqual(await h.internal.get('internal-shields-isolation-state')({}), {
    isolateEffective: false,
    operatorOverride: 'disabled'
  });
  const on = makeSettingsIpcHarness();
  assert.deepEqual(await on.bare.get('shields-isolation-state')({}), {
    isolateEffective: true,
    operatorOverride: null
  });
});

test('settings writes broadcast before their live side effects', async () => {
  const h = makeSettingsIpcHarness();
  await h.invokeInternal('internal-settings-set', 'spellcheck', true);
  assert.equal(h.defaultSessionReads(), 1);
  assert.deepEqual(
    h.events.map((event) => event.slice(0, 2)),
    [
      ['set', 'spellcheck'],
      ['broadcast', 'settings-changed'],
      ['spellcheck', 'default'],
      ['spellcheck', 'jar']
    ]
  );

  h.events.length = 0;
  const status = await h.invokeInternal('automation:set-port', 45123);
  assert.deepEqual(status, { enabled: true, port: 45123 });
  assert.deepEqual(
    h.events.map((event) => event.slice(0, 2)),
    [['set', 'automationPort'], ['broadcast', 'settings-changed'], ['rebind']]
  );
});

test('automation key mutations and toolbar allowlist always broadcast settings-changed', async () => {
  const h = makeSettingsIpcHarness();
  for (const [channel, arg] of [
    ['automation:jar-key-mint', 'personal'],
    ['automation:jar-key-revoke', 'personal'],
    ['automation:admin-key-mint'],
    ['automation:admin-key-revoke']
  ]) {
    h.events.length = 0;
    await h.invokeInternal(channel, arg);
    assert.equal(
      h.events.some((event) => event[0] === 'broadcast' && event[1] === 'settings-changed'),
      true,
      channel
    );
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
  assert.deepEqual(
    h.events.map((e) => e.slice(0, 2)),
    [
      ['set', 'homePage'],
      ['broadcast', 'settings-changed']
    ]
  );
  assert.equal(h.values.homePage, 'https://example.test/');
});

test('chrome-welcome-set: a validator throw returns {ok:false, error} rather than propagating, with no broadcast', async () => {
  const { registerSettingsIpc } = require('../../src/main/register-settings-ipc');
  const bare = new Map();
  const events = [];
  const settings = {
    get: () => undefined,
    getAll: () => ({}),
    set: () => {
      throw new TypeError('invalid homePage');
    }
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
    mintJarKey: () => '',
    revokeJarKey: () => {},
    mintAdminKey: () => '',
    revokeAdminKey: () => {},
    getMcpServer: () => null,
    adminEnabled: () => false
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
  assert.deepEqual(
    h.events.map((event) => event.slice(0, 2)),
    [
      ['set', 'bookmarksBarEnabled'],
      ['broadcast', 'settings-changed']
    ]
  );

  h.events.length = 0;
  h.send('toggle-bookmarks-bar');
  assert.equal(h.values.bookmarksBarEnabled, false);
  assert.equal(h.events.at(-1)[1], 'settings-changed');
});

// clipboard:write — squawk 0021: a vault SECRET copy (opts.secret:true) auto-clears
// the OS clipboard ~20s later, but ONLY if it still holds exactly what was copied.
// The non-secret settings-page fallback (DD4/copyText) omits opts entirely and must
// keep behaving exactly as before (no timer, no clear, ever).

test('clipboard:write (secret): clears the clipboard 20s later if it still holds the copied value', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeSettingsIpcHarness();

  const result = await h.invokeInternal('clipboard:write', 'hunter2', { secret: true });
  assert.deepEqual(result, { ok: true });
  assert.equal(h.clipboard.readText(), 'hunter2');

  await drain();
  t.mock.timers.tick(20000);
  await drain();

  assert.equal(h.clipboard.readText(), '', 'the secret must be cleared 20s after the copy');
});

test('clipboard:write (secret): leaves a changed clipboard alone (never clobbers a later copy)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeSettingsIpcHarness();

  await h.invokeInternal('clipboard:write', 'hunter2', { secret: true });
  // The operator copied something else (in this app or another) before the window elapsed.
  h.clipboard.writeText('something-else');

  await drain();
  t.mock.timers.tick(20000);
  await drain();

  assert.equal(h.clipboard.readText(), 'something-else');
});

test('clipboard:write (secret): a second copy re-arms the timer and resets the 20s window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeSettingsIpcHarness();

  await h.invokeInternal('clipboard:write', 'first-secret', { secret: true });

  t.mock.timers.tick(15000); // 15s into the FIRST copy's window
  await h.invokeInternal('clipboard:write', 'second-secret', { secret: true }); // re-copy resets the clock
  assert.equal(h.clipboard.readText(), 'second-secret');

  t.mock.timers.tick(10000); // 25s since copy 1, but only 10s since copy 2 — must NOT clear yet
  await drain();
  assert.equal(h.clipboard.readText(), 'second-secret', 're-arming must reset the window, not just extend it');

  t.mock.timers.tick(10000); // 20s since copy 2 — now it clears
  await drain();
  assert.equal(h.clipboard.readText(), '');
});

test('clipboard:write (no opts): a non-secret copy never auto-clears (settings-page DD4 fallback unaffected)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeSettingsIpcHarness();

  await h.invokeInternal('clipboard:write', 'mcp://example.test/config');

  await drain();
  t.mock.timers.tick(60000);
  await drain();

  assert.equal(h.clipboard.readText(), 'mcp://example.test/config');
});

test('clipboard:write: a later non-secret copy cancels a still-pending secret-clear timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeSettingsIpcHarness();

  await h.invokeInternal('clipboard:write', 'hunter2', { secret: true });
  // A plain (non-secret) copy before the window elapses — the pending clear must not
  // survive to wipe this unrelated later copy.
  await h.invokeInternal('clipboard:write', 'https://example.test/');

  await drain();
  t.mock.timers.tick(20000);
  await drain();

  assert.equal(h.clipboard.readText(), 'https://example.test/');
});

test('default-browser channels are internal handlers that ignore page arguments and never touch settings', async () => {
  const h = makeSettingsIpcHarness();
  assert.equal(h.bare.has('default-browser:get-status'), false);
  assert.equal(h.bare.has('default-browser:make-default'), false);
  const before = h.events.length;
  const status = h.invokeInternal('default-browser:get-status', 'ms-settings:evil');
  assert.deepEqual(status, { fake: 'status', args: [] });
  const made = await h.invokeInternal('default-browser:make-default', 'ms-settings:evil', { x: 1 });
  assert.deepEqual(made, { fake: 'made', args: [] });
  assert.equal(h.events.length, before, 'no settings write / broadcast');
});

// ---- Sortie 02 leg 2 / DD11: Restart now (state-changing, sender-validated, business-gated) ----

const names = (h) => h.calls.map((c) => c[0]);

test('restart-to-apply refuses non-chrome senders (internal-session, guest, empty) without relaunching', async () => {
  const h = makeSettingsIpcHarness();
  h.shieldsCfg.isolate = false; // pending, so ONLY the sender gate can stop it
  for (const sender of [undefined, { id: 'internal-session-sender' }, { id: 'guest-sender' }]) {
    const res = await h.invokeFrom('shields-restart-to-apply', sender);
    assert.deepEqual(res, { ok: false, reason: 'refused' });
  }
  assert.deepEqual(h.calls, []);
});

test('both restart channels return not-pending and never relaunch/quit when nothing is pending', async () => {
  const h = makeSettingsIpcHarness(); // configured on, in force on
  assert.deepEqual(await h.invokeFrom('shields-restart-to-apply', h.chromeSender), {
    ok: false,
    reason: 'not-pending'
  });
  assert.deepEqual(await h.invokeInternal('internal-shields-restart-to-apply'), { ok: false, reason: 'not-pending' });
  assert.deepEqual(h.calls, []);
  assert.equal(h.env.GOLDFINCH_AUTOMATION_DEV_MINT, '1', 'env untouched on refusal');
  // Operator --disable-features with config on: restart would change nothing, so no permanent hint.
  const off = makeSettingsIpcHarness({ isolateEffective: false, operatorOverride: 'disabled' });
  assert.deepEqual(await off.invokeInternal('internal-shields-restart-to-apply'), {
    ok: false,
    reason: 'not-pending'
  });
  assert.deepEqual(off.calls, []);
});

test('restart-to-apply, when pending: strip DEV_MINT -> release lock -> relaunch -> quit, in that order', async () => {
  const h = makeSettingsIpcHarness();
  h.shieldsCfg.isolate = false; // in force on, configured off
  const res = await h.invokeFrom('shields-restart-to-apply', h.chromeSender);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(names(h), ['releaseSingleInstanceLock', 'relaunch', 'quit']);
  const [release, relaunch] = h.calls;
  // At the moment of release AND relaunch the live env no longer carries DEV_MINT; other keys untouched.
  assert.equal('GOLDFINCH_AUTOMATION_DEV_MINT' in release[1], false);
  assert.equal('GOLDFINCH_AUTOMATION_DEV_MINT' in relaunch[2], false);
  assert.equal(relaunch[2].GOLDFINCH_AUTOMATION_ADMIN, '1');
  assert.deepEqual(relaunch[1], {}, 'no APPIMAGE -> default options');
  assert.equal('env' in relaunch[1], false);
});

test('restart-to-apply internal channel passes the same gate; APPIMAGE becomes execPath', async () => {
  const h = makeSettingsIpcHarness({ env: { APPIMAGE: '/opt/Goldfinch.AppImage' } });
  h.shieldsCfg.enabled = false; // master off while in force -> pending 'off'
  assert.deepEqual(await h.invokeInternal('internal-shields-restart-to-apply'), { ok: true });
  assert.deepEqual(names(h), ['releaseSingleInstanceLock', 'relaunch', 'quit']);
  assert.deepEqual(h.calls[1][1], { execPath: '/opt/Goldfinch.AppImage' });
  // Pending 'on': configured on, not in force.
  const on = makeSettingsIpcHarness({ isolateEffective: false });
  assert.deepEqual(await on.invokeInternal('internal-shields-restart-to-apply'), { ok: true });
  assert.equal(on.calls.length, 3);
});

test('restart-to-apply authority is main-side: page arguments are ignored', async () => {
  const h = makeSettingsIpcHarness();
  assert.deepEqual(await h.invokeFrom('shields-restart-to-apply', h.chromeSender, { pending: true }), {
    ok: false,
    reason: 'not-pending'
  });
  assert.deepEqual(h.calls, []);
});
