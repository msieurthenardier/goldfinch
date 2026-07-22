'use strict';

// Unit tests for src/main/register-vault-ipc.js (M12 Flight 3, Leg 1).
//
// Uses the REAL registerInternalHandler from internal-ipc.js (not a fake store)
// so the origin + session-identity guard is genuinely exercised — the register-
// settings-ipc.test.js pattern, plus the guard end-to-end. Electron-free.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');
const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const REAL_JARS = [{ id: 'work' }, { id: 'personal' }];
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vaultipc-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

/** Minimal fake ipcMain: stores each registered handler for direct invocation. */
function makeFakeIpcMain() {
  return {
    _handlers: {},
    handle(channel, fn) { this._handlers[channel] = fn; },
    invoke(channel, event, ...args) {
      const fn = this._handlers[channel];
      if (!fn) throw new Error('no handler for ' + channel);
      return fn(event, ...args);
    }
  };
}

/** A trusted event from the genuine goldfinch://vault origin + internal session. */
function vaultEvent() {
  return {
    senderFrame: { origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
    sender: { session: { __goldfinchInternal: true } }
  };
}

// Fake store: isSetUp/isUnlocked + a listItemsMeta that yields `counts[vaultId]`
// metadata rows (for the isUnlocked-guarded count path).
function makeStore({ setUp = true, unlocked = false, counts = {} } = {}) {
  return {
    isSetUp: () => setUp,
    isUnlocked: () => unlocked,
    listItemsMeta: (vaultId) => Array.from({ length: counts[vaultId] || 0 }, (_v, i) => ({ id: `${vaultId}-${i}` }))
  };
}

function wire({ store = makeStore(), jarsList = [] } = {}) {
  const ipcMain = makeFakeIpcMain();
  registerVaultIpc({
    ipcMain,
    registerInternalHandler,
    getVaultStore: () => store,
    jars: { list: () => jarsList }
  });
  return ipcMain;
}

// A harness wired to a REAL, set-up, unlocked vault store (FAST scrypt) — exercises
// the CRUD handlers end-to-end through registerInternalHandler.
async function realHarness() {
  const dir = tmpDir();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS });
  await store.setup({ masterPassword: MASTER });
  const ipcMain = makeFakeIpcMain();
  registerVaultIpc({ ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS } });
  return { dir, store, ipcMain };
}

const CRUD_CHANNELS = ['internal-vault-list', 'internal-vault-reveal', 'internal-vault-item-save', 'internal-vault-item-delete'];
const ACCESSKEY_CHANNELS = ['internal-vault-accesskey-list', 'internal-vault-accesskey-revoke'];

test('registerVaultIpc registers the state read + the vault-presence probe + the four item CRUD channels + live-totp + the two access-key channels + the global lock', () => {
  const ipcMain = wire();
  assert.deepEqual(
    Object.keys(ipcMain._handlers).sort(),
    [
      'internal-vault-accesskey-list',
      'internal-vault-accesskey-revoke',
      'internal-vault-has',
      'internal-vault-item-delete',
      'internal-vault-item-save',
      'internal-vault-list',
      'internal-vault-lock',
      'internal-vault-reveal',
      'internal-vault-state',
      'internal-vault-totp-code'
    ]
  );
});

// ---------------------------------------------------------------------------
// Global LOCK (M12 F5 HAT batch 1, I6) — internal-vault-lock. A bare internal handler that
// calls the store's global lockNow() and returns { ok: true }; it must NOT re-broadcast (the
// store's onLock hook already emits vault-lock-state), and it carries no secret.
// ---------------------------------------------------------------------------

test('internal-vault-lock: an internal sender calls the store lockNow() exactly once and returns { ok: true }', () => {
  const calls = [];
  const store = { ...makeStore(), lockNow: () => calls.push('lockNow') };
  const ipcMain = wire({ store });
  const res = ipcMain.invoke('internal-vault-lock', vaultEvent());
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(calls, ['lockNow'], 'exactly one lockNow, no re-broadcast side-channel');
});

