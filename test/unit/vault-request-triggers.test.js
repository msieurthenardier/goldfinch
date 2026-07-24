'use strict';

// Integration tests for the cross-renderer setup/unlock request triggers (M12 Flight 3
// Leg 4 first-run-setup, DD5): internal-vault-request-setup / internal-vault-request-unlock
// in register-browser-ipc.js. Wired with the REAL registerInternalHandler so the origin
// gate is exercised end-to-end: a non-internal sender is REJECTED before the body runs; an
// internal sender forwards a BARE trigger (no secret) to the owning window's chrome via
// chromeForTab(event.sender.id). The two DISTINCT channels drive the two distinct chrome
// sheets (vault-set vs. vault-unlock).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerBrowserIpc } = require('../../src/main/register-browser-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');

// registerInternalHandler(ipcMain, channel, fn) calls ipcMain.handle(channel, wrapped).
// We drive the WRAPPED handler directly, so build the harness with an ipcMain.handle that
// records the wrapped fns.
function makeCapturingHarness() {
  const wrapped = new Map();
  const sends = [];
  const chrome = { send: (channel, payload) => sends.push([channel, payload]) };
  registerBrowserIpc({
    ipcMain: { handle: (channel, fn) => wrapped.set(channel, fn), on: () => {} },
    webContents: { fromId: () => null },
    chromeForTab: (id) => (id === 5 ? chrome : null),
    getTabContents: () => null,
    applyZoom: () => {},
    isInternalContents: () => false,
    toggleDevTools: () => false,
    registerInternalHandler,
    jars: { list: () => [], add: () => ({}) },
    registry: { getWindowForChrome: () => null },
    createWindow: () => ({ win: { id: 1 } }),
    broadcastJarsChanged: () => {},
    isSafeTabUrl: () => false,
    getChromeContents: () => chrome,
    session: { fromPartition: () => ({}) },
    registrableDomain: (h) => h,
    hostnameOf: (u) => new URL(u).hostname,
    shields: { active: () => false },
    getVaultHuman: () => ({}),
  });
  return { wrapped, sends, chrome };
}

const internalEvent = (id) => ({
  senderFrame: { origin: 'goldfinch://vault' },
  sender: { id, session: { __goldfinchInternal: true } },
});
const webEvent = (id) => ({
  senderFrame: { origin: 'https://evil.example' },
  sender: { id, session: {} },
});

test('all three request channels are registered through the internal origin gate', () => {
  const { wrapped } = makeCapturingHarness();
  assert.equal(wrapped.has('internal-vault-request-setup'), true);
  assert.equal(wrapped.has('internal-vault-request-unlock'), true);
  assert.equal(wrapped.has('internal-vault-request-mint'), true);
});

test('internal sender: request-setup forwards a bare vault-request-setup trigger to the owning chrome', () => {
  const { wrapped, sends } = makeCapturingHarness();
  const res = wrapped.get('internal-vault-request-setup')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, [['vault-request-setup', undefined]]);
});

test('internal sender: request-unlock forwards a DISTINCT vault-request-unlock trigger', () => {
  const { wrapped, sends } = makeCapturingHarness();
  wrapped.get('internal-vault-request-unlock')(internalEvent(5));
  assert.deepEqual(sends, [['vault-request-unlock', undefined]]);
});

test('internal sender: request-mint forwards vault-request-mint carrying the NON-SECRET target', () => {
  const { wrapped, sends } = makeCapturingHarness();
  const res = wrapped.get('internal-vault-request-mint')(internalEvent(5), 'work');
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, [['vault-request-mint', { target: 'work' }]]);
});

// ---------------------------------------------------------------------------
// Key-rotation / recover triggers (M12 Flight 4 Leg 2 key-rotation, DD3/DD2) — three BARE
// cross-renderer triggers, origin-gated, forwarding to the owning chrome.
// ---------------------------------------------------------------------------

test('the three rotation/recover request channels are registered through the internal origin gate', () => {
  const { wrapped } = makeCapturingHarness();
  assert.equal(wrapped.has('internal-vault-request-rotate-recovery'), true);
  assert.equal(wrapped.has('internal-vault-request-change-master'), true);
  assert.equal(wrapped.has('internal-vault-request-recover'), true);
});

