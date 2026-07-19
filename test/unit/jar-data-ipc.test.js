'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerJarDataIpc } = require('../../src/main/jar-data-ipc');
const { appDb, flush, makeHarness } = require('./helpers/jar-ipc-harness');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-jar-ipc-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('exports the data registrar', () => {
  assert.equal(typeof registerJarDataIpc, 'function');
});
test('data chrome/internal twins receive the same handler identity before the internal wrapper', () => {
  const chrome = new Map();
  const internal = new Map();
  const ipcMain = { handle: (channel, handler) => chrome.set(channel, handler) };
  registerJarDataIpc({
    ipcMain,
    registerInternal: (_ipcMain, channel, handler) => internal.set(channel, handler),
    jars: {},
    session: {},
    historyStore: {},
    cookieSeen: {},
    retentionSweep: {},
    wipeJarData() {},
    broadcast() {},
    broadcastJarsChanged() {}
  });
  for (const operation of [
    'clear-data',
    'wipe',
    'set-retention',
    'cookies-list',
    'cookies-remove',
    'cookies-value',
    'sitedata-list',
    'sitedata-remove-origin'
  ]) {
    assert.equal(internal.get(`internal-jars-${operation}`), chrome.get(`jars-${operation}`), operation);
  }
});

test('data internal twins reject an untrusted sender before invoking their shared body', (t) => {
  const h = makeHarness(t);
  const evil = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  for (const channel of [
    'internal-jars-clear-data',
    'internal-jars-wipe',
    'internal-jars-set-retention',
    'internal-jars-cookies-list',
    'internal-jars-cookies-remove',
    'internal-jars-cookies-value',
    'internal-jars-sitedata-list',
    'internal-jars-sitedata-remove-origin'
  ]) {
    assert.throws(() => h.handlers.get(channel)(evil, { id: 'personal' }), /forbidden/, channel);
  }
  assert.equal(h.events.length, 0);
});

// jars-clear-data (Flight 4, Leg 1 / DD2, DD3) — granular per-class clears.
// Partition lookup is jars.list().find(...); Burner is never a store entry, so
// it rejects the same way as an unknown id (covers burner-<n> ids too).
// ---------------------------------------------------------------------------
test('jars-clear-data applies each requested class in order, passing the exact storages array per class', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'storage'] });
  assert.deepEqual(result, { ok: true, cleared: ['cookies', 'storage'] });
  assert.deepEqual(h.events.map((e) => e.fn), ['clearStorageData', 'clearStorageData', 'broadcast']);
  assert.deepEqual(h.events[0].args, { storages: ['cookies'] });
  assert.deepEqual(h.events[1].args, {
    storages: ['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage']
  });
  assert.equal(h.events[0].partition, 'persist:container:personal');
  // DD10: cookies + storage were both requested/cleared, so jar-data-changed
  // fires once carrying both — but clear-data still never touches
  // jars-changed/settings-changed (DD3 scope note unchanged).
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jar-data-changed');
  assert.deepEqual(b[0].payload, { jarId: 'personal', classes: ['cookies', 'storage'] });
});

// M10 Flight 2, Leg 3 / DD7 — a cookies-class clear wipes the jar's
// cookie_seen bookkeeping too (not just the session's cookies).
test('jars-clear-data with classes:["cookies"] clears the jar\'s cookie_seen bookkeeping (DD7 lifecycle)', async (t) => {
  const h = makeHarness(t);
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  cookieSeen.insertIfAbsent('work', 'sid', 'x.test', '/', 1000); // a DIFFERENT jar — must survive
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies'] });
  assert.equal(result.ok, true);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 0);
  assert.equal(cookieSeen.selectExpired('work', Number.MAX_SAFE_INTEGER).length, 1, 'work bookkeeping untouched');
});

test('jars-clear-data with classes:["storage"] (no cookies requested) leaves cookie_seen bookkeeping untouched', async (t) => {
  const h = makeHarness(t);
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['storage'] });
  assert.equal(result.ok, true);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 1, 'a storage-only clear must not touch cookie bookkeeping');
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

test('jars-clear-data rejection matrix returns { ok: false, error } and touches no session', async (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope', 'jars: clear-data — malformed-payload'],
    ['unknown id', { id: 'nope', classes: ['cookies'] }, 'jars: clear-data — unknown-jar'],
    ['burner', { id: 'burner', classes: ['cookies'] }, 'jars: clear-data — unknown-jar'],
    ['missing classes', { id: 'personal' }, 'jars: clear-data — invalid-classes'],
    ['empty classes', { id: 'personal', classes: [] }, 'jars: clear-data — invalid-classes'],
    ['unknown class id', { id: 'personal', classes: ['nonexistent'] }, 'jars: clear-data — unknown-class: nonexistent'],
    ['non-array classes', { id: 'personal', classes: 'cookies' }, 'jars: clear-data — invalid-classes']
  ];
  for (const [label, payload, error] of cases) {
    assert.deepEqual(await h.invoke('jars-clear-data', payload), { ok: false, error }, label);
  }
  assert.equal(h.events.length, 0);
  assert.equal(h.sessions.length, 0);
});

test('jars-clear-data with a partially-unknown classes array applies NONE of them (strict fail-closed)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'nonexistent'] });
  assert.deepEqual(result, { ok: false, error: 'jars: clear-data — unknown-class: nonexistent' });
  assert.equal(h.events.length, 0); // "cookies" never applied either — no partial application
});

test('jars-clear-data with a throwing session call returns { ok: false, error }', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies'] });
  assert.deepEqual(result, { ok: false, error: 'jars: clear-data — session-failure: wipe failed' });
});

