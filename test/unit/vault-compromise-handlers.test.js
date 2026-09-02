'use strict';

// Integration tests for the M18 F2 L4 compromise-mode sheet channels + surfacing seams
// (register-overlay-ipc.js), driven with a fake ipcMain event + fake/real delegates —
// the vault-rotation-handlers.test.js stubbed-sheet harness idiom. Pins:
//   - both handlers' full discipline (sender identity, open-token freshness, the
//     menuType predicate, Uint8Array checks, Buffer hand-off, DUAL-zeroize ×4);
//   - the non-secret error-reason pass-through incl. the new VaultPasswordReuseError
//     mapping ('reuse');
//   - the H2 success ORDERING: stash reveal + acquire suppression hold BEFORE any
//     sheet interaction (close / recovery-show send), key NEVER in the invoke reply;
//   - the H2 null-guarded window-gone path (durable commit, dead window → stash only,
//     no throw, reveal stays pending) and the resurface RE-KEY (the reveal + its hold
//     move to a freshly booted window's chrome id);
//   - the H1 ack discrimination on menu-overlay:activated for ALL FOUR ack kinds:
//     setup/rotate no-op, adopt-only, compromise-only, and both flows pending in
//     DIFFERENT windows (neither release touches the other).
// The surfacing delegates are composed from the REAL suppression holder + REAL
// pending-reveal store (the exact composition main.js wires), so release-exactness
// and the hold lifecycle are exercised for real, not modeled.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const { createSuppressionHolder } = require('../../src/main/vault/autolock-suppression');
const { createCompromiseRevealStore } = require('../../src/main/vault/pending-compromise-reveals');

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

// The main.js composition, rebuilt over the real holder + reveal store: stash sets the
// session report + stashes the reveal (acquiring the hold); ack consumes-if-present and
// fires the completion broadcast; takeAdoptAdminKey mirrors main's adopt store.
function makeSurfacing() {
  const suspended = [];
  const holder = createSuppressionHolder({ setSuspended: (on) => suspended.push(on) });
  const reveals = createCompromiseRevealStore(holder);
  const adoptKeys = new Map();
  const broadcasts = [];
  const events = [];
  let report = null;
  return {
    holder,
    reveals,
    adoptKeys,
    broadcasts,
    suspended,
    events,
    getReport: () => report,
    stashAdoptAdminKey(chromeId, key) {
      adoptKeys.set(chromeId, key);
      holder.acquire(chromeId, 'adopt');
    },
    takeAdoptAdminKey(chromeId) {
      if (chromeId == null || !adoptKeys.has(chromeId)) return undefined;
      const key = adoptKeys.get(chromeId);
      adoptKeys.delete(chromeId);
      holder.release(chromeId, 'adopt');
      return key;
    },
    stashCompromiseReveal(chromeId, { recoveryKey, revoked }) {
      events.push(['stash', chromeId]);
      report = revoked;
      reveals.stash(chromeId, recoveryKey);
    },
    ackCompromiseReveal(chromeId) {
      if (!reveals.ack(chromeId)) return false;
      broadcasts.push('vault-lock-state');
      return true;
    }
  };
}

// Stubbed-sheet harness (vault-rotation-handlers.test.js:19-56 idiom), extended with an
// event log shared with makeSurfacing so the stash-before-sheet-interaction ordering is
// pinnable, and with per-test control of window liveness.
function harness({ vaultCompromiseRotate, menuType = 'vault-compromise', surfacing = makeSurfacing() } = {}) {
  const ipcMain = makeIpc();
  const events = surfacing.events;
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1, destroyed: false, isDestroyed: () => win.destroyed };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType }),
    closeMenuOverlay: (reason, token) => events.push(['close', reason, token])
  };
  const rec = { sheet, win };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  const chrome = { id: 100, send: (channel, payload) => events.push(['send', channel, payload]) };

  registerOverlayIpc({
    ipcMain,
    registry,
    chromeForAttachment: (w) => (w === win && !win.destroyed ? chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    vaultCompromiseRotate,
    stashCompromiseReveal: (chromeId, reveal) => surfacing.stashCompromiseReveal(chromeId, reveal),
    ackCompromiseReveal: (chromeId) => surfacing.ackCompromiseReveal(chromeId),
    takeAdoptAdminKey: (chromeId) => surfacing.takeAdoptAdminKey(chromeId)
  });
  return { ipcMain, sheetSender, win, rec, chrome, events, surfacing };
}

