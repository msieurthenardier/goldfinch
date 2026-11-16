'use strict';

// KNOWN-ANSWER VECTOR (Mission 23 Flight 2 leg `vault-format-v2`, AC1(c); operator ruling 2026-11-14).
//
// The constant below is ONE small version-1 `.gfvault` document written by the RELEASED vault code:
// commit 376e541 (v0.19.14), generated 2026-11-14 by running that commit's own `vault-store.js`
// (extracted with `git archive 376e541`, system Node, no install) with fast scrypt parameters and a
// throwaway password: a jar vault holding two items, its `mrk` envelope and one access envelope.
// The master key, vault key and access secret are the throwaway keys of that run, as hex.
//
// It is HAND-PINNED and NEVER REGENERATED: its whole value is that these bytes were produced by the
// previous version, not by this tree. It is the ONLY committed fixture in the vault suites (this
// project does not commit generated baselines; everything else is built at run time, and the
// independent oracle `test/helpers/vault-oracle.js` covers shapes). The generator is
// `generate-vector.cjs` in the flight's scratchpad.
//
// Leg `vault-upgrade` upgrades THIS document in place and re-opens it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');
const oracle = require('../helpers/vault-oracle');

const VECTOR = {
  vaultId: 'jar-k',
  doc: '{"format":"gfvault","version":1,"vaultId":"jar-k","kdf":{"algo":"scrypt","N":131072,"r":8,"p":2,"maxmem":201326592},"envelopes":[{"keyId":"mrk","type":"mrk","iv":"bIgld7agRFh8eNnI","ct":"na6AU0zsLnYa/Y5u9hfcAySB33yPPpZDIhb52DsvWng=","tag":"8U4mCMeOZEdciMK/340OSw=="},{"keyId":"NsOoekmy1O4","type":"hkdf-access","salt":"+GBTlvTTe1t7W/HnxpWXFQ==","iv":"0j3NRnnpOqKblHGa","ct":"N8gpyvSSfI+mGiC8YMX3S82qQ/crU66rTjHscjJJ4zI=","tag":"X0DKse7FiRFmSPdgBOLBtA=="}],"items":{"iv":"BtDJV8ozLtKMPp38","ct":"VcBVysFu8d/retMK8TKsy2bSOcZjgWvX46hiM5RSCJttFWb2JFbotHcxuEDoTTrR6zBWYM2ZJpptPbczQWqX2f5W4uBFr47Kp/+fovjBV57w1W8HWj2400QQUGLUYSW2OB0OMpAfQQIefrZ9qlJJOkI6Yrom0lG+T/cj6FXXvutcYEthyuVfha2UN8Dt8Vqw/gNWldepFVCF601/HpD01ttMmuKN/PRdiOIGJiUZMi8f4JSOwm/JFPWv8hkpRuN2d0Pni5L37jNzmGqdYybinFwGnCvcUjSn2cmeP5IZyJ2EUyUSBBFdLl9ZnsvKEOcvMiAtH7UXWDCNY2fH8Q1pYjAs4luKLbBRZifLeb0KAbWLZCHvLV8TLO4fTjQUZtls4tT6kzHDKPw7","tag":"DetOFSVkWUlar25YziWpfw=="}}',
  masterKeyHex: '096ea9432e7baaa9e5487ae8fb8623566622956d03293b1e9e1e372d1a074b7b',
  vaultKeyHex: 'b28e63d0a012c1f0cd00c98ea684bc7c35fd7acb7c089b65ff53ae93fe504b7b',
  accessSecretHex: '4d6a3746524945714b75575554783345536e3331473158665766613265736338585f72314166314e733177',
  accessKeyId: 'NsOoekmy1O4',
  items: [
    {
      id: 'k1',
      type: 'login',
      title: 'Vector login',
      username: 'vu',
      origin: 'https://vector.example',
      password: 'vector-pw',
      createdAt: 1700000001000,
      updatedAt: 1700000001000
    },
    {
      id: 'k2',
      type: 'note',
      title: 'Vector note',
      body: 'vector body',
      createdAt: 1700000002000,
      updatedAt: 1700000002000
    }
  ]
};

const FAST = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const master = () => Buffer.from(VECTOR.masterKeyHex, 'hex');
const accessSecret = () => Buffer.from(VECTOR.accessSecretHex, 'hex').toString('utf8');

