'use strict';

// Unit tests for src/main/jar-ipc.js (M06 Flight 1 Leg 3 / DD6, DD7, CP3).
//
// jar-ipc.js is Electron-free — every dep is injected — so the harness fakes
// ipcMain (capturing handlers), session.fromPartition (a fake session with
// async clearStorageData/clearCache), rerollSeed/revokeJarKey/broadcast spies,
// and a get/set/getAll settings object, while driving the REAL jars module
// (cache-busted + temp-dir loaded, the jars.test.js pattern — node's per-file
// process isolation keeps the shared jars module state safe).
//
// The jars-changed payload carries the LIVE jars.list() array (structured-cloned
// at the real IPC boundary, but a plain reference in this fake harness), so the
// broadcast spy snapshots every payload at emit time; assertions read the
// snapshot, and one pin documents the liveness explicitly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { BURNER } = require('../../src/shared/burner');
const { registerJarIpc } = require('../../src/main/jar-ipc');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-jar-ipc-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// The jars store is a module-scoped singleton — re-require it fresh per test.
function freshStore() {
  const resolved = require.resolve('../../src/main/jars');
  delete require.cache[resolved];
  return require('../../src/main/jars');
}

// Seed fixtures (valid v2 entries).
const personal = { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' };
const work = { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' };

/**
 * Build the fake-deps harness around a real jars store loaded from a v2
 * envelope written to a temp dir. Every observable side-effect (wipe calls,
 * reroll, revoke, broadcasts) is recorded IN ORDER in `events`, so the
 * delete-composition ordering is assertable from one array.
 */
function makeHarness(t, { containers = [personal, work], defaultId = 'personal', storageThrows = false } = {}) {
  const dir = makeTempDir();
  t.after(() => removeTempDir(dir));
  fs.writeFileSync(path.join(dir, 'containers.json'), JSON.stringify({ version: 2, defaultId, containers }));
  const jars = freshStore();
  jars.load(dir);

  const events = [];
  const sessions = [];

  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    }
  };

  // clearStorageData/clearCache capture their call OPTIONS in an `args` field
  // (Flight 4, Leg 1) alongside the original { fn, partition } shape every
  // existing assertion (`events.map(e => e.fn)`, `events[0].partition`, ...)
  // already reads — additive only, so those 23 pre-existing tests are
  // unaffected. Each call pushes its OWN event, so a handler that calls
  // clearStorageData/clearCache multiple times in sequence (the cache-sentinel
  // mapping, or a multi-class clear-data payload) gets one distinct, ordered
  // record per call, each with its own args.
  const session = {
    fromPartition(partition) {
      const ses = {
        partition,
        async clearStorageData(options) {
          if (storageThrows) throw new Error('wipe failed');
          events.push({ fn: 'clearStorageData', partition, args: options });
        },
        async clearCache(options) {
          events.push({ fn: 'clearCache', partition, args: options });
        }
      };
      sessions.push(ses);
      return ses;
    }
  };

  const rerollSeed = (ses) => events.push({ fn: 'rerollSeed', ses });
  const revokeJarKey = (jarId, s) => events.push({ fn: 'revokeJarKey', jarId, settings: s });

  const settingsData = { automationKeyHashes: { personal: 'hash-p' } };
  const settings = {
    get: (k) => settingsData[k],
    set: (k, v) => {
      settingsData[k] = v;
    },
    getAll: () => ({ ...settingsData })
  };

  // Snapshot payloads at emit time (see header note); keep the raw reference
  // too so the liveness pin can compare identities.
  const broadcast = (channel, payload) =>
    events.push({ fn: 'broadcast', channel, payload: structuredClone(payload), raw: payload });

  const { broadcastJarsChanged } = registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast });

  const invoke = (channel, payload) => handlers.get(channel)({}, payload);
  // Internal-origin-gated twins (F3 DD1) are registered through registerInternalHandler,
  // whose wrapper reads event.senderFrame.origin + event.sender.session.__goldfinchInternal
  // BEFORE forwarding to the shared handler body — a trusted fake event mirroring
  // internal-ipc.test.js's trustedEvent() shape is required (the bare `{}` the chrome
  // `invoke` helper passes has no senderFrame, so it would always reject).
  const trustedJarsEvent = () => ({
    senderFrame: { origin: 'goldfinch://jars', url: 'goldfinch://jars/' },
    sender: { session: { __goldfinchInternal: true } }
  });
  const invokeInternal = (channel, payload) => handlers.get(channel)(trustedJarsEvent(), payload);
  const broadcasts = () => events.filter((e) => e.fn === 'broadcast');

  return { jars, handlers, events, sessions, settings, broadcastJarsChanged, invoke, invokeInternal, broadcasts };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------
