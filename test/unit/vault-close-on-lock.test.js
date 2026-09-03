'use strict';

// M18 F3 L1 (DD8 close-on-lock): end-to-end pin that a vault lock — CRITICALLY,
// including the AUTOLOCK IDLE TIMER, not just the manual lock handler — actually
// reaches every window's sheet with `closeMenuOverlay('vault-lock')`.
//
// Design review found the one anchor that covers BOTH lock paths is the store's
// injected `onLock` callback (`main.js:769`): manual lock (`vaultLockNow()`,
// `main.js:1973-1977`) calls `getVaultStore().lockNow()`, which fires `onLock`;
// the autolock idle timer lives INSIDE vault-store.js and calls `this.lockNow()`
// DIRECTLY (`vault-store.js:624`) — it never passes through the `vaultLockNow()`
// wrapper, so hooking the wrapper instead of `onLock` would silently miss autolock.
//
// main.js is not importable (it requires Electron at load), so this composes a
// REAL VaultStore (the idle-timer plumbing under test) with a FAITHFUL
// transcription of main.js's `onLock` composition and `closeVaultCredentialSheetsOnLock`
// fan-out (`for (const rec of registry.records()) rec.sheet?.closeMenuOverlay('vault-lock')`)
// over a fake registry/sheet — the vault-compromise-report-surface.test.js idiom.
// The SCOPING of 'vault-lock' (allowlist minus vault-unlock) is the REAL
// menu-overlay-manager.js's job and is pinned directly there; this suite's job is
// only to prove the WIRING reaches every window's sheet.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vaultStoreModule = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-close-on-lock-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// A fake window-registry record's sheet: records every closeMenuOverlay reason,
// idempotent like the real manager (no menu open -> nothing to record). This suite
// does NOT re-simulate the real allowlist scoping (menu-overlay-manager.test.js
// already pins that) — it exists to prove the wiring reaches every sheet.
function makeFakeSheet({ open = true } = {}) {
  const closeCalls = [];
  let hasMenu = open;
  return {
    closeCalls,
    closeMenuOverlay(reason) {
      if (!hasMenu) return; // idempotent — matches the real manager's no-op-when-closed
      hasMenu = false;
      closeCalls.push(reason);
    }
  };
}

/**
 * The main.js composition, transcribed faithfully: closeVaultCredentialSheetsOnLock's
 * fan-out (main.js, this leg) + the onLock callback that runs it before broadcasting.
 */
function makeMainLockComposition(registry) {
  const broadcasts = [];
  function closeVaultCredentialSheetsOnLock() {
    for (const rec of registry.records()) {
      rec.sheet?.closeMenuOverlay('vault-lock');
    }
  }
  return {
    onLock: () => {
      closeVaultCredentialSheetsOnLock();
      broadcasts.push('locked');
    },
    broadcasts
  };
}

test('the IDLE AUTOLOCK TIMER (not just manual lock) reaches every window sheet with closeMenuOverlay("vault-lock")', async () => {
  const dir = tmpDir();
  try {
    const recA = { sheet: makeFakeSheet() };
    const recB = { sheet: makeFakeSheet() };
    const registry = { records: () => [recA, recB] };
    const { onLock, broadcasts } = makeMainLockComposition(registry);

    let armed = null;
    const store = vaultStoreModule.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 5,
      listJars: () => [{ id: 'work' }],
      setTimeout: (fn, ms) => {
        armed = { fn, ms };
        return 'token';
      },
      clearTimeout: () => {},
      onLock
    });
    await store.setup({ masterPassword: MASTER });
    assert.ok(armed, 'setup arms the idle timer');
    assert.equal(store.isUnlocked(), true);

    // Fire the idle timer directly — this is vault-store.js's OWN internal path
    // (armed.fn calls this.lockNow() from INSIDE the module, vault-store.js:624),
    // never touching main.js's manual vaultLockNow() wrapper at all.
    armed.fn();

    assert.equal(store.isUnlocked(), false, 'the idle timer actually locked the store');
    assert.deepEqual(recA.sheet.closeCalls, ['vault-lock'], "window A's sheet closed on the idle-timer lock");
    assert.deepEqual(recB.sheet.closeCalls, ['vault-lock'], "window B's sheet closed on the idle-timer lock too");
    assert.deepEqual(broadcasts, ['locked'], 'the broadcast still fires (order: close-then-broadcast)');
  } finally {
    rm(dir);
  }
});

test('manual lockNow() (the vaultLockNow() wrapper path) ALSO reaches every window sheet — both lock paths share the one onLock anchor', async () => {
  const dir = tmpDir();
  try {
    const rec = { sheet: makeFakeSheet() };
    const registry = { records: () => [rec] };
    const { onLock } = makeMainLockComposition(registry);

    const store = vaultStoreModule.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => [{ id: 'work' }],
      onLock
    });
    await store.setup({ masterPassword: MASTER });

    store.lockNow(); // the manual path (main.js's vaultLockNow() calls exactly this)
    assert.deepEqual(rec.sheet.closeCalls, ['vault-lock']);
  } finally {
    rm(dir);
  }
});

test('a window record with no sheet (mid-teardown — window-factory.js nulls rec.sheet) is tolerated, never throws', async () => {
  const dir = tmpDir();
  try {
    const recTornDown = { sheet: null };
    const recLive = { sheet: makeFakeSheet() };
    const registry = { records: () => [recTornDown, recLive] };
    const { onLock } = makeMainLockComposition(registry);

    let armed = null;
    const store = vaultStoreModule.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 5,
      listJars: () => [{ id: 'work' }],
      setTimeout: (fn, ms) => {
        armed = { fn, ms };
        return 'token';
      },
      clearTimeout: () => {},
      onLock
    });
    await store.setup({ masterPassword: MASTER });

    assert.doesNotThrow(() => armed.fn());
    assert.deepEqual(recLive.sheet.closeCalls, ['vault-lock'], 'the live window still closes');
  } finally {
    rm(dir);
  }
});

test('a window with NO open menu at all is a safe no-op (closeMenuOverlay is idempotent — the unconditional per-window call never throws)', async () => {
  const dir = tmpDir();
  try {
    const rec = { sheet: makeFakeSheet({ open: false }) };
    const registry = { records: () => [rec] };
    const { onLock } = makeMainLockComposition(registry);

    const store = vaultStoreModule.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => [{ id: 'work' }],
      onLock
    });
    await store.setup({ masterPassword: MASTER });

    store.lockNow();
    assert.deepEqual(rec.sheet.closeCalls, [], 'nothing was open — nothing to close');
  } finally {
    rm(dir);
  }
});
