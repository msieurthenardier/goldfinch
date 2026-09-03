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
    getVaultHuman: () => ({})
  });
  return { wrapped, sends, chrome };
}

const internalEvent = (id) => ({
  senderFrame: { origin: 'goldfinch://vault' },
  sender: { id, session: { __goldfinchInternal: true } }
});
const webEvent = (id) => ({
  senderFrame: { origin: 'https://evil.example' },
  sender: { id, session: {} }
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
    ['vault-request-recover', undefined]
  ]);
});

// ---------------------------------------------------------------------------
// Compromise-mode rotation trigger (M18 F2 L4) — a BARE cross-renderer trigger,
// origin-gated, forwarding vault-request-compromise to the owning chrome (which
// opens the vault-compromise sheet; reachable from BOTH lock states, R4).
// ---------------------------------------------------------------------------

test('internal sender: request-compromise is registered and forwards its DISTINCT bare trigger', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.equal(wrapped.has('internal-vault-request-compromise'), true);
  assert.deepEqual(wrapped.get('internal-vault-request-compromise')(internalEvent(5)), { ok: true });
  assert.deepEqual(sends, [['vault-request-compromise', undefined]]);
});

test('non-internal sender is REJECTED for the compromise trigger (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.throws(
    () => wrapped.get('internal-vault-request-compromise')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-compromise/
  );
  assert.deepEqual(sends, []);
});

test('non-internal sender is REJECTED for each rotation/recover trigger (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  for (const ch of [
    'internal-vault-request-rotate-recovery',
    'internal-vault-request-change-master',
    'internal-vault-request-recover'
  ]) {
    assert.throws(() => wrapped.get(ch)(webEvent(9)), new RegExp(`forbidden: non-internal sender for ${ch}`));
  }
  assert.deepEqual(sends, []);
});

test('non-internal sender is REJECTED before the body runs (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.throws(
    () => wrapped.get('internal-vault-request-setup')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-setup/
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-unlock')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-unlock/
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-mint')(webEvent(9), 'work'),
    /forbidden: non-internal sender for internal-vault-request-mint/
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
// Restore (M12 Flight 4 Leg 1 export-import; SPLIT for the F5 HAT page modal, I14; RE-MODELED
// M18 F3 Leg 3 / DD2 ruling 1 — the pinned-shape casualty named in the leg spec: pick no longer
// carries or binds a destination, so `vaultImportBegin(destinationTarget, chromeId)` loses its
// first argument and `setPendingVaultImportOverwrite` is GONE entirely — destination + mode are
// commit-time mapping concerns). The page-invoked channels:
//   • pickImportFile          — dialog+read+HOLD { bundle, handle }, returns
//                                { ok, path, importHandle } | { canceled } | { error }; NO forward.
//   • beginImportUnlock       — a fully BARE vault-request-import forward (needs only chromeForTab).
//   • clearPendingImport      — drops the held record (DD5 matrix's explicit-cancel row).
//   • fetchImportLabels       — the page's window-scoped labels fetch (DD2 ruling 3(c)).
//   • commitImport            — mapping → per-vault outcomes + generation (DD2 ruling 3(e)).
//   • severDismiss            — DD7's offer-card dismiss.
// pickImportFile is GATED on vaultImportBegin; clearPendingImport on clearPendingVaultImport;
// fetchImportLabels/commitImport/severDismiss on their own delegates.
// ---------------------------------------------------------------------------

function makeImportHarness({ beginResult, commitResult, labelsResult } = {}) {
  const wrapped = new Map();
  const sends = [];
  const beginCalls = [];
  const beginChromeIds = [];
  const clearArgs = [];
  const commitCalls = [];
  const labelsCalls = [];
  const severDismissCalls = [];
  let clearCalls = 0;
  const chrome = { id: 5, send: (channel, payload) => sends.push([channel, payload]) };
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
    vaultImportBegin: async (chromeId) => {
      beginChromeIds.push(chromeId); // finding 5: the owning-chrome id is threaded in.
      beginCalls.push(chromeId);
      return beginResult || { ok: true, path: '/x/bundle.gfvaultbundle', importHandle: 'h1' };
    },
    clearPendingVaultImport: (chromeId, handle) => {
      clearCalls += 1;
      clearArgs.push([chromeId, handle]);
    },
    vaultImportFetchLabels: (chromeId) => {
      labelsCalls.push(chromeId);
      return labelsResult !== undefined ? labelsResult : null;
    },
    vaultImportCommit: async (chromeId, handle, mapping) => {
      commitCalls.push([chromeId, handle, mapping]);
      return commitResult || { ok: true, fresh: false, results: [], generation: { completedAt: 1, nonce: 'n' } };
    },
    vaultImportSeverDismiss: () => {
      severDismissCalls.push(true);
    }
  });
  return {
    wrapped,
    sends,
    beginCalls,
    beginChromeIds,
    clearArgs,
    commitCalls,
    labelsCalls,
    severDismissCalls,
    clearCallsCount: () => clearCalls
  };
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

