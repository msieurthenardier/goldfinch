'use strict';

// Integration tests for the dedicated `menu-overlay:vault-import` secret handler — RESHAPED
// M18 F3 Leg 3 / DD2 ruling 2 into a PREVIEW-ONLY step (was: the whole single-vault import,
// M12 Flight 4 Leg 1 export-import, DD1/DD2). The pinned-shape casualty named in the leg spec:
// the fresh-adopt admin-key surfacing chain this file used to pin (recovery-show → adminkey-show,
// M17 F4 L3) is GONE — adopt no longer mints an admin pair (DD6) and no longer runs at the
// secret step at all (the whole destination/adopt decision moved to the commit step, which this
// file does not exercise — see the new commit-handler suite). What remains here: the Buffer
// hand-off + BOTH-array DUAL-zeroization, the { ok } result, the sheet-close on success, the
// sender/token discipline, and the NON-SECRET secretKind forwarding. A wrong/refused secret →
// { ok:false } (+ a non-secret reason for format/busy/state) → NOTHING stashed and the sheet
// re-prompts (the vaultUnlock pattern — VaultAuthError mapped to bare { ok:false
// } in the main.js delegate).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');

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

function makeHarness({ previewResult, previewThrows } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { id: 42, isDestroyed: () => false }; // the sheet's OWN overlay webContents
  const win = { id: 1 };
  const currentMenu = { token: 7, menuType: 'vault-import' };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => currentMenu,
    closeMenuOverlay: (reason, token) => closeCalls.push([reason, token])
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  // The window's CHROME contents (distinct from the sheet's own webContents); its id is the
  // per-window import key (finding 5) — chromeForAttachment(rec.win) resolves to this.
  const chrome = { id: 77, send: (channel, payload) => chromeSends.push([channel, payload]) };

  const captured = { chromeId: undefined, buffer: null, isBuffer: null, bytes: null, secretKind: undefined, called: 0 };
  // finding 5: the delegate now receives the owning-chrome id FIRST (the sheet's own sender id).
  const vaultImportPreview = async (chromeId, buf, secretKind) => {
    captured.called += 1;
    captured.chromeId = chromeId;
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8'); // snapshot before zeroize
    captured.secretKind = secretKind;
    if (previewThrows) throw previewThrows;
    return previewResult || { ok: true };
  };

  registerOverlayIpc({
    ipcMain,
    registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultImportPreview
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-import');
  return { handler, sheetSender, closeCalls, chromeSends, captured };
}

test('the import handler is GATED on the vaultImportPreview injection (offline overlay tests omit it)', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined
    // no vaultImportPreview
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-import'), false);
});

test('valid preview → { ok:true }; Buffer + secretKind hand-off; BOTH arrays zeroed; sheet closed; labels-ready sent with NO payload', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness();
  const secret = new TextEncoder().encode('correct horse battery staple');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.chromeId, 77, 'the delegate is scoped to the window CHROME id, not the sheet wc (finding 5)');
  assert.equal(captured.isBuffer, true, 'preview received a Buffer, not a Uint8Array');
  assert.equal(captured.bytes, 'correct horse battery staple');
  assert.equal(captured.secretKind, 'master', 'the NON-SECRET secretKind is forwarded');
  // DUAL-zeroize: both the copied Buffer AND the incoming Uint8Array are cleared.
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized in finally'
  );
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized in finally'
  );
  assert.deepEqual(closeCalls, [['activated', 7]]);
  // DD2 ruling 3(c): a targeted, PAYLOAD-FREE notification — no labels ride this send.
  assert.deepEqual(chromeSends, [['vault-import-labels-ready', undefined]]);
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

test('WRONG secret → { ok:false }: sheet NOT closed (re-prompt); both arrays still zeroed; no labels-ready send', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({ previewResult: { ok: false } });
  const secret = new TextEncoder().encode('wrong');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 1, 'the delegate ran (the wrong secret is judged in main)');
  assert.deepEqual(closeCalls, [], 'the sheet stays open to re-prompt');
  assert.deepEqual(chromeSends, []);
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized on refusal'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized on refusal'
  );
});

test('a non-secret reason (format/busy/state) forwards through untouched: sheet NOT closed, both arrays zeroed', async () => {
  for (const reason of ['format', 'busy', 'state']) {
    const { handler, sheetSender, closeCalls, chromeSends } = makeHarness({
      previewResult: { ok: false, reason }
    });
    const secret = new TextEncoder().encode('correct horse battery staple');

    const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

    assert.deepEqual(res, { ok: false, reason }, `reason '${reason}' forwards verbatim`);
    assert.deepEqual(closeCalls, [], `sheet stays open on a '${reason}' refusal`);
    assert.deepEqual(chromeSends, []);
    assert.ok(
      secret.every((b) => b === 0),
      `Uint8Array zeroized on a '${reason}' refusal`
    );
  }
});

test('a delegate THROW (unmapped error class) rejects the invoke but still zeroizes both arrays; sheet not closed', async () => {
  const err = new Error('vault-store: bundle vault "work" missing mrk envelope');
  const { handler, sheetSender, closeCalls, captured } = makeHarness({ previewThrows: err });
  const secret = new TextEncoder().encode('correct horse battery staple');

  await assert.rejects(
    handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' }),
    /missing mrk envelope/
  );

  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized even on throw'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized even on throw'
  );
  assert.deepEqual(closeCalls, [], 'sheet not closed on failure');
});

test('wrong sender → { ok:false }, preview never called', async () => {
  const { handler, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2');
  const res = await handler(
    { sender: { isDestroyed: () => false } /* not the sheet */ },
    { token: 7, secret, secretKind: 'master' }
  );
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'preview never called for a foreign sender');
});

test('stale token → { ok:false }, preview never called', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2');
  const res = await handler({ sender: sheetSender }, { token: 6 /* current is 7 */, secret, secretKind: 'master' });
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0, 'preview never called on a stale token');
});

test('a non-Uint8Array secret → { ok:false }', async () => {
  const { handler, sheetSender, captured } = makeHarness();
  const res = await handler(
    { sender: sheetSender },
    { token: 7, secret: 'hunter2' /* string */, secretKind: 'master' }
  );
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0);
});
