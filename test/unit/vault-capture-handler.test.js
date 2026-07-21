'use strict';

// Integration tests for the dedicated `menu-overlay:vault-capture-save` handler
// (M12 Flight 2 Leg 4 capture-save, DD7), driven with a fake ipcMain event + a fake
// vaultCaptureSave delegate. Verifies the sender / open-token discipline, the
// close-the-sheet-on-save behavior (never on a refusal), the payload pass-through,
// and — the leg's security invariant — that the SAVE INVOKE carries NO password
// (only captureId + vaultId; the password lives solely in the main-side record).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');

function makeIpc() {
  const listeners = new Map();
  const handlers = new Map();
  return {
    listeners, handlers,
    on(channel, fn) { listeners.set(channel, fn); },
    handle(channel, fn) { handlers.set(channel, fn); },
  };
}

function makeHarness(saveResult = { saved: true }) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const saveCalls = [];
  const sheetSender = { isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-capture' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };

  const vaultCaptureSave = (arg) => { saveCalls.push(arg); return saveResult; };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultCaptureSave,
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-capture-save');
  return { handler, sheetSender, closeCalls, saveCalls };
}

test('the handler is NOT registered without the vaultCaptureSave injection (offline-test safe)', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain, registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null, chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-capture-save'), false);
});

test('save success → { saved:true }, delegate gets { captureId, vaultId } (no password), sheet closed "activated"', async () => {
  const { handler, sheetSender, closeCalls, saveCalls } = makeHarness({ saved: true });
  const res = await handler({ sender: sheetSender }, { token: 7, captureId: 'cap1', vaultId: 'work' });

  assert.deepEqual(res, { saved: true });
  assert.deepEqual(saveCalls, [{ captureId: 'cap1', vaultId: 'work' }]);
  assert.ok(!JSON.stringify(saveCalls).includes('password'), 'the save invoke never carries a password');
  assert.deepEqual(closeCalls, [['activated', 7]]);
});

test('save refusal → the result passes through and the sheet stays OPEN (re-prompt)', async () => {
  const { handler, sheetSender, closeCalls } = makeHarness({ saved: false, reason: 'locked' });
  const res = await handler({ sender: sheetSender }, { token: 7, captureId: 'cap1', vaultId: 'work' });
  assert.deepEqual(res, { saved: false, reason: 'locked' });
  assert.deepEqual(closeCalls, [], 'sheet stays open on a refusal');
});

test('foreign sender → { saved:false }, delegate never called', async () => {
  const { handler, saveCalls } = makeHarness();
  const res = await handler({ sender: { isDestroyed: () => false } /* not the sheet */ }, { token: 7, captureId: 'cap1', vaultId: 'work' });
  assert.deepEqual(res, { saved: false });
  assert.deepEqual(saveCalls, []);
});

test('stale token → { saved:false }, delegate never called', async () => {
  const { handler, sheetSender, saveCalls } = makeHarness();
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, captureId: 'cap1', vaultId: 'work' });
  assert.deepEqual(res, { saved: false });
  assert.deepEqual(saveCalls, []);
});

test('a missing / non-string captureId → { saved:false }, delegate never called', async () => {
  const { handler, sheetSender, saveCalls } = makeHarness();
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, vaultId: 'work' }), { saved: false });
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, captureId: 42, vaultId: 'work' }), { saved: false });
  assert.deepEqual(saveCalls, []);
});
