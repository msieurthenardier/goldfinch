'use strict';

// Unit tests for src/main/vault/vault-crypto.js — the pure crypto + `.gfvault`
// format + TOTP module (Mission 12, Flight 1, Leg 1).
//
// No Electron stub needed — the module is Electron-free (node:crypto only). All
// cases run offline. Functional envelope/item round-trips use a SMALL scrypt N
// (2**14) to keep the suite fast; ONE separate test exercises the production
// params (and the maxmem-too-low failure mode) so the sizing relationship is
// pinned without paying its latency on every functional case.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const vc = require('../../src/main/vault/vault-crypto');

// Fast scrypt params for functional round-trips (memory-cheap, quick).
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const MASTER_PW = 'correct horse battery staple';

// A representative JSON-serializable items payload (opaque to this module).
function samplePayload() {
  return {
    items: [
      { id: 'a', type: 'login', title: 'Example', username: 'user@example.com', password: 'hunter2' },
      { id: 'b', type: 'note', title: 'Recovery', body: 'multi\nline\ntext' },
    ],
    meta: { updated: 1234567890, count: 2 },
  };
}

// Build a full vault (one of each envelope type) at fast scrypt params. Returns
// everything a test needs to open any envelope.
async function buildFullVault() {
  const vaultKey = vc.newVaultKey();
  const items = vc.encryptItems(samplePayload(), vaultKey);

  const recovery = vc.generateRecoveryKey();
  const access = vc.generateAccessKey();
  const admin = vc.generateAdminKeypair();

  const master = await vc.wrapMaster(vaultKey, MASTER_PW, { params: FAST_SCRYPT });
  const recEnv = vc.wrapRecovery(vaultKey, recovery.material);
  const accEnv = vc.wrapAccess(vaultKey, access.secret, access.keyId);
  const adminEnv = vc.sealToAdmin(vaultKey, admin.publicKey);

  return {
    vaultKey,
    items,
    recovery,
    access,
    admin,
    envelopes: [master, recEnv, accEnv, adminEnv],
    master,
    recEnv,
    accEnv,
    adminEnv,
  };
}

// ---------------------------------------------------------------------------
// Vault key + item crypto
// ---------------------------------------------------------------------------

test('item crypto: round-trips a JSON payload to a deep-equal object', () => {
  const key = vc.newVaultKey();
  assert.equal(key.length, 32);
  const payload = samplePayload();
  const blob = vc.encryptItems(payload, key);
  assert.deepEqual(vc.decryptItems(blob, key), payload);
});

test('item crypto: empty payload round-trips without error', () => {
  const key = vc.newVaultKey();
  assert.deepEqual(vc.decryptItems(vc.encryptItems({}, key), key), {});
  assert.deepEqual(vc.decryptItems(vc.encryptItems([], key), key), []);
});

test('item crypto: tampering ct / iv / tag makes decryption THROW (never corrupt data)', () => {
  const key = vc.newVaultKey();
  const blob = vc.encryptItems(samplePayload(), key);

  for (const field of ['ct', 'iv', 'tag']) {
    const bytes = Buffer.from(blob[field], 'base64');
    bytes[0] ^= 0x01; // flip one byte
    const tampered = { ...blob, [field]: bytes.toString('base64') };
    assert.throws(() => vc.decryptItems(tampered, key), vc.VaultAuthError, `flipping ${field} must throw`);
  }
});

test('item crypto: wrong vault key throws (never returns a wrong Buffer)', () => {
  const key = vc.newVaultKey();
  const blob = vc.encryptItems(samplePayload(), key);
  assert.throws(() => vc.decryptItems(blob, vc.newVaultKey()), vc.VaultAuthError);
});

test('IV freshness: successive encryptItems on one key yield distinct IVs', () => {
  const key = vc.newVaultKey();
  const a = vc.encryptItems(samplePayload(), key);
  const b = vc.encryptItems(samplePayload(), key);
  assert.notEqual(a.iv, b.iv);
});

test('items AAD: decrypting with a mismatched version fails authentication', () => {
  const key = vc.newVaultKey();
  const blob = vc.encryptItems(samplePayload(), key, 1);
  assert.throws(() => vc.decryptItems(blob, key, 2), vc.VaultAuthError);
});

