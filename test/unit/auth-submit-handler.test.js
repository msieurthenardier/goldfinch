'use strict';

// The dedicated `menu-overlay:auth-submit` credential handler (M14 F1 L2,
// flight DD2) — clones the vault-unlock handler's test shape: fake ipcMain
// event + a recording answer delegate. Verifies the Buffer hand-off + BOTH-
// array zeroization, the sender/token discipline, the result pass-through, and
// that the HANDLER never closes the sheet (the store owns the single close
// site — 8b).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');

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

function makeHarness({ delegateResult = { answered: true } } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const sheetSender = { isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'auth-basic' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };

  // Recording delegate — snapshots the Buffer's bytes BEFORE the handler's
  // finally zeroizes them (the answerFromSheet contract: the store consumes the
  // password synchronously, inside the try).
  const calls = [];
  const authAnswerFromSheet = (record, username, buf) => {
    calls.push({
      record,
      username,
      isBuffer: Buffer.isBuffer(buf),
      bytes: Buffer.from(buf).toString('utf8'),
      buf,
    });
    return delegateResult;
  };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    authAnswerFromSheet,
  });

  const handler = ipcMain.handlers.get('menu-overlay:auth-submit');
  return { handler, sheetSender, closeCalls, calls, rec };
}

test('registration is gated on the injection — absent delegate registers no handler', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:auth-submit'), false);
});

test('valid submit: Buffer hand-off to the store (record + username + password bytes), BOTH arrays zeroized, result passed through, handler closes NOTHING', async () => {
  const { handler, sheetSender, closeCalls, calls, rec } = makeHarness();
  const secret = new TextEncoder().encode('fixturepass');
  const res = await handler({ sender: sheetSender }, { token: 7, username: 'fixtureuser', secret });

  assert.deepEqual(res, { answered: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].record, rec, 'record-shaped delegate — the store holds no tokens');
  assert.equal(calls[0].username, 'fixtureuser');
  assert.equal(calls[0].isBuffer, true, 'the store receives a zeroizable Buffer copy');
  assert.equal(calls[0].bytes, 'fixturepass');
  assert.ok(calls[0].buf.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  assert.deepEqual(closeCalls, [], 'the handler NEVER closes the sheet — the store owns the close (8b)');
});

test('a failed answer passes { answered:false } through and still zeroizes both arrays', async () => {
  const { handler, sheetSender, calls } = makeHarness({ delegateResult: { answered: false, reason: 'no-challenge' } });
  const secret = new TextEncoder().encode('pw');
  const res = await handler({ sender: sheetSender }, { token: 7, username: 'u', secret });
  assert.deepEqual(res, { answered: false, reason: 'no-challenge' });
  assert.ok(secret.every((b) => b === 0));
  assert.ok(calls[0].buf.every((b) => b === 0));
});

test('a throwing delegate still zeroizes BOTH arrays (finally runs) and rejects the invoke', async () => {
  const ipcMain = makeIpc();
  const sheetSender = { isDestroyed: () => false };
  const rec = {
    sheet: {
      getView: () => ({ webContents: sheetSender }),
      getCurrentMenu: () => ({ token: 7, menuType: 'auth-basic' }),
      closeMenuOverlay: () => {},
    },
  };
  let seenBuf = null;
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [rec], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    authAnswerFromSheet: (_r, _u, buf) => { seenBuf = buf; throw new Error('store exploded'); },
  });
  const handler = ipcMain.handlers.get('menu-overlay:auth-submit');
  const secret = new TextEncoder().encode('pw');
  await assert.rejects(async () => handler({ sender: sheetSender }, { token: 7, username: 'u', secret }), /store exploded/);
  assert.ok(secret.every((b) => b === 0), 'incoming array zeroized on a throw');
  assert.ok(seenBuf.every((b) => b === 0), 'Buffer copy zeroized on a throw');
});

test('wrong sender is rejected → { answered:false }, delegate never called', async () => {
  const { handler, calls } = makeHarness();
  const secret = new TextEncoder().encode('pw');
  const res = await handler({ sender: { isDestroyed: () => false } /* not the sheet */ }, { token: 7, username: 'u', secret });
  assert.deepEqual(res, { answered: false });
  assert.equal(calls.length, 0);
});

test('stale token is rejected → { answered:false }, delegate never called', async () => {
  const { handler, sheetSender, calls } = makeHarness();
  const secret = new TextEncoder().encode('pw');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, username: 'u', secret });
  assert.deepEqual(res, { answered: false });
  assert.equal(calls.length, 0);
});

test('a non-Uint8Array secret or non-string username is rejected → { answered:false }', async () => {
  const { handler, sheetSender, calls } = makeHarness();
  assert.deepEqual(await handler({ sender: sheetSender }, { token: 7, username: 'u', secret: 'pw' }), { answered: false });
  assert.deepEqual(
    await handler({ sender: sheetSender }, { token: 7, username: 42, secret: new TextEncoder().encode('pw') }),
    { answered: false }
  );
  assert.equal(calls.length, 0);
});
