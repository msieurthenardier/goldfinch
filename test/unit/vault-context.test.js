'use strict';

// Unit tests for src/main/vault/vault-context.js — the per-session, fill-only
// vault dispatch (Mission 12, Flight 1, Leg 3).
//
// Electron-free + SDK-light: the vault context is exercised against REAL
// `.gfvault` fixtures (built via the vault-store API in a temp dir) plus fakes
// for the browser world (fromId/fromPartition with getURL) and the fill delegate.
// scrypt runs at FAST params so the setup/mint derivations stay quick. Every leg
// acceptance criterion is covered: two-session isolation, jar-can't-reach-global/
// sibling, admin-reaches-all, metadata-only list, totp-code-only, fill-delegate-
// gets-credential + result-no-password, out-of-jar throw, origin-mismatch no-fill,
// audit-detail-no-secret (both key types), onclose zeroize + re-unlock,
// no-singleton-coupling both directions, and the idle auto-lock backstop.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');
const { createVaultContext } = require('../../src/main/vault/vault-context');
const { deriveAuditDetail } = require('../../src/main/automation/mcp-server');

// Memory-cheap scrypt for fast round-trips (production params live in vault-crypto's suite).
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
// Jars carry `partition` (scope.js membership needs it); vault-store reads only `id`.
const JARS = [
  { id: 'work', partition: 'persist:container:work' },
  { id: 'personal', partition: 'persist:container:personal' },
];
// A well-known base32 TOTP secret (bare secret → parseOtpauth defaults SHA1/6/30).
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vaultctx-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
  });
}

// Build a real vault fixture: global + work + personal, each with a login item,
// plus a per-jar access key for work + personal. Leaves the SETUP store locked so
// the vault-context path is proven against a human-locked store.
async function buildFixture() {
  const dir = tmpDir();
  const setup = makeStore(dir);
  const { adminPrivateKeyB64 } = await setup.setup({ masterPassword: MASTER });
  setup.saveItem('global', { id: 'g1', type: 'login', title: 'Global', origin: 'https://global.example', username: 'guser', password: 'gpass' });
  setup.saveItem('work', { id: 'w1', type: 'login', title: 'Work', origin: 'https://work.example', username: 'wuser', password: 'wpass', totp: TOTP_SECRET });
  setup.saveItem('personal', { id: 'p1', type: 'login', title: 'Personal', origin: 'https://personal.example', username: 'puser', password: 'ppass' });
  const work = await setup.mintAccessKey('work', { masterPassword: MASTER });
  const personal = await setup.mintAccessKey('personal', { masterPassword: MASTER });
  setup.lockNow(); // human store locked — the automation path is stateless.
  return { dir, adminPrivateKeyB64, workSecret: work.secret, personalSecret: personal.secret, setup };
}

// A fake browser world: sessions interned by partition (REAL object identity), a
// fromId returning a wc with { session, getURL }, and fromPartition.
function makeWorld() {
  const sessions = new Map();
  const sessionFor = (p) => {
    if (!sessions.has(p)) sessions.set(p, { __partition: p, __goldfinchInternal: p === 'goldfinch-internal' });
    return sessions.get(p);
  };
  const tabs = [
    { wcId: 10, partition: 'persist:container:work', url: 'https://work.example/login' },
    { wcId: 20, partition: 'persist:container:personal', url: 'https://personal.example/login' },
    { wcId: 30, partition: 'persist:container:work', url: 'https://evil.example/phish' }, // work session, WRONG origin
  ];
  const byWcId = new Map(tabs.map((t) => [t.wcId, t]));
  const fromId = (wcId) => {
    const t = byWcId.get(wcId);
    if (!t) return null;
    return { id: wcId, session: sessionFor(t.partition), getURL: () => t.url, isDestroyed() { return false; } };
  };
  return { fromId, fromPartition: sessionFor };
}

function fillDeps(world) {
  return {
    jars: { list: () => JARS },
    fromId: world.fromId,
    fromPartition: world.fromPartition,
    getChromeContents: () => ({ id: 0 }),
  };
}

function makeFill() {
  const calls = [];
  return { fn: (arg) => { calls.push(arg); }, calls };
}

// A manual timer harness for the idle-lock backstop.
function fakeTimers() {
  let armed = null;
  return {
    setTimeout: (fn, ms) => { armed = { fn, ms }; return { unref() {} }; },
    clearTimeout: () => { armed = null; },
    fire() { const a = armed; armed = null; if (a) a.fn(); },
    get armed() { return armed; },
  };
}