test('internal sender: pickImportFile runs vaultImportBegin (dialog+read+hold, NO destination) and returns { ok, path, importHandle } WITHOUT forwarding', async () => {
  const { wrapped, sends, beginCalls, beginChromeIds } = makeImportHarness();
  const res = await wrapped.get('internal-vault-pick-import-file')(internalEvent(5));
  assert.deepEqual(res, { ok: true, path: '/x/bundle.gfvaultbundle', importHandle: 'h1' });
  assert.deepEqual(beginChromeIds, [5], 'ONLY the owning-chrome id is passed — no destination (DD2 ruling 1)');
  assert.deepEqual(beginCalls, [5]);
  assert.deepEqual(sends, [], 'picking a file opens NO sheet — the forward is a separate step');
});

test('internal sender: beginImportUnlock forwards a fully BARE vault-request-import to the owning chrome', () => {
  const { wrapped, sends } = makeImportHarness();
  const res = wrapped.get('internal-vault-begin-import-unlock')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(
    sends,
    [['vault-request-import', undefined]],
    'a BARE trigger — no secret, no target, no overwrite (destination/mode moved to commit)'
  );
});

test('a canceled / failed pick holds nothing and does not forward', async () => {
  const canceled = makeImportHarness({ beginResult: { canceled: true } });
  const cres = await canceled.wrapped.get('internal-vault-pick-import-file')(internalEvent(5));
  assert.deepEqual(cres, { canceled: true });
  assert.deepEqual(canceled.sends, [], 'a canceled dialog forwards nothing');

  const errored = makeImportHarness({ beginResult: { error: 'unreadable' } });
  const eres = await errored.wrapped.get('internal-vault-pick-import-file')(internalEvent(5));
  assert.deepEqual(eres, { error: 'unreadable' });
  assert.deepEqual(errored.sends, [], 'an unreadable bundle forwards nothing');
});

test('internal sender: fetchImportLabels is window-scoped and forwards the delegate result verbatim (including null)', () => {
  const nully = makeImportHarness({ labelsResult: null });
  assert.deepEqual(nully.wrapped.get('internal-vault-import-labels')(internalEvent(5)), null);
  assert.deepEqual(nully.labelsCalls, [5]);

  const withLabels = makeImportHarness({
    labelsResult: { handle: 'h1', labels: [{ sourceId: 'global', jarMeta: null, itemCount: 2 }] }
  });
  assert.deepEqual(withLabels.wrapped.get('internal-vault-import-labels')(internalEvent(5)), {
    handle: 'h1',
    labels: [{ sourceId: 'global', jarMeta: null, itemCount: 2 }]
  });
});

test('internal sender: commitImport validates the payload shape before calling the delegate', async () => {
  const h = makeImportHarness();
  const commit = h.wrapped.get('internal-vault-import-commit');
  assert.deepEqual(await commit(internalEvent(5), { handle: 'h1', mapping: { global: { directive: 'skip' } } }), {
    ok: true,
    fresh: false,
    results: [],
    generation: { completedAt: 1, nonce: 'n' }
  });
  assert.deepEqual(h.commitCalls, [[5, 'h1', { global: { directive: 'skip' } }]]);

  // Malformed payloads never reach the delegate — a non-secret refusal instead.
  const rejected = makeImportHarness();
  const rejectedCommit = rejected.wrapped.get('internal-vault-import-commit');
  assert.deepEqual(await rejectedCommit(internalEvent(5), {}), { ok: false, reason: 'state' });
  assert.deepEqual(await rejectedCommit(internalEvent(5), { handle: 'h1' }), { ok: false, reason: 'state' });
  assert.deepEqual(rejected.commitCalls, []);
});

test('internal sender: severDismiss calls the delegate and returns { ok:true }', () => {
  const h = makeImportHarness();
  const res = h.wrapped.get('internal-vault-sever-dismiss')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.severDismissCalls, [true]);
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
    /forbidden: non-internal sender for internal-vault-pick-import-file/
  );
  assert.throws(
    () => wrapped.get('internal-vault-begin-import-unlock')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-begin-import-unlock/
  );
  assert.throws(
    () => wrapped.get('internal-vault-clear-pending-import')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-clear-pending-import/
  );
  assert.deepEqual(beginCalls, [], 'the file-open delegate never runs for a foreign sender');
  assert.deepEqual(sends, []);
});