test('internal-jars-clear-data shares behavior with jars-clear-data', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-clear-data', { id: 'personal', classes: ['cookies'] });
  assert.deepEqual(result, { ok: true, cleared: ['cookies'] });
});

// ---------------------------------------------------------------------------
// jars-clear-data — the `history` class (M08 Flight 3, Leg 1 / DD1):
// discriminator-first dispatch (ahead of the storages-null cache fallthrough),
// its own static error fragment, n>0 broadcast gate.
// ---------------------------------------------------------------------------
test('jars-clear-data with classes:["history"] clears via historyStore.clearJar and broadcasts history-changed (n>0)', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  h.historyStore.seed('personal', 2000);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['history'] });
  assert.deepEqual(result, { ok: true, cleared: ['history'] });
  assert.equal(h.historyStore.count('personal'), 0);
  // No session call at all for a pure-history clear.
  assert.equal(h.events.filter((e) => e.fn === 'clearStorageData' || e.fn === 'clearCache').length, 0);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'history-changed');
  assert.deepEqual(b[0].payload, { jarId: 'personal' });
});

test('jars-clear-data with classes:["history"] on an empty jar is ok:true with NO broadcast (n>0 gate)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['history'] });
  assert.deepEqual(result, { ok: true, cleared: ['history'] });
  assert.equal(h.broadcasts().length, 0);
});

test('jars-clear-data with the cache class still routes to clearCache, NOT historyStore (regression pin for the fallthrough hazard)', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cache'] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.fn), ['clearCache', 'clearStorageData']);
  assert.equal(h.historyStore.count('personal'), 1, 'a cache clear must NOT touch history');
  assert.equal(h.broadcasts().length, 0, 'no history-changed for a cache-only clear');
});

test('jars-clear-data with mixed ["history","cookies"] clears BOTH, in request order', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['history', 'cookies'] });
  assert.deepEqual(result, { ok: true, cleared: ['history', 'cookies'] });
  assert.equal(h.historyStore.count('personal'), 0);
  const sessionCalls = h.events.filter((e) => e.fn !== 'broadcast');
  assert.deepEqual(sessionCalls.map((e) => e.fn), ['clearStorageData']);
  assert.deepEqual(sessionCalls[0].args, { storages: ['cookies'] });
  // Two broadcasts now: history-changed (n>0 gate) THEN jar-data-changed
  // (DD10 — 'cookies' ∩ {cookies, storage} is non-empty; 'history' is
  // excluded from the jar-data-changed classes list).
  const b = h.broadcasts();
  assert.equal(b.length, 2);
  assert.equal(b[0].channel, 'history-changed');
  assert.equal(b[1].channel, 'jar-data-changed');
  assert.deepEqual(b[1].payload, { jarId: 'personal', classes: ['cookies'] });
});

test('jars-clear-data with classes:["cookies","history"] on a history-store throw returns the static history-failure string; the already-applied session class is unaffected', async (t) => {
  const h = makeHarness(t, { historyThrows: { clearJar: true } });
  const result = await h.invoke('jars-clear-data', { id: 'personal', classes: ['cookies', 'history'] });
  assert.deepEqual(result, { ok: false, error: 'jars: clear-data — history-failure' });
  // 'cookies' ran BEFORE 'history' in request order — its session call already
  // fired and is not rolled back (matching the mixed-class error-attribution
  // shape, not the strict fail-closed PRE-validation, which only guards
  // against unknown class ids).
  assert.deepEqual(h.events.map((e) => e.fn), ['clearStorageData']);
  assert.equal(h.broadcasts().length, 0);
});

test('internal-jars-clear-data with classes:["history"] shares behavior with jars-clear-data', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  const result = await h.invokeInternal('internal-jars-clear-data', { id: 'personal', classes: ['history'] });
  assert.deepEqual(result, { ok: true, cleared: ['history'] });
  assert.equal(h.historyStore.count('personal'), 0);
});

// ---------------------------------------------------------------------------
// jars-wipe (Flight 4, Leg 1 / DD3, DD4) — the full identity wipe. Same
// composition as identity-new plus the jar-wiped broadcast, minus registry
// removal/key revoke (the jar persists).
// ---------------------------------------------------------------------------
test('jars-wipe composes storage -> cache -> reroll -> broadcast(jar-wiped) -> broadcast(jar-data-changed) -> resolve', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events.map((e) => e.fn), [
    'clearStorageData',
    'clearCache',
    'rerollSeed',
    'broadcast',
    'broadcast'
  ]);
  assert.equal(h.events[0].partition, 'persist:container:personal');
  assert.equal(h.events[0].args, undefined); // no filter — full wipe, matching identity-new
  assert.equal(h.events[1].partition, 'persist:container:personal');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.events[2].ses, h.sessions[0]); // reroll got the SAME session object
  assert.equal(h.events[3].channel, 'jar-wiped');
  assert.deepEqual(h.events[3].payload, { id: 'personal' });
  // DD10: a wipe always clears cookies + storage, so jar-data-changed fires
  // unconditionally on success (no history rows here, so no history-changed
  // in between — see the n>0-gated test below for that ordering).
  assert.equal(h.events[4].channel, 'jar-data-changed');
  assert.deepEqual(h.events[4].payload, { jarId: 'personal', classes: ['cookies', 'storage'] });
});