const OK_RESULT = {
  ok: true,
  recoveryKey: 'NEW-COMPROMISE-RECOVERY-KEY',
  revoked: { admin: true, vaultIds: ['global', 'work'] }
};

// ---------------------------------------------------------------------------
// Registration gating
// ---------------------------------------------------------------------------

test('both compromise channels are GATED on the vaultCompromiseRotate injection', () => {
  const ipcMain = makeIpc();
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [], getWindowForChrome: () => null },
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-compromise'), false);
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-compromise-recover'), false);
});

// ---------------------------------------------------------------------------
// menu-overlay:vault-compromise — master branch
// ---------------------------------------------------------------------------

test('compromise: valid → { ok:true } ONLY (never the key/report); Buffers passed; all four arrays zeroed; stash+hold BEFORE close+recovery-show (H2 ordering)', async () => {
  const captured = {};
  const vaultCompromiseRotate = async ({ oldMasterPassword, newMasterPassword }) => {
    captured.old = Buffer.from(oldMasterPassword).toString('utf8');
    captured.neu = Buffer.from(newMasterPassword).toString('utf8');
    captured.oldBuf = oldMasterPassword;
    captured.newBuf = newMasterPassword;
    captured.oldIsBuf = Buffer.isBuffer(oldMasterPassword);
    captured.newIsBuf = Buffer.isBuffer(newMasterPassword);
    return OK_RESULT;
  };
  const h = harness({ vaultCompromiseRotate });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise');
  const oldSecret = new TextEncoder().encode('old-master');
  const newSecret = new TextEncoder().encode('fresh-master');

  const res = await handler({ sender: h.sheetSender }, { token: 7, oldSecret, newSecret });

  assert.deepEqual(res, { ok: true }, 'the invoke reply carries { ok } only — never the key or report');
  assert.equal(captured.oldIsBuf, true);
  assert.equal(captured.newIsBuf, true);
  assert.equal(captured.old, 'old-master');
  assert.equal(captured.neu, 'fresh-master');
  // DUAL-zeroize: both copied Buffers AND both incoming Uint8Arrays.
  assert.ok(
    captured.oldBuf.every((b) => b === 0),
    'copied old Buffer zeroized'
  );
  assert.ok(
    captured.newBuf.every((b) => b === 0),
    'copied new Buffer zeroized'
  );
  assert.ok(
    oldSecret.every((b) => b === 0),
    'incoming old Uint8Array zeroized'
  );
  assert.ok(
    newSecret.every((b) => b === 0),
    'incoming new Uint8Array zeroized'
  );

  // H2 ordering: stash (which acquires the hold) STRICTLY before any sheet interaction.
  assert.deepEqual(h.events, [
    ['stash', 100],
    ['close', 'activated', 7],
    ['send', 'vault-recovery-show', { recoveryKey: 'NEW-COMPROMISE-RECOVERY-KEY', replacing: true }]
  ]);
  assert.equal(h.surfacing.holder.isHeld(100, 'compromise'), true, 'the suppression hold is live pending the ack');
  assert.deepEqual(h.surfacing.getReport(), { admin: true, vaultIds: ['global', 'work'] });
});

test('compromise: every mapped reason passes through untouched, sheet NOT closed, arrays still zeroed', async () => {
  for (const reason of ['reuse', 'auth', 'format', 'busy', 'state']) {
    const h = harness({ vaultCompromiseRotate: async () => ({ ok: false, reason }) });
    const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise');
    const oldSecret = new TextEncoder().encode('old');
    const newSecret = new TextEncoder().encode('new');
    const res = await handler({ sender: h.sheetSender }, { token: 7, oldSecret, newSecret });
    assert.deepEqual(res, { ok: false, reason });
    assert.deepEqual(h.events, [], `no stash/close/send on a '${reason}' refusal`);
    assert.ok(oldSecret.every((b) => b === 0));
    assert.ok(newSecret.every((b) => b === 0));
  }
});