// ---------------------------------------------------------------------------
// The four envelope operations — round-trip to a byte-equal vault key
// ---------------------------------------------------------------------------

test('master envelope: scrypt wrap/unwrap round-trips the vault key', async () => {
  const vaultKey = vc.newVaultKey();
  const env = await vc.wrapMaster(vaultKey, MASTER_PW, { params: FAST_SCRYPT });
  assert.equal(env.keyId, 'master');
  const opened = await vc.unwrapMaster(env, MASTER_PW, { params: FAST_SCRYPT });
  assert.ok(opened.equals(vaultKey));
});

test('recovery envelope: hkdf wrap/unwrap round-trips the vault key', () => {
  const vaultKey = vc.newVaultKey();
  const { material } = vc.generateRecoveryKey();
  const env = vc.wrapRecovery(vaultKey, material);
  assert.equal(env.keyId, 'recovery');
  assert.ok(vc.unwrapRecovery(env, material).equals(vaultKey));
});

test('access envelope: hkdf wrap/unwrap round-trips the vault key', () => {
  const vaultKey = vc.newVaultKey();
  const { secret, keyId } = vc.generateAccessKey();
  const env = vc.wrapAccess(vaultKey, secret, keyId);
  assert.equal(env.keyId, keyId);
  assert.ok(vc.unwrapAccess(env, secret).equals(vaultKey));
});

test('admin seal: x25519 wrap/unwrap round-trips the vault key', () => {
  const vaultKey = vc.newVaultKey();
  const admin = vc.generateAdminKeypair();
  const env = vc.sealToAdmin(vaultKey, admin.publicKey);
  assert.equal(env.keyId, 'admin-pub');
  assert.ok(typeof env.epk === 'string' && env.epk.length > 0);
  assert.ok(vc.openAdminSeal(env, admin.privateKey).equals(vaultKey));
});

// ---------------------------------------------------------------------------
// Wrong key fails auth — for EACH envelope type
// ---------------------------------------------------------------------------

test('wrong key throws for every envelope type', async () => {
  const vaultKey = vc.newVaultKey();

  const master = await vc.wrapMaster(vaultKey, MASTER_PW, { params: FAST_SCRYPT });
  await assert.rejects(() => vc.unwrapMaster(master, 'wrong password', { params: FAST_SCRYPT }), vc.VaultAuthError);

  const rec = vc.generateRecoveryKey();
  const recEnv = vc.wrapRecovery(vaultKey, rec.material);
  assert.throws(() => vc.unwrapRecovery(recEnv, crypto.randomBytes(20)), vc.VaultAuthError);

  const acc = vc.generateAccessKey();
  const accEnv = vc.wrapAccess(vaultKey, acc.secret, acc.keyId);
  assert.throws(() => vc.unwrapAccess(accEnv, vc.generateAccessKey().secret), vc.VaultAuthError);

  const admin = vc.generateAdminKeypair();
  const adminEnv = vc.sealToAdmin(vaultKey, admin.publicKey);
  const wrongAdmin = vc.generateAdminKeypair();
  assert.throws(() => vc.openAdminSeal(adminEnv, wrongAdmin.privateKey), vc.VaultAuthError);
});

// ---------------------------------------------------------------------------
// Envelope independence + revoke-one-leaves-others
// ---------------------------------------------------------------------------

test('envelope independence: any grantee yields the SAME vault key', async () => {
  const v = await buildFullVault();
  const viaMaster = await vc.unwrapMaster(v.master, MASTER_PW, { params: FAST_SCRYPT });
  const viaRecovery = vc.unwrapRecovery(v.recEnv, v.recovery.material);
  const viaAccess = vc.unwrapAccess(v.accEnv, v.access.secret);
  const viaAdmin = vc.openAdminSeal(v.adminEnv, v.admin.privateKey);

  assert.ok(viaMaster.equals(v.vaultKey));
  assert.ok(viaRecovery.equals(v.vaultKey));
  assert.ok(viaAccess.equals(v.vaultKey));
  assert.ok(viaAdmin.equals(v.vaultKey));
});