// M10 Flight 2, Leg 3 / DD7 — wipe routes through the SAME wipeJarData as
// jars-remove, so bookkeeping dies with it too.
test('jars-wipe clears the jar\'s cookie_seen bookkeeping (DD7 lifecycle, via wipeJarData)', async (t) => {
  const h = makeHarness(t);
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  cookieSeen.insertIfAbsent('work', 'sid', 'x.test', '/', 1000); // a DIFFERENT jar — must survive
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 0);
  assert.equal(cookieSeen.selectExpired('work', Number.MAX_SAFE_INTEGER).length, 1, 'work bookkeeping untouched');
});

test('jars-wipe rejects burner and unknown/malformed ids with { ok: false, error }, no session call', async (t) => {
  const h = makeHarness(t);
  assert.deepEqual(await h.invoke('jars-wipe', { id: 'burner' }), { ok: false, error: 'jars: wipe — unknown-jar' });
  assert.deepEqual(await h.invoke('jars-wipe', { id: 'nope' }), { ok: false, error: 'jars: wipe — unknown-jar' });
  assert.deepEqual(await h.invoke('jars-wipe', 'nope'), { ok: false, error: 'jars: wipe — malformed-payload' });
  assert.deepEqual(await h.invoke('jars-wipe', undefined), { ok: false, error: 'jars: wipe — malformed-payload' });
  assert.equal(h.events.length, 0);
  assert.equal(h.sessions.length, 0);
});

test('jars-wipe with a throwing session call returns { ok: false, error } with NO broadcast and NO reroll', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'jars: wipe — session-failure: wipe failed');
  // clearStorageData threw before logging anything; rerollSeed/broadcast never ran
  // (nothing was wiped, so no reload should fire).
  assert.equal(h.events.length, 0);
  assert.equal(h.broadcasts().length, 0);
});

// M08 Flight 3, Leg 1 / DD2 — wipe also purges history via wipeJarData.
test('jars-wipe purges history and broadcasts history-changed AFTER jar-wiped (order pinned)', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', 1000);
  h.historyStore.seed('personal', 2000);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.deepEqual(result, { ok: true });
  assert.equal(h.historyStore.count('personal'), 0);
  const b = h.broadcasts();
  assert.equal(b.length, 3);
  assert.equal(b[0].channel, 'jar-wiped', 'jar-wiped keeps its shipped ordering — it drives tab reloads');
  assert.equal(b[1].channel, 'history-changed');
  assert.deepEqual(b[1].payload, { jarId: 'personal' });
  // DD10: jar-data-changed fires LAST, unconditionally (after the n>0-gated
  // history-changed).
  assert.equal(b[2].channel, 'jar-data-changed');
  assert.deepEqual(b[2].payload, { jarId: 'personal', classes: ['cookies', 'storage'] });
});

test('jars-wipe on a jar with no history broadcasts jar-wiped + jar-data-changed, no history-changed (n>0 gate)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.deepEqual(result, { ok: true });
  const b = h.broadcasts();
  assert.equal(b.length, 2);
  assert.equal(b[0].channel, 'jar-wiped');
  assert.equal(b[1].channel, 'jar-data-changed');
  assert.deepEqual(b[1].payload, { jarId: 'personal', classes: ['cookies', 'storage'] });
});

test('jars-wipe stays ok:true when the history purge throws — logged, no history-changed, jar-wiped + jar-data-changed still fire', async (t) => {
  const h = makeHarness(t, { historyThrows: { clearJar: true } });
  h.historyStore.seed('personal', 1000);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.deepEqual(result, { ok: true });
  const b = h.broadcasts();
  assert.equal(b.length, 2);
  assert.equal(b[0].channel, 'jar-wiped');
  assert.equal(b[1].channel, 'jar-data-changed');
});

test('jars-wipe session-throw-with-history-rows pin: fail-hard returns, the purge is SKIPPED (it runs after the throwing session calls, inside wipeJarData)', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  h.historyStore.seed('personal', 1000);
  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(result.ok, false);
  assert.equal(h.historyStore.count('personal'), 1, 'purge never ran — the row survives');
  assert.equal(h.broadcasts().length, 0);
});

test('internal-jars-wipe shares behavior with jars-wipe', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-wipe', { id: 'work' });
  assert.deepEqual(result, { ok: true });
  const b = h.broadcasts();
  assert.equal(b.length, 2);
  assert.equal(b[0].channel, 'jar-wiped');
  assert.deepEqual(b[0].payload, { id: 'work' });
  assert.equal(b[1].channel, 'jar-data-changed');
});

// ---------------------------------------------------------------------------
// jars-set-retention (M08 Flight 3, Leg 1 / DD4) — the first `{ ok, container }`
// wrapper shape in this module (design review Q2: deliberate). Unknown-jar vs
// invalid-days are disambiguated by checking jars.list() membership FIRST
// (both surface as `null` from jars.setRetention). Success always broadcasts
// jars-changed; historyStore.pruneOneJar then runs in its own try/catch,
// broadcasting history-changed only when rows were deleted (n>0 gate).
// ---------------------------------------------------------------------------
test('jars-set-retention happy path: mutates, persists via jars.js, broadcasts jars-changed, returns { ok: true, container }', (t) => {
  const h = makeHarness(t);
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 90 });
  assert.equal(result.ok, true);
  assert.equal(result.container.id, 'personal');
  assert.equal(result.container.retentionDays, 90);
  assert.equal(h.jars.list().find((c) => c.id === 'personal').retentionDays, 90);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
});

