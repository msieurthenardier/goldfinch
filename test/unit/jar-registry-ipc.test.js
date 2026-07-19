'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BURNER } = require('../../src/shared/burner');
const { registerJarRegistryIpc } = require('../../src/main/jar-registry-ipc');
const { appDb, makeHarness, personal } = require('./helpers/jar-ipc-harness');

test('exports the registry registrar', () => {
  assert.equal(typeof registerJarRegistryIpc, 'function');
});

test('registry chrome/internal twins receive the same handler identity before the internal wrapper', () => {
  const chrome = new Map();
  const internal = new Map();
  const ipcMain = { handle: (channel, handler) => chrome.set(channel, handler) };
  registerJarRegistryIpc({
    ipcMain,
    registerInternal: (_ipcMain, channel, handler) => internal.set(channel, handler),
    jars: {},
    session: {},
    wipeJarData() {},
    revokeJarKey() {},
    settings: {},
    broadcast() {},
    broadcastJarsChanged() {}
  });
  for (const operation of ['list', 'add', 'rename', 'set-default', 'get-default', 'remove']) {
    assert.equal(internal.get(`internal-jars-${operation}`), chrome.get(`jars-${operation}`), operation);
  }
});

test('registry internal twins reject an untrusted sender before invoking their shared body', (t) => {
  const h = makeHarness(t);
  const evil = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  for (const channel of [
    'internal-jars-list',
    'internal-jars-add',
    'internal-jars-rename',
    'internal-jars-set-default',
    'internal-jars-get-default',
    'internal-jars-remove'
  ]) {
    assert.throws(() => h.handlers.get(channel)(evil, { id: 'personal' }), /forbidden/, channel);
  }
  assert.equal(h.events.length, 0);
});

// Internal-origin-gated twins (F3 DD1) — share the exact handler body with their
// chrome twin, so a mutation via internal-jars-add is observable via jars-list, and
// an untrusted event is rejected the same way internal-ipc.test.js pins.
// ---------------------------------------------------------------------------
test('internal-jars-add creates a jar observable via the chrome jars-list channel', (t) => {
  const h = makeHarness(t);
  const c = h.invokeInternal('internal-jars-add', { name: 'Banking', color: '#f5c518' });
  assert.equal(c.name, 'Banking');
  assert.deepEqual(h.invoke('jars-list').map((x) => x.id), ['personal', 'work', 'banking']);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
});

test('internal-jars-list returns the same live array as jars-list', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invokeInternal('internal-jars-list'), h.invoke('jars-list'));
});

test('internal-jars-rename shares behavior with jars-rename (color-only patch keeps the name)', (t) => {
  const h = makeHarness(t);
  const c = h.invokeInternal('internal-jars-rename', { id: 'personal', color: '#ff0000' });
  assert.equal(c.name, 'Personal');
  assert.equal(c.color, '#ff0000');
});

test('internal-jars-set-default shares behavior with jars-set-default', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invokeInternal('internal-jars-set-default', { id: 'work' }), true);
  assert.equal(h.invoke('jars-get-default').id, 'work');
});

test('internal-jars-get-default returns BURNER (reference-equal) when the store is empty', (t) => {
  const h = makeHarness(t, { containers: [], defaultId: null });
  assert.equal(h.invokeInternal('internal-jars-get-default'), BURNER);
});

test('internal-jars-remove composes the same delete pipeline as jars-remove', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.wiped, true);
  assert.deepEqual(h.events.map((e) => e.fn), [
    'clearStorageData',
    'clearCache',
    'rerollSeed',
    'revokeJarKey',
    'broadcast',
    'broadcast'
  ]);
});

// jars-list — bare-array passthrough (DD7: renderer boot shape unchanged)
// ---------------------------------------------------------------------------
test('jars-list returns the live jars.list() array unchanged', (t) => {
  const h = makeHarness(t);
  const result = h.invoke('jars-list');
  assert.equal(result, h.jars.list()); // passthrough, no wrapping
  assert.deepEqual(result.map((c) => c.id), ['personal', 'work']);
  assert.equal(h.broadcasts().length, 0); // reads never broadcast
});

// ---------------------------------------------------------------------------
// jars-add — add + broadcast, name guard mirrors new-container-create
// ---------------------------------------------------------------------------
test('jars-add creates the jar and broadcasts jars-changed with { containers, defaultId }', (t) => {
  const h = makeHarness(t);
  const c = h.invoke('jars-add', { name: 'Banking', color: '#f5c518' });
  assert.equal(c.name, 'Banking');
  assert.equal(c.color, '#f5c518');
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
  assert.deepEqual(b[0].payload.containers.map((x) => x.id), ['personal', 'work', 'banking']);
  assert.equal(b[0].payload.defaultId, 'personal'); // string while jars exist
});