test('revoke: removing one envelope leaves the others functional', async () => {
  const v = await buildFullVault();
  const doc = vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: v.envelopes, items: v.items });
  const parsed = vc.parseVault(doc);

  // Revoke the access grant by keyId.
  const remaining = parsed.envelopes.filter((e) => e.keyId !== v.access.keyId);
  assert.equal(remaining.length, parsed.envelopes.length - 1);
  const reparsed = vc.parseVault(vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: remaining, items: v.items }));

  const master = reparsed.envelopes.find((e) => e.keyId === 'master');
  const admin = reparsed.envelopes.find((e) => e.keyId === 'admin-pub');
  assert.ok(master && admin);
  assert.ok((await vc.unwrapMaster(master, MASTER_PW, { params: FAST_SCRYPT })).equals(v.vaultKey));
  assert.ok(vc.openAdminSeal(admin, v.admin.privateKey).equals(v.vaultKey));
  // The revoked access envelope is gone.
  assert.equal(reparsed.envelopes.find((e) => e.keyId === v.access.keyId), undefined);
});

// ---------------------------------------------------------------------------
// Per-envelope key-id readable without any key + duplicate rejection
// ---------------------------------------------------------------------------

test('key-ids are readable from a parsed vault with NO key material', async () => {
  const v = await buildFullVault();
  const parsed = vc.parseVault(vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: v.envelopes, items: v.items }));
  const ids = vc.listEnvelopeKeyIds(parsed);
  assert.deepEqual([...ids].sort(), ['admin-pub', 'master', 'recovery', v.access.keyId].sort());
});

test('access keyId is assigned at mint, independent of the secret', () => {
  const a = vc.generateAccessKey();
  const b = vc.generateAccessKey();
  assert.notEqual(a.keyId, b.keyId);
  assert.notEqual(a.secret, b.secret);
  // keyId is not derived from the secret — different lengths / independent draws.
  assert.ok(!a.secret.includes(a.keyId));
});

test('serializeVault rejects duplicate keyIds', () => {
  const key = vc.newVaultKey();
  const items = vc.encryptItems({}, key);
  const a = vc.wrapAccess(key, vc.generateAccessKey().secret, 'dup');
  const b = vc.wrapAccess(key, vc.generateAccessKey().secret, 'dup');
  assert.throws(() => vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: [a, b], items }), vc.VaultFormatError);
});

test('parseVault rejects a document with duplicate keyIds', () => {
  const key = vc.newVaultKey();
  const items = vc.encryptItems({}, key);
  const env = vc.wrapAccess(key, vc.generateAccessKey().secret, 'x');
  // Hand-craft a document that bypasses serialize's guard.
  const doc = JSON.stringify({
    format: 'gfvault', version: 1, vaultId: 'abc', kdf: FAST_SCRYPT,
    envelopes: [env, { ...env }], items,
  });
  assert.throws(() => vc.parseVault(doc), vc.VaultFormatError);
});

// ---------------------------------------------------------------------------
// Authenticated envelope headers (AAD)
// ---------------------------------------------------------------------------

test('AAD: altering an envelope keyId fails unwrap authentication', () => {
  const vaultKey = vc.newVaultKey();
  const rec = vc.generateRecoveryKey();
  const env = vc.wrapRecovery(vaultKey, rec.material);
  const tampered = { ...env, keyId: 'relabelled' };
  assert.throws(() => vc.unwrapRecovery(tampered, rec.material), vc.VaultAuthError);
});

test('AAD: altering an envelope type fails unwrap authentication', () => {
  const vaultKey = vc.newVaultKey();
  const acc = vc.generateAccessKey();
  const env = vc.wrapAccess(vaultKey, acc.secret, acc.keyId);
  const tampered = { ...env, type: 'hkdf-recovery' };
  assert.throws(() => vc.unwrapAccess(tampered, acc.secret), vc.VaultAuthError);
});

test('AAD: mismatched document version fails unwrap authentication', () => {
  const vaultKey = vc.newVaultKey();
  const rec = vc.generateRecoveryKey();
  const env = vc.wrapRecovery(vaultKey, rec.material, { version: 1 });
  assert.throws(() => vc.unwrapRecovery(env, rec.material, { version: 2 }), vc.VaultAuthError);
});