test('jars-set-retention full rejection matrix: malformed payload / unknown jar / invalid days, no mutation', (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope', 'jars: set-retention — malformed-payload'],
    ['undefined payload', undefined, 'jars: set-retention — malformed-payload'],
    ['unknown id', { id: 'nope', days: 30 }, 'jars: set-retention — unknown-jar'],
    ['burner', { id: 'burner', days: 30 }, 'jars: set-retention — unknown-jar'],
    ['zero days', { id: 'personal', days: 0 }, 'jars: set-retention — invalid-days'],
    ['non-integer days', { id: 'personal', days: 1.5 }, 'jars: set-retention — invalid-days'],
    ['numeric-string days', { id: 'personal', days: '30' }, 'jars: set-retention — invalid-days'],
    ['over-max days', { id: 'personal', days: 3651 }, 'jars: set-retention — invalid-days'],
    ['null days', { id: 'personal', days: null }, 'jars: set-retention — invalid-days'],
    ['missing days', { id: 'personal' }, 'jars: set-retention — invalid-days']
  ];
  for (const [label, payload, error] of cases) {
    assert.deepEqual(h.invoke('jars-set-retention', payload), { ok: false, error }, label);
  }
  assert.equal(h.broadcasts().length, 0);
  assert.equal(h.jars.list().find((c) => c.id === 'personal').retentionDays, 30, 'no partial mutation on any rejection');
});

test('jars-set-retention prune-on-change: deleted>0 broadcasts history-changed AFTER jars-changed', (t) => {
  const h = makeHarness(t);
  const dayMs = 86_400_000;
  h.historyStore.seed('personal', Date.now() - 100 * dayMs); // far older than any preset
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  assert.equal(result.ok, true);
  assert.equal(h.historyStore.count('personal'), 0);
  const b = h.broadcasts();
  assert.equal(b.length, 2);
  assert.equal(b[0].channel, 'jars-changed');
  assert.equal(b[1].channel, 'history-changed');
  assert.deepEqual(b[1].payload, { jarId: 'personal' });
});

test('jars-set-retention prune-on-change: deleted===0 broadcasts ONLY jars-changed', (t) => {
  const h = makeHarness(t);
  h.historyStore.seed('personal', Date.now()); // fresh — within any retention window
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 365 });
  assert.equal(result.ok, true);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
});

test('jars-set-retention: jars-changed still broadcasts even when the prune throws (logged, fail-soft, no history-changed)', (t) => {
  const h = makeHarness(t, { historyThrows: { pruneOneJar: true } });
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  assert.equal(result.ok, true);
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
});

test('jars-set-retention to the CURRENT value is still ok:true and still broadcasts (idempotent, no special-casing)', (t) => {
  const h = makeHarness(t);
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 30 });
  assert.equal(result.ok, true);
  assert.equal(h.broadcasts().length, 1);
});

test('internal-jars-set-retention shares behavior with jars-set-retention', (t) => {
  const h = makeHarness(t);
  const result = h.invokeInternal('internal-jars-set-retention', { id: 'work', days: 60 });
  assert.equal(result.ok, true);
  assert.equal(result.container.retentionDays, 60);
});

// ---------------------------------------------------------------------------
// M10 Flight 2, Leg 3 / DD4b, DD6, DD10 — the immediate one-jar retention
// sweep handleSetRetention gains: the SEQUENCING invariant (snapshot the
// aged-out origins BEFORE pruneOneJar runs) and the fire-and-forget sweep's
// DD10 completion broadcast.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

test('jars-set-retention SEQUENCING: expiredOriginsForJar snapshot runs BEFORE pruneOneJar (Context SEQUENCING / leg-3 design review HIGH)', (t) => {
  const h = makeHarness(t);
  h.historyStore.seedVisit('personal', 'https://old.example/', Date.now() - 100 * DAY_MS);
  h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  const snapIdx = h.historyStore.calls.indexOf('expiredOriginsForJar');
  const pruneIdx = h.historyStore.calls.indexOf('pruneOneJar');
  assert.notEqual(snapIdx, -1, 'expiredOriginsForJar was called');
  assert.notEqual(pruneIdx, -1, 'pruneOneJar was called');
  assert.ok(snapIdx < pruneIdx, 'the snapshot must be taken before the prune deletes the rows it reads');
});

test('jars-set-retention SEQUENCING regression guard: the immediate sweep clears the aged-out origin — would be silently inert if the snapshot ran post-prune', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seedVisit('personal', 'https://old.example/', Date.now() - 100 * DAY_MS);
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  assert.equal(result.ok, true);
  await flush();
  const clears = h.events.filter(
    (e) => e.fn === 'clearStorageData' && e.partition === 'persist:container:personal' && e.args && e.args.origin
  );
  assert.ok(
    clears.some((c) => c.args.origin === 'https://old.example'),
    'the storage sweep must see and clear the aged-out origin from the PRE-prune snapshot'
  );
});

test('jars-set-retention: no aged-out origins and no aged-out cookies sweeps to a no-op — no jar-data-changed broadcast', async (t) => {
  const h = makeHarness(t);
  const result = h.invoke('jars-set-retention', { id: 'personal', days: 90 });
  assert.equal(result.ok, true);
  await flush();
  assert.ok(!h.broadcasts().some((b) => b.channel === 'jar-data-changed'), 'nothing was swept, so no completion broadcast');
});

test('jars-set-retention: the sweep\'s jar-data-changed broadcast fires on COMPLETION (async, never on the invoke itself — DD10)', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seedVisit('personal', 'https://old.example/', Date.now() - 100 * DAY_MS);
  h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  // Synchronously right after invoke, the async sweep has not settled yet.
  assert.ok(
    !h.broadcasts().some((b) => b.channel === 'jar-data-changed'),
    'jar-data-changed must not fire before the sweep completes (the invoke resolves first)'
  );
  await flush();
  const swept = h.broadcasts().find((b) => b.channel === 'jar-data-changed');
  assert.ok(swept, 'jar-data-changed fires once the sweep settles');
  assert.deepEqual(swept.payload, { jarId: 'personal', classes: ['storage'] });
});