test('compromise: an UNKNOWN delegate error rejects the invoke and still dual-zeroizes', async () => {
  const captured = {};
  const h = harness({
    vaultCompromiseRotate: async ({ oldMasterPassword, newMasterPassword }) => {
      captured.oldBuf = oldMasterPassword;
      captured.newBuf = newMasterPassword;
      throw new Error('disk exploded');
    }
  });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise');
  const oldSecret = new TextEncoder().encode('old');
  const newSecret = new TextEncoder().encode('new');
  await assert.rejects(() => handler({ sender: h.sheetSender }, { token: 7, oldSecret, newSecret }), /disk exploded/);
  assert.ok(captured.oldBuf.every((b) => b === 0));
  assert.ok(captured.newBuf.every((b) => b === 0));
  assert.ok(oldSecret.every((b) => b === 0));
  assert.ok(newSecret.every((b) => b === 0));
  assert.deepEqual(h.events, [], 'no sheet interaction, no stash');
});

test('compromise: wrong sender / stale token / non-Uint8Array / WRONG MENUTYPE → { ok:false }, delegate never called', async () => {
  let called = 0;
  const vaultCompromiseRotate = async () => {
    called += 1;
    return OK_RESULT;
  };
  const h = harness({ vaultCompromiseRotate });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise');
  const u8 = () => new Uint8Array([1]);

  assert.deepEqual(
    await handler({ sender: { isDestroyed: () => false } }, { token: 7, oldSecret: u8(), newSecret: u8() }),
    { ok: false }
  );
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: 6, oldSecret: u8(), newSecret: u8() }), {
    ok: false
  });
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: 7, oldSecret: 'str', newSecret: u8() }), {
    ok: false
  });
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: 7, oldSecret: u8() /* no newSecret */ }), {
    ok: false
  });

  // The menuType predicate (the M15 F3 lesson, named here as a guard): a DIFFERENT live
  // menu — even a sibling vault sheet — must never reach the destructive delegate.
  const wrongMenu = harness({ vaultCompromiseRotate, menuType: 'vault-change-master' });
  const wrongHandler = wrongMenu.ipcMain.handlers.get('menu-overlay:vault-compromise');
  assert.deepEqual(
    await wrongHandler({ sender: wrongMenu.sheetSender }, { token: 7, oldSecret: u8(), newSecret: u8() }),
    {
      ok: false
    }
  );
  assert.equal(called, 0);
});

test('compromise: WINDOW-GONE at resolution (H2 null-guard) — the reveal is stashed + held, nothing thrown, no sheet interaction; then the boot re-key moves reveal AND hold to the new window', async () => {
  const surfacing = makeSurfacing();
  let h;
  const vaultCompromiseRotate = async () => {
    // The window dies DURING the 2–3-scrypt await, after a durable commit.
    h.win.destroyed = true;
    h.rec.sheet = null; // window-factory's close handler nulls rec.sheet
    return OK_RESULT;
  };
  h = harness({ vaultCompromiseRotate, surfacing });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise');
  const oldSecret = new TextEncoder().encode('old');
  const newSecret = new TextEncoder().encode('new');

  const res = await handler({ sender: h.sheetSender }, { token: 7, oldSecret, newSecret });

  assert.deepEqual(res, { ok: true }, 'a durable commit reports success even with the window gone');
  // The naive close would have thrown here and LOST the reveal — the pin: stash only.
  assert.deepEqual(h.events, [['stash', 100]], 'stash happened; no close, no send on a dead window');
  assert.equal(surfacing.reveals.has(100), true, 'the reveal stays pending under the dead chrome id');
  assert.equal(surfacing.holder.isHeld(100, 'compromise'), true, 'its hold stays live');

  // H2 resurface: the next chrome boot re-keys the orphaned reveal to the new window.
  const reveal = surfacing.reveals.rekey(100, 555);
  assert.deepEqual(reveal, { recoveryKey: 'NEW-COMPROMISE-RECOVERY-KEY' }, 'the reveal survives, re-keyed');
  assert.equal(surfacing.reveals.has(100), false, 'the dead window key is gone');
  assert.equal(surfacing.reveals.has(555), true, 'the reveal now belongs to the new window');
  assert.equal(surfacing.holder.isHeld(100, 'compromise'), false, "the dead window's hold moved");
  assert.equal(surfacing.holder.isHeld(555, 'compromise'), true, "…to the new window's identity");
  // And the new window's ack completes normally.
  assert.equal(surfacing.ackCompromiseReveal(555), true);
  assert.equal(surfacing.holder.count(), 0);
});