test('registers exactly the eight chrome + eight internal jar channels, no others', (t) => {
  const h = makeHarness(t);
  assert.deepEqual(
    [...h.handlers.keys()].sort(),
    [
      'internal-jars-add',
      'internal-jars-clear-data',
      'internal-jars-get-default',
      'internal-jars-list',
      'internal-jars-remove',
      'internal-jars-rename',
      'internal-jars-set-default',
      'internal-jars-wipe',
      'jars-add',
      'jars-clear-data',
      'jars-get-default',
      'jars-list',
      'jars-remove',
      'jars-rename',
      'jars-set-default',
      'jars-wipe'
    ]
  );
});

// ---------------------------------------------------------------------------
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

test('an untrusted event (wrong origin) is rejected on every internal-jars-* channel', (t) => {
  const h = makeHarness(t);
  const untrusted = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  for (const channel of [
    'internal-jars-list',
    'internal-jars-add',
    'internal-jars-rename',
    'internal-jars-set-default',
    'internal-jars-get-default',
    'internal-jars-remove',
    'internal-jars-clear-data',
    'internal-jars-wipe'
  ]) {
    assert.throws(
      () => h.handlers.get(channel)(untrusted, { id: 'personal' }),
      (err) => err instanceof Error && err.message.includes('forbidden'),
      `${channel} should reject an untrusted sender`
    );
  }
  assert.equal(h.broadcasts().length, 0);
});

// ---------------------------------------------------------------------------
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
  // Registry removal already happened; reroll/revoke/broadcasts still ran
  // (clearStorageData threw before logging, clearCache never ran).
  assert.deepEqual(h.events.map((e) => e.fn), ['rerollSeed', 'revokeJarKey', 'broadcast', 'broadcast']);
  assert.equal(h.events[0].ses, h.sessions[0]);
  assert.equal(h.events[2].channel, 'settings-changed');
  assert.equal(h.events[3].channel, 'jars-changed');
  assert.deepEqual(h.jars.list().map((c) => c.id), ['work']);
});

// ---------------------------------------------------------------------------
// jars-clear-data (Flight 4, Leg 1 / DD2, DD3) — granular per-class clears.
// Partition lookup is jars.list().find(...); Burner is never a store entry, so
// it rejects the same way as an unknown id (covers burner-<n> ids too).
// ---------------------------------------------------------------------------
test('jars-clear-data applies each requested class in order, passing the exact storages array per class', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'storage'] });
  assert.deepEqual(result, { ok: true, cleared: ['cookies', 'storage'] });
  assert.deepEqual(h.events.map((e) => e.fn), ['clearStorageData', 'clearStorageData']);
  assert.deepEqual(h.events[0].args, { storages: ['cookies'] });
  assert.deepEqual(h.events[1].args, {
    storages: ['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage']
  });
  assert.equal(h.events[0].partition, 'persist:container:personal');
  assert.equal(h.broadcasts().length, 0); // clear-data never broadcasts (DD3 scope note: no settings/jars mutation)
});

test('jars-clear-data with the cache class calls clearCache AND clearStorageData({ storages: [shadercache] })', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cache'] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.fn), ['clearCache', 'clearStorageData']);
  assert.deepEqual(h.events[1].args, { storages: ['shadercache'] });
});

test('jars-clear-data with duplicate class ids applies twice, harmlessly (not deduped)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'cookies'] });
  assert.deepEqual(result.cleared, ['cookies', 'cookies']);
  assert.equal(h.events.filter((e) => e.fn === 'clearStorageData').length, 2);
});

test('jars-clear-data rejection matrix returns { ok: false } and touches no session', async (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope'],
    ['unknown id', { id: 'nope', classes: ['cookies'] }],
    ['burner', { id: 'burner', classes: ['cookies'] }],
    ['missing classes', { id: 'personal' }],
    ['empty classes', { id: 'personal', classes: [] }],
    ['unknown class id', { id: 'personal', classes: ['history'] }],
    ['non-array classes', { id: 'personal', classes: 'cookies' }]
  ];
  for (const [label, payload] of cases) {
    assert.deepEqual(await h.invoke('jars-clear-data', payload), { ok: false }, label);
  }
  assert.equal(h.events.length, 0);
  assert.equal(h.sessions.length, 0);
});

