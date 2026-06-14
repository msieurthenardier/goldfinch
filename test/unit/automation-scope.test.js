'use strict';

// Unit tests for src/main/automation/scope.js — the jar-scoping façade (Leg 2,
// DD4/DD6/DD7). Electron-free: a fake engine + a partition→session map (with REAL
// object identity) + a fake jars registry stand in for the live runtime, so the
// membership compare (wc.session === fromPartition(jar.partition)) is authentic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scopeEngine, WCID_FIRST_OPS } = require('../../src/main/automation/scope');

// ---------------------------------------------------------------------------
// Fake world: jars, interned sessions, tabs, fromId, fromPartition.
// ---------------------------------------------------------------------------

const JARS = [
  { id: 'personal', partition: 'persist:container:personal' },
  { id: 'work', partition: 'persist:container:work' },
];

function makeWorld() {
  const sessions = new Map();
  const sessionFor = (partition) => {
    if (!sessions.has(partition)) {
      sessions.set(partition, { __partition: partition, __goldfinchInternal: partition === 'goldfinch-internal' });
    }
    return sessions.get(partition);
  };

  // tabs: wcId → partition + reported jarId (which MAY lie).
  const tabs = [
    { wcId: 1, partition: 'persist:container:personal', jarId: 'personal', url: 'https://p1', title: 'P1', active: true },
    { wcId: 2, partition: 'persist:container:work', jarId: 'work', url: 'https://w1', title: 'W1', active: false },
    { wcId: 3, partition: 'burner:1', jarId: 'personal', url: 'https://b', title: 'B', active: false }, // burner; jarId LIES
    { wcId: 4, partition: 'persist:container:personal', jarId: 'work', url: 'https://p2', title: 'P2', active: false }, // personal session; jarId LIES 'work'
    { wcId: 5, partition: 'goldfinch-internal', jarId: null, url: 'goldfinch://settings', title: 'S', active: false },
  ];
  const byWcId = new Map(tabs.map((t) => [t.wcId, t]));

  const fromId = (wcId) => {
    const t = byWcId.get(wcId);
    if (!t) return null;
    return { id: wcId, session: sessionFor(t.partition), isDestroyed() { return false; } };
  };

  return { sessionFor, fromPartition: (p) => sessionFor(p), tabs, fromId };
}

// A fake engine recording calls. enumerateTabs returns the non-internal tabs
// (mirroring the jar-engine's allowInternal:false enumeration). wcId-first ops
// echo their wcId so a test can prove the call reached the engine.
function makeFakeEngine(world, { includeInternal = false } = {}) {
  const calls = [];
  const tabsView = world.tabs
    .filter((t) => includeInternal || t.partition !== 'goldfinch-internal')
    .map((t) => ({ wcId: t.wcId, url: t.url, title: t.title, jarId: t.jarId, active: t.active }));
  const engine = { __calls: calls, enumerateTabs: () => tabsView };
  for (const op of WCID_FIRST_OPS) {
    engine[op] = (wcId, ...rest) => { calls.push([op, wcId, ...rest]); return { op, wcId }; };
  }
  engine.openTab = (url) => { calls.push(['openTab', url]); return { openedFor: url }; };
  engine.captureWindow = () => { calls.push(['captureWindow']); return 'WINDOW'; };
  return engine;
}

function makeCtx(world) {
  return {
    jars: { list: () => JARS },
    fromId: world.fromId,
    fromPartition: world.fromPartition,
    getChromeContents: () => ({ id: 0 }),
  };
}

// ---------------------------------------------------------------------------
// admin → engine unchanged
// ---------------------------------------------------------------------------

test('scopeEngine: admin returns the engine UNCHANGED (same object reference)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world, { includeInternal: true });
  assert.equal(scopeEngine(engine, 'admin', makeCtx(world)), engine);
});

// ---------------------------------------------------------------------------
// jar → enumerate filtered by SESSION, not reported jarId
// ---------------------------------------------------------------------------

test('scopeEngine: jar enumerateTabs filters by RESOLVED SESSION, not reported jarId', async () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  const tabs = await scoped.enumerateTabs();
  const wcIds = tabs.map((t) => t.wcId).sort();
  // wcId 1 (personal, label matches) + wcId 4 (personal session, label LIES 'work').
  // NOT 2 (work), 3 (burner), 5 (internal — not even in the jar engine's view).
  assert.deepEqual(wcIds, [1, 4]);
});