// ---------------------------------------------------------------------------
// menu-overlay:vault-compromise-recover — recovery branch
// ---------------------------------------------------------------------------

test('compromise-recover: valid → { ok:true }; recovery Buffer passed; all four arrays zeroed; same H2 ordering', async () => {
  const captured = {};
  const vaultCompromiseRotate = async ({ recoveryKey, newMasterPassword }) => {
    captured.recovery = Buffer.from(recoveryKey).toString('utf8');
    captured.neu = Buffer.from(newMasterPassword).toString('utf8');
    captured.recoveryBuf = recoveryKey;
    captured.newBuf = newMasterPassword;
    return OK_RESULT;
  };
  const h = harness({ vaultCompromiseRotate, menuType: 'vault-compromise-recover' });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise-recover');
  const recoverySecret = new TextEncoder().encode('ABCD-EFGH-IJKL-MNOP');
  const newSecret = new TextEncoder().encode('fresh-master');

  const res = await handler({ sender: h.sheetSender }, { token: 7, recoverySecret, newSecret });

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.recovery, 'ABCD-EFGH-IJKL-MNOP');
  assert.equal(captured.neu, 'fresh-master');
  assert.ok(
    captured.recoveryBuf.every((b) => b === 0),
    'copied recovery Buffer zeroized'
  );
  assert.ok(
    captured.newBuf.every((b) => b === 0),
    'copied new Buffer zeroized'
  );
  assert.ok(
    recoverySecret.every((b) => b === 0),
    'incoming recovery Uint8Array zeroized'
  );
  assert.ok(
    newSecret.every((b) => b === 0),
    'incoming new Uint8Array zeroized'
  );
  assert.deepEqual(h.events, [
    ['stash', 100],
    ['close', 'activated', 7],
    ['send', 'vault-recovery-show', { recoveryKey: 'NEW-COMPROMISE-RECOVERY-KEY', replacing: true }]
  ]);
});

test('compromise-recover: reason pass-through + menuType predicate', async () => {
  const h = harness({
    vaultCompromiseRotate: async () => ({ ok: false, reason: 'format' }),
    menuType: 'vault-compromise-recover'
  });
  const handler = h.ipcMain.handlers.get('menu-overlay:vault-compromise-recover');
  const recoverySecret = new TextEncoder().encode('NOT-A-KEY');
  const newSecret = new TextEncoder().encode('new');
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: 7, recoverySecret, newSecret }), {
    ok: false,
    reason: 'format'
  });
  assert.ok(recoverySecret.every((b) => b === 0));

  let called = 0;
  const wrongMenu = harness({
    vaultCompromiseRotate: async () => {
      called += 1;
      return OK_RESULT;
    },
    menuType: 'vault-compromise' // the MASTER sheet is live, not the recover one
  });
  const wrongHandler = wrongMenu.ipcMain.handlers.get('menu-overlay:vault-compromise-recover');
  assert.deepEqual(
    await wrongHandler(
      { sender: wrongMenu.sheetSender },
      { token: 7, recoverySecret: new Uint8Array([1]), newSecret: new Uint8Array([1]) }
    ),
    { ok: false }
  );
  assert.equal(called, 0);
});

// ---------------------------------------------------------------------------
// H1 — the recovery-show ack discrimination, all four ack kinds
// ---------------------------------------------------------------------------

// A two-window activation harness: each window has its own sheet + chrome; the
// recovery-show sheet is the live menu on both. Surfacing delegates are the REAL
// holder/reveal-store composition.
function ackHarness() {
  const ipcMain = makeIpc();
  const surfacing = makeSurfacing();
  const sends = [];
  function makeWindow(winId, chromeId) {
    const sheetSender = { isDestroyed: () => false, _tag: chromeId };
    const win = { id: winId };
    const sheet = {
      getView: () => ({ webContents: sheetSender }),
      getCurrentMenu: () => ({ token: 7, menuType: 'vault-recovery-show' }),
      closeMenuOverlay: () => {}
    };
    const chrome = { id: chromeId, send: (channel, payload) => sends.push([chromeId, channel, payload]) };
    return { rec: { sheet, win }, sheetSender, chrome };
  }
  const a = makeWindow(1, 100);
  const b = makeWindow(2, 200);
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [a.rec, b.rec], getWindowForChrome: () => null },
    chromeForAttachment: (w) => (w === a.rec.win ? a.chrome : w === b.rec.win ? b.chrome : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined),
    takeAdoptAdminKey: (chromeId) => surfacing.takeAdoptAdminKey(chromeId),
    ackCompromiseReveal: (chromeId) => surfacing.ackCompromiseReveal(chromeId)
  });
  const activated = ipcMain.listeners.get('menu-overlay:activated');
  const ack = (windowHalf) => activated({ sender: windowHalf.sheetSender }, { id: 'ack', token: 7 });
  return { surfacing, sends, a, b, ack };
}