test('internal-vault-lock rejects a non-internal sender (forbidden) — no lock', () => {
  const calls = [];
  const store = { ...makeStore(), lockNow: () => calls.push('lockNow') };
  const ipcMain = wire({ store });
  const webEvent = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } } // right session, wrong origin
  };
  assert.throws(
    () => ipcMain.invoke('internal-vault-lock', webEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
  assert.deepEqual(calls, [], 'a rejected sender never reaches lockNow');
});

test('internal-vault-lock drives the REAL store lockNow → onLock (the single vault-lock-state broadcast) fires EXACTLY once', async () => {
  const dir = tmpDir();
  try {
    let broadcasts = 0;
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS,
      onLock: () => { broadcasts += 1; }, // stands in for broadcastVaultLockState
    });
    await store.setup({ masterPassword: MASTER }); // set up + unlocked
    const ipcMain = makeFakeIpcMain();
    registerVaultIpc({ ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS } });

    const res = ipcMain.invoke('internal-vault-lock', vaultEvent());
    assert.deepEqual(res, { ok: true });
    assert.equal(store.isUnlocked(), false, 'the store is now locked');
    assert.equal(broadcasts, 1, 'the store onLock (broadcast) fired exactly once — no double-broadcast');
  } finally { rm(dir); }
});

