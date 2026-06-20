'use strict';

// Unit tests for src/main/automation/scope.js — the jar-scoping façade (Leg 2,
// DD4/DD6/DD7). Electron-free: a fake engine + a partition→session map (with REAL
// object identity) + a fake jars registry stand in for the live runtime, so the
// membership compare (wc.session === fromPartition(jar.partition)) is authentic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scopeEngine, WCID_FIRST_OPS } = require('../../src/main/automation/scope');
const { buildToolRegistry } = require('../../src/main/automation/mcp-tools');

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
  engine.openTab = (url, jarId) => { calls.push(['openTab', url, jarId]); return { openedFor: url }; };
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

test('scopeEngine: jar getZoom/setZoom/printToPDF on an IN-JAR tab reach the engine (Flight-1 parity)', async () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  // wcId 1 is in-jar for 'personal'. printToPDF is async in the live engine; the
  // generic wrapper forwards the engine return untouched — await is harmless on the
  // synchronous fake stub and required by the real op.
  scoped.getZoom(1);
  scoped.setZoom(1, 1.5);
  await scoped.printToPDF(1);
  assert.deepEqual(engine.__calls, [
    ['getZoom', 1],
    ['setZoom', 1, 1.5],
    ['printToPDF', 1],
  ]);
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
// THREE-PLACE-REGISTRATION GUARD (leg-05 / SC8 gap).
//
// A new guest-targeting (wcId-first) automation op must be registered in THREE
// places: engine.js (dispatch), mcp-tools.js (ToolDef), and scope.js
// (WCID_FIRST_OPS). This flight, getZoom/setZoom/printToPDF were added to the MCP
// tool list but NOT to WCID_FIRST_OPS — so jar keys hit the generic Proxy/getter
// path and threw "engine.getZoom is not a function" (SC8). The existing
// 'every wcId-first op is membership-gated' test only ITERATES WCID_FIRST_OPS, so
// a MISSING op is invisible to it. This test closes that hole NON-CIRCULARLY by
// deriving the wcId-first set from the AUTHORITATIVE tool registry and asserting
// each such tool is present in WCID_FIRST_OPS.
// ---------------------------------------------------------------------------

test('scopeEngine: every wcId-first MCP tool is registered in WCID_FIRST_OPS (three-place-registration guard)', () => {
  // listTools() returns the STATIC tool defs — no live engine needed.
  const reg = buildToolRegistry(() => ({}));

  // A tool is "wcId-first" when its inputSchema has a required `wcId` property.
  // Tool names map 1:1 to engine op names (asserted by the mcp-tools discovery
  // test), and WCID_FIRST_OPS holds engine op names, so name-matching is valid.
  const wcIdFirst = reg.listTools()
    .filter((t) => {
      const s = t.inputSchema || {};
      const req = s.required || [];
      return s.properties && s.properties.wcId && req.includes('wcId');
    })
    .map((t) => t.name);

  // Tools that legitimately take `wcId` but are intentionally NOT jar-scoped
  // (admin-only). EMPTY today — every wcId-first op is jar-reachable on its own
  // tabs. A future admin-only wcId-first op would be added here WITH a documented
  // reason, e.g. `WCID_FIRST_EXEMPT.add('someAdminOnlyOp'); // reason: …`.
  const WCID_FIRST_EXEMPT = new Set([]);

  const gated = new Set(WCID_FIRST_OPS);
  const missing = wcIdFirst.filter((n) => !gated.has(n) && !WCID_FIRST_EXEMPT.has(n));
  assert.deepEqual(
    missing,
    [],
    'wcId-first MCP tool(s) missing from scope.js WCID_FIRST_OPS — jar keys would throw "engine.<op> is not a function": ' +
      missing.join(', ') +
      '. Add them to WCID_FIRST_OPS (or to WCID_FIRST_EXEMPT with a reason if intentionally admin-only).'
  );
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

test('scopeEngine: jar openTab (no jarId) forces the caller\'s own jar.id to the engine', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  const res = scoped.openTab('https://new');
  assert.deepEqual(res, { openedFor: 'https://new' });
  // The façade forces jar.id='personal'; engine receives (url, 'personal')
  assert.deepEqual(engine.__calls, [['openTab', 'https://new', 'personal']]);
});

test('scopeEngine: jar openTab(url, ownId) is allowed — engine gets own jar.id', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  const res = scoped.openTab('https://new', 'personal');
  assert.deepEqual(res, { openedFor: 'https://new' });
  assert.deepEqual(engine.__calls, [['openTab', 'https://new', 'personal']]);
});

test('scopeEngine: jar openTab(url, foreignId) throws out-of-jar, engine NOT reached', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.openTab('https://new', 'work'),
    (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
  );
  assert.equal(engine.__calls.length, 0, 'engine must NOT be reached on out-of-jar refusal');
});