test('jars-changed carries the LIVE containers array (reference in the fake harness)', (t) => {
  const h = makeHarness(t);
  h.invoke('jars-add', { name: 'Banking' });
  // The raw payload references jars.list()'s live array — the real IPC boundary
  // structured-clones per send; test assertions above use the emit-time snapshot.
  assert.equal(h.broadcasts()[0].raw.containers, h.jars.list());
});

test('jars-add into an empty store broadcasts a string defaultId (first jar becomes default)', (t) => {
  const h = makeHarness(t, { containers: [], defaultId: null });
  const c = h.invoke('jars-add', { name: 'Solo' });
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].payload.defaultId, c.id);
  assert.deepEqual(b[0].payload.containers.map((x) => x.id), [c.id]);
});

test('jars-add with {} or a non-string name returns null with no broadcast', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-add', {}), null);
  assert.equal(h.invoke('jars-add', { name: 42 }), null);
  assert.equal(h.broadcasts().length, 0);
  assert.equal(h.jars.list().length, 2); // nothing added
});

// ---------------------------------------------------------------------------
// jars-rename — patch built from present fields only
// ---------------------------------------------------------------------------
test('jars-rename with a color-only patch keeps the name and broadcasts', (t) => {
  const h = makeHarness(t);
  const c = h.invoke('jars-rename', { id: 'personal', color: '#ff0000' });
  assert.equal(c.name, 'Personal'); // absent field preserved
  assert.equal(c.color, '#ff0000');
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
  assert.equal(b[0].payload.containers.find((x) => x.id === 'personal').color, '#ff0000');
});

test('jars-rename with an explicit { name: undefined } key does not clobber the name', (t) => {
  const h = makeHarness(t);
  const c = h.invoke('jars-rename', { id: 'personal', name: undefined, color: '#ff0000' });
  assert.equal(c.name, 'Personal');
});

test('jars-rename with an unknown id returns null with no broadcast', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-rename', { id: 'nope', name: 'X' }), null);
  assert.equal(h.broadcasts().length, 0);
});

// ---------------------------------------------------------------------------
// jars-set-default
// ---------------------------------------------------------------------------
test('jars-set-default with an existing id returns true and broadcasts the new defaultId', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-set-default', { id: 'work' }), true);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].payload.defaultId, 'work');
});

test('jars-set-default with an unknown id returns false with no broadcast', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-set-default', { id: 'nope' }), false);
  assert.equal(h.broadcasts().length, 0);
  assert.equal(h.jars.getDefault().id, 'personal'); // unchanged
});

// DD2 strictness exercised through the IPC layer: explicit Burner-as-default is
// rejected while jars exist, accepted (idempotent) on an empty store.
test('jars-set-default { id: null } while jars exist returns false with no broadcast', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-set-default', { id: null }), false);
  assert.equal(h.broadcasts().length, 0);
});

test('jars-set-default { id: null } on an empty store returns true and broadcasts defaultId null', (t) => {
  const h = makeHarness(t, { containers: [], defaultId: null });
  assert.equal(h.invoke('jars-set-default', { id: null }), true);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].payload.defaultId, null);
  assert.deepEqual(b[0].payload.containers, []);
});

// ---------------------------------------------------------------------------
// jars-get-default
// ---------------------------------------------------------------------------
test('jars-get-default returns the flagged jar object', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-get-default').id, 'personal');
});

test('jars-get-default returns BURNER (reference-equal) when the store is empty', (t) => {
  const h = makeHarness(t, { containers: [], defaultId: null });
  assert.equal(h.invoke('jars-get-default'), BURNER);
});

// ---------------------------------------------------------------------------
// jars-remove — the DD6 delete composition
// ---------------------------------------------------------------------------
test('jars-remove composes remove → wipe → reroll → revoke → settings-changed → jars-changed', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-remove', { id: 'personal' });

  assert.equal(result.ok, true);
  assert.equal(result.wiped, true);
  assert.equal(result.removed.id, 'personal');
  assert.equal(result.removed.partition, 'persist:container:personal');

  // Exact composition order, from the single in-order event log.
  assert.deepEqual(h.events.map((e) => e.fn), [
    'clearStorageData',
    'clearCache',
    'rerollSeed',
    'revokeJarKey',
    'broadcast',
    'broadcast'
  ]);
  // Wipe hit the removed jar's partition; reroll got the SAME session object.
  assert.equal(h.events[0].partition, 'persist:container:personal');
  assert.equal(h.events[1].partition, 'persist:container:personal');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.events[2].ses, h.sessions[0]);
  // Revoke got the removed id and the injected settings object.
  assert.equal(h.events[3].jarId, 'personal');
  assert.equal(h.events[3].settings, h.settings);
  // settings-changed carries getAll()'s payload…
  assert.equal(h.events[4].channel, 'settings-changed');
  assert.deepEqual(h.events[4].payload, h.settings.getAll());
  // …then jars-changed reflects the NEW default (the removed jar held the flag).
  assert.equal(h.events[5].channel, 'jars-changed');
  assert.equal(h.events[5].payload.defaultId, 'work');
  assert.deepEqual(h.events[5].payload.containers.map((x) => x.id), ['work']);
});