// ---------------------------------------------------------------------------
// X25519 seal round-trips through a full serialize / parse JSON cycle
// ---------------------------------------------------------------------------

test('admin seal survives a full serializeVault / parseVault JSON cycle', async () => {
  const v = await buildFullVault();
  const json = vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: v.envelopes, items: v.items });
  // Prove it really round-trips through a JSON string (not a live object).
  assert.equal(typeof json, 'string');
  const parsed = vc.parseVault(json);
  const adminEnv = parsed.envelopes.find((e) => e.keyId === 'admin-pub');
  assert.ok(adminEnv);
  const opened = vc.openAdminSeal(adminEnv, v.admin.privateKey);
  assert.ok(opened.equals(v.vaultKey));
  // And through the exported/re-imported admin private key too.
  const reimportedPriv = vc.importAdminPrivateKey(v.admin.privateKeyB64);
  assert.ok(vc.openAdminSeal(adminEnv, reimportedPriv).equals(v.vaultKey));
});

test('admin seal: sealing to a re-imported public key still opens', () => {
  const vaultKey = vc.newVaultKey();
  const admin = vc.generateAdminKeypair();
  const pub = vc.importAdminPublicKey(admin.publicKeyB64);
  const env = vc.sealToAdmin(vaultKey, pub);
  assert.ok(vc.openAdminSeal(env, admin.privateKey).equals(vaultKey));
});

// ---------------------------------------------------------------------------
// Re-wrap only — master change does NOT touch the items ciphertext
// ---------------------------------------------------------------------------

test('re-wrap only: changing the master password leaves the items ciphertext byte-identical', async () => {
  const vaultKey = vc.newVaultKey();
  const items = vc.encryptItems(samplePayload(), vaultKey);

  const oldMaster = await vc.wrapMaster(vaultKey, MASTER_PW, { params: FAST_SCRYPT });
  const newMaster = await vc.wrapMaster(vaultKey, 'a different passphrase', { params: FAST_SCRYPT });

  // The re-wrap swaps only the master envelope; items are untouched.
  const before = vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: [oldMaster], items });
  const after = vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: [newMaster], items });
  assert.deepEqual(vc.parseVault(before).items, vc.parseVault(after).items);

  // And the new envelope opens the same vault key without re-encrypting items.
  const opened = await vc.unwrapMaster(newMaster, 'a different passphrase', { params: FAST_SCRYPT });
  assert.ok(opened.equals(vaultKey));
  assert.deepEqual(vc.decryptItems(items, opened), samplePayload());
});

test('re-wrap only: rotating the recovery key re-wraps the same vault key', () => {
  const vaultKey = vc.newVaultKey();
  const items = vc.encryptItems(samplePayload(), vaultKey);
  const oldRec = vc.generateRecoveryKey();
  const newRec = vc.generateRecoveryKey();

  vc.wrapRecovery(vaultKey, oldRec.material);
  const rotated = vc.wrapRecovery(vaultKey, newRec.material);
  assert.ok(vc.unwrapRecovery(rotated, newRec.material).equals(vaultKey));
  // Old material no longer opens the rotated envelope.
  assert.throws(() => vc.unwrapRecovery(rotated, oldRec.material), vc.VaultAuthError);
  // Items ciphertext was never re-encrypted.
  assert.deepEqual(vc.decryptItems(items, vaultKey), samplePayload());
});

// ---------------------------------------------------------------------------
// Serialization is self-contained + versioned; strict parse
// ---------------------------------------------------------------------------

test('serialize/parse: round-trips a single self-contained versioned document', async () => {
  const v = await buildFullVault();
  const doc = vc.parseVault(vc.serializeVault({ vaultId: 'vault-123', kdf: FAST_SCRYPT, envelopes: v.envelopes, items: v.items }));
  assert.equal(doc.format, 'gfvault');
  assert.equal(doc.version, 1);
  assert.equal(doc.vaultId, 'vault-123');
  assert.deepEqual(doc.kdf, FAST_SCRYPT);
  assert.equal(doc.envelopes.length, 4);
  assert.ok(doc.items.iv && doc.items.ct && doc.items.tag);
});

