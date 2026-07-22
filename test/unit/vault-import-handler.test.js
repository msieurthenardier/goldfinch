'use strict';

// Integration tests for the dedicated `menu-overlay:vault-import` secret handler (M12 Flight 4
// Leg 1 export-import, DD1/DD2), driven with a fake ipcMain event + a fake vaultImport delegate.
// Mirrors the vault-stepup-mint handler suite: verifies the Buffer hand-off + BOTH-array DUAL-
// zeroization, the { ok } result, the sheet-close on success, the sender / token discipline, and
// the NON-SECRET secretKind forwarding. Unlike stepup, a successful import opens NO follow-up
// sheet (no chrome send). A wrong secret → { ok:false } → NOTHING written and the sheet re-prompts
// (the vaultUnlock pattern — VaultAuthError mapped to { ok:false } in the main.js delegate).

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

function makeHarness({ importResult, importThrows } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1 };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'vault-import' }),
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token]),
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  const chrome = { send: (channel, payload) => chromeSends.push([channel, payload]) };

  const captured = { buffer: null, isBuffer: null, bytes: null, secretKind: undefined, called: 0 };
  const vaultImport = async (buf, secretKind) => {
    captured.called += 1;
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8'); // snapshot before zeroize
    captured.secretKind = secretKind;
    if (importThrows) throw importThrows;
    return importResult || { ok: true };
  };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultImport,
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-import');
  return { handler, sheetSender, closeCalls, chromeSends, captured };
}

test('the import handler is GATED on the vaultImport injection (offline overlay tests omit it)', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain, registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null, chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    // no vaultImport
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-import'), false);
});

test('valid import → { ok:true }; Buffer + secretKind hand-off; BOTH arrays zeroed; sheet closed; NO follow-up chrome send', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness();
  const secret = new TextEncoder().encode('correct horse battery staple');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.isBuffer, true, 'import received a Buffer, not a Uint8Array');
  assert.equal(captured.bytes, 'correct horse battery staple');
  assert.equal(captured.secretKind, 'master', 'the NON-SECRET secretKind is forwarded');
  // DUAL-zeroize: both the copied Buffer AND the incoming Uint8Array are cleared.
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized in finally');
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized in finally');
  assert.deepEqual(closeCalls, [['activated', 7]]);
  assert.deepEqual(chromeSends, [], 'import opens no follow-up sheet');
});

test('secretKind:"recovery" is forwarded verbatim; an unknown/omitted secretKind defaults to "master"', async () => {
  const rec = makeHarness();
  const s1 = new TextEncoder().encode('ABCD-EFGH');
  await rec.handler({ sender: rec.sheetSender }, { token: 7, secret: s1, secretKind: 'recovery' });
  assert.equal(rec.captured.secretKind, 'recovery');

  const bogus = makeHarness();
  const s2 = new TextEncoder().encode('hunter2');
  await bogus.handler({ sender: bogus.sheetSender }, { token: 7, secret: s2, secretKind: 'nonsense' });
  assert.equal(bogus.captured.secretKind, 'master', 'a bogus secretKind falls back to master');
});

test('WRONG secret → { ok:false }: sheet NOT closed (re-prompt); both arrays still zeroed', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({ importResult: { ok: false } });
  const secret = new TextEncoder().encode('wrong');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 1, 'the delegate ran (the wrong secret is judged in main)');
  assert.deepEqual(closeCalls, [], 'the sheet stays open to re-prompt');
  assert.deepEqual(chromeSends, []);
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized on refusal');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized on refusal');
});

test('COLLISION reason → { ok:false, reason:"collision" }: sheet NOT closed (surfaces "already exists"); both arrays zeroed (M12 F5 HAT tail)', async () => {
  // The main.js delegate maps a coded VaultCollisionError to { ok:false, reason:'collision' } (a
  // RETURN, not a throw) so the handler forwards the NON-SECRET reason and the dual-zeroize runs
  // uniformly — distinguishing a destination collision from a wrong secret at the sheet.
  const { handler, sheetSender, closeCalls, chromeSends, captured } =
    makeHarness({ importResult: { ok: false, reason: 'collision' } });
  const secret = new TextEncoder().encode('correct horse battery staple');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: false, reason: 'collision' });
  assert.deepEqual(closeCalls, [], 'the sheet stays open to surface the collision message');
  assert.deepEqual(chromeSends, []);
  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized on collision');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized on collision');
});

test('a delegate THROW (non-auth error, e.g. collision) rejects the invoke but still zeroizes both arrays; sheet not closed', async () => {
  const err = new Error('vault-store: a vault already exists for "work"');
  const { handler, sheetSender, closeCalls, captured } = makeHarness({ importThrows: err });
  const secret = new TextEncoder().encode('correct horse battery staple');

  await assert.rejects(handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' }), /already exists/);

  assert.ok(secret.every((b) => b === 0), 'incoming Uint8Array zeroized even on throw');
  assert.ok(captured.buffer.every((b) => b === 0), 'copied Buffer zeroized even on throw');
  assert.deepEqual(closeCalls, [], 'sheet not closed on failure');
});

test('wrong sender → { ok:false }, import never called', async () => {
  const { handler, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2');
  const res = await handler({ sender: { isDestroyed: () => false } /* not the sheet */ }, { token: 7, secret, secretKind: 'master' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'import never called for a foreign sender');
});

test('stale token → { ok:false }, import never called', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, secret, secretKind: 'master' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'import never called on a stale token');
});

test('a non-Uint8Array secret → { ok:false }', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const res = await handler({ sender: sheetSender }, { token: 7, secret: 'hunter2' /* string */, secretKind: 'master' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0);
});