test('scopeEngine: admin openTab passes jarId straight through to the engine unchanged', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world, { includeInternal: true });
  // admin returns the engine unchanged
  const scoped = scopeEngine(engine, 'admin', makeCtx(world));
  assert.equal(scoped, engine, 'admin must return the engine as-is');
  // Calling it confirms the raw engine records the args as-is
  engine.openTab('https://admin', 'work');
  assert.deepEqual(engine.__calls, [['openTab', 'https://admin', 'work']]);
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

// ---------------------------------------------------------------------------
// getChromeTarget refusal (admin-only, DISTINCT from out-of-jar)
// ---------------------------------------------------------------------------

test('scopeEngine: jar getChromeTarget throws admin-only (NOT out-of-jar), engine NOT reached', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  engine.getChromeTarget = () => { engine.__calls.push(['getChromeTarget']); return { wcId: 0, kind: 'chrome', url: '' }; };
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.getChromeTarget(),
    (err) => err instanceof Error
      && err.message.includes('automation: admin-only')
      && !err.message.includes('out-of-jar')
  );
  // engine.__calls should NOT include getChromeTarget — the façade refused before reaching engine
  assert.equal(engine.__calls.filter((c) => c[0] === 'getChromeTarget').length, 0,
    'getChromeTarget must never reach the engine for a jar key');
});

test('scopeEngine: admin getChromeTarget reaches the engine and returns its value', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world, { includeInternal: true });
  const target = { wcId: 1, kind: 'chrome', url: 'goldfinch://app' };
  engine.getChromeTarget = () => target;
  // admin → engine unchanged
  const scoped = scopeEngine(engine, 'admin', makeCtx(world));
  assert.equal(scoped, engine, 'admin must return the engine unchanged');
  assert.equal(scoped.getChromeTarget(), target);
});

test('scopeEngine: unknown jar calling getChromeTarget throws no-such-jar (requireJar fires first)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  engine.getChromeTarget = () => { throw new Error('should not reach engine'); };
  const scoped = scopeEngine(engine, 'ghost', makeCtx(world));
  assert.throws(
    () => scoped.getChromeTarget(),
    (err) => err instanceof Error && err.message.includes('automation: no-such-jar')
  );
});

// ---------------------------------------------------------------------------
// downloadsList refusal (admin-only, app-level — outside WCID_FIRST_OPS; the
// three-place guard does NOT cover app-level ops, so this dedicated test is required)
// ---------------------------------------------------------------------------

test('scopeEngine: jar getDownloadsList throws admin-only — downloadsList (NOT out-of-jar), engine NOT reached', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  engine.getDownloadsList = () => { engine.__calls.push(['getDownloadsList']); return []; };
  const scoped = scopeEngine(engine, 'personal', makeCtx(world));
  assert.throws(
    () => scoped.getDownloadsList(),
    (err) => err instanceof Error
      && /admin-only — downloadsList/.test(err.message)
      && !err.message.includes('out-of-jar')
  );
  assert.equal(engine.__calls.filter((c) => c[0] === 'getDownloadsList').length, 0,
    'getDownloadsList must never reach the engine for a jar key');
});

test('scopeEngine: admin getDownloadsList reaches the engine and returns its value (pass-through)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world, { includeInternal: true });
  const records = [{ id: 1, filename: 'a.zip', state: 'completed' }];
  engine.getDownloadsList = () => records;
  // admin → engine unchanged
  const scoped = scopeEngine(engine, 'admin', makeCtx(world));
  assert.equal(scoped, engine, 'admin must return the engine unchanged');
  assert.equal(scoped.getDownloadsList(), records);
});

test('scopeEngine: unknown jar calling getDownloadsList throws no-such-jar (requireJar fires first)', () => {
  const world = makeWorld();
  const engine = makeFakeEngine(world);
  engine.getDownloadsList = () => { throw new Error('should not reach engine'); };
  const scoped = scopeEngine(engine, 'ghost', makeCtx(world));
  assert.throws(
    () => scoped.getDownloadsList(),
    (err) => err instanceof Error && err.message.includes('automation: no-such-jar')
  );
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