test('serialize: mints a vaultId when none supplied', () => {
  const key = vc.newVaultKey();
  const doc = vc.parseVault(vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: [], items: vc.encryptItems({}, key) }));
  assert.equal(typeof doc.vaultId, 'string');
  assert.ok(doc.vaultId.length > 0);
});

test('parseVault: rejects malformed JSON', () => {
  assert.throws(() => vc.parseVault('{not json'), vc.VaultFormatError);
});

test('parseVault: rejects an unknown / missing version', () => {
  const key = vc.newVaultKey();
  const items = vc.encryptItems({}, key);
  const base = { format: 'gfvault', vaultId: 'x', kdf: FAST_SCRYPT, envelopes: [], items };
  assert.throws(() => vc.parseVault(JSON.stringify({ ...base, version: 2 })), vc.VaultFormatError);
  assert.throws(() => vc.parseVault(JSON.stringify(base)), vc.VaultFormatError); // no version
});

test('parseVault: rejects an unknown format id', () => {
  const key = vc.newVaultKey();
  const items = vc.encryptItems({}, key);
  const doc = JSON.stringify({ format: 'notgfvault', version: 1, kdf: FAST_SCRYPT, envelopes: [], items });
  assert.throws(() => vc.parseVault(doc), vc.VaultFormatError);
});

test('parseVault: rejects a malformed items blob and malformed envelopes', () => {
  const key = vc.newVaultKey();
  const items = vc.encryptItems({}, key);
  assert.throws(
    () => vc.parseVault(JSON.stringify({ format: 'gfvault', version: 1, kdf: FAST_SCRYPT, envelopes: [], items: { iv: 'x' } })),
    vc.VaultFormatError,
  );
  assert.throws(
    () => vc.parseVault(JSON.stringify({ format: 'gfvault', version: 1, kdf: FAST_SCRYPT, envelopes: [{ keyId: 'x' }], items })),
    vc.VaultFormatError,
  );
});

test('parseVault: accepts a Buffer input', async () => {
  const v = await buildFullVault();
  const buf = Buffer.from(vc.serializeVault({ kdf: FAST_SCRYPT, envelopes: v.envelopes, items: v.items }), 'utf8');
  assert.equal(vc.parseVault(buf).format, 'gfvault');
});

// ---------------------------------------------------------------------------
// Recovery-key display round-trip
// ---------------------------------------------------------------------------

test('recovery key: grouped-base32 display round-trips to the 20-byte material', () => {
  const { display, material } = vc.generateRecoveryKey();
  assert.equal(material.length, 20);
  assert.match(display, /^[A-Z2-7]+(-[A-Z2-7]+)+$/);
  assert.ok(vc.parseRecoveryKey(display).equals(material));
  // Tolerant of lowercase + whitespace.
  assert.ok(vc.parseRecoveryKey(display.toLowerCase().replace(/-/g, ' ')).equals(material));
});

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) + otpauth parsing
// ---------------------------------------------------------------------------

// RFC 6238 Appendix B SHA-1 vectors. The published vectors are 8-DIGIT; the
// shared secret is ASCII "12345678901234567890" → base32 below.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('TOTP: reproduces the RFC 6238 SHA-1 8-digit published vectors', () => {
  assert.equal(vc.totp(RFC_SECRET, { digits: 8 }, 59 * 1000), '94287082');
  assert.equal(vc.totp(RFC_SECRET, { digits: 8 }, 1111111109 * 1000), '07081804');
  assert.equal(vc.totp(RFC_SECRET, { digits: 8 }, 1111111111 * 1000), '14050471');
});

test('TOTP: the product default (6 digits) is the low 6 of the RFC vector', () => {
  // 94287082 → last 6 digits = 287082, pins the default digits/period path.
  assert.equal(vc.totp(RFC_SECRET, {}, 59 * 1000), '287082');
  assert.equal(vc.totp(RFC_SECRET, undefined, 59 * 1000), '287082');
});

