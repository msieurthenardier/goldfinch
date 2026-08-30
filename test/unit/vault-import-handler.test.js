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
    on(channel, fn) {
      listeners.set(channel, fn);
    },
    handle(channel, fn) {
      handlers.set(channel, fn);
    }
  };
}

function makeHarness({ importResult, importThrows } = {}) {
  const ipcMain = makeIpc();
  const closeCalls = [];
  const chromeSends = [];
  const sheetSender = { id: 42, isDestroyed: () => false }; // the sheet's OWN overlay webContents
  const win = { id: 1 };
  // M17 F4 L3: the presented menu is now MUTABLE — step 1 (the import invoke) sees
  // `vault-import`; step 2 (the recovery-show ack that chains adminkey-show) presents
  // `vault-recovery-show`. Initialized to the pre-leg fixed stub so every prior test
  // (token 7 / vault-import) is byte-unchanged.
  let currentMenu = { token: 7, menuType: 'vault-import' };
  const setCurrentMenu = (m) => {
    currentMenu = m;
  };
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
  const vaultImport = async (chromeId, buf, secretKind) => {
    captured.called += 1;
    captured.chromeId = chromeId;
    captured.buffer = buf;
    captured.isBuffer = Buffer.isBuffer(buf);
    captured.bytes = Buffer.from(buf).toString('utf8'); // snapshot before zeroize
    captured.secretKind = secretKind;
    if (importThrows) throw importThrows;
    return importResult || { ok: true };
  };

  // M17 F4 L3 (AC2-AC4): a faithful stand-in for main's pending-admin-key store + store
  // autolock suppression. stash SETS suppression; take (consume) CLEARS it once nothing is
  // pending — mirroring main.js's stashAdoptAdminKey / takeAdoptAdminKey. `suspendCalls`
  // records the suppression transitions so AC4 is asserted through this seam at the IPC layer
  // (the real store timer is exercised by vault-store.test.js).
  const pendingAdmin = new Map();
  const suspendCalls = []; // booleans: true = suspended, false = resumed
  const stashAdoptAdminKey = (chromeId, adminPrivateKeyB64) => {
    if (chromeId == null) return;
    pendingAdmin.set(chromeId, adminPrivateKeyB64);
    suspendCalls.push(true);
  };
  const takeAdoptAdminKey = (chromeId) => {
    if (chromeId == null || !pendingAdmin.has(chromeId)) return undefined;
    const k = pendingAdmin.get(chromeId);
    pendingAdmin.delete(chromeId);
    if (pendingAdmin.size === 0) suspendCalls.push(false);
    return k;
  };

  registerOverlayIpc({
    ipcMain,
    registry,
    chromeForAttachment: (w) => (w === win ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultImport,
    stashAdoptAdminKey,
    takeAdoptAdminKey
  });

  const handler = ipcMain.handlers.get('menu-overlay:vault-import');
  const activated = ipcMain.listeners.get('menu-overlay:activated');
  return {
    handler,
    activated,
    sheetSender,
    closeCalls,
    chromeSends,
    captured,
    setCurrentMenu,
    suspendCalls,
    pendingAdmin
  };
}

// M17 F4 L3: channel-filter helper — the activated handler ALSO echoes a
// `menu-overlay-activated` onto chromeSends, so the show-sheet assertions must
// filter by channel, never by array length.
function sendsOn(chromeSends, channel) {
  return chromeSends.filter(([ch]) => ch === channel);
}

test('the import handler is GATED on the vaultImport injection (offline overlay tests omit it)', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined
    // no vaultImport
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-import'), false);
});

test('valid import → { ok:true }; Buffer + secretKind hand-off; BOTH arrays zeroed; sheet closed; NO follow-up chrome send', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness();
  const secret = new TextEncoder().encode('correct horse battery staple');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.chromeId, 77, 'the delegate is scoped to the window CHROME id, not the sheet wc (finding 5)');
  assert.equal(captured.isBuffer, true, 'import received a Buffer, not a Uint8Array');
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
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized on refusal'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized on refusal'
  );
});

