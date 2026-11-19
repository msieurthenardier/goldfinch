'use strict';

// Unit tests for vault/vault-wiring.js (Mission 24 Flight 3, leg 2) with fakes. Every test
// drives the module's real exports; the lock fan-out is driven through the `onLock` the
// wiring hands to the injected vaultStoreModule.load (the real idle/lock entry point).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVaultWiring } = require('../../src/main/vault/vault-wiring');
const { maskComments } = require('../helpers/source-scan');

function makeRig({ records = [], mcpServer = null } = {}) {
  const log = [];
  const loads = [];
  const store = {
    isSetUp: () => true,
    isUnlocked: () => false,
    setAutoLockSuspended: (on) => log.push(['suspend', on]),
    previewRestoreBundle: async () => ({ labels: [{ id: 'v1' }] }),
    restoreProfile: async () => ({ fresh: true, recoveryKeyDisplay: 'RK', results: [], generation: { n: 1 } })
  };
  const vaultStoreModule = {
    load: (dir, opts) => {
      loads.push({ dir, opts });
      return store;
    }
  };
  const sent = [];
  const documentMarks = { clearGrants: () => log.push(['clearGrants']) };
  const revealGate = { dropAllGrants: () => log.push(['dropAllGrants']) };
  const broadcasts = [];
  let server = mcpServer;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-wiring-'));
  const bundleFile = path.join(tmp, 'b.gfvaultbundle');
  fs.writeFileSync(bundleFile, JSON.stringify({ sourceVaultId: 'v1' }));
  const csvFile = path.join(tmp, 'p.csv');
  fs.writeFileSync(csvFile, 'name,url,username,password,note\nsite,https://a.example/,u,p,\n');
  const dialogFile = { path: bundleFile };
  const wiring = createVaultWiring({
    app: { getPath: () => '/userdata' },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [dialogFile.path] }) },
    webContents: { fromId: (id) => ({ send: (...a) => sent.push([id, ...a]) }) },
    registry: { records: () => records, getWindowForChrome: () => null },
    jars: { list: () => [] },
    settings: { get: () => 5 },
    vaultStoreModule,
    getMcpServer: () => server,
    documentMarks,
    revealGate,
    gestureTrace: () => {},
    chromeForTab: () => null,
    broadcastToChromeAndInternal: (...a) => broadcasts.push(a)
  });
  return {
    wiring,
    log,
    loads,
    store,
    sent,
    broadcasts,
    setServer: (s) => (server = s),
    pickCsv: () => (dialogFile.path = csvFile),
    cleanup: () => {
      // The held-import stores arm real safety-drop timers: a lock drops them so the process can exit.
      wiring.getVaultStore();
      loads.at(-1).opts.onLock();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

test('peekVaultStore is null before the first getVaultStore() and never constructs the store', () => {
  const r = makeRig();
  try {
    assert.equal(r.wiring.peekVaultStore(), null);
    assert.equal(r.wiring.peekVaultHuman(), null);
    assert.equal(r.loads.length, 0, 'a peek loads nothing');
    // The quit-lock / power-lock shape: optional-chained over the peek.
    assert.equal(r.wiring.peekVaultStore()?.lockNow(), undefined);
    assert.equal(r.loads.length, 0, 'still zero loads after the quit-lock shape ran');
    const store = r.wiring.getVaultStore();
    assert.equal(r.wiring.peekVaultStore(), store);
    assert.equal(r.loads.length, 1);
  } finally {
    r.cleanup();
  }
});

test('getVaultStore is memoized and loads from the userData directory', () => {
  const r = makeRig();
  try {
    assert.equal(r.wiring.getVaultStore(), r.wiring.getVaultStore());
    assert.equal(r.loads.length, 1);
    assert.equal(r.loads[0].dir, '/userdata');
  } finally {
    r.cleanup();
  }
});

test('the store onLock fans out: grants cleared, sheets closed with vault-lock, MCP zeroized (LIVE server), lock state broadcast', () => {
  const closes = [];
  const rec = (id) => ({ sheet: { closeMenuOverlay: (reason) => closes.push([id, reason]) }, tabViews: new Map() });
  const records = [rec('a'), { sheet: null, tabViews: new Map() }, rec('b')];
  const r = makeRig({ records });
  try {
    r.wiring.getVaultStore();
    const { onLock } = r.loads[0].opts;
    // The server mounts AFTER construction: the lock must reach the live one.
    let zeroized = 0;
    r.setServer({ zeroizeAllVaultSessions: () => zeroized++ });
    onLock();
    assert.deepEqual(r.log[0], ['clearGrants']);
    assert.deepEqual(closes, [
      ['a', 'vault-lock'],
      ['b', 'vault-lock']
    ]);
    assert.equal(zeroized, 1);
    assert.deepEqual(r.broadcasts.at(-1), ['vault-lock-state', { setUp: true, unlocked: false }]);
    // No server: a no-op, never a throw.
    r.setServer(null);
    assert.doesNotThrow(() => onLock());
  } finally {
    r.cleanup();
  }
});

test('releaseVaultHoldsForWindow drops the held import and releases the suppression hold for that window only', async () => {
  const r = makeRig();
  try {
    const begun = await r.wiring.vaultImportBeginFromFile(7);
    assert.equal(begun.ok, true);
    await r.wiring.vaultImportBeginFromFile(8);
    r.wiring.stashCompromiseReveal(7, { recoveryKey: 'K', revoked: null });
    assert.deepEqual(r.log.at(-1), ['suspend', true]);
    assert.deepEqual(await r.wiring.vaultImportPreviewFromSheet(7, Buffer.from('s'), 'master'), { ok: true });

    r.wiring.releaseVaultHoldsForWindow(7);
    assert.deepEqual(await r.wiring.vaultImportPreviewFromSheet(7, Buffer.from('s'), 'master'), { ok: false });
    assert.deepEqual(r.log.at(-1), ['suspend', false], 'the window suppression hold is released');
    // Window 8's record is untouched.
    assert.deepEqual(await r.wiring.vaultImportPreviewFromSheet(8, Buffer.from('s'), 'master'), { ok: true });
    // null id: strict no-op.
    assert.doesNotThrow(() => r.wiring.releaseVaultHoldsForWindow(null));
  } finally {
    r.cleanup();
  }
});

test('releaseVaultHoldsForWindow and the store onLock clear the held browser import', async () => {
  const r = makeRig();
  try {
    r.pickCsv();
    const flow = r.wiring.getBrowserImportFlow();
    assert.equal(r.wiring.getBrowserImportFlow(), flow, 'memoized');
    assert.equal((await flow.begin(5)).ok, true);
    assert.notEqual(flow.summary(5), null, 'held after begin');
    r.wiring.releaseVaultHoldsForWindow(5);
    assert.equal(flow.summary(5), null, 'released with its window');
    assert.equal((await flow.begin(6)).ok, true);
    r.wiring.getVaultStore();
    r.loads[0].opts.onLock();
    assert.equal(flow.summary(6), null, 'dropped by the lock');
  } finally {
    r.cleanup();
  }
});

test('vaultImportCommit calls revealGate.dropAllGrants() after a successful restore, and not for a stale handle', async () => {
  const r = makeRig();
  try {
    const { importHandle } = await r.wiring.vaultImportBeginFromFile(7);
    await r.wiring.vaultImportPreviewFromSheet(7, Buffer.from('secret'), 'master');
    // A stale handle never writes and never drops grants.
    assert.deepEqual(await r.wiring.vaultImportCommit(7, 'not-the-handle', {}), { ok: false, reason: 'state' });
    assert.equal(
      r.log.some((e) => e[0] === 'dropAllGrants'),
      false
    );
    const res = await r.wiring.vaultImportCommit(7, importHandle, {});
    assert.equal(res.ok, true);
    assert.equal(res.fresh, true);
    assert.equal(r.log.filter((e) => e[0] === 'dropAllGrants').length, 1);
    // A fresh adopt: the reveal is sent to the owning chrome and the sever offer is surfaced.
    assert.deepEqual(r.sent[0], [7, 'vault-recovery-show', { recoveryKey: 'RK', replacing: true }]);
    assert.notEqual(r.wiring.severOfferRoute(), null);
  } finally {
    r.cleanup();
  }
});

test('accessors: compromise report get/clear and sever offer clear', async () => {
  const r = makeRig();
  try {
    assert.equal(r.wiring.getCompromiseReport(), null);
    r.wiring.stashCompromiseReveal(3, { recoveryKey: 'K', revoked: { admin: true, vaultIds: ['v1', 4] } });
    const report = r.wiring.getCompromiseReport();
    assert.equal(report.admin, true);
    assert.deepEqual(report.vaultIds, ['v1']);
    r.wiring.clearCompromiseReport();
    assert.equal(r.wiring.getCompromiseReport(), null);

    assert.equal(r.wiring.severOfferRoute(), null);
    const { importHandle } = await r.wiring.vaultImportBeginFromFile(9);
    await r.wiring.vaultImportPreviewFromSheet(9, Buffer.from('s'), 'recovery');
    await r.wiring.vaultImportCommit(9, importHandle, {});
    assert.notEqual(r.wiring.severOfferRoute(), null, 'a fresh adopt surfaces the offer');
    r.wiring.clearSeverOffer();
    assert.equal(r.wiring.severOfferRoute(), null);
  } finally {
    r.cleanup();
  }
});

test('ackVaultReveal: no pending reveal is a strict no-op; a pending one broadcasts the lock state', () => {
  const r = makeRig();
  try {
    assert.equal(r.wiring.ackVaultReveal(1), false);
    assert.equal(r.broadcasts.length, 0);
    r.wiring.stashCompromiseReveal(1, { recoveryKey: 'K', revoked: null });
    assert.equal(r.wiring.ackVaultReveal(1), true);
    assert.equal(r.broadcasts.at(-1)[0], 'vault-lock-state');
  } finally {
    r.cleanup();
  }
});

test('vault-wiring.js stays Electron-free (no require of electron)', () => {
  const src = maskComments(fs.readFileSync(path.join(__dirname, '../../src/main/vault/vault-wiring.js'), 'utf8'));
  assert.ok(src.includes('createVaultWiring'), 'scan target is the real module');
  assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(src), false);
  const neutered = src + "\nconst e = require('electron');";
  assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(neutered), true, 'the scan can fail');
});