test('internal-vault-state returns setUp/unlocked + Global-first labels with UNLOCKED item counts', () => {
  const ipcMain = wire({
    store: makeStore({ setUp: true, unlocked: true, counts: { global: 2, personal: 1, work: 0 } }),
    jarsList: [
      { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal', retentionDays: 30 },
      { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work', retentionDays: 30 }
    ]
  });

  const state = ipcMain.invoke('internal-vault-state', vaultEvent());
  assert.equal(state.setUp, true);
  assert.equal(state.unlocked, true);
  // Counts are present ONLY because the store is unlocked (isUnlocked-guarded).
  assert.deepEqual(state.vaults, [
    { vaultId: 'global', label: 'Global', count: 2 },
    { vaultId: 'personal', label: 'Personal', count: 1 },
    { vaultId: 'work', label: 'Work', count: 0 }
  ]);
});

test('internal-vault-state reflects not-set-up / locked store state', () => {
  const notSetUp = wire({ store: makeStore({ setUp: false, unlocked: false }) })
    .invoke('internal-vault-state', vaultEvent());
  assert.equal(notSetUp.setUp, false);
  assert.equal(notSetUp.unlocked, false);
  // The vault list is still composed from jars (labels need no MRK); here empty + Global.
  assert.deepEqual(notSetUp.vaults, [{ vaultId: 'global', label: 'Global' }]);

  const locked = wire({
    store: makeStore({ setUp: true, unlocked: false }),
    jarsList: [{ id: 'personal', name: 'Personal' }]
  }).invoke('internal-vault-state', vaultEvent());
  assert.equal(locked.setUp, true);
  assert.equal(locked.unlocked, false);
  assert.deepEqual(locked.vaults.map((v) => v.vaultId), ['global', 'personal']);
});

test('internal-vault-state carries LABELS ONLY — no secret, no counts (grep AC)', () => {
  const ipcMain = wire({
    jarsList: [{ id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal', retentionDays: 30 }]
  });
  const state = ipcMain.invoke('internal-vault-state', vaultEvent());

  // Each vault row is EXACTLY { vaultId, label } — no color/partition/count/secret leaks through.
  for (const v of state.vaults) {
    assert.deepEqual(Object.keys(v).sort(), ['label', 'vaultId']);
  }
  // No secret-shaped keys anywhere in the serialized payload.
  const json = JSON.stringify(state);
  for (const needle of ['password', 'secret', 'mrk', 'recovery', 'privateKey', 'partition', 'count']) {
    assert.equal(json.toLowerCase().includes(needle.toLowerCase()), false, `payload must not carry "${needle}"`);
  }
});

test('internal-vault-state never double-lists the reserved global sentinel (defense in depth)', () => {
  const ipcMain = wire({ jarsList: [{ id: 'global', name: 'Sneaky' }, { id: 'personal', name: 'Personal' }] });
  const state = ipcMain.invoke('internal-vault-state', vaultEvent());
  const ids = state.vaults.map((v) => v.vaultId);
  assert.deepEqual(ids, ['global', 'personal']);
  // The one 'global' row is the manager-wide vault, labelled 'Global' — never the jar's name.
  assert.equal(state.vaults[0].label, 'Global');
});

test('internal-vault-state rejects a non-internal sender (forbidden)', () => {
  const ipcMain = wire();
  const webEvent = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } } // right session, wrong origin
  };
  assert.throws(
    () => ipcMain.invoke('internal-vault-state', webEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );

  const nonInternalSession = {
    senderFrame: { origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
    sender: { session: {} } // right origin, no internal marker
  };
  assert.throws(
    () => ipcMain.invoke('internal-vault-state', nonInternalSession),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

/* --------------------------------------------------------- item CRUD handlers */

test('every item CRUD channel rejects a non-internal sender (forbidden)', () => {
  const ipcMain = wire();
  const webEvent = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  for (const channel of CRUD_CHANNELS) {
    assert.throws(
      () => ipcMain.invoke(channel, webEvent, {}),
      (err) => err instanceof Error && err.message.includes('forbidden'),
      `${channel} must reject a non-internal origin`
    );
  }
});

test('a LOCKED store surfaces every CRUD channel as structured { locked: true } (not a thrown string)', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    store.lockNow();
    const ev = vaultEvent();
    assert.deepEqual(ipcMain.invoke('internal-vault-list', ev, 'global'), { locked: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-reveal', ev, { vaultId: 'global', itemId: 'x' }), { locked: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-item-save', ev, { vaultId: 'global', item: { type: 'login', title: 'T', password: 'p' }, unchangedSecrets: [] }), { locked: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-item-delete', ev, { vaultId: 'global', itemId: 'x' }), { locked: true });
  } finally { rm(dir); }
});

test('internal-vault-list returns metadata-only items (no secret) for a vault', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    store.saveItem('global', { type: 'login', title: 'Bank', username: 'me', origin: 'https://bank', password: 'PW', totp: 'SEED', notes: 'N' });
    const res = ipcMain.invoke('internal-vault-list', vaultEvent(), 'global');
    assert.equal(res.items.length, 1);
    assert.equal(JSON.stringify(res.items).includes('PW'), false);
    assert.equal(JSON.stringify(res.items).includes('SEED'), false);
    assert.equal('password' in res.items[0], false);
    assert.equal(res.items[0].title, 'Bank');
  } finally { rm(dir); }
});

test('internal-vault-item-save PRESERVES an unrevealed password AND notes; returns metadata only', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const orig = store.saveItem('global', { type: 'login', title: 'Old', username: 'me', origin: 'https://x', password: 'secretPW', totp: 'SEED', notes: 'reco' });
    const res = ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global',
      item: { id: orig.id, type: 'login', title: 'New', username: 'me', origin: 'https://x', password: '', totp: '', notes: '' },
      unchangedSecrets: ['password', 'totp', 'notes']
    });
    // The handler returns metadata ONLY — never echoes a secret back to the page.
    assert.equal('password' in res.item, false);
    assert.equal(res.item.title, 'New');
    // ...but the secrets are preserved in the store.
    const full = store.revealItem('global', orig.id);
    assert.equal(full.password, 'secretPW');
    assert.equal(full.totp, 'SEED');
    assert.equal(full.notes, 'reco');
  } finally { rm(dir); }
});

test('internal-vault-item-save with a note preserves body; an explicit clear removes a field', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const note = store.saveItem('global', { type: 'note', title: 'N', body: 'the body', notes: 'keep' });
    // Preserve body + notes.
    ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global', item: { id: note.id, type: 'note', title: 'N2', body: '', notes: '' }, unchangedSecrets: ['body', 'notes']
    });
    assert.equal(store.revealItem('global', note.id).body, 'the body');
    // Explicit clear of notes (omit from unchangedSecrets, send '').
    ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global', item: { id: note.id, type: 'note', title: 'N3', body: '', notes: '' }, unchangedSecrets: ['body']
    });
    const full = store.revealItem('global', note.id);
    assert.equal(full.body, 'the body', 'body still preserved');
    assert.equal(full.notes, '', 'notes explicitly cleared');
  } finally { rm(dir); }
});

