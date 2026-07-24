'use strict';

// Integration tests for the dedicated `menu-overlay:vault-setup` secret handler (M12
// Flight 3 Leg 4 first-run-setup, DD5), driven with a fake ipcMain event + a fake
// vaultSetup delegate. Mirrors the vault-unlock handler suite: verifies the Buffer
// hand-off + BOTH-array DUAL-zeroization, the { ok } result, the sheet-close on success,
// the sender / token discipline — and the F3-specific parts: it drives chrome to open
// vault-recovery-show with the RECOVERY KEY ONLY (never the admin key), and a setup throw
// rejects while still zeroizing.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');

function makeIpc() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    on(channel, fn) { listeners.set(channel, fn); },
    handle(channel, fn) { handlers.set(channel, fn); },
  };
}

// Build a harness: the registered handler + a fake vaultSetup delegate that records the
// Buffer it received (bytes snapshotted before the handler's finally zeroizes it).
function makeHarness({ setupResult, setupThrows } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1 };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-set' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  const chrome = { send: (channel, payload) => chromeSends.push([channel, payload]) };

  const captured = { buffer: null, isBuffer: null, bytes: null };
  const vaultSetup = async (buf) => {
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8'); // snapshot before zeroize
    if (setupThrows) throw setupThrows;
    return setupResult || { recoveryKeyDisplay: 'RECOVERY-1234', adminPrivateKeyB64: 'ADMIN-SECRET-B64' };
  };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultSetup,
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-setup');
  return { handler, sheetSender, closeCalls, chromeSends, captured };
}

test('valid setup → { ok:true }; Buffer hand-off + BOTH arrays zeroed; sheet closed; recovery-show opened with the KEY ONLY', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');

  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.isBuffer, true, 'setup received a Buffer, not a Uint8Array');
  assert.equal(captured.bytes, 'hunter2hunter2');
  // DUAL-zeroize: both the copied Buffer AND the incoming Uint8Array are cleared.
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  // Sheet closed 'activated'; chrome told to open recovery-show.
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.equal(chromeSends.length, 1);
  assert.equal(chromeSends[0][0], 'vault-recovery-show');
  // The recovery KEY only — the admin key must NEVER be forwarded (F4 deferral).
  assert.deepEqual(chromeSends[0][1], { recoveryKey: 'RECOVERY-1234' });
  assert.ok(!('adminPrivateKeyB64' in chromeSends[0][1]), 'admin key never leaves main');
  assert.ok(!JSON.stringify(chromeSends[0][1]).includes('ADMIN-SECRET-B64'));
});

test('setup throws (already set up) → invoke rejects, both arrays still zeroed, no recovery-show, sheet not closed', async () => {
  const err = new Error('vault-store: already set up');
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({ setupThrows: err });
  const secret = new TextEncoder().encode('hunter2hunter2');

  await assert.rejects(handler({ sender: sheetSender }, { token: 7, secret }), /already set up/);

  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized even on throw');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized even on throw');
  assert.deepEqual(closeCalls, [], 'sheet not closed on failure');
  assert.deepEqual(chromeSends, [], 'no recovery-show on failure');
});

test('wrong sender → { ok:false }, setup never called', async () => {
  const { handler, captured, chromeSends } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');
  const res = await handler({ sender: { isDestroyed: () => false } /* not the sheet */ }, { token: 7, secret });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.buffer, null, 'setup never called for a foreign sender');
  assert.deepEqual(chromeSends, []);
});

test('stale token → { ok:false }, setup never called', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2hunter2');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, secret });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.buffer, null, 'setup never called on a stale token');
});

test('a non-Uint8Array secret → { ok:false }', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const res = await handler({ sender: sheetSender }, { token: 7, secret: 'hunter2' /* string */ });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.buffer, null);
});
