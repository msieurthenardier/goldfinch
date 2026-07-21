'use strict';

// Integration tests for the three M12 Flight 4 Leg 2 key-rotation sheet Buffer channels
// (register-overlay-ipc.js), driven with a fake ipcMain event + fake delegates. Mirrors the
// vault-stepup-mint / vault-setup handler suites: verifies the Buffer hand-off + DUAL-
// zeroization (both the copied Buffer(s) AND the incoming Uint8Array(s)), the { ok } result,
// the sheet-close on success, the sender / token discipline, and the Leg-2 specifics:
//   - menu-overlay:vault-rotate-recovery — single master-pw secret; on success drives
//     vault-recovery-show with the NEW one-time recovery key ONLY (never in the invoke reply).
//   - menu-overlay:vault-change-master — TWO secrets (old + new); both dual-zeroized.
//   - menu-overlay:vault-recover — TWO secrets (recovery + new); both dual-zeroized.
// A WRONG step-up/secret → { ok:false } (VaultAuthError mapped in main) → nothing shown/closed.

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
// menu-overlay:vault-rotate-recovery — single master-password secret
// ---------------------------------------------------------------------------

test('rotate-recovery is GATED on the vaultRotateRecovery injection', () => {
  const { ipcMain } = baseHarness({}, 'vault-stepup');
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-rotate-recovery'), false);
});

test('rotate-recovery: valid step-up → { ok:true }; Buffer hand-off; array zeroed; sheet closed; recovery-show opened with the NEW key ONLY', async () => {
  const captured = { bytes: null, buffer: null, isBuffer: null };
  const vaultRotateRecovery = async (buf) => {
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8');
    return { ok: true, recoveryKeyDisplay: 'NEW-RECOVERY-KEY-DISPLAY' };
  };
  const { ipcMain, sheetSender, closeCalls, chromeSends } = baseHarness({ vaultRotateRecovery }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-recovery');
  const secret = new TextEncoder().encode('correct-master');

  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: true }, 'the invoke reply carries { ok } only — never the new key');
  assert.equal(captured.isBuffer, true);
  assert.equal(captured.bytes, 'correct-master');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.deepEqual(chromeSends, [['vault-recovery-show', { recoveryKey: 'NEW-RECOVERY-KEY-DISPLAY' }]]);
});

test('rotate-recovery: WRONG master → { ok:false }: no recovery-show, sheet not closed; array still zeroed', async () => {
  const vaultRotateRecovery = async () => ({ ok: false });
  const { ipcMain, sheetSender, closeCalls, chromeSends } = baseHarness({ vaultRotateRecovery }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-recovery');
  const secret = new TextEncoder().encode('wrong-master');

  const res = await handler({ sender: sheetSender }, { token: 7, secret });

  assert.deepEqual(res, { ok: false });
  assert.deepEqual(chromeSends, [], 'no recovery-show on a refused rotation');
  assert.deepEqual(closeCalls, [], 'sheet stays open to re-prompt');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized on refusal');
});

test('rotate-recovery: wrong sender / stale token / non-Uint8Array → { ok:false }, delegate never called', async () => {
  let called = 0;
  const vaultRotateRecovery = async () => { called += 1; return { ok: true, recoveryKeyDisplay: 'x' }; };
  const { ipcMain, sheetSender } = baseHarness({ vaultRotateRecovery }, 'vault-stepup');
  const handler = ipcMain.handlers.get('menu-overlay:vault-rotate-recovery');

  assert.deepEqual(await handler({ sender: { isDestroyed: () => false } }, { token: 7, secret: new Uint8Array([1]) }), { ok: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 6, secret: new Uint8Array([1]) }), { ok: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, secret: 'string' }), { ok: false });
  assert.equal(called, 0);
});

// ---------------------------------------------------------------------------
// menu-overlay:vault-change-master — TWO secrets (old + new)
// ---------------------------------------------------------------------------

test('change-master is GATED on the vaultChangeMaster injection', () => {
  const { ipcMain } = baseHarness({}, 'vault-change-master');
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-change-master'), false);
});

test('change-master: valid → { ok:true }; BOTH Buffers passed; ALL FOUR arrays zeroed; sheet closed; no display', async () => {
  const captured = { old: null, neu: null, oldIsBuf: null, newIsBuf: null };
  const vaultChangeMaster = async (oldBuf, newBuf) => {
    captured.old = Buffer.from(oldBuf).toString('utf8');
    captured.neu = Buffer.from(newBuf).toString('utf8');
    captured.oldIsBuf = Buffer.isBuffer(oldBuf);
    captured.newIsBuf = Buffer.isBuffer(newBuf);
    captured.oldBuf = oldBuf;
    captured.newBuf = newBuf;
    return { ok: true };
  };
  const { ipcMain, sheetSender, closeCalls, chromeSends } = baseHarness({ vaultChangeMaster }, 'vault-change-master');
  const handler = ipcMain.handlers.get('menu-overlay:vault-change-master');
  const oldSecret = new TextEncoder().encode('old-master');
  const newSecret = new TextEncoder().encode('new-master');

  const res = await handler({ sender: sheetSender }, { token: 7, oldSecret, newSecret });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.oldIsBuf, true);
  assert.equal(captured.newIsBuf, true);
  assert.equal(captured.old, 'old-master');
  assert.equal(captured.neu, 'new-master');
  // DUAL-zeroize: both copied Buffers AND both incoming Uint8Arrays.
  assert.ok(captured.oldBuf.every((b) => b === 0), 'copied old Buffer zeroized');
  assert.ok(captured.newBuf.every((b) => b === 0), 'copied new Buffer zeroized');
  assert.ok(oldSecret.every((b) => b === 0), 'incoming old Uint8Array zeroized');
  assert.ok(newSecret.every((b) => b === 0), 'incoming new Uint8Array zeroized');
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.deepEqual(chromeSends, [], 'change-master shows no one-time display');
});