test('internal sender: rotate-recovery / change-master / recover each forward their DISTINCT bare trigger', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.deepEqual(wrapped.get('internal-vault-request-rotate-recovery')(internalEvent(5)), { ok: true });
  assert.deepEqual(wrapped.get('internal-vault-request-change-master')(internalEvent(5)), { ok: true });
  assert.deepEqual(wrapped.get('internal-vault-request-recover')(internalEvent(5)), { ok: true });
  assert.deepEqual(sends, [
    ['vault-request-rotate-recovery', undefined],
    ['vault-request-change-master', undefined],
    ['vault-request-recover', undefined],
  ]);
});

test('non-internal sender is REJECTED for each rotation/recover trigger (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  for (const ch of ['internal-vault-request-rotate-recovery', 'internal-vault-request-change-master', 'internal-vault-request-recover']) {
    assert.throws(() => wrapped.get(ch)(webEvent(9)), new RegExp(`forbidden: non-internal sender for ${ch}`));
  }
  assert.deepEqual(sends, []);
});

test('non-internal sender is REJECTED before the body runs (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.throws(
    () => wrapped.get('internal-vault-request-setup')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-setup/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-unlock')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-unlock/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-mint')(webEvent(9), 'work'),
    /forbidden: non-internal sender for internal-vault-request-mint/,
  );
  assert.deepEqual(sends, [], 'a rejected request forwards nothing to chrome');
});

test('an unresolvable owning chrome no-ops gracefully (still returns ok)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  // sender id 6 does not resolve a chrome (chromeForTab returns null) — the optional chain
  // no-ops; the handler still returns { ok: true }.
  const res = wrapped.get('internal-vault-request-setup')(internalEvent(6));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, []);
});

// ---------------------------------------------------------------------------
// Import (M12 Flight 4 Leg 1 export-import; SPLIT for the F5 HAT page modal, I14). The old atomic
// request-import (pick+forward in ONE call) is split into three page-invoked channels so the page's
// Import modal owns destination+file selection BEFORE the secret sheet opens:
//   • pickImportFile          — dialog+read+HOLD, returns { ok, path } | { canceled } | { error }; NO forward.
//   • beginImportUnlock       — the BARE vault-request-import forward (unconditional; needs only chromeForTab).
//   • clearPendingImport      — drops the held record (L1) on modal dismiss.
// pickImportFile is GATED on vaultImportBegin; clearPendingImport on clearPendingVaultImport.
// ---------------------------------------------------------------------------

function makeImportHarness({ beginResult } = {}) {
  const wrapped = new Map();
  const sends = [];
  const beginCalls = [];
  const beginChromeIds = [];
  const clearArgs = [];
  const overwriteCalls = [];
  let clearCalls = 0;
  const chrome = { send: (channel, payload) => sends.push([channel, payload]) };
  registerBrowserIpc({
    ipcMain: { handle: (channel, fn) => wrapped.set(channel, fn), on: () => {} },
    webContents: { fromId: () => null },
    chromeForTab: (id) => (id === 5 ? chrome : null),
    getTabContents: () => null,
    applyZoom: () => {},
    isInternalContents: () => false,
    toggleDevTools: () => false,
    registerInternalHandler,
    jars: { list: () => [], add: () => ({}) },
    registry: { getWindowForChrome: () => null },
    createWindow: () => ({ win: { id: 1 } }),
    broadcastJarsChanged: () => {},
    isSafeTabUrl: () => false,
    getChromeContents: () => chrome,
    session: { fromPartition: () => ({}) },
    registrableDomain: (h) => h,
    hostnameOf: (u) => new URL(u).hostname,
    shields: { active: () => false },
    getVaultHuman: () => ({}),
    vaultImportBegin: async (destinationTarget, chromeId) => {
      beginCalls.push(destinationTarget);
      beginChromeIds.push(chromeId); // finding 5: the owning-chrome id is threaded in.
      return beginResult || { ok: true, path: '/x/bundle.gfvaultbundle' };
    },
    clearPendingVaultImport: (chromeId, handle) => { clearCalls += 1; clearArgs.push([chromeId, handle]); },
    setPendingVaultImportOverwrite: (chromeId, overwrite) => { overwriteCalls.push(overwrite); },
  });
  return { wrapped, sends, beginCalls, beginChromeIds, clearArgs, overwriteCalls, clearCallsCount: () => clearCalls };
}