// ---------------------------------------------------------------------------
// Cryptographic scope — jar reaches only its own vault; admin reaches all.
// ---------------------------------------------------------------------------

test('jar session with its per-jar access key reaches ONLY its own vault (cannot see global or a sibling)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    const res = ctx.unlock('work', fx.workSecret);
    assert.deepEqual(res.unlocked, ['work'], 'a jar access key opens exactly its own vault');
    const rows = ctx.list();
    assert.deepEqual(rows.map((r) => r.id).sort(), ['w1'], 'only the work item is visible');
    assert.deepEqual([...new Set(rows.map((r) => r.vaultId))], ['work']);
    // totp of a sibling/global item is not reachable → code null.
    assert.deepEqual(ctx.totp('p1'), { id: 'p1', code: null });
    assert.deepEqual(ctx.totp('g1'), { id: 'g1', code: null });
  } finally {
    rm(fx.dir);
  }
});

test('admin session with the admin private key reaches EVERY vault (seal-to-all)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    const res = ctx.unlock('admin', fx.adminPrivateKeyB64);
    assert.deepEqual(res.unlocked.slice().sort(), ['global', 'personal', 'work']);
    const rows = ctx.list();
    assert.deepEqual(rows.map((r) => r.id).sort(), ['g1', 'p1', 'w1']);
  } finally {
    rm(fx.dir);
  }
});

test('a wrong/foreign access key unlocks NOTHING — a normal { unlocked: [] } result, not a throw', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    // wrong jar secret
    assert.deepEqual(ctx.unlock('work', 'not-the-secret'), { unlocked: [] });
    assert.deepEqual(ctx.list(), []);
    // the personal secret presented on a work session opens nothing (structural).
    assert.deepEqual(ctx.unlock('work', fx.personalSecret), { unlocked: [] });
    assert.deepEqual(ctx.list(), []);
    // a bad admin private key opens nothing (no throw).
    assert.deepEqual(ctx.unlock('admin', 'bm90LWEta2V5'), { unlocked: [] });
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// vaultList metadata-only; vaultTotp code-only.
// ---------------------------------------------------------------------------

test('vaultList is metadata-only — origin/username/hasTotp/vaultId/id/title, NEVER a password or TOTP secret', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    ctx.unlock('admin', fx.adminPrivateKeyB64);
    const rows = ctx.list();
    const work = rows.find((r) => r.id === 'w1');
    assert.deepEqual(Object.keys(work).sort(), ['hasTotp', 'id', 'origin', 'title', 'username', 'vaultId']);
    assert.equal(work.origin, 'https://work.example');
    assert.equal(work.username, 'wuser');
    assert.equal(work.hasTotp, true);
    assert.equal(rows.find((r) => r.id === 'g1').hasTotp, false);
    // No secret material anywhere in the serialized list.
    const blob = JSON.stringify(rows);
    for (const secret of ['wpass', 'gpass', 'ppass', TOTP_SECRET]) {
      assert.equal(blob.includes(secret), false, 'list must not leak ' + secret);
    }
  } finally {
    rm(fx.dir);
  }
});

test('vaultTotp returns ONLY the current code for a named unlocked TOTP item (no secret)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const T = 1_700_000_000_000;
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn, now: () => T });
    ctx.unlock('work', fx.workSecret);
    const params = vc.parseOtpauth(TOTP_SECRET);
    const expected = vc.totp(params.secret, params, T);
    assert.deepEqual(ctx.totp('w1'), { id: 'w1', code: expected });
    assert.match(expected, /^\d{6}$/);
    // an item with no TOTP → code null; the secret never appears.
    ctx.zeroize();
    ctx.unlock('admin', fx.adminPrivateKeyB64);
    assert.deepEqual(ctx.totp('g1'), { id: 'g1', code: null });
    assert.equal(JSON.stringify(ctx.totp('w1')).includes(TOTP_SECRET), false);
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// vaultFill wire behavior — delegate gets the credential; result carries none.
// ---------------------------------------------------------------------------

test('vaultFill hands the credential to the fill delegate and returns NO password', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const fill = makeFill();
    const world = makeWorld();
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: fill.fn });
    ctx.unlock('work', fx.workSecret);
    const res = ctx.fill('work', { wcId: 10, itemId: 'w1' }, fillDeps(world)); // work tab, matching origin
    assert.deepEqual(res, { filled: true, id: 'w1' });
    assert.equal(fill.calls.length, 1);
    assert.equal(fill.calls[0].wcId, 10);
    assert.deepEqual(fill.calls[0].credential, { username: 'wuser', password: 'wpass' });
    // The TOOL RESULT must carry no secret.
    const blob = JSON.stringify(res);
    assert.equal(blob.includes('wpass'), false);
    assert.equal(blob.includes('wuser'), false);
  } finally {
    rm(fx.dir);
  }
});

