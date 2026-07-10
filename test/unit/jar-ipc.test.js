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

  const session = {
    fromPartition(partition) {
      const ses = {
        partition,
        async clearStorageData() {
          if (storageThrows) throw new Error('wipe failed');
          events.push({ fn: 'clearStorageData', partition });
        },
        async clearCache() {
          events.push({ fn: 'clearCache', partition });
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
  const broadcasts = () => events.filter((e) => e.fn === 'broadcast');

  return { jars, handlers, events, sessions, settings, broadcastJarsChanged, invoke, broadcasts };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------
test('registers exactly the six jar-registry channels, no others', (t) => {
  const h = makeHarness(t);
  assert.deepEqual(
    [...h.handlers.keys()].sort(),
    ['jars-add', 'jars-get-default', 'jars-list', 'jars-remove', 'jars-rename', 'jars-set-default']
  );
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
