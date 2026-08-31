'use strict';

// Unit tests for M17 F4 DD1 — fail-closed KDF validation on read. _readManager
// (src/main/vault/vault-store.js) now calls validateImportedKdf(doc.kdf) after the
// pre-existing `typeof doc.kdf === 'object'` guard, so an out-of-bounds kdf (the F2
// vault-tampering attack: silent scrypt downgrade / absurd-N hang on the
// un-step-up-gated recovery path) makes the manager refuse to open at every read
// path, throwing VaultFormatError before any derive or write.
//
// Harness mirrors vault-store.test.js: makeStore / FAST_SCRYPT / managerPath, and the
// `assert.throws(() => makeStore(dir), (e) => e instanceof vs.VaultFormatError)` idiom
// the corrupt-manager test uses. setup() writes in-bounds FAST_SCRYPT, so an untampered
// manager still loads; each row tampers manager.json's kdf on disk and asserts refuse.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

// In-bounds memory-cheap scrypt (same as vault-store.test.js): N=2^12, r=8, p=1,
// maxmem 64 MiB. The tampered-doc maxmem floor is 128*N*r relative to the TAMPERED
// doc's N — for N=2^12,r=8 that floor is 128*4096*8 = 4 MiB, so a below-floor maxmem
// row picks a value under 4 MiB (not under the production 192 MiB).
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-kdf-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    ...overrides
  });
}
function managerPath(dir) {
  return path.join(dir, 'vaults', 'manager.json');
}

// Set up a valid vault (in-bounds FAST_SCRYPT), then apply `mutate` to the on-disk
// manager.json's kdf and write it back. Returns { dir, recoveryKeyDisplay } for the
// caller; the store is discarded (rows re-construct via makeStore to hit the eager
// load at :325).
async function setupThenTamperKdf(dir, mutate) {
  const store = makeStore(dir);
  const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
  store.lockNow();
  const doc = JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
  mutate(doc);
  fs.writeFileSync(managerPath(dir), JSON.stringify(doc, null, 2), 'utf8');
  return { recoveryKeyDisplay };
}

// ---------------------------------------------------------------------------
// AC2 — truth table: each out-of-bounds kdf makes the eager load refuse to open.
// ---------------------------------------------------------------------------

// Each row mutates doc.kdf (starting from the valid FAST_SCRYPT). The array-kdf row
// is the one that actually reaches the NEW validateImportedKdf(doc.kdf) call, since
// `typeof [] === 'object'` slips past the pre-existing `:375` guard; the missing-kdf
// row is caught by that OLDER guard (still VaultFormatError, still fail-closed).
const TRUTH_TABLE = [
  ['N below min (2^11)', (d) => (d.kdf.N = 2 ** 11)],
  ['N above max (2^22)', (d) => (d.kdf.N = 2 ** 22)],
  ['N not a power of two (100000)', (d) => (d.kdf.N = 100000)],
  ['N non-numeric ("big")', (d) => (d.kdf.N = 'big')],
  ['r above max (33)', (d) => (d.kdf.r = 33)],
  ['r below min (0)', (d) => (d.kdf.r = 0)],
  ['p above max (17)', (d) => (d.kdf.p = 17)],
  ['p below min (0)', (d) => (d.kdf.p = 0)],
  // Floor is 128*N*r of the tampered doc; N=2^12,r=8 → 4 MiB. Pick below 4 MiB.
  ['maxmem below floor (1 MiB, floor is 4 MiB)', (d) => (d.kdf.maxmem = 1 * 1024 * 1024)],
  ['maxmem above 512 MiB cap (513 MiB)', (d) => (d.kdf.maxmem = 513 * 1024 * 1024)],
  ['maxmem non-integer', (d) => (d.kdf.maxmem = 64 * 1024 * 1024 + 0.5)],
  ['algo not scrypt ("argon2")', (d) => (d.kdf.algo = 'argon2')],
  // Reaches the NEW call: typeof [] === 'object' passes the :375 guard.
  ['array-valued kdf (kdf: [])', (d) => (d.kdf = [])],
  // Caught by the OLDER :375 guard (pins fail-closed, not the new line).
  ['missing kdf', (d) => delete d.kdf]
];