test('vaultFill on a FOREIGN/sibling tab THROWS automation: out-of-jar (delegate not called)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const fill = makeFill();
    const world = makeWorld();
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: fill.fn });
    ctx.unlock('work', fx.workSecret);
    assert.throws(
      () => ctx.fill('work', { wcId: 20, itemId: 'w1' }, fillDeps(world)), // wcId 20 is the personal tab
      (err) => err instanceof Error && err.message.includes('automation: out-of-jar')
    );
    assert.equal(fill.calls.length, 0, 'delegate never called on an out-of-jar refusal');
  } finally {
    rm(fx.dir);
  }
});

test('vaultFill on an origin-MISMATCHED tab is a normal { filled: false } (delegate not called)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const fill = makeFill();
    const world = makeWorld();
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: fill.fn });
    ctx.unlock('work', fx.workSecret);
    // wcId 30 is an in-jar (work-session) tab, but its origin is evil.example ≠ the item's origin.
    const res = ctx.fill('work', { wcId: 30, itemId: 'w1' }, fillDeps(world));
    assert.equal(res.filled, false);
    assert.equal(res.reason, 'origin-mismatch');
    assert.equal(fill.calls.length, 0, 'origin mismatch never reaches the delegate');
  } finally {
    rm(fx.dir);
  }
});

test('vaultFill with no matching item id → normal { filled: false, reason: "no-match" }', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const fill = makeFill();
    const world = makeWorld();
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: fill.fn });
    ctx.unlock('work', fx.workSecret);
    const res = ctx.fill('work', { wcId: 10, itemId: 'no-such' }, fillDeps(world));
    assert.deepEqual(res, { filled: false, reason: 'no-match' });
    assert.equal(fill.calls.length, 0);
  } finally {
    rm(fx.dir);
  }
});

test('list/totp/fill BEFORE unlock are normal empty/locked results (empty ctx)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const fill = makeFill();
    const world = makeWorld();
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: fill.fn });
    assert.deepEqual(ctx.list(), []);
    assert.deepEqual(ctx.totp('w1'), { id: 'w1', code: null });
    assert.deepEqual(ctx.fill('work', { wcId: 10, itemId: 'w1' }, fillDeps(world)), { filled: false, reason: 'locked' });
    assert.equal(fill.calls.length, 0);
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// Two-session isolation — independent Buffers; one teardown never breaks the other.
// ---------------------------------------------------------------------------