test('internal-vault-reveal returns the secret ONLY for the requested id; delete removes it', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const a = store.saveItem('global', { type: 'login', title: 'A', username: 'a', origin: 'https://a', password: 'pwA' });
    const b = store.saveItem('global', { type: 'login', title: 'B', username: 'b', origin: 'https://b', password: 'pwB' });
    const rev = ipcMain.invoke('internal-vault-reveal', vaultEvent(), { vaultId: 'global', itemId: a.id });
    assert.equal(rev.item.password, 'pwA');
    assert.equal(JSON.stringify(rev.item).includes('pwB'), false, 'reveal is single-id scoped');
    assert.deepEqual(ipcMain.invoke('internal-vault-reveal', vaultEvent(), { vaultId: 'global', itemId: 'nope' }), { item: null });

    assert.deepEqual(ipcMain.invoke('internal-vault-item-delete', vaultEvent(), { vaultId: 'global', itemId: b.id }), { deleted: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-item-delete', vaultEvent(), { vaultId: 'global', itemId: b.id }), { deleted: false });
    assert.equal(store.listItemsMeta('global').length, 1);
  } finally { rm(dir); }
});

/* ------------------------------------------------------ access-key handlers (Leg 5) */

test('both access-key channels reject a non-internal sender (forbidden)', () => {
  const ipcMain = wire();
  const webEvent = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } } // right session, wrong origin
  };
  for (const channel of ACCESSKEY_CHANNELS) {
    assert.throws(
      () => ipcMain.invoke(channel, webEvent, {}),
      (err) => err instanceof Error && err.message.includes('forbidden'),
      `${channel} must reject a non-internal origin`
    );
  }
});

test('a LOCKED store surfaces both access-key channels as structured { locked: true }', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    store.lockNow();
    const ev = vaultEvent();
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-list', ev, 'work'), { locked: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-revoke', ev, { vaultId: 'work', keyId: 'x' }), { locked: true });
  } finally { rm(dir); }
});

test('internal-vault-accesskey-list returns keyIds ONLY (no secret) and reflects mint/revoke immediately', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    store.saveItem('work', { type: 'login', title: 'W', username: 'u', origin: 'https://w', password: 'PW' });
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-list', vaultEvent(), 'work'), { keys: [] });

    const { secret, keyId } = await store.mintAccessKey('work', { masterPassword: MASTER });
    const listed = ipcMain.invoke('internal-vault-accesskey-list', vaultEvent(), 'work');
    assert.deepEqual(listed.keys, [{ keyId }]);
    // keyIds ONLY — the minted secret must NEVER cross this channel (grep AC).
    assert.equal(JSON.stringify(listed).includes(secret), false);
    for (const k of listed.keys) assert.deepEqual(Object.keys(k), ['keyId']);

    // Revoke is immediate — the list refreshes to empty; a stale keyId → { revoked:false }.
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-revoke', vaultEvent(), { vaultId: 'work', keyId }), { revoked: true });
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-list', vaultEvent(), 'work'), { keys: [] });
    assert.deepEqual(ipcMain.invoke('internal-vault-accesskey-revoke', vaultEvent(), { vaultId: 'work', keyId }), { revoked: false });
  } finally { rm(dir); }
});

test('internal-vault-accesskey-revoke resolves the target through the store allowlist (a burner/unknown target is rejected)', async () => {
  const { dir, ipcMain } = await realHarness();
  try {
    // The revoke handler validates the target via the store's PUBLIC resolveTarget BEFORE
    // calling revokeAccessKey (which takes a raw vaultId) — a burner/unknown/traversal target
    // is rejected (VaultStateError propagates as a rejected invoke), never a raw-path revoke.
    assert.throws(
      () => ipcMain.invoke('internal-vault-accesskey-revoke', vaultEvent(), { vaultId: 'burner-xyz', keyId: 'x' }),
      (err) => err instanceof Error && /unknown or non-persistent/.test(err.message)
    );
  } finally { rm(dir); }
});

// ---------------------------------------------------------------------------
// Portable EXPORT (M12 Flight 4 Leg 1 export-import, DD1) — internal-vault-export.
// GATED on the vaultSaveBundle injection; builds a ciphertext-only bundle from the store
// and hands it to the save-dialog delegate; a LOCKED manager → { locked: true }.
// ---------------------------------------------------------------------------