test('pickImportFile is GATED on vaultImportBegin; clearPendingImport on clearPendingVaultImport; beginImportUnlock is unconditional', () => {
  const { wrapped } = makeCapturingHarness(); // neither injection
  assert.equal(wrapped.has('internal-vault-pick-import-file'), false);
  assert.equal(wrapped.has('internal-vault-clear-pending-import'), false);
  assert.equal(wrapped.has('internal-vault-begin-import-unlock'), true, 'the bare forward needs only chromeForTab');
  const withDep = makeImportHarness();
  assert.equal(withDep.wrapped.has('internal-vault-pick-import-file'), true);
  assert.equal(withDep.wrapped.has('internal-vault-clear-pending-import'), true);
});

test('internal sender: pickImportFile runs vaultImportBegin (dialog+read+hold) and returns { ok, path } WITHOUT forwarding', async () => {
  const { wrapped, sends, beginCalls } = makeImportHarness();
  const res = await wrapped.get('internal-vault-pick-import-file')(internalEvent(5), 'work');
  assert.deepEqual(res, { ok: true, path: '/x/bundle.gfvaultbundle' });
  assert.deepEqual(beginCalls, ['work'], 'the destination target is passed to the file-open delegate');
  assert.deepEqual(sends, [], 'picking a file opens NO sheet — the forward is a separate step');
});

test('internal sender: beginImportUnlock forwards a BARE vault-request-import to the owning chrome', () => {
  const { wrapped, sends } = makeImportHarness();
  const res = wrapped.get('internal-vault-begin-import-unlock')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, [['vault-request-import', undefined]], 'a BARE trigger — no secret, no target');
});

test('beginImportUnlock binds `overwrite` (the Replace checkbox) onto the held record before forwarding (M12 F5 HAT tail)', () => {
  // overwrite:true (Replace confirmed) → the delegate is called with strict true.
  const yes = makeImportHarness();
  yes.wrapped.get('internal-vault-begin-import-unlock')(internalEvent(5), true);
  assert.deepEqual(yes.overwriteCalls, [true]);
  assert.deepEqual(yes.sends, [['vault-request-import', undefined]], 'still a bare forward — only a boolean crosses');

  // overwrite absent / false / truthy-but-not-true → coerced to strict false (overwrite DESTROYS).
  for (const arg of [undefined, false, 'true', 1]) {
    const h = makeImportHarness();
    h.wrapped.get('internal-vault-begin-import-unlock')(internalEvent(5), arg);
    assert.deepEqual(h.overwriteCalls, [false], `overwrite=${JSON.stringify(arg)} → strict false`);
  }
});

test('a canceled / failed pick holds nothing and does not forward', async () => {
  const canceled = makeImportHarness({ beginResult: { canceled: true } });
  const cres = await canceled.wrapped.get('internal-vault-pick-import-file')(internalEvent(5), 'work');
  assert.deepEqual(cres, { canceled: true });
  assert.deepEqual(canceled.sends, [], 'a canceled dialog forwards nothing');

  const errored = makeImportHarness({ beginResult: { error: 'unreadable' } });
  const eres = await errored.wrapped.get('internal-vault-pick-import-file')(internalEvent(5), 'work');
  assert.deepEqual(eres, { error: 'unreadable' });
  assert.deepEqual(errored.sends, [], 'an unreadable bundle forwards nothing');
});

test('internal sender: clearPendingImport drops the held record (L1)', () => {
  const h = makeImportHarness();
  const res = h.wrapped.get('internal-vault-clear-pending-import')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.equal(h.clearCallsCount(), 1);
});

test('non-internal sender is REJECTED for each import channel (no delegate run, no forward)', () => {
  const { wrapped, sends, beginCalls } = makeImportHarness();
  // The origin gate throws SYNCHRONOUSLY in the registerInternalHandler wrapper, before any body
  // runs (the same shape as the setup/unlock/mint rejections above).
  assert.throws(
    () => wrapped.get('internal-vault-pick-import-file')(webEvent(9), 'work'),
    /forbidden: non-internal sender for internal-vault-pick-import-file/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-begin-import-unlock')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-begin-import-unlock/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-clear-pending-import')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-clear-pending-import/,
  );
  assert.deepEqual(beginCalls, [], 'the file-open delegate never runs for a foreign sender');
  assert.deepEqual(sends, []);
});