test('COLLISION reason → { ok:false, reason:"collision" }: sheet NOT closed (surfaces "already exists"); both arrays zeroed (M12 F5 HAT tail)', async () => {
  // The main.js delegate maps a coded VaultCollisionError to { ok:false, reason:'collision' } (a
  // RETURN, not a throw) so the handler forwards the NON-SECRET reason and the dual-zeroize runs
  // uniformly — distinguishing a destination collision from a wrong secret at the sheet.
  const { handler, sheetSender, closeCalls, chromeSends, captured } = makeHarness({
    importResult: { ok: false, reason: 'collision' }
  });
  const secret = new TextEncoder().encode('correct horse battery staple');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: false, reason: 'collision' });
  assert.deepEqual(closeCalls, [], 'the sheet stays open to surface the collision message');
  assert.deepEqual(chromeSends, []);
  assert.ok(
    secret.every((b) => b === 0),
    'incoming Uint8Array zeroized on collision'
  );
  assert.ok(
    captured.buffer.every((b) => b === 0),
    'copied Buffer zeroized on collision'
  );
});

test('a delegate THROW (non-auth error, e.g. collision) rejects the invoke but still zeroizes both arrays; sheet not closed', async () => {
  const err = new Error('vault-store: a vault already exists for "work"');
  const { handler, sheetSender, closeCalls, captured } = makeHarness({ importThrows: err });
  const secret = new TextEncoder().encode('correct horse battery staple');

  await assert.rejects(handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' }), /already exists/);

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

test('wrong sender → { ok:false }, import never called', async () => {
  const { handler, captured } = makeHarness();
  const secret = new TextEncoder().encode('hunter2');
  const res = await handler(
    { sender: { isDestroyed: () => false } /* not the sheet */ },
    { token: 7, secret, secretKind: 'master' }
  );
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
  const res = await handler(
    { sender: sheetSender },
    { token: 7, secret: 'hunter2' /* string */, secretKind: 'master' }
  );
  assert.deepEqual(res, { ok: false });
  assert.equal(captured.called, 0);
});

// ---------------------------------------------------------------------------
// M17 F4 L3 (surface-adopted-keys): the fresh-adopt one-time-secret surfacing
// chain. The delegate is STUBBED here, so these pin the DELEGATE RETURN-SHAPE
// branches (fresh vs existing) — secretKind is vacuous at this layer (both-kind
// crypto coverage lives in Leg 2's store tests). Sequential guarantee: the
// recovery-show sheet is shown on the import ack; the adminkey-show sheet opens
// ONLY after the recovery-show is itself acknowledged (never back-to-back).
// ---------------------------------------------------------------------------

test('FRESH adopt: import shows recovery-show ONLY (no adminkey-show), suspends autolock, and stashes the admin key; no secrets in the invoke reply', async () => {
  const { handler, sheetSender, closeCalls, chromeSends, suspendCalls, pendingAdmin } = makeHarness({
    importResult: {
      ok: true,
      fresh: true,
      recoveryKeyDisplay: 'RCV-AAAA-BBBB-CCCC',
      adminPrivateKeyB64: 'ADMINKEYb64=='
    }
  });
  const secret = new TextEncoder().encode('donor recovery key');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'recovery' });

  // The invoke reply carries NO secret material.
  assert.deepEqual(res, { ok: true }, 'invoke reply is a bare { ok:true } — no recovery/admin key');
  assert.deepEqual(closeCalls, [['activated', 7]], 'the import sheet is closed on success');

  // Exactly one recovery-show, with the new recovery key; and NO adminkey-show yet.
  const recShows = sendsOn(chromeSends, 'vault-recovery-show');
  assert.equal(recShows.length, 1, 'exactly one vault-recovery-show sent');
  assert.deepEqual(recShows[0][1], { recoveryKey: 'RCV-AAAA-BBBB-CCCC', replacing: true });
  assert.equal(
    sendsOn(chromeSends, 'vault-adminkey-show').length,
    0,
    'adminkey-show is NOT sent before the recovery ack'
  );

  // AC4 seam: autolock suspended on stash; the admin key is held (not surfaced yet).
  assert.deepEqual(suspendCalls, [true], 'idle autolock is suspended when the admin key is stashed');
  assert.equal(pendingAdmin.get(77), 'ADMINKEYb64==', 'the admin key is stashed keyed by the window chrome id');
});

test('FRESH adopt: the recovery-show ACK chains adminkey-show (exactly once, with the admin key), drops the pending key, and clears autolock suppression', async () => {
  const { handler, activated, sheetSender, chromeSends, suspendCalls, setCurrentMenu, pendingAdmin } = makeHarness({
    importResult: {
      ok: true,
      fresh: true,
      recoveryKeyDisplay: 'RCV-AAAA-BBBB-CCCC',
      adminPrivateKeyB64: 'ADMINKEYb64=='
    }
  });
  const secret = new TextEncoder().encode('donor recovery key');
  await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'recovery' });

  // The recovery-show sheet is now the presented menu; acknowledge it (its ONLY close path).
  setCurrentMenu({ token: 99, menuType: 'vault-recovery-show' });
  activated({ sender: sheetSender }, { id: 'ack', token: 99 });

  const adminShows = sendsOn(chromeSends, 'vault-adminkey-show');
  assert.equal(adminShows.length, 1, 'exactly one vault-adminkey-show, sent only AFTER the recovery ack');
  assert.deepEqual(adminShows[0][1], { adminPrivateKey: 'ADMINKEYb64==' });
  // Still exactly one recovery-show across the whole flow — no re-send.
  assert.equal(sendsOn(chromeSends, 'vault-recovery-show').length, 1, 'the recovery-show is not re-sent');

  // AC3/AC4: the pending key is dropped and suppression is cleared on the ack.
  assert.equal(pendingAdmin.has(77), false, 'the pending admin key is dropped on the recovery ack');
  assert.deepEqual(suspendCalls, [true, false], 'autolock suppression is set on stash then cleared on ack');
});