test('jars-set-retention: the immediate sweep also removes cookies whose bookkeeping age exceeds the NEW window, clears their row, and reports "cookies" in the completion classes', async (t) => {
  const h = makeHarness(t, {
    cookiesByPartition: { 'persist:container:personal': [{ name: 'sid', domain: 'x.test', path: '/', secure: true }] }
  });
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', Date.now() - 100 * DAY_MS);

  h.invoke('jars-set-retention', { id: 'personal', days: 7 });
  await flush();

  const removeCalls = h.events.filter((e) => e.fn === 'cookiesRemove' && e.partition === 'persist:container:personal');
  assert.equal(removeCalls.length, 1);
  assert.equal(removeCalls[0].args.name, 'sid');
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 0, 'the expired row was deleted');

  const swept = h.broadcasts().find((b) => b.channel === 'jar-data-changed');
  assert.ok(swept);
  assert.ok(swept.payload.classes.includes('cookies'));
});

test('jars-set-retention: a rejected payload never triggers a sweep (no session calls, no snapshot)', (t) => {
  const h = makeHarness(t);
  h.invoke('jars-set-retention', { id: 'nope', days: 7 });
  assert.deepEqual(h.historyStore.calls, [], 'neither expiredOriginsForJar nor pruneOneJar ran for a rejected payload');
  assert.deepEqual(h.sessions, [], 'no session was ever resolved');
});

// ---------------------------------------------------------------------------
// jars-cookies-list / jars-cookies-remove (M10 Flight 2, Leg 2 / flight DD2,
// DD7). NO `value` field crosses the payload (least-privilege). Neither twin
// broadcasts jar-data-changed — that's handleClearData/handleWipe's job
// (DD10); per-item deletes rely on the calling panel re-querying itself.
// ---------------------------------------------------------------------------

const COOKIE_HOST_ONLY = {
  name: 'sid',
  domain: 'host-only.test',
  path: '/',
  secure: true,
  hostOnly: true,
  session: false,
  expirationDate: 1893456000,
  value: 'super-secret-value'
};
const COOKIE_DOMAIN_ATTR = {
  name: 'pref',
  domain: '.domain-cookie.test',
  path: '/app',
  secure: false,
  hostOnly: false,
  session: true,
  value: 'also-secret'
  // no expirationDate — session cookie
};
const COOKIE_EMPTY_NAME = {
  name: '',
  domain: 'x.test',
  path: '/',
  secure: false,
  hostOnly: true,
  session: true,
  value: 'v'
};

test('jars-cookies-list maps fields and strips `value` entirely (DD7 least-privilege)', async (t) => {
  const h = makeHarness(t, {
    cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY, COOKIE_DOMAIN_ATTR] }
  });
  const result = await h.invoke('jars-cookies-list', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cookies, [
    {
      name: 'sid',
      domain: 'host-only.test',
      path: '/',
      expirationDate: 1893456000,
      secure: true,
      hostOnly: true,
      session: false
    },
    {
      name: 'pref',
      domain: '.domain-cookie.test',
      path: '/app',
      expirationDate: null,
      secure: false,
      hostOnly: false,
      session: true
    }
  ]);
  for (const c of result.cookies) assert.ok(!('value' in c), 'no value field ever crosses the payload');
  assert.equal(h.broadcasts().length, 0);
});

test('jars-cookies-list: empty-name cookies list too (typeof check, not truthiness)', async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE_EMPTY_NAME] } });
  const result = await h.invoke('jars-cookies-list', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.cookies.length, 1);
  assert.equal(result.cookies[0].name, '');
});

test('jars-cookies-list rejection matrix + session-failure, no session call on rejection', async (t) => {
  const h = makeHarness(t);
  assert.deepEqual(await h.invoke('jars-cookies-list', 'nope'), {
    ok: false,
    error: 'jars: cookies-list — malformed-payload'
  });
  assert.deepEqual(await h.invoke('jars-cookies-list', { id: 'nope' }), {
    ok: false,
    error: 'jars: cookies-list — unknown-jar'
  });
  assert.deepEqual(await h.invoke('jars-cookies-list', { id: 'burner' }), {
    ok: false,
    error: 'jars: cookies-list — unknown-jar'
  });
  assert.equal(h.sessions.length, 0);
});

test('jars-cookies-list: a throwing session call returns { ok: false, error }', async (t) => {
  const h = makeHarness(t, { cookiesGetThrows: true });
  const result = await h.invoke('jars-cookies-list', { id: 'personal' });
  assert.deepEqual(result, { ok: false, error: 'jars: cookies-list — session-failure: cookies.get failed' });
});

test('internal-jars-cookies-list shares behavior with jars-cookies-list', async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY] } });
  const result = await h.invokeInternal('internal-jars-cookies-list', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(result.cookies.length, 1);
});

test('jars-cookies-remove: host-only cookie reconstructs a dot-free URL (DD2, spike-verified)', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-cookies-remove', {
    id: 'personal',
    name: 'sid',
    domain: 'host-only.test',
    path: '/',
    secure: true
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events, [
    { fn: 'cookiesRemove', partition: 'persist:container:personal', args: { url: 'https://host-only.test/', name: 'sid' } }
  ]);
  assert.equal(h.broadcasts().length, 0, 'per-item delete never broadcasts jar-data-changed (DD10)');
});