test('two sessions unlocking the SAME vault hold independent contexts — zeroizing one never empties the other', async () => {
  const fx = await buildFixture();
  try {
    const storeA = makeStore(fx.dir);
    const storeB = makeStore(fx.dir);
    const ctxA = createVaultContext({ vaultStore: storeA, fillDelegate: makeFill().fn });
    const ctxB = createVaultContext({ vaultStore: storeB, fillDelegate: makeFill().fn });
    ctxA.unlock('work', fx.workSecret);
    ctxB.unlock('work', fx.workSecret);
    assert.deepEqual(ctxA.list().map((r) => r.id), ['w1']);
    assert.deepEqual(ctxB.list().map((r) => r.id), ['w1']);
    // Tear down A — B must keep working (its own fresh-buffer copy).
    ctxA.zeroize();
    assert.deepEqual(ctxA.list(), [], 'A is empty after zeroize');
    assert.deepEqual(ctxB.list().map((r) => r.id), ['w1'], 'B still holds its own key');
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// Session-scoped zeroization (onclose) + re-unlock required.
// ---------------------------------------------------------------------------

test('zeroize (transport.onclose) clears the session — a fresh vaultUnlock is required before list returns anything', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    ctx.unlock('work', fx.workSecret);
    assert.equal(ctx.list().length, 1);
    ctx.zeroize(); // what transport.onclose calls
    assert.deepEqual(ctx.list(), [], 'nothing unlocked after zeroize');
    // Re-unlock restores the session.
    ctx.unlock('work', fx.workSecret);
    assert.deepEqual(ctx.list().map((r) => r.id), ['w1']);
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// No singleton coupling — both directions.
// ---------------------------------------------------------------------------

test('no singleton coupling: an MCP unlock NEVER changes the vault-store human lock state', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    assert.equal(store.isUnlocked(), false, 'the human store starts locked');
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    ctx.unlock('work', fx.workSecret);
    assert.equal(store.isUnlocked(), false, 'a jar automation unlock leaves the human store locked');
    ctx.zeroize();
    ctx.unlock('admin', fx.adminPrivateKeyB64);
    assert.equal(store.isUnlocked(), false, 'an admin automation unlock leaves the human store locked (openAllWithAdminKey never installs the MRK)');
  } finally {
    rm(fx.dir);
  }
});

test('no singleton coupling: vault-store.lockNow() NEVER empties a live MCP session (fresh-buffer copies)', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: makeFill().fn });
    ctx.unlock('work', fx.workSecret);
    store.lockNow(); // a concurrent human "Lock now"
    assert.deepEqual(ctx.list().map((r) => r.id), ['w1'], 'the MCP session keeps working after a human lock');
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// openAllWithAdminKey — no-singleton-mutation, fresh buffers.
// ---------------------------------------------------------------------------

test('openAllWithAdminKey opens every vault into FRESH buffers with NO singleton mutation', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const map = store.openAllWithAdminKey(fx.adminPrivateKeyB64);
    assert.deepEqual([...map.keys()].sort(), ['global', 'personal', 'work']);
    for (const buf of map.values()) assert.ok(Buffer.isBuffer(buf) && buf.length === 32);
    // No singleton mutation: the store stays locked and its human key cache is empty.
    assert.equal(store.isUnlocked(), false);
    assert.equal(store.mrk, null);
    assert.equal(store.vaultKeys.size, 0);
    // The returned buffers are usable to decrypt items (stateless read path).
    const items = store.readVaultItems('work', map.get('work'));
    assert.deepEqual(items.map((i) => i.id), ['w1']);
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// Per-session idle auto-lock (DD5 backstop) — fires + zeroizes.
// ---------------------------------------------------------------------------

test('the per-session idle timer zeroizes the ctx on fire; each vault op resets it', async () => {
  const fx = await buildFixture();
  try {
    const store = makeStore(fx.dir);
    const timers = fakeTimers();
    const ctx = createVaultContext({
      vaultStore: store,
      fillDelegate: makeFill().fn,
      getAutoLockMinutes: () => 5,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    ctx.unlock('work', fx.workSecret);
    assert.ok(timers.armed, 'unlock arms the idle timer');
    assert.equal(timers.armed.ms, 5 * 60 * 1000, 'duration comes from vaultAutoLockMinutes');
    // A vault op resets it (re-arms).
    ctx.list();
    assert.ok(timers.armed, 'a vault op re-arms the idle timer');
    // Fire it → the session is zeroized.
    timers.fire();
    assert.deepEqual(ctx.list(), [], 'the idle fire zeroized the session (locked until re-unlock)');
    assert.equal(timers.armed, null, 'no timer armed while locked');
  } finally {
    rm(fx.dir);
  }
});

// ---------------------------------------------------------------------------
// Audit detail carries NO secret — for BOTH accessKey types.
// ---------------------------------------------------------------------------

test('deriveAuditDetail NEVER emits a secret for vault ops (both accessKey types)', async () => {
  const fx = await buildFixture();
  try {
    // vaultUnlock: neither the per-jar access secret nor the admin private key appears.
    assert.equal(deriveAuditDetail('vaultUnlock', { accessKey: fx.workSecret }), null);
    assert.equal(deriveAuditDetail('vaultUnlock', { accessKey: fx.adminPrivateKeyB64 }), null);
    // vaultList: nothing.
    assert.equal(deriveAuditDetail('vaultList', {}), null);
    // vaultFill / vaultTotp: the item id only — never a credential.
    assert.equal(deriveAuditDetail('vaultFill', { wcId: 10, itemId: 'w1' }), 'item=w1');
    assert.equal(deriveAuditDetail('vaultTotp', { itemId: 'w1' }), 'item=w1');
    for (const op of ['vaultUnlock', 'vaultList', 'vaultTotp', 'vaultFill']) {
      const detail = deriveAuditDetail(op, { accessKey: fx.workSecret, adminKey: fx.adminPrivateKeyB64, itemId: 'w1', wcId: 10 });
      const s = String(detail);
      for (const secret of [fx.workSecret, fx.adminPrivateKeyB64, 'wpass', TOTP_SECRET]) {
        assert.equal(s.includes(secret), false, op + ' audit detail must not leak ' + secret);
      }
    }
  } finally {
    rm(fx.dir);
  }
});