test('jars-clear-data with a partially-unknown classes array applies NONE of them (strict fail-closed)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'history'] });
  assert.deepEqual(result, { ok: false });
  assert.equal(h.events.length, 0); // "cookies" never applied either — no partial application
});

test('jars-clear-data with a throwing session call returns { ok: false }', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies'] });
  assert.deepEqual(result, { ok: false });
});

test('internal-jars-clear-data shares behavior with jars-clear-data', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-clear-data', { id: 'personal', classes: ['cookies'] });
  assert.deepEqual(result, { ok: true, cleared: ['cookies'] });
});

// ---------------------------------------------------------------------------
// jars-wipe (Flight 4, Leg 1 / DD3, DD4) — the full identity wipe. Same
// composition as identity-new plus the jar-wiped broadcast, minus registry
// removal/key revoke (the jar persists).
// ---------------------------------------------------------------------------
test('jars-wipe composes storage -> cache -> reroll -> broadcast(jar-wiped) -> resolve', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events.map((e) => e.fn), ['clearStorageData', 'clearCache', 'rerollSeed', 'broadcast']);
  assert.equal(h.events[0].partition, 'persist:container:personal');
  assert.equal(h.events[0].args, undefined); // no filter — full wipe, matching identity-new
  assert.equal(h.events[1].partition, 'persist:container:personal');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.events[2].ses, h.sessions[0]); // reroll got the SAME session object
  assert.equal(h.events[3].channel, 'jar-wiped');
  assert.deepEqual(h.events[3].payload, { id: 'personal' });
});

test('jars-wipe rejects burner and unknown/malformed ids with { ok: false }, no session call', async (t) => {
  const h = makeHarness(t);
  assert.deepEqual(await h.invoke('jars-wipe', { id: 'burner' }), { ok: false });
  assert.deepEqual(await h.invoke('jars-wipe', { id: 'nope' }), { ok: false });
  assert.deepEqual(await h.invoke('jars-wipe', 'nope'), { ok: false });
  assert.deepEqual(await h.invoke('jars-wipe', undefined), { ok: false });
  assert.equal(h.events.length, 0);
  assert.equal(h.sessions.length, 0);
});

test('jars-wipe with a throwing session call returns { ok: false, error } with NO broadcast and NO reroll', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  // clearStorageData threw before logging anything; rerollSeed/broadcast never ran
  // (nothing was wiped, so no reload should fire).
  assert.equal(h.events.length, 0);
  assert.equal(h.broadcasts().length, 0);
});

test('internal-jars-wipe shares behavior with jars-wipe', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-wipe', { id: 'work' });
  assert.deepEqual(result, { ok: true });
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jar-wiped');
  assert.deepEqual(b[0].payload, { id: 'work' });
});

// ---------------------------------------------------------------------------
// Payload hardening — missing/undefined/primitive payloads return the failure
// value, never throw (the `in` operator throws on primitives).
// ---------------------------------------------------------------------------
test('all four mutating channels tolerate an undefined payload', async (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-add', undefined), null);
  assert.equal(h.invoke('jars-rename', undefined), null);
  assert.equal(h.invoke('jars-set-default', undefined), false);
  assert.deepEqual(await h.invoke('jars-remove', undefined), { ok: false });
  assert.equal(h.broadcasts().length, 0);
  assert.equal(h.jars.list().length, 2);
});

test('jars-rename with a non-object primitive payload (string) returns null, no throw', (t) => {
  const h = makeHarness(t);
  assert.equal(h.invoke('jars-rename', 'personal'), null);
  assert.equal(h.broadcasts().length, 0);
});

// ---------------------------------------------------------------------------
// broadcastJarsChanged (returned for main.js's new-container-create reuse)
// ---------------------------------------------------------------------------
test('the returned broadcastJarsChanged emits the same { containers, defaultId } payload', (t) => {
  const h = makeHarness(t);
  h.broadcastJarsChanged();
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
  assert.deepEqual(b[0].payload.containers.map((x) => x.id), ['personal', 'work']);
  assert.equal(b[0].payload.defaultId, 'personal');
});