test('scopeEngine: jar enumerate EXCLUDES a tab whose label says the jar but session does not', async () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  // For 'work': wcId 2 is the only work-session tab. wcId 4's label LIES 'work'
  // but its session is personal → excluded. wcId 3 (burner) labels 'personal'.
  const scoped = scopeEngine(engine, 'work', makeCtx(world));
  const tabs = await scoped.enumerateTabs();
  assert.deepEqual(tabs.map((t) => t.wcId).sort(), [2]);
});

// ---------------------------------------------------------------------------
// jar → wcId-first ops gated by membership
// ---------------------------------------------------------------------------

test('scopeEngine: jar wcId-op on an IN-JAR tab reaches the engine', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  const res = scoped.navigate(1, 'https://x');
  assert.deepEqual(res, { op: 'navigate', wcId: 1 });
  assert.deepEqual(engine.__calls, [['navigate', 1, 'https://x']]);
});

test('scopeEngine: jar wcId-op on an OUT-OF-JAR tab throws out-of-jar (engine NOT reached)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.click(2, 1, 1), // wcId 2 is 'work'
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
  assert.equal(engine.__calls.length, 0, 'engine op never called on refusal');
});

test('scopeEngine: jar wcId-op on a BURNER tab throws out-of-jar', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.readDom(3), // wcId 3 is a burner
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('scopeEngine: jar wcId-op on the INTERNAL tab throws internal-session (absolute)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.readDom(5), // wcId 5 is the internal session
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('scopeEngine: a tab whose label LIES in-jar but session is out is REFUSED (session authoritative)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  // 'work' identity, wcId 4 labels 'work' but its session is personal → refused.
  const scoped = scopeEngine(engine, 'work', makeCtx(world));
  assert.throws(
    () => scoped.navigate(4, 'https://x'),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
});

test('scopeEngine: every wcId-first op is membership-gated', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  for (const op of WCID_FIRST_OPS) {
    assert.throws(
      () => scoped[op](2), // wcId 2 is out-of-jar for 'personal'
      (err) => err instanceof Error && err.message.includes('automation: out-of-jar'),
      'op ' + op + ' must be membership-gated'
    );
  }
});

// ---------------------------------------------------------------------------
// captureWindow refusal (admin-only, DISTINCT from out-of-jar) + openTab delegate
// ---------------------------------------------------------------------------

test('scopeEngine: jar captureWindow throws admin-only (NOT out-of-jar)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.captureWindow(),
    (err) => err instanceof Error
      && err.message.includes('automation: admin-only')
      && !err.message.includes('out-of-jar')
  );
  assert.equal(engine.__calls.length, 0, 'captureWindow never reaches the engine for a jar key');
});

test('scopeEngine: jar openTab is delegated to the engine (known v1 limitation: no jar targeting)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  const res = scoped.openTab('https://new');
  assert.deepEqual(res, { openedFor: 'https://new' });
  assert.deepEqual(engine.__calls, [['openTab', 'https://new']]);
});

// ---------------------------------------------------------------------------
// unknown / revoked / deleted jar → all ops error
// ---------------------------------------------------------------------------

test('scopeEngine: an UNKNOWN jar identity makes every op error (no-such-jar)', async () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'ghost', makeCtx(world));

  await assert.rejects(
    async () => scoped.enumerateTabs(),
    (err) => err instanceof Error && err.message.includes('automation: no-such-jar')
  );
  for (const op of WCID_FIRST_OPS) {
    assert.throws(
      () => scoped[op](1),
      (err) => err instanceof Error && err.message.includes('automation: no-such-jar'),
      'op ' + op + ' must error for an unknown jar'
    );
  }
  assert.throws(() => scoped.openTab('https://x'), /no-such-jar/);
  assert.throws(() => scoped.captureWindow(), /no-such-jar/);
});

test('scopeEngine: a jar DELETED mid-session degrades to all-ops-error', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  // A mutable jars list we can shrink mid-session.
  let live = [...JARS];
  const ctx = {
    jars: { list: () => live },
    fromId: world.fromId,
    fromPartition: world.fromPartition,
    getChromeContents: () => ({ id: 0 }),
  };
  const scoped = scopeEngine(engine, 'personal', ctx);
  // Works while present:
  assert.deepEqual(scoped.navigate(1, 'https://x'), { op: 'navigate', wcId: 1 });
  // Delete the jar mid-session:
  live = live.filter((j) => j.id !== 'personal');
  assert.throws(() => scoped.navigate(1, 'https://x'), /no-such-jar/);
});