test('ack kind 1 — setup/rotate-recovery (no marker anywhere): a strict no-op — no second sheet, no broadcast, holder untouched', () => {
  const { surfacing, sends, a, ack } = ackHarness();
  ack(a);
  const secondSheetSends = sends.filter(([, ch]) => ch === 'vault-adminkey-show');
  assert.deepEqual(secondSheetSends, [], 'no adminkey-show');
  assert.deepEqual(surfacing.broadcasts, [], 'no completion broadcast');
  assert.equal(surfacing.holder.count(), 0);
});

test('ack kind 2 — adopt-only: the adminkey-show chain fires; the compromise path is untouched', () => {
  const { surfacing, sends, a, ack } = ackHarness();
  surfacing.stashAdoptAdminKey(100, 'adopt-admin-key-b64');
  ack(a);
  assert.deepEqual(
    sends.filter(([, ch]) => ch === 'vault-adminkey-show'),
    [[100, 'vault-adminkey-show', { adminPrivateKey: 'adopt-admin-key-b64' }]]
  );
  assert.deepEqual(surfacing.broadcasts, [], 'the adopt ack is NOT a compromise completion');
  assert.equal(surfacing.holder.count(), 0, "the adopt hold released — exactly (100, 'adopt')");
});

test('ack kind 3 — compromise-only: exact (chromeId, reason) release + the completion broadcast; no second sheet', () => {
  const { surfacing, sends, a, ack } = ackHarness();
  surfacing.stashCompromiseReveal(100, { recoveryKey: 'KEY', revoked: { admin: true, vaultIds: [] } });
  assert.equal(surfacing.holder.isHeld(100, 'compromise'), true);
  ack(a);
  assert.deepEqual(
    sends.filter(([, ch]) => ch === 'vault-adminkey-show'),
    [],
    'no adminkey-show'
  );
  assert.deepEqual(surfacing.broadcasts, ['vault-lock-state'], 'the completion trigger (M3): one re-broadcast');
  assert.equal(surfacing.holder.isHeld(100, 'compromise'), false, 'the exact pair released');
  assert.equal(surfacing.reveals.has(100), false, 'the reveal consumed');
});

test('ack kind 4 — both flows pending in DIFFERENT windows: each ack consumes only its own; neither release touches the other', () => {
  const { surfacing, sends, a, b, ack } = ackHarness();
  surfacing.stashAdoptAdminKey(100, 'window-a-adopt-key');
  surfacing.stashCompromiseReveal(200, { recoveryKey: 'WINDOW-B-KEY', revoked: { admin: false, vaultIds: ['jar1'] } });
  assert.equal(surfacing.holder.count(), 2);

  // Window A's ack: adopt chain only. Window B's compromise reveal + hold untouched.
  ack(a);
  assert.deepEqual(
    sends.filter(([, ch]) => ch === 'vault-adminkey-show'),
    [[100, 'vault-adminkey-show', { adminPrivateKey: 'window-a-adopt-key' }]]
  );
  assert.deepEqual(surfacing.broadcasts, [], "window A's ack fired no compromise completion");
  assert.equal(surfacing.holder.isHeld(200, 'compromise'), true, "window B's hold survives A's release");
  assert.equal(surfacing.reveals.has(200), true, "window B's reveal survives");
  assert.deepEqual(surfacing.suspended, [true], 'suppression NEVER dropped between the two acks');

  // Window B's ack: compromise completion only.
  ack(b);
  assert.deepEqual(surfacing.broadcasts, ['vault-lock-state']);
  assert.equal(surfacing.holder.count(), 0);
  assert.deepEqual(surfacing.suspended, [true, false], 'suppression cleared only once BOTH reveals are done');
});