test('change-master: WRONG old password → { ok:false }: sheet not closed; both arrays still zeroed', async () => {
  const vaultChangeMaster = async () => ({ ok: false });
  const { ipcMain, sheetSender, closeCalls } = baseHarness({ vaultChangeMaster }, 'vault-change-master');
  const handler = ipcMain.handlers.get('menu-overlay:vault-change-master');
  const oldSecret = new TextEncoder().encode('wrong-old');
  const newSecret = new TextEncoder().encode('new-master');

  const res = await handler({ sender: sheetSender }, { token: 7, oldSecret, newSecret });

  assert.deepEqual(res, { ok: false });
  assert.deepEqual(closeCalls, []);
  assert.ok(oldSecret.every((b) => b === 0));
  assert.ok(newSecret.every((b) => b === 0));
});

test('change-master: a missing/non-Uint8Array secret → { ok:false }, delegate never called', async () => {
  let called = 0;
  const vaultChangeMaster = async () => { called += 1; return { ok: true }; };
  const { ipcMain, sheetSender } = baseHarness({ vaultChangeMaster }, 'vault-change-master');
  const handler = ipcMain.handlers.get('menu-overlay:vault-change-master');
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, oldSecret: new Uint8Array([1]) /* no newSecret */ }), { ok: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, oldSecret: 'str', newSecret: new Uint8Array([1]) }), { ok: false });
  assert.equal(called, 0);
});

// ---------------------------------------------------------------------------
// menu-overlay:vault-recover — TWO secrets (recovery + new)
// ---------------------------------------------------------------------------

test('recover is GATED on the vaultRecover injection', () => {
  const { ipcMain } = baseHarness({}, 'vault-recover');
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-recover'), false);
});

test('recover: valid → { ok:true }; BOTH Buffers passed; ALL FOUR arrays zeroed; sheet closed', async () => {
  const captured = {};
  const vaultRecover = async (recoveryBuf, newBuf) => {
    captured.recovery = Buffer.from(recoveryBuf).toString('utf8');
    captured.neu = Buffer.from(newBuf).toString('utf8');
    captured.recoveryBuf = recoveryBuf;
    captured.newBuf = newBuf;
    return { ok: true };
  };
  const { ipcMain, sheetSender, closeCalls } = baseHarness({ vaultRecover }, 'vault-recover');
  const handler = ipcMain.handlers.get('menu-overlay:vault-recover');
  const recoverySecret = new TextEncoder().encode('ABCD-EFGH-IJKL-MNOP');
  const newSecret = new TextEncoder().encode('new-master');

  const res = await handler({ sender: sheetSender }, { token: 7, recoverySecret, newSecret });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.recovery, 'ABCD-EFGH-IJKL-MNOP');
  assert.equal(captured.neu, 'new-master');
  assert.ok(captured.recoveryBuf.every((b) => b === 0), 'copied recovery Buffer zeroized');
  assert.ok(captured.newBuf.every((b) => b === 0), 'copied new Buffer zeroized');
  assert.ok(recoverySecret.every((b) => b === 0), 'incoming recovery Uint8Array zeroized');
  assert.ok(newSecret.every((b) => b === 0), 'incoming new Uint8Array zeroized');
  assert.deepEqual(closeCalls, [['activated', 7]]);
});

test('recover: WRONG recovery key → { ok:false }: sheet not closed; both arrays still zeroed', async () => {
  const vaultRecover = async () => ({ ok: false });
  const { ipcMain, sheetSender, closeCalls } = baseHarness({ vaultRecover }, 'vault-recover');
  const handler = ipcMain.handlers.get('menu-overlay:vault-recover');
  const recoverySecret = new TextEncoder().encode('WRONG-KEY');
  const newSecret = new TextEncoder().encode('new-master');

  const res = await handler({ sender: sheetSender }, { token: 7, recoverySecret, newSecret });

  assert.deepEqual(res, { ok: false });
  assert.deepEqual(closeCalls, []);
  assert.ok(recoverySecret.every((b) => b === 0));
  assert.ok(newSecret.every((b) => b === 0));
});