test('EXISTING-profile adopt: NEITHER show channel is sent, autolock is never suspended, no admin key stashed', async () => {
  const { handler, activated, sheetSender, closeCalls, chromeSends, suspendCalls, setCurrentMenu, pendingAdmin } =
    makeHarness({ importResult: { ok: true, fresh: false } });
  const secret = new TextEncoder().encode('donor master password');

  const res = await handler({ sender: sheetSender }, { token: 7, secret, secretKind: 'master' });

  assert.deepEqual(res, { ok: true }, 'invoke reply is a bare { ok:true }');
  assert.deepEqual(closeCalls, [['activated', 7]], 'the import sheet is closed');
  assert.equal(sendsOn(chromeSends, 'vault-recovery-show').length, 0, 'no recovery-show on an existing-profile adopt');
  assert.equal(sendsOn(chromeSends, 'vault-adminkey-show').length, 0, 'no adminkey-show on an existing-profile adopt');
  assert.deepEqual(suspendCalls, [], 'idle autolock is never suspended on an existing-profile adopt');
  assert.equal(pendingAdmin.size, 0, 'no admin key stashed');

  // Even a stray recovery-show ack (none should be pending) chains nothing.
  setCurrentMenu({ token: 99, menuType: 'vault-recovery-show' });
  activated({ sender: sheetSender }, { id: 'ack', token: 99 });
  assert.equal(
    sendsOn(chromeSends, 'vault-adminkey-show').length,
    0,
    'a recovery-show ack with no pending admin key is inert'
  );
});

test('a recovery-show ack with NO pending admin key (setup / rotate-recovery) is fully unaffected — no adminkey-show, no suppression toggle', () => {
  // No import invoke at all: this window never adopted. A bare recovery-show ack
  // (as setup / rotate-recovery produce) must not chain adminkey-show.
  const { activated, sheetSender, chromeSends, suspendCalls, setCurrentMenu } = makeHarness();
  setCurrentMenu({ token: 99, menuType: 'vault-recovery-show' });
  activated({ sender: sheetSender }, { id: 'ack', token: 99 });
  assert.equal(sendsOn(chromeSends, 'vault-adminkey-show').length, 0, 'no adminkey-show for a non-adopt recovery-show');
  assert.deepEqual(suspendCalls, [], 'no suppression toggle for a non-adopt recovery-show');
});