test('jars-cookies-remove: domain-attribute cookie strips the leading dot (DD2, spike-verified)', async (t) => {
  const h = makeHarness(t);
  await h.invoke('jars-cookies-remove', {
    id: 'personal',
    name: 'pref',
    domain: '.domain-cookie.test',
    path: '/app',
    secure: false
  });
  assert.deepEqual(h.events[0].args, { url: 'http://domain-cookie.test/app', name: 'pref' });
});

test('jars-cookies-remove: empty-name cookie is a valid removal target', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-cookies-remove', { id: 'personal', name: '', domain: 'x.test' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events[0].args, { url: 'http://x.test/', name: '' });
});

// M10 Flight 2, Leg 3 / DD7 — a per-cookie delete clears its bookkeeping row
// too (matching `path` defaulted to '/' the same way cookieUrl defaults it).
test('jars-cookies-remove clears the cookie\'s cookie_seen bookkeeping row (DD7 lifecycle)', async (t) => {
  const h = makeHarness(t);
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  cookieSeen.insertIfAbsent('personal', 'other', 'x.test', '/', 1000); // a DIFFERENT identity — must survive
  const result = await h.invoke('jars-cookies-remove', { id: 'personal', name: 'sid', domain: 'x.test' });
  assert.equal(result.ok, true);
  const remaining = cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER);
  assert.deepEqual(remaining.map((r) => r.name), ['other']);
});

test('jars-cookies-remove: a session-throw never touches bookkeeping (fails before the cleanup step)', async (t) => {
  const h = makeHarness(t, { cookiesRemoveThrows: true });
  const cookieSeen = appDb.createCookieSeenStore();
  cookieSeen.insertIfAbsent('personal', 'sid', 'x.test', '/', 1000);
  const result = await h.invoke('jars-cookies-remove', { id: 'personal', name: 'sid', domain: 'x.test' });
  assert.equal(result.ok, false);
  assert.equal(cookieSeen.selectExpired('personal', Number.MAX_SAFE_INTEGER).length, 1, 'bookkeeping survives a failed session removal');
});

test('jars-cookies-remove rejection matrix returns { ok: false, error }, no session call', async (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope', 'jars: cookies-remove — malformed-payload'],
    ['unknown id', { id: 'nope', name: 'x', domain: 'y' }, 'jars: cookies-remove — unknown-jar'],
    ['burner', { id: 'burner', name: 'x', domain: 'y' }, 'jars: cookies-remove — unknown-jar'],
    ['missing name', { id: 'personal', domain: 'y' }, 'jars: cookies-remove — malformed-payload'],
    ['missing domain', { id: 'personal', name: 'x' }, 'jars: cookies-remove — malformed-payload'],
    ['non-string name', { id: 'personal', name: 42, domain: 'y' }, 'jars: cookies-remove — malformed-payload']
  ];
  for (const [label, payload, error] of cases) {
    assert.deepEqual(await h.invoke('jars-cookies-remove', payload), { ok: false, error }, label);
  }
  assert.equal(h.sessions.length, 0);
});

test('jars-cookies-remove: a throwing session call returns { ok: false, error }', async (t) => {
  const h = makeHarness(t, { cookiesRemoveThrows: true });
  const result = await h.invoke('jars-cookies-remove', { id: 'personal', name: 'sid', domain: 'x.test' });
  assert.deepEqual(result, { ok: false, error: 'jars: cookies-remove — session-failure: cookies.remove failed' });
});

test('internal-jars-cookies-remove shares behavior with jars-cookies-remove', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-cookies-remove', {
    id: 'personal',
    name: 'sid',
    domain: 'x.test'
  });
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// jars-cookies-value (F3 HAT walkthrough fix-rider, operator-requested). Same
// three-phase validation as jars-cookies-remove (object-shape -> unknown-jar
// -> per-field `typeof` checks on name/domain/path — including `path`, which
// jars-cookies-remove leaves optional but this handler requires). Matches
// client-side to the EXACT {name, domain, path} identity — never Electron's
// subdomain-matching CookiesGetFilter.domain form.
// ---------------------------------------------------------------------------

// A second 'sid'-named cookie on a DIFFERENT domain — the exact-identity
// match must never cross-match this against COOKIE_HOST_ONLY's 'sid'.
const COOKIE_SID_OTHER_DOMAIN = {
  name: 'sid',
  domain: 'other.test',
  path: '/',
  secure: false,
  hostOnly: true,
  session: true,
  value: 'other-domain-secret'
};

test('jars-cookies-value: exact-identity match returns { ok: true, value }', async (t) => {
  const h = makeHarness(t, {
    cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY, COOKIE_DOMAIN_ATTR] }
  });
  const result = await h.invoke('jars-cookies-value', {
    id: 'personal',
    name: 'sid',
    domain: 'host-only.test',
    path: '/'
  });
  assert.deepEqual(result, { ok: true, value: 'super-secret-value' });
});

test('jars-cookies-value: two cookies sharing a name on different domains resolve to the correct one', async (t) => {
  const h = makeHarness(t, {
    cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY, COOKIE_SID_OTHER_DOMAIN] }
  });
  const first = await h.invoke('jars-cookies-value', {
    id: 'personal',
    name: 'sid',
    domain: 'host-only.test',
    path: '/'
  });
  assert.deepEqual(first, { ok: true, value: 'super-secret-value' });
  const second = await h.invoke('jars-cookies-value', { id: 'personal', name: 'sid', domain: 'other.test', path: '/' });
  assert.deepEqual(second, { ok: true, value: 'other-domain-secret' });
});