test('TOTP: honors algorithm / digits / period overrides', () => {
  // A period override changes the counter: period=60 halves the 59s counter to 0.
  assert.equal(vc.totp(RFC_SECRET, { digits: 8, period: 60 }, 59 * 1000), vc.totp(RFC_SECRET, { digits: 8, period: 60 }, 0));
  // SHA-256 / SHA-512 differ from SHA-1 for the same secret (algorithm is wired).
  const t = 59 * 1000;
  assert.notEqual(vc.totp(RFC_SECRET, { digits: 8, algorithm: 'SHA256' }, t), vc.totp(RFC_SECRET, { digits: 8 }, t));
  assert.notEqual(vc.totp(RFC_SECRET, { digits: 8, algorithm: 'SHA512' }, t), vc.totp(RFC_SECRET, { digits: 8 }, t));
});

test('TOTP: counter increments exactly at a period boundary', () => {
  const justBefore = vc.totp(RFC_SECRET, { digits: 8 }, 30 * 1000 - 1);
  const atBoundary = vc.totp(RFC_SECRET, { digits: 8 }, 30 * 1000);
  const codeAt0 = vc.totp(RFC_SECRET, { digits: 8 }, 0);
  assert.equal(justBefore, codeAt0); // still counter 0
  assert.notEqual(atBoundary, codeAt0); // ticked to counter 1
});

test('parseOtpauth: extracts secret + parameters from an otpauth URI', () => {
  const uri = 'otpauth://totp/ACME%20Co:alice@example.com?secret=' + RFC_SECRET
    + '&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60';
  const parsed = vc.parseOtpauth(uri);
  assert.equal(parsed.secret, RFC_SECRET);
  assert.equal(parsed.algorithm, 'SHA256');
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.period, 60);
  assert.equal(parsed.issuer, 'ACME Co');
  assert.equal(parsed.label, 'ACME Co:alice@example.com');
  // The parsed parameters feed straight back into totp.
  assert.equal(vc.totp(parsed.secret, parsed, 59 * 1000), vc.totp(RFC_SECRET, { digits: 8, algorithm: 'SHA256', period: 60 }, 59 * 1000));
});

test('parseOtpauth: defaults when parameters are omitted', () => {
  const parsed = vc.parseOtpauth('otpauth://totp/Bare?secret=' + RFC_SECRET);
  assert.equal(parsed.algorithm, 'SHA1');
  assert.equal(parsed.digits, 6);
  assert.equal(parsed.period, 30);
});

test('parseOtpauth: accepts a bare base32 secret (with mixed case / spacing)', () => {
  const parsed = vc.parseOtpauth('gezd gnbv gy3t qojq gezd gnbv gy3t qojq');
  assert.equal(parsed.secret, RFC_SECRET);
  assert.equal(vc.totp(parsed.secret, { digits: 8 }, 59 * 1000), '94287082');
});

test('parseOtpauth: rejects a wrong scheme / type / missing secret', () => {
  assert.throws(() => vc.parseOtpauth('otpauth://hotp/x?secret=' + RFC_SECRET), vc.VaultFormatError);
  assert.throws(() => vc.parseOtpauth('otpauth://totp/x?issuer=y'), vc.VaultFormatError);
  assert.throws(() => vc.parseOtpauth('!!!not-base32!!!'), vc.VaultFormatError);
});

// ---------------------------------------------------------------------------
// Production scrypt params + maxmem sizing (one slow test, isolated)
// ---------------------------------------------------------------------------

test('production scrypt params derive a key; too-low maxmem throws', async () => {
  const salt = crypto.randomBytes(16);
  const key = await vc.deriveMasterKey(MASTER_PW, salt, vc.SCRYPT_PARAMS);
  assert.equal(key.length, 32);

  // maxmem must exceed 128*N*r; below it, Node throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
  const { N, r, p } = vc.SCRYPT_PARAMS;
  const tooLow = { algo: 'scrypt', N, r, p, maxmem: 128 * N * r - 1 };
  await assert.rejects(
    () => vc.deriveMasterKey(MASTER_PW, salt, tooLow),
    (err) => /** @type {any} */ (err).code === 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS',
  );
});