test('internal-vault-export is GATED on the vaultSaveBundle injection', () => {
  const ipcMain = wire(); // no vaultSaveBundle
  assert.equal('internal-vault-export' in ipcMain._handlers, false);
});

test('internal-vault-export builds a ciphertext-only bundle from the store and hands it to vaultSaveBundle', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS });
    await store.setup({ masterPassword: MASTER }); // set up + unlocked
    store.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'hunter2' });

    const saved = [];
    const ipcMain = makeFakeIpcMain();
    registerVaultIpc({
      ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS },
      vaultSaveBundle: async (bundle) => { saved.push(bundle); return { ok: true, path: '/tmp/x.gfvaultbundle' }; },
    });

    const res = await ipcMain.invoke('internal-vault-export', vaultEvent(), 'global');
    assert.deepEqual(res, { ok: true, path: '/tmp/x.gfvaultbundle' });
    assert.equal(saved.length, 1);
    const bundle = saved[0];
    assert.equal(bundle.format, 'gfvault-bundle');
    assert.equal(bundle.sourceVaultId, 'global');
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.equal(typeof bundle.mrk[slot].ct, 'string');
    }
    // No plaintext password crosses to the delegate.
    assert.equal(JSON.stringify(bundle).includes('hunter2'), false);
  } finally { rm(dir); }
});

test('internal-vault-export on a LOCKED manager returns { locked: true } (never calls the save dialog)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS });
    await store.setup({ masterPassword: MASTER });
    store.lockNow();

    let called = 0;
    const ipcMain = makeFakeIpcMain();
    registerVaultIpc({
      ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS },
      vaultSaveBundle: async () => { called += 1; return { ok: true }; },
    });

    const res = await ipcMain.invoke('internal-vault-export', vaultEvent(), 'global');
    assert.deepEqual(res, { locked: true });
    assert.equal(called, 0, 'the save dialog is never reached when locked');
  } finally { rm(dir); }
});

test('internal-vault-export with a pre-chosen savePath forwards it to vaultSaveBundle (write-direct branch)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'hunter2' });

    const calls = [];
    const ipcMain = makeFakeIpcMain();
    registerVaultIpc({
      ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS },
      // The dual-mode save delegate: a pre-chosen savePath skips the dialog and writes directly.
      vaultSaveBundle: async (bundle, savePath) => { calls.push({ bundle, savePath }); return { ok: true, path: savePath }; },
    });

    const res = await ipcMain.invoke('internal-vault-export', vaultEvent(), 'global', '/chosen/out.gfvaultbundle');
    assert.deepEqual(res, { ok: true, path: '/chosen/out.gfvaultbundle' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].savePath, '/chosen/out.gfvaultbundle', 'the pre-chosen path is forwarded to the save delegate');
    // L3: the STORE's exportVault stays single-arg — the pre-chosen path is handled entirely by the
    // main-side save delegate, never threaded into the store.
    assert.equal(store.exportVault.length, 1);
  } finally { rm(dir); }
});

// ---------------------------------------------------------------------------
// Save-location PICK (M12 F5 HAT, I14) — internal-vault-pick-save-path. GATED on the
// vaultPickSavePath injection; runs the save dialog ONLY (no build, no write), holds no state.
// ---------------------------------------------------------------------------

test('internal-vault-pick-save-path is GATED on the vaultPickSavePath injection', () => {
  const ipcMain = wire(); // no vaultPickSavePath
  assert.equal('internal-vault-pick-save-path' in ipcMain._handlers, false);
});

test('internal-vault-pick-save-path runs the save-location picker ONLY and returns its result', async () => {
  const store = makeStore({ setUp: true, unlocked: true });
  const picks = [];
  const ipcMain = makeFakeIpcMain();
  registerVaultIpc({
    ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => [] },
    vaultPickSavePath: async (target) => { picks.push(target); return { path: '/picked/vault-global.gfvaultbundle' }; },
  });
  const res = await ipcMain.invoke('internal-vault-pick-save-path', vaultEvent(), 'global');
  assert.deepEqual(res, { path: '/picked/vault-global.gfvaultbundle' });
  assert.deepEqual(picks, ['global'], 'the target is forwarded to seed the default filename');
});
