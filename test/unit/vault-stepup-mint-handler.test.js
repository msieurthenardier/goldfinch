'use strict';

// Integration tests for the dedicated `menu-overlay:vault-stepup-mint` secret handler (M12
// Flight 3 Leg 5 access-keys, DD5), driven with a fake ipcMain event + a fake
// vaultMintAccessKey delegate. Mirrors the vault-setup handler suite: verifies the Buffer
// hand-off + BOTH-array DUAL-zeroization, the { ok } result, the sheet-close on success, the
// sender / token discipline — plus the Leg-5 parts: it forwards the NON-SECRET target to the
// delegate, drives chrome to open vault-accesskey-show with the minted { secret, keyId } ONLY
// (never in the invoke reply), and a WRONG step-up password → { ok:false } mints NOTHING and
// opens no accesskey-show (the vaultUnlock pattern — VaultAuthError mapped to { ok:false }).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const vaultStoreModule = require('../../src/main/vault/vault-store');

function makeIpc() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    on(channel, fn) {
      listeners.set(channel, fn);
    },
    handle(channel, fn) {
      handlers.set(channel, fn);
    }
  };
}

// Build a harness: the registered handler + a fake vaultMintAccessKey delegate that records
// the Buffer + target it received (bytes snapshotted before the handler's finally zeroizes).
function makeHarness({ mintResult, mintThrows } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1 };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-stepup' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token])
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  const chrome = { send: (channel, payload) => chromeSends.push([channel, payload]) };

  const captured = { buffer: null, isBuffer: null, bytes: null, target: undefined, called: 0 };
  // The main.js delegate maps VaultAuthError → { ok:false } (the vaultUnlock pattern); the
  // fake reproduces that contract: a wrong password resolves { ok:false }, never throwing.
  const vaultMintAccessKey = async (buf, target) => {
    captured.called += 1;
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8'); // snapshot before zeroize
    captured.target = target;
    if (mintThrows) throw mintThrows;
    return mintResult || { ok: true, secret: 'ACCESS-SECRET-1234', keyId: 'KEYID-9' };
  };

  registerOverlayIpc({
    ipcMain,
    registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultMintAccessKey
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-stepup-mint');
  return { handler, sheetSender, closeCalls, chromeSends, captured };
}

test('the mint handler is GATED on the vaultMintAccessKey injection (offline overlay tests omit it)', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined
    // no vaultMintAccessKey
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-stepup-mint'), false);
});

test('valid step-up → { ok:true }; Buffer + target hand-off; BOTH arrays zeroed; sheet closed; accesskey-show opened with secret+keyId ONLY', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, target: 'work' });

  // The invoke reply carries { ok } ONLY — never the minted secret.
  assert.deepEqual(res, { ok: true });
  assert.equal(captured.isBuffer, true, 'mint received a Buffer, not a Uint8Array');
  assert.equal(captured.bytes, 'hunter2hunter2');
  assert.equal(captured.target, 'work', 'the NON-SECRET target is forwarded to the delegate');
  // DUAL-zeroize: both the copied Buffer AND the incoming Uint8Array are cleared.
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized in finally'
  );
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized in finally'
  );
  // Sheet closed 'activated'; chrome told to open accesskey-show with the minted secret+keyId.
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.equal(chromeSends.length, 1);
  assert.equal(chromeSends[0][0], 'vault-accesskey-show');
  assert.deepEqual(chromeSends[0][1], { secret: 'ACCESS-SECRET-1234', keyId: 'KEYID-9' });
});

test('WRONG step-up password → { ok:false }: NOTHING minted-shown (no accesskey-show, sheet not closed); both arrays still zeroed', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({ mintResult: { ok: false } });
  const secret = new TextEncoder().encode('wrongpassword');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, target: 'work' });

  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 1, 'the delegate was invoked (the wrong password is judged in main)');
  assert.deepEqual(chromeSends, [], 'no accesskey-show on a refused mint');
  assert.deepEqual(closeCalls, [], 'the sheet stays open to re-prompt');
  // Dual-zeroize still runs on the { ok:false } path.
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized on refusal'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized on refusal'
  );
});

test('a delegate THROW (non-auth error) rejects the invoke but still zeroizes both arrays; no accesskey-show', async () => {
  const err = new Error('vault-store: no vault for "work"');
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({ mintThrows: err });
  const secret = new TextEncoder().encode('hunter2hunter2');

  await assert.rejects(handler({ sender: sheetSender }, { token: 7, secret, target: 'work' }), /no vault for/);

  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized even on throw'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized even on throw'
  );
  assert.deepEqual(closeCalls, [], 'sheet not closed on failure');
  assert.deepEqual(chromeSends, [], 'no accesskey-show on failure');
});

test('wrong sender → { ok:false }, mint never called', async () => {
  const { handler, captured, chromeSends } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');
  const res = await handler(
    { sender: { isDestroyed: () => false } /* not the sheet */ },
    { token: 7, secret, target: 'work' }
  );
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'mint never called for a foreign sender');
  assert.deepEqual(chromeSends, []);
});

test('stale token → { ok:false }, mint never called', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, secret, target: 'work' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'mint never called on a stale token');
});

test('a non-Uint8Array secret → { ok:false }', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const res = await handler({ sender: sheetSender }, { token: 7, secret: 'hunter2' /* string */, target: 'work' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0);
});