test('jars-remove of the last jar broadcasts containers: [] and defaultId: null; getDefault → BURNER', async (t) => {
  const h = makeHarness(t, { containers: [personal], defaultId: 'personal' });
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  const changed = h.broadcasts().find((b) => b.channel === 'jars-changed');
  assert.deepEqual(changed.payload.containers, []);
  assert.equal(changed.payload.defaultId, null);
  assert.equal(h.invoke('jars-get-default'), BURNER);
});

test('jars-remove with an unknown id returns { ok: false } with zero side effects', async (t) => {
  const h = makeHarness(t);
  assert.deepEqual(await h.invoke('jars-remove', { id: 'nope' }), { ok: false });
  assert.equal(h.events.length, 0);
  assert.equal(h.sessions.length, 0);
  assert.equal(h.jars.list().length, 2);
});

test('jars-remove with a throwing wipe is fail-soft: { ok: true, wiped: false }, rest of the composition runs', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.wiped, false);
  // Registry removal already happened; revoke/broadcasts still ran. rerollSeed
  // does NOT run here (M08 F3 leg 1: wipeJarData's session calls are UN-CAUGHT
  // — clearStorageData threw before reaching rerollSeed, which now lives
  // INSIDE wipeJarData, after the session calls — a session throw skips it,
  // same as it always skipped the (new) history purge).
  assert.deepEqual(h.events.map((e) => e.fn), ['revokeJarKey', 'broadcast', 'broadcast']);
  assert.equal(h.events[0].jarId, 'personal');
  assert.equal(h.events[1].channel, 'settings-changed');
  assert.equal(h.events[2].channel, 'jars-changed');
  assert.deepEqual(h.jars.list().map((c) => c.id), ['work']);
});

// M08 Flight 3, Leg 1 / DD2 — history purges on delete too (via wipeJarData).
test('jars-remove purges the jar\'s history silently — no broadcast, handleRemove emits none', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  h.historyStore.seed('personal', 2000);
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(h.historyStore.count('personal'), 0, 'history purged');
  assert.ok(h.broadcasts().every((b) => b.channel !== 'history-changed'), 'handleRemove never broadcasts history-changed');
});

test('jars-remove session-throw-with-history-rows pin: fail-soft continues, but the purge is SKIPPED (it runs after the throwing session calls, inside wipeJarData)', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  h.historyStore.seed('personal', 1000);
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.wiped, false);
  assert.equal(h.historyStore.count('personal'), 1, 'purge never ran — the row survives');
});

// M10 Flight 2, Leg 3 / DD7 — bookkeeping dies with its jar on every
// destructive path. jars-remove routes through wipeJarData, same as
// jars-wipe (its own DD7 pin lives with the wipe tests below).
test('jars-remove clears the jar\'s cookie_seen bookkeeping (DD7 lifecycle, via wipeJarData)', async (t) => {
  const h = makeHarness(t);
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  cookieSeen.insertIfAbsent('work', 'sid', 'x.test', '/', 1000); // a DIFFERENT jar — must survive
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 0, 'personal bookkeeping purged');
  assert.equal(cookieSeen.selectExpired('work', Number.MAX_SAFE_INTEGER).length, 1, 'work bookkeeping untouched');
});

test('jars-remove session-throw pin: bookkeeping cleanup is SKIPPED too (it runs inside wipeJarData, after the throwing session calls)', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.wiped, false);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 1, 'bookkeeping survives — cleanup never ran');
});

// ---------------------------------------------------------------------------
test('jars-rename with a non-object primitive payload (string) returns null, no throw', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-rename', 'personal'), null);
  assert.equal(h.broadcasts().length, 0);
});

// ---------------------------------------------------------------------------
// broadcastJarsChanged (returned for main.js's new-container-create reuse)
// ---------------------------------------------------------------------------
