'use strict';

// Integration tests for the M12 Flight 4 Leg 3 admin-key ROTATION sheet Buffer channel
// (register-overlay-ipc.js), driven with a fake ipcMain event + fake delegate. Mirrors the
// vault-rotate-recovery handler suite: verifies the Buffer hand-off + DUAL-zeroization (both
// the copied Buffer AND the incoming Uint8Array), the { ok } result, the sheet-close on
// success, the sender / token discipline, and the Leg-3 specifics:
//   - menu-overlay:vault-rotate-admin — single master-pw secret; on success drives
//     vault-adminkey-show with the NEW one-time admin private key ONLY (never in the invoke reply).
// A WRONG step-up → { ok:false } (VaultAuthError mapped in main) → nothing shown/closed.

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

function baseHarness(extraInjections, menuType) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1 };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  const chrome = { send: (channel, payload) => chromeSends.push([channel, payload]) };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    ...extraInjections,
  });
  return { ipcMain, sheetSender, closeCalls, chromeSends };
}

// ---------------------------------------------------------------------------
// menu-overlay:vault-rotate-admin — single master-password secret
// ---------------------------------------------------------------------------

test('rotate-admin is GATED on the vaultRotateAdminKey injection', () => {
  const { ipcMain } = baseHarness({}, 'vault-stepup');
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-rotate-admin'), false);
});

test('rotate-admin: valid step-up → { ok:true }; Buffer hand-off; array zeroed; sheet closed; adminkey-show opened with the NEW key ONLY', async () => {
  const captured = { bytes: null, buffer: null, isBuffer: null };
  const vaultRotateAdminKey = async (buf) => {
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8');
    return { ok: true, adminPrivateKeyB64: 'NEW-ADMIN-PRIVATE-KEY-B64' };
  };
  const { ipcMain, sheetSender, closeCalls, chromeSends } = baseHarness({ vaultRotateAdminKey }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-admin');
  const secret = new TextEncoder().encode('correct-master');

  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: true }, 'the invoke reply carries { ok } only — never the new key');
  assert.equal(captured.isBuffer, true);
  assert.equal(captured.bytes, 'correct-master');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.deepEqual(chromeSends, [['vault-adminkey-show', { adminPrivateKey: 'NEW-ADMIN-PRIVATE-KEY-B64' }]]);
});

test('rotate-admin: WRONG master → { ok:false }: no adminkey-show, sheet not closed; array still zeroed', async () => {
  const vaultRotateAdminKey = async () => ({ ok: false });
  const { ipcMain, sheetSender, closeCalls, chromeSends } = baseHarness({ vaultRotateAdminKey }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-admin');
  const secret = new TextEncoder().encode('wrong-master');

  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: false });
  assert.deepEqual(chromeSends, [], 'no adminkey-show on a refused rotation');
  assert.deepEqual(closeCalls, [], 'sheet stays open to re-prompt');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized on refusal');
});

test('rotate-admin: wrong sender / stale token / non-Uint8Array → { ok:false }, delegate never called', async () => {
  let called = 0;
  const vaultRotateAdminKey = async () => { called += 1; return { ok: true, adminPrivateKeyB64: 'x' }; };
  const { ipcMain, sheetSender } = baseHarness({ vaultRotateAdminKey }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-admin');

  assert.deepEqual(await handler({ sender: { isDestroyed: () => false } }, { token: 7, secret: new Uint8Array([1]) }), { ok: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 6, secret: new Uint8Array([1]) }), { ok: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, secret: 'string' }), { ok: false });
  assert.equal(called, 0);
});