/** A set-up store whose unlock state is the vector's master key, with the vector at its slot. */
async function storeWithVector() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vector-'));
  const store = vs.load(dir, { scryptParams: FAST, listJars: () => [{ id: VECTOR.vaultId }] });
  await store.setup({ masterPassword: 'unrelated-password' });
  store.mrk.fill(0);
  store.mrk = master(); // the vector's own master key (the store's manager is not the vector's)
  fs.writeFileSync(path.join(dir, 'vaults', `${VECTOR.vaultId}.gfvault`), VECTOR.doc);
  return { dir, store };
}

test('vector: the oracle (raw node:crypto) opens the released bytes by master key and by access key', () => {
  const byMaster = oracle.openWithMaster(VECTOR.doc, master(), VECTOR.vaultId);
  assert.deepEqual(byMaster.items, VECTOR.items);
  assert.equal(byMaster.vaultKey.toString('hex'), VECTOR.vaultKeyHex);
  assert.equal(oracle.openAccessEnvelope(VECTOR.doc, accessSecret()).toString('hex'), VECTOR.vaultKeyHex);
});

test('vector: this tree reads a version-1 file written by the released code, by master key', async () => {
  const { dir, store } = await storeWithVector();
  try {
    assert.deepEqual(store.listItems(VECTOR.vaultId), VECTOR.items);
    assert.equal(JSON.parse(VECTOR.doc).version, 1);
    // reading is not writing: the file is byte-identical afterwards
    assert.equal(fs.readFileSync(path.join(dir, 'vaults', `${VECTOR.vaultId}.gfvault`), 'utf8'), VECTOR.doc);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vector: ... and by access key (the automation path)', async () => {
  const { dir, store } = await storeWithVector();
  try {
    const { key, keyId } = store.openVaultWithAccessKey(VECTOR.vaultId, accessSecret());
    assert.equal(keyId, VECTOR.accessKeyId);
    assert.equal(key.toString('hex'), VECTOR.vaultKeyHex);
    assert.deepEqual(store.readVaultItems(VECTOR.vaultId, key), VECTOR.items);
    assert.throws(() => store.openVaultWithAccessKey(VECTOR.vaultId, 'not the secret'), vc.VaultAuthError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vector: the released bytes are upgraded in place at the real trigger, and a FRESH store reads every item (leg vault-upgrade)', async () => {
  const { dir, store } = await storeWithVector();
  try {
    const file = path.join(dir, 'vaults', `${VECTOR.vaultId}.gfvault`);
    store._installMrk(master()); // the one point every master-key unlock passes; installs the vector's master key
    const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(upgraded.version, 2);
    assert.equal(upgraded.vaultId, VECTOR.vaultId);
    // the independent oracle opens the upgraded bytes at version 2, bound to the slot
    const viaOracle = oracle.openWithMaster(upgraded, master(), VECTOR.vaultId);
    assert.deepEqual(viaOracle.items, VECTOR.items);
    assert.equal(viaOracle.vaultKey.toString('hex'), VECTOR.vaultKeyHex, 'the vault key is unchanged');
    // the released access envelope is carried verbatim, and its secret still opens it
    assert.deepEqual(upgraded.envelopes[1], JSON.parse(VECTOR.doc).envelopes[1]);
    assert.equal(oracle.openAccessEnvelope(upgraded, accessSecret()).toString('hex'), VECTOR.vaultKeyHex);
    assert.deepEqual(upgraded.kdf, JSON.parse(VECTOR.doc).kdf);
    // a restart: a fresh store instance on the same directory
    const fresh = vs.load(dir, { scryptParams: FAST, listJars: () => [{ id: VECTOR.vaultId }] });
    fresh.mrk = master();
    assert.deepEqual(fresh.listItems(VECTOR.vaultId), VECTOR.items);
    const { key } = fresh.openVaultWithAccessKey(VECTOR.vaultId, accessSecret());
    assert.equal(key.toString('hex'), VECTOR.vaultKeyHex);
    assert.deepEqual(fresh.readVaultItems(VECTOR.vaultId, key), VECTOR.items);
    // a second install writes nothing
    const bytes = fs.readFileSync(file);
    fresh._installMrk(master());
    assert.ok(fs.readFileSync(file).equals(bytes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
