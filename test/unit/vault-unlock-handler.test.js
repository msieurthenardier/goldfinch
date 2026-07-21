'use strict';

// Integration tests for the dedicated `menu-overlay:vault-unlock` secret handler
// (M12 Flight 2 Leg 2 chrome-unlock, DD4/DD10), driven with a fake ipcMain event +
// a fake vault store. Verifies the Buffer hand-off + BOTH-array zeroization, the
// { ok } result, the broadcast + sheet-close on success only, and the sender /
// token discipline.
//
// The `vaultUnlock` delegate is built here the SAME way main.js builds it
// (getVaultStore().unlock wrapped so VaultAuthError → false, others rethrow) so the
// composed unlock→onUnlock→broadcast chain is exercised end-to-end.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const vs = require('../../src/main/vault/vault-store');

function makeIpc() {
  const listeners = new Map();
  const handlers = new Map();
  return {
    listeners,
    handlers,
    on(channel, fn) { listeners.set(channel, fn); },
    handle(channel, fn) { handlers.set(channel, fn); },
  };
}

// A fake vault store mirroring the _installMrk → onUnlock choke point: unlock
// compares the received Buffer's bytes to the correct password, fires onUnlock on
// success, and throws VaultAuthError on a mismatch (the real crypto contract).
function makeFakeStore(correctPw) {
  const broadcasts = [];
  const store = {
    unlocked: false,
    isSetUp: () => true,
    isUnlocked: () => store.unlocked,
    onUnlock: null,
    // captured for assertions:
    receivedBuffer: null,
    receivedIsBuffer: null,
    receivedBytes: null,
    async unlock(buf) {
      store.receivedBuffer = buf;
      store.receivedIsBuffer = Buffer.isBuffer(buf);
      store.receivedBytes = Buffer.from(buf).toString('utf8'); // snapshot before the handler zeroizes
      if (store.receivedBytes !== correctPw) throw new vs.VaultAuthError('wrong password');
      store.unlocked = true;
      try { store.onUnlock?.(); } catch { /* guarded, as in _installMrk */ }
    },
  };
  // Wire onUnlock the way main.js does: broadcast the lock-state projection.
  store.onUnlock = () => broadcasts.push({ setUp: store.isSetUp(), unlocked: store.isUnlocked() });
  store.broadcasts = broadcasts;
  return store;
}

// Build a harness: a registered handler + the fakes it validates against.
function makeHarness(store) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const sheetSender = { isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-unlock' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };

  // The main.js vaultUnlock delegate, verbatim in shape.
  const vaultUnlock = async (buf) => {
    try { await store.unlock(buf); return true; }
    catch (e) { if (e instanceof vs.VaultAuthError) return false; throw e; }
  };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultUnlock,
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-unlock');
  return { handler, sheetSender, closeCalls, store };
}

test('correct password → { ok:true }, Buffer hand-off + BOTH arrays zeroed, broadcast + sheet close', async () => {
  const store = makeFakeStore('hunter2');
  const { handler, sheetSender, closeCalls } = makeHarness(store);

  const secret = new TextEncoder().encode('hunter2'); // Uint8Array — the wire shape
  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: true });
  // unlock received a Buffer carrying the exact password bytes.
  assert.equal(store.receivedIsBuffer, true, 'unlock received a Buffer, not a Uint8Array');
  assert.equal(store.receivedBytes, 'hunter2');
  // BOTH the copied Buffer and the incoming Uint8Array are zeroed afterward.
  assert.ok(store.receivedBuffer.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  // Broadcast fired exactly once (unlocked) via onUnlock; sheet closed with 'activated'.
  assert.deepEqual(store.broadcasts, [{ setUp: true, unlocked: true }]);
  assert.deepEqual(closeCalls, [['activated', 7]]);
});

test('wrong password → { ok:false }, no broadcast, store stays locked, sheet NOT closed, array still zeroed', async () => {
  const store = makeFakeStore('hunter2');
  const { handler, sheetSender, closeCalls } = makeHarness(store);

  const secret = new TextEncoder().encode('nope');
  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: false });
  assert.equal(store.isUnlocked(), false, 'store stays locked on a wrong password');
  assert.deepEqual(store.broadcasts, [], 'no broadcast on a wrong password');
  assert.deepEqual(closeCalls, [], 'sheet stays open on a wrong password');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized even on failure');
  assert.ok(store.receivedBuffer.every((b) => b === 0), 'copied Buffer zeroized even on failure');
});

test('a non-auth throw still zeroizes BOTH arrays (finally runs), and the invoke rejects', async () => {
  const store = makeFakeStore('hunter2');
  // Replace unlock with a non-auth thrower; capture the buffer to assert zeroization.
  store.unlock = async (buf) => { store.receivedBuffer = buf; throw new Error('disk exploded'); };
  const { handler, sheetSender, closeCalls } = makeHarness(store);

  const secret = new TextEncoder().encode('hunter2');
  await assert.rejects(handler({ sender: sheetSender }, { token: 7, secret }), /disk exploded/);

  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized on a non-auth throw');
  assert.ok(store.receivedBuffer.every((b) => b === 0), 'copied Buffer zeroized on a non-auth throw');
  assert.deepEqual(store.broadcasts, []);
  assert.deepEqual(closeCalls, []);
});

test('wrong sender is rejected → { ok:false }, unlock never called', async () => {
  const store = makeFakeStore('hunter2');
  const { handler } = makeHarness(store);

  const secret = new TextEncoder().encode('hunter2');
  const res = await handler({ sender: { isDestroyed: () => false } /* not the sheet */ }, { token: 7, secret });

  assert.deepEqual(res, { ok: false });
  assert.equal(store.receivedBuffer, null, 'unlock never called for a foreign sender');
  assert.equal(store.isUnlocked(), false);
});

test('stale token is rejected → { ok:false }, unlock never called', async () => {
  const store = makeFakeStore('hunter2');
  const { handler, sheetSender } = makeHarness(store);

  const secret = new TextEncoder().encode('hunter2');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, secret });

  assert.deepEqual(res, { ok: false });
  assert.equal(store.receivedBuffer, null, 'unlock never called on a stale token');
  assert.equal(store.isUnlocked(), false);
});

test('a non-Uint8Array secret is rejected → { ok:false }', async () => {
  const store = makeFakeStore('hunter2');
  const { handler, sheetSender } = makeHarness(store);

  const res = await handler({ sender: sheetSender }, { token: 7, secret: 'hunter2' /* string, not a typed array */ });
  assert.deepEqual(res, { ok: false });
  assert.equal(store.receivedBuffer, null);
});