// ---------------------------------------------------------------------------
// REAL-STORE flow shape (M18 F2 grounding anomaly, 2026-09-01)
// ---------------------------------------------------------------------------
// The harness above stubs vaultMintAccessKey with a FAKE that only ever models
// { ok:false } (a mapped VaultAuthError) or a caller-chosen throw — which is
// exactly why this suite stayed green while the live app showed "Wrong master
// password" to an operator typing the CORRECT password. The real failure class
// was never modeled: on a fresh profile a jar's `.gfvault` file does not exist
// until the first credential is saved into that jar (lazy creation), so the
// REAL delegate chain (main.js vaultMintAccessKey → store.mintAccessKey) gets
// past the step-up unwrap (the password IS correct) and then throws
// VaultStateError('no vault for "<jar>" — save an item first'). That is a
// REJECTED invoke, not { ok:false } — and menu-overlay.js's submitVaultStepup
// catch collapses EVERY rejection into the same 'Wrong master password.
// Nothing was minted.' copy. Pre-existing M12 F3 Leg 5 behavior (reproduced
// byte-identical at the pre-flight commit), surfaced by the operator's fresh
// dev profile — logged for a squawk, NOT fixed in this flight.
//
// These tests drive the REAL registered handler + the main.js delegate shape
// (verbatim: VaultAuthError → { ok:false }, everything else propagates) over a
// REAL VaultStore, pinning all three real-flow outcomes so the auth/state
// discrimination cannot regress silently again.

// Memory-cheap scrypt for fast round-trips (the vault-store.test.js idiom).
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

async function makeRealStoreHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mint-real-'));
  const store = vaultStoreModule.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => [{ id: 'work' }, { id: 'personal' }]
  });
  await store.setup({ masterPassword: MASTER });

  // The main.js delegate, verbatim shape: ONLY VaultAuthError maps to
  // { ok:false }; every other failure class (VaultStateError included)
  // propagates and REJECTS the invoke.
  const vaultMintAccessKey = async (buf, target) => {
    try {
      const { secret, keyId } = await store.mintAccessKey(target, { masterPassword: buf });
      return { ok: true, secret, keyId };
    } catch (e) {
      if (e instanceof vaultStoreModule.VaultAuthError) return { ok: false };
      throw e;
    }
  };

  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1 };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    // The REAL open shape: the chrome opens menuType 'vault-stepup' (mint mode)
    // for the page's mint request — pinned here so a future menuType predicate
    // on this channel must admit it.
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-stepup' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token])
  };
  const rec = { sheet, win };
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [rec], getWindowForChrome: () => null },
    chromeForAttachment: (w) =>
      w === win ? { send: (channel, payload) => chromeSends.push([channel, payload]) } : null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    vaultMintAccessKey
  });
  return {
    dir,
    store,
    handler: ipcMain.handlers.get('menu-overlay:vault-stepup-mint'),
    sheetSender,
    closeCalls,
    chromeSends
  };
}

test('REAL store: jar WITH a vault file — correct password mints { ok:true } (the M18 F2 gated wrapper + version threading are sound)', async () => {
  const h = await makeRealStoreHarness();
  try {
    // First credential save lazily creates work.gfvault — the state the mint UI assumes.
    h.store.saveItem('work', { type: 'login', title: 'x', origin: 'https://x.test', username: 'u', password: 'p' });
    const res = await h.handler(
      { sender: h.sheetSender },
      { token: 7, secret: new TextEncoder().encode(MASTER), target: 'work' }
    );
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(h.closeCalls, [['activated', 7]]);
    assert.equal(h.chromeSends.length, 1);
    assert.equal(h.chromeSends[0][0], 'vault-accesskey-show');
    assert.equal(typeof h.chromeSends[0][1].secret, 'string');
    assert.equal(typeof h.chromeSends[0][1].keyId, 'string');
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('REAL store: jar with NO vault file (fresh profile) — a CORRECT password REJECTS with VaultStateError, which the sheet renders as the wrong-password copy (grounding anomaly 2026-09-01; pre-existing, squawked)', async () => {
  const h = await makeRealStoreHarness();
  try {
    // No item ever saved into 'personal' → no personal.gfvault (lazy creation).
    // The operator's exact live state: setUp, unlocked, jar listed, count 0.
    await assert.rejects(
      h.handler({ sender: h.sheetSender }, { token: 7, secret: new TextEncoder().encode(MASTER), target: 'personal' }),
      (err) => {
        // The password was CORRECT — the step-up unwrap succeeded — yet the op
        // fails with a non-auth STATE error. menu-overlay.js's submitVaultStepup
        // catch turns this rejection into { ok:false } and shows 'Wrong master
        // password. Nothing was minted.' — the misleading copy the operator saw.
        assert.equal(err instanceof vaultStoreModule.VaultStateError, true);
        assert.match(err.message, /no vault for "personal"/);
        assert.match(err.message, /save an item first/);
        return true;
      }
    );
    assert.deepEqual(h.closeCalls, [], 'sheet not closed — it re-prompts with the (wrong) copy');
    assert.deepEqual(h.chromeSends, [], 'nothing minted, no accesskey-show');
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('REAL store: a genuinely WRONG password → { ok:false } (VaultAuthError mapped) — indistinguishable sheet-side from the no-vault rejection above', async () => {
  const h = await makeRealStoreHarness();
  try {
    h.store.saveItem('work', { type: 'login', title: 'x', origin: 'https://x.test', username: 'u', password: 'p' });
    const res = await h.handler(
      { sender: h.sheetSender },
      { token: 7, secret: new TextEncoder().encode('not the master password'), target: 'work' }
    );
    assert.deepEqual(res, { ok: false });
    assert.deepEqual(h.closeCalls, []);
    assert.deepEqual(h.chromeSends, []);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});