test('jars-cookies-value: empty-name cookie is a valid reveal target (typeof check, not truthiness)', async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE_EMPTY_NAME] } });
  const result = await h.invoke('jars-cookies-value', { id: 'personal', name: '', domain: 'x.test', path: '/' });
  assert.deepEqual(result, { ok: true, value: 'v' });
});

test('jars-cookies-value: no matching cookie returns a static not-found error', async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY] } });
  const result = await h.invoke('jars-cookies-value', {
    id: 'personal',
    name: 'sid',
    domain: 'host-only.test',
    path: '/gone' // path mismatch — same name/domain, different path
  });
  assert.deepEqual(result, { ok: false, error: 'jars: cookies-value — not-found' });
});

test('jars-cookies-value rejection matrix returns { ok: false, error }, no session call', async (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope', 'jars: cookies-value — malformed-payload'],
    ['unknown id', { id: 'nope', name: 'x', domain: 'y', path: '/' }, 'jars: cookies-value — unknown-jar'],
    ['burner', { id: 'burner', name: 'x', domain: 'y', path: '/' }, 'jars: cookies-value — unknown-jar'],
    ['missing name', { id: 'personal', domain: 'y', path: '/' }, 'jars: cookies-value — malformed-payload'],
    ['missing domain', { id: 'personal', name: 'x', path: '/' }, 'jars: cookies-value — malformed-payload'],
    ['missing path', { id: 'personal', name: 'x', domain: 'y' }, 'jars: cookies-value — malformed-payload'],
    ['non-string name', { id: 'personal', name: 42, domain: 'y', path: '/' }, 'jars: cookies-value — malformed-payload'],
    ['non-string domain', { id: 'personal', name: 'x', domain: 42, path: '/' }, 'jars: cookies-value — malformed-payload'],
    ['non-string path', { id: 'personal', name: 'x', domain: 'y', path: 42 }, 'jars: cookies-value — malformed-payload']
  ];
  for (const [label, payload, error] of cases) {
    assert.deepEqual(await h.invoke('jars-cookies-value', payload), { ok: false, error }, label);
  }
  assert.equal(h.sessions.length, 0);
});

test('jars-cookies-value: a throwing session call returns { ok: false, error }', async (t) => {
  const h = makeHarness(t, { cookiesGetThrows: true });
  const result = await h.invoke('jars-cookies-value', { id: 'personal', name: 'sid', domain: 'x.test', path: '/' });
  assert.deepEqual(result, { ok: false, error: 'jars: cookies-value — session-failure: cookies.get failed' });
});

test('internal-jars-cookies-value shares behavior with jars-cookies-value', async (t) => {
  const h = makeHarness(t, { cookiesByPartition: { 'persist:container:personal': [COOKIE_HOST_ONLY] } });
  const result = await h.invokeInternal('internal-jars-cookies-value', {
    id: 'personal',
    name: 'sid',
    domain: 'host-only.test',
    path: '/'
  });
  assert.deepEqual(result, { ok: true, value: 'super-secret-value' });
});

// ---------------------------------------------------------------------------
// jars-sitedata-list / jars-sitedata-remove-origin (M10 Flight 2, Leg 2 /
// flight DD3 VERDICT). Composite union: IndexedDB-dir scrape (ses.storagePath
// — a PROPERTY) ∪ historyStore.originsForJar, two-tier badges, stored wins on
// overlap. Both sides degrade to empty rather than erroring.
// ---------------------------------------------------------------------------

/**
 * Real temp dir with a real `IndexedDB/` subdirectory containing the given
 * leveldb dirnames (empty dirs — only the NAME is read by the parser) — the
 * on-disk-scrape half is exercised against real fs.readdir, not a mocked fs,
 * matching this repo's temp-dir convention for filesystem-touching code.
 * @param {string[]} dirnames
 * @returns {string} the storagePath root (the parent of IndexedDB/)
 */
function makeStoragePathWithIndexedDbDirs(dirnames) {
  const root = makeTempDir();
  const idbDir = path.join(root, 'IndexedDB');
  fs.mkdirSync(idbDir, { recursive: true });
  for (const name of dirnames) fs.mkdirSync(path.join(idbDir, name));
  return root;
}

test('jars-sitedata-list: composite union — IndexedDB-confirmed origins tier "stored", history-only origins tier "visited"', async (t) => {
  const storagePath = makeStoragePathWithIndexedDbDirs(['http_127.0.0.1_54321.indexeddb.leveldb']);
  t.after(() => removeTempDir(storagePath));
  const h = makeHarness(t, { storagePaths: { 'persist:container:personal': storagePath } });
  h.historyStore.seedVisit('personal', 'https://visited-only.example/page', 1000);

  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.origins, [
    { origin: 'http://127.0.0.1:54321', tier: 'stored' },
    { origin: 'https://visited-only.example', tier: 'visited' }
  ]);
});

test('jars-sitedata-list: an origin with BOTH IndexedDB data and history activity is tiered "stored" (stored wins)', async (t) => {
  // Portless dirname (no default-port segment) — matches `new URL().origin`'s
  // OWN default-port omission, so this is the unambiguous merge case. A
  // dirname carrying an EXPLICIT default port (e.g. "..._443...") would NOT
  // merge under the current parser (it round-trips to "https://example.com:443",
  // distinct from origin()'s "https://example.com") — exactly the open
  // question this leg's smoke check live-probes against a real default-port
  // origin (leg AC); not asserted here since the on-disk format for that case
  // is unconfirmed pre-smoke.
  const storagePath = makeStoragePathWithIndexedDbDirs(['https_example.com.indexeddb.leveldb']);
  t.after(() => removeTempDir(storagePath));
  const h = makeHarness(t, { storagePaths: { 'persist:container:personal': storagePath } });
  h.historyStore.seedVisit('personal', 'https://example.com/', 1000);

  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.deepEqual(result.origins, [{ origin: 'https://example.com', tier: 'stored' }]);
});