for (const [label, mutate] of TRUTH_TABLE) {
  test(`out-of-bounds kdf refuses to open at read: ${label}`, async () => {
    const dir = tmpDir();
    try {
      await setupThenTamperKdf(dir, mutate);
      assert.throws(
        () => makeStore(dir),
        (e) => e instanceof vs.VaultFormatError,
        `expected VaultFormatError for tampered kdf: ${label}`
      );
    } finally {
      rm(dir);
    }
  });
}

test('an in-bounds FAST_SCRYPT manager (untampered) still loads', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.lockNow();
    // Re-construct: eager load at :325 re-reads + validates the untampered kdf.
    const reloaded = makeStore(dir);
    assert.equal(reloaded.isSetUp(), true, 'in-bounds manager loads without throwing');
    await reloaded.unlock(MASTER);
    assert.equal(reloaded.isUnlocked(), true, 'in-bounds manager unlocks normally');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC3 — recovery-path fail-closed guard: the silent-KDF-downgrade attack is blocked
// before any write. recoverMasterPassword calls _readManager first (:876), so an
// out-of-bounds N throws VaultFormatError before the re-wrap — and before scrypt,
// so an absurd N cannot hang/OOM. Tamper on disk and call on the ALREADY-LOADED
// instance (a fresh store would throw at the eager load :325 instead, passing the
// assertion without exercising the recovery path).
// ---------------------------------------------------------------------------

test('recoverMasterPassword refuses an out-of-bounds kdf and writes nothing', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });

    // Snapshot the pre-tamper master envelope (what a silent downgrade would rewrite).
    const masterBefore = JSON.parse(fs.readFileSync(managerPath(dir), 'utf8')).mrk.master;

    // Tamper kdf.N out of bounds on disk (absurdly large — would hang/OOM if derived).
    const doc = JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
    doc.kdf.N = 2 ** 30;
    fs.writeFileSync(managerPath(dir), JSON.stringify(doc, null, 2), 'utf8');

    // Call on the ALREADY-LOADED instance — recoverMasterPassword re-reads via
    // _readManager, which now validates and throws before any re-wrap.
    await assert.rejects(
      store.recoverMasterPassword({
        recoveryDisplay: recoveryKeyDisplay,
        newMasterPassword: 'brand-new-master'
      }),
      (e) => e instanceof vs.VaultFormatError
    );

    // Nothing was written: the master envelope bytes are unchanged on disk.
    const masterAfter = JSON.parse(fs.readFileSync(managerPath(dir), 'utf8')).mrk.master;
    assert.deepEqual(masterAfter, masterBefore, 'master envelope must be untouched — no silent downgrade');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Squawk 0052 — DD1 coupling guard. The truth table above and the AC3 test prove
// _readManager fails closed on OUT-of-bounds kdf. That guarantee is only sound for
// legitimate managers because setup() is the sole kdf writer and always writes
// vc.SCRYPT_PARAMS, which today sits INSIDE validateImportedKdf's bounds. Nothing
// else pins that second half: a future production-param bump past the import
// bounds (or a second kdf writer) would make _readManager fail closed on every
// LEGITIMATE manager — surfacing at a user's unlock, not at test time. Assert the
// coupling directly against the same validator :387's read-path guard calls, so a
// violation fails loudly here instead. (An equivalent assertion already exists in
// vault-export-import.test.js, from the import-hardening work that predates the F4
// read-path guard — this copy is co-located with the read-path guarantee it backs.)
// ---------------------------------------------------------------------------

test('vc.SCRYPT_PARAMS (the production KDF) passes validateImportedKdf — DD1 coupling guard', () => {
  assert.doesNotThrow(
    () => vs.validateImportedKdf(vc.SCRYPT_PARAMS),
    'production SCRYPT_PARAMS drifted outside validateImportedKdf bounds — _readManager would now ' +
      'fail closed on every legitimate manager at unlock, not just tampered ones'
  );
});