test('jars-sitedata-list: no storagePath yields an empty stored tier, not an error', async (t) => {
  const h = makeHarness(t); // no storagePaths entry -> ses.storagePath is null
  h.historyStore.seedVisit('personal', 'https://visited-only.example/', 1000);
  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.origins, [{ origin: 'https://visited-only.example', tier: 'visited' }]);
});

test('jars-sitedata-list: a storagePath with no IndexedDB/ dir yields an empty stored tier, not an error (ENOENT)', async (t) => {
  const root = makeTempDir(); // no IndexedDB/ subdir created at all
  t.after(() => removeTempDir(root));
  const h = makeHarness(t, { storagePaths: { 'persist:container:personal': root } });
  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.deepEqual(result, { ok: true, origins: [] });
});

test('jars-sitedata-list: unparseable IndexedDB dir entries are skipped, never thrown', async (t) => {
  const storagePath = makeStoragePathWithIndexedDbDirs([
    'Local Storage', // unrelated leveldb dir, wrong suffix entirely
    'garbage',
    'http_127.0.0.1_1.indexeddb.leveldb' // one valid entry survives alongside the junk
  ]);
  t.after(() => removeTempDir(storagePath));
  const h = makeHarness(t, { storagePaths: { 'persist:container:personal': storagePath } });
  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.deepEqual(result, { ok: true, origins: [{ origin: 'http://127.0.0.1:1', tier: 'stored' }] });
});

test('jars-sitedata-list: a jar with no storage path and no history yields an empty (not error) list', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.deepEqual(result, { ok: true, origins: [] });
});

test('jars-sitedata-list: a history-store throw is logged and fail-soft (treated as zero visited origins, still ok:true)', async (t) => {
  const h = makeHarness(t, { historyThrows: { originsForJar: true } });
  const result = await h.invoke('jars-sitedata-list', { id: 'personal' });
  assert.deepEqual(result, { ok: true, origins: [] });
});

test('jars-sitedata-list rejection matrix', async (t) => {
  const h = makeHarness(t);
  assert.deepEqual(await h.invoke('jars-sitedata-list', 'nope'), {
    ok: false,
    error: 'jars: sitedata-list — malformed-payload'
  });
  assert.deepEqual(await h.invoke('jars-sitedata-list', { id: 'nope' }), {
    ok: false,
    error: 'jars: sitedata-list — unknown-jar'
  });
  assert.deepEqual(await h.invoke('jars-sitedata-list', { id: 'burner' }), {
    ok: false,
    error: 'jars: sitedata-list — unknown-jar'
  });
});

test('internal-jars-sitedata-list shares behavior with jars-sitedata-list', async (t) => {
  const h = makeHarness(t);
  h.historyStore.seedVisit('work', 'https://example.org/', 1000);
  const result = await h.invokeInternal('internal-jars-sitedata-list', { id: 'work' });
  assert.deepEqual(result, { ok: true, origins: [{ origin: 'https://example.org', tier: 'visited' }] });
});

test('jars-sitedata-remove-origin: clears storage classes MINUS cookies, for the exact origin', async (t) => {
  const h = makeHarness(t);
  const result = await h.invoke('jars-sitedata-remove-origin', { id: 'personal', origin: 'https://example.com' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.events, [
    {
      fn: 'clearStorageData',
      partition: 'persist:container:personal',
      args: {
        origin: 'https://example.com',
        storages: ['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage']
      }
    }
  ]);
  assert.ok(!h.events[0].args.storages.includes('cookies'), 'cookies excluded from the site-data storage set');
  assert.equal(h.broadcasts().length, 0, 'per-item delete never broadcasts jar-data-changed (DD10)');
});

test('jars-sitedata-remove-origin rejection matrix, no session call', async (t) => {
  const h = makeHarness(t);
  const cases = [
    ['non-object payload', 'nope', 'jars: sitedata-remove-origin — malformed-payload'],
    ['missing origin', { id: 'personal' }, 'jars: sitedata-remove-origin — malformed-payload'],
    ['empty-string origin', { id: 'personal', origin: '' }, 'jars: sitedata-remove-origin — malformed-payload'],
    ['unknown id', { id: 'nope', origin: 'https://x.test' }, 'jars: sitedata-remove-origin — unknown-jar'],
    ['burner', { id: 'burner', origin: 'https://x.test' }, 'jars: sitedata-remove-origin — unknown-jar']
  ];
  for (const [label, payload, error] of cases) {
    assert.deepEqual(await h.invoke('jars-sitedata-remove-origin', payload), { ok: false, error }, label);
  }
  assert.equal(h.sessions.length, 0);
});

test('jars-sitedata-remove-origin: a throwing session call returns { ok: false, error }', async (t) => {
  const h = makeHarness(t, { storageThrows: true });
  const result = await h.invoke('jars-sitedata-remove-origin', { id: 'personal', origin: 'https://x.test' });
  assert.deepEqual(result, {
    ok: false,
    error: 'jars: sitedata-remove-origin — session-failure: wipe failed'
  });
});

test('internal-jars-sitedata-remove-origin shares behavior with jars-sitedata-remove-origin', async (t) => {
  const h = makeHarness(t);
  const result = await h.invokeInternal('internal-jars-sitedata-remove-origin', {
    id: 'personal',
    origin: 'https://x.test'
  });
  assert.deepEqual(result, { ok: true });
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
