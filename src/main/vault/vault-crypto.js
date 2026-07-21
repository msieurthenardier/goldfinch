// @ts-check
'use strict';

// Vault crypto + `.gfvault` file format — the pure, headless cryptographic core
// of the password manager (Mission 12, Flight 1, Leg 1).
//
// PURE + ELECTRON-FREE: this module imports ONLY `node:crypto` (+ Node built-ins).
// It holds the KDFs, AES-256-GCM item encryption, the four envelope operations,
// the self-contained versioned `.gfvault` serialize/parse, and RFC 6238 TOTP —
// so the whole surface unit-tests offline with no Electron, no persistence, and
// no state. Persistence, identity ownership, and the MCP surface are later legs.
//
// KEY MODEL (flight DD3 — envelope set):
//   - One random 256-bit VAULT KEY encrypts the item payload (AES-256-GCM).
//   - The vault key is stored wrapped independently by each grantee ("envelope").
//     A wrong key fails GCM authentication — never a garbage Buffer.
//   - Each envelope carries a PLAINTEXT `keyId` + `type`, readable with no key.
//   - Master-password change / recovery rotation is RE-WRAP-ONLY: a new envelope
//     over the same vault key; the item ciphertext is never touched.
//
// ENVELOPE KEY DERIVATION (flight DD2 — only the master password is low-entropy):
//   | keyId          | wrapping-key derivation                              |
//   |----------------|-----------------------------------------------------|
//   | master         | scrypt(password, salt, params)  (async, stretched)  |
//   | recovery       | hkdf(recoveryMaterial, salt, info)  (high-entropy)  |
//   | <access-key-id>| hkdf(accessSecret, salt, info)   (per-jar grant)    |
//   | admin-pub      | X25519 ECDH → hkdf(sharedSecret)  (asymmetric seal) |
//
// AUTHENTICATED HEADERS (design review): each envelope's `keyId` + `type` and the
// document `version` are bound as GCM AAD, and the same `version` binds the items
// blob. Relabelling an envelope or downgrading the version fails authentication
// rather than silently succeeding — load-bearing because Leg 2 trusts the parsed
// plaintext header (load-loudly-never-quarantine).

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Format + KDF constants
// ---------------------------------------------------------------------------

/** The `.gfvault` format identifier. */
const FORMAT = 'gfvault';
/** The current on-disk format version. `parseVault` rejects any other value. */
const VERSION = 1;

/**
 * Production scrypt parameters (flight DD11). Benchmarked on the dev rig at
 * ~434 ms per derivation; `128 * N * r` = 128 MiB, so `maxmem` (192 MiB) must —
 * and does — exceed it, or Node throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 * @type {ScryptParams}
 */
const SCRYPT_PARAMS = Object.freeze({
  algo: 'scrypt',
  N: 2 ** 17,
  r: 8,
  p: 2,
  maxmem: 192 * 1024 * 1024,
});

// GCM sizing.
const IV_BYTES = 12;
const KEY_BYTES = 32; // AES-256 + the vault key are both 256-bit.

// HKDF `info` labels — domain separation between the recovery and access grants.
const HKDF_RECOVERY_INFO = Buffer.from('gfvault/recovery/v1', 'utf8');
const HKDF_ACCESS_INFO = Buffer.from('gfvault/access/v1', 'utf8');
const HKDF_ADMIN_INFO = Buffer.from('gfvault/admin-seal/v1', 'utf8');

// Reserved plaintext key-ids for the singleton envelope types.
const KEYID_MASTER = 'master';
const KEYID_RECOVERY = 'recovery';
const KEYID_ADMIN = 'admin-pub';

// Envelope `type` tags (bound into AAD).
const TYPE_MASTER = 'scrypt';
const TYPE_RECOVERY = 'hkdf-recovery';
const TYPE_ACCESS = 'hkdf-access';
const TYPE_ADMIN = 'x25519';

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ScryptParams
 * @property {'scrypt'} algo
 * @property {number} N   CPU/memory cost (power of two).
 * @property {number} r   block size.
 * @property {number} p   parallelization.
 * @property {number} maxmem  memory ceiling in bytes; must exceed 128*N*r.
 */

/**
 * A base64 AES-256-GCM ciphertext bundle.
 * @typedef {Object} GcmBlob
 * @property {string} iv   base64, 12 random bytes.
 * @property {string} ct   base64 ciphertext.
 * @property {string} tag  base64, 16-byte auth tag.
 */

/**
 * One stored wrap of the vault key. `keyId` + `type` are plaintext and
 * authenticated as AAD. `salt` is present for the KDF envelopes; `epk` (the
 * ephemeral SPKI-DER public key, base64) is present only for the X25519 seal.
 * @typedef {GcmBlob & { keyId: string, type: string, salt?: string, epk?: string }} Envelope
 */

/**
 * The item payload is opaque JSON to this module — item *schemas* (Login / Card /
 * Secure note) are vault-store's concern. Here it is any JSON-serializable value.
 * @typedef {Record<string, unknown> | unknown[]} ItemsPayload
 */

/**
 * The parsed `.gfvault` document.
 * @typedef {Object} VaultDocument
 * @property {'gfvault'} format
 * @property {number} version
 * @property {string} vaultId
 * @property {ScryptParams} kdf
 * @property {Envelope[]} envelopes
 * @property {GcmBlob} items
 */

// ---------------------------------------------------------------------------
// Typed errors — a bad tag / malformed document throws these, never returns junk
// ---------------------------------------------------------------------------

/** Authentication failure: wrong key, tampered ciphertext/IV/tag, or bad AAD. */
class VaultAuthError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultAuthError';
  }
}

/** Malformed, unknown-version, or structurally-invalid `.gfvault` input. */
class VaultFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultFormatError';
  }
}

// ---------------------------------------------------------------------------
// AAD construction
// ---------------------------------------------------------------------------

/**
 * Authenticated header for an envelope wrap: its keyId, its type, and the
 * document version. Altering any of the three changes the AAD and fails GCM auth.
 * @param {string} keyId
 * @param {string} type
 * @param {number} version
 * @returns {Buffer}
 */
function envelopeAad(keyId, type, version) {
  return Buffer.from(`gfvault/env/${version}/${type}/${keyId}`, 'utf8');
}

/**
 * Authenticated header for the items blob: the document version.
 * @param {number} version
 * @returns {Buffer}
 */
function itemsAad(version) {
  return Buffer.from(`gfvault/items/${version}`, 'utf8');
}

// ---------------------------------------------------------------------------
// AES-256-GCM primitives
// ---------------------------------------------------------------------------

/**
 * Encrypt with AES-256-GCM under a fresh random IV, binding `aad`.
 * @param {Buffer} plaintext
 * @param {Buffer} key  32 bytes.
 * @param {Buffer} aad
 * @returns {GcmBlob}
 */
function gcmEncrypt(plaintext, key, aad) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
}

/**
 * Decrypt an AES-256-GCM blob, verifying `aad` and the tag. A bad key / tampered
 * bytes / wrong AAD throw {@link VaultAuthError} — never a corrupt Buffer.
 * @param {GcmBlob} blob
 * @param {Buffer} key
 * @param {Buffer} aad
 * @returns {Buffer}
 */
function gcmDecrypt(blob, key, aad) {
  if (!blob || typeof blob !== 'object'
    || typeof blob.iv !== 'string' || typeof blob.ct !== 'string' || typeof blob.tag !== 'string') {
    throw new VaultAuthError('gcm: malformed ciphertext bundle');
  }
  let iv;
  let ct;
  let tag;
  try {
    iv = Buffer.from(blob.iv, 'base64');
    ct = Buffer.from(blob.ct, 'base64');
    tag = Buffer.from(blob.tag, 'base64');
  } catch {
    throw new VaultAuthError('gcm: undecodable ciphertext bundle');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch (err) {
    // GCM authentication failed (wrong key, tampered ct/iv/tag, or AAD mismatch),
    // or the IV/tag length was invalid. Surface a single typed error.
    throw new VaultAuthError(`gcm: authentication failed (${/** @type {Error} */ (err).message})`);
  }
}

// ---------------------------------------------------------------------------
// Vault key + item crypto
// ---------------------------------------------------------------------------

/**
 * Mint a fresh random 256-bit vault key.
 * @returns {Buffer}
 */
function newVaultKey() {
  return crypto.randomBytes(KEY_BYTES);
}

/**
 * Encrypt the items payload under the vault key. The document `version` is bound
 * as AAD. Each call draws a fresh IV — successive calls on one key differ.
 * @param {ItemsPayload} payload  any JSON-serializable value.
 * @param {Buffer} vaultKey
 * @param {number} [version]  defaults to the current format version.
 * @returns {GcmBlob}
 */
function encryptItems(payload, vaultKey, version = VERSION) {
  return gcmEncrypt(Buffer.from(JSON.stringify(payload), 'utf8'), vaultKey, itemsAad(version));
}

/**
 * Decrypt an items blob back to its payload. A tampered blob or a mismatched
 * `version` throws {@link VaultAuthError}.
 * @param {GcmBlob} blob
 * @param {Buffer} vaultKey
 * @param {number} [version]
 * @returns {ItemsPayload}
 */
function decryptItems(blob, vaultKey, version = VERSION) {
  const plain = gcmDecrypt(blob, vaultKey, itemsAad(version));
  try {
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new VaultAuthError('items: decrypted payload is not valid JSON');
  }
}

// ---------------------------------------------------------------------------
// Envelope key derivations
// ---------------------------------------------------------------------------

/**
 * Stretch the low-entropy master password into a 32-byte wrapping key with the
 * ASYNC scrypt primitive only (never the synchronous variant). Rejects if
 * `maxmem` is too low for N/r.
 * @param {string | Buffer} password
 * @param {Buffer} salt  >= 16 bytes.
 * @param {ScryptParams} [params]  defaults to the production parameters.
 * @returns {Promise<Buffer>}
 */
function deriveMasterKey(password, salt, params = SCRYPT_PARAMS) {
  const { N, r, p, maxmem } = params;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Derive a 32-byte wrapping key from high-entropy key material with HKDF-SHA256.
 * `hkdfSync` returns an ArrayBuffer — wrap it in a Buffer, or `@ts-check` fails
 * and downstream `.equals()` / Buffer methods throw at runtime.
 * @param {Buffer} secret  high-entropy input key material.
 * @param {Buffer} salt  >= 16 bytes.
 * @param {Buffer} info  domain-separation label.
 * @returns {Buffer}
 */
function deriveHkdfKey(secret, salt, info) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, salt, info, KEY_BYTES));
}

// ---------------------------------------------------------------------------
// Generic symmetric wrap / unwrap
// ---------------------------------------------------------------------------

/**
 * Wrap the vault key under a 32-byte symmetric wrapping key, binding `aad`.
 * @param {Buffer} vaultKey
 * @param {Buffer} wrappingKey
 * @param {Buffer} aad
 * @returns {GcmBlob}
 */
function wrapVaultKey(vaultKey, wrappingKey, aad) {
  return gcmEncrypt(vaultKey, wrappingKey, aad);
}

/**
 * Unwrap the vault key from a GCM blob. Wrong key / tamper / bad AAD throw
 * {@link VaultAuthError}.
 * @param {GcmBlob} blob
 * @param {Buffer} wrappingKey
 * @param {Buffer} aad
 * @returns {Buffer}
 */
function unwrapVaultKey(blob, wrappingKey, aad) {
  return gcmDecrypt(blob, wrappingKey, aad);
}

// ---------------------------------------------------------------------------
// The four envelope operations (create / open)
// ---------------------------------------------------------------------------

/**
 * Wrap the vault key under the scrypt-derived master key. Async (scrypt).
 * @param {Buffer} vaultKey
 * @param {string | Buffer} password
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.salt]  defaults to 16 fresh random bytes.
 * @param {ScryptParams} [opts.params]
 * @returns {Promise<Envelope>}
 */
async function wrapMaster(vaultKey, password, opts = {}) {
  const version = opts.version ?? VERSION;
  const salt = opts.salt ?? crypto.randomBytes(16);
  const wrappingKey = await deriveMasterKey(password, salt, opts.params ?? SCRYPT_PARAMS);
  const blob = wrapVaultKey(vaultKey, wrappingKey, envelopeAad(KEYID_MASTER, TYPE_MASTER, version));
  return { keyId: KEYID_MASTER, type: TYPE_MASTER, salt: salt.toString('base64'), ...blob };
}

/**
 * Open the master envelope with the password. Async.
 * @param {Envelope} env
 * @param {string | Buffer} password
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @param {ScryptParams} [opts.params]
 * @returns {Promise<Buffer>}
 */
async function unwrapMaster(env, password, opts = {}) {
  const version = opts.version ?? VERSION;
  if (typeof env.salt !== 'string') throw new VaultFormatError('master envelope: missing salt');
  const wrappingKey = await deriveMasterKey(password, Buffer.from(env.salt, 'base64'), opts.params ?? SCRYPT_PARAMS);
  return unwrapVaultKey(env, wrappingKey, envelopeAad(env.keyId, env.type, version));
}

/**
 * Wrap the vault key under the HKDF-derived recovery key.
 * @param {Buffer} vaultKey
 * @param {Buffer} recoveryMaterial  the 20-byte recovery-key material.
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.salt]
 * @returns {Envelope}
 */
function wrapRecovery(vaultKey, recoveryMaterial, opts = {}) {
  const version = opts.version ?? VERSION;
  const salt = opts.salt ?? crypto.randomBytes(16);
  const wrappingKey = deriveHkdfKey(recoveryMaterial, salt, HKDF_RECOVERY_INFO);
  const blob = wrapVaultKey(vaultKey, wrappingKey, envelopeAad(KEYID_RECOVERY, TYPE_RECOVERY, version));
  return { keyId: KEYID_RECOVERY, type: TYPE_RECOVERY, salt: salt.toString('base64'), ...blob };
}

/**
 * Open the recovery envelope with the recovery material.
 * @param {Envelope} env
 * @param {Buffer} recoveryMaterial
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @returns {Buffer}
 */
function unwrapRecovery(env, recoveryMaterial, opts = {}) {
  const version = opts.version ?? VERSION;
  if (typeof env.salt !== 'string') throw new VaultFormatError('recovery envelope: missing salt');
  const wrappingKey = deriveHkdfKey(recoveryMaterial, Buffer.from(env.salt, 'base64'), HKDF_RECOVERY_INFO);
  return unwrapVaultKey(env, wrappingKey, envelopeAad(env.keyId, env.type, version));
}

/**
 * Wrap the vault key under an HKDF-derived per-jar access key. The `keyId` is
 * assigned at mint (independent of the secret) and becomes the envelope's
 * plaintext id for revoke/reference.
 * @param {Buffer} vaultKey
 * @param {string} accessSecret  the mint's base64url secret.
 * @param {string} keyId  the mint's assigned key-id.
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.salt]
 * @returns {Envelope}
 */
function wrapAccess(vaultKey, accessSecret, keyId, opts = {}) {
  const version = opts.version ?? VERSION;
  if (typeof keyId !== 'string' || keyId.length === 0) {
    throw new VaultFormatError('access envelope: keyId must be a non-empty string');
  }
  const salt = opts.salt ?? crypto.randomBytes(16);
  const wrappingKey = deriveHkdfKey(Buffer.from(accessSecret, 'utf8'), salt, HKDF_ACCESS_INFO);
  const blob = wrapVaultKey(vaultKey, wrappingKey, envelopeAad(keyId, TYPE_ACCESS, version));
  return { keyId, type: TYPE_ACCESS, salt: salt.toString('base64'), ...blob };
}

/**
 * Open a per-jar access envelope with its secret.
 * @param {Envelope} env
 * @param {string} accessSecret
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @returns {Buffer}
 */
function unwrapAccess(env, accessSecret, opts = {}) {
  const version = opts.version ?? VERSION;
  if (typeof env.salt !== 'string') throw new VaultFormatError('access envelope: missing salt');
  const wrappingKey = deriveHkdfKey(Buffer.from(accessSecret, 'utf8'), Buffer.from(env.salt, 'base64'), HKDF_ACCESS_INFO);
  return unwrapVaultKey(env, wrappingKey, envelopeAad(env.keyId, env.type, version));
}

/**
 * Seal the vault key to an admin X25519 public key. Generates an ephemeral
 * keypair, does ECDH, derives the wrapping key via HKDF, and stores the ephemeral
 * PUBLIC key as `epk` (SPKI-DER, base64) so `openAdminSeal` can reconstruct it.
 * Only the admin private key opens the result.
 * @param {Buffer} vaultKey
 * @param {crypto.KeyObject} adminPublicKey  an X25519 public KeyObject.
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @returns {Envelope}
 */
function sealToAdmin(vaultKey, adminPublicKey, opts = {}) {
  const version = opts.version ?? VERSION;
  const eph = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: adminPublicKey });
  const salt = crypto.randomBytes(16);
  const wrappingKey = deriveHkdfKey(shared, salt, HKDF_ADMIN_INFO);
  const epk = eph.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const blob = wrapVaultKey(vaultKey, wrappingKey, envelopeAad(KEYID_ADMIN, TYPE_ADMIN, version));
  return { keyId: KEYID_ADMIN, type: TYPE_ADMIN, salt: salt.toString('base64'), epk, ...blob };
}

/**
 * Open an admin seal with the admin X25519 private key.
 * @param {Envelope} env
 * @param {crypto.KeyObject} adminPrivateKey  an X25519 private KeyObject.
 * @param {Object} [opts]
 * @param {number} [opts.version]
 * @returns {Buffer}
 */
function openAdminSeal(env, adminPrivateKey, opts = {}) {
  const version = opts.version ?? VERSION;
  if (typeof env.epk !== 'string') throw new VaultFormatError('admin envelope: missing epk');
  if (typeof env.salt !== 'string') throw new VaultFormatError('admin envelope: missing salt');
  let ephPub;
  try {
    ephPub = crypto.createPublicKey({ key: Buffer.from(env.epk, 'base64'), format: 'der', type: 'spki' });
  } catch (err) {
    throw new VaultFormatError(`admin envelope: unreadable epk (${/** @type {Error} */ (err).message})`);
  }
  let shared;
  try {
    shared = crypto.diffieHellman({ privateKey: adminPrivateKey, publicKey: ephPub });
  } catch (err) {
    throw new VaultAuthError(`admin seal: ECDH failed (${/** @type {Error} */ (err).message})`);
  }
  const wrappingKey = deriveHkdfKey(shared, Buffer.from(env.salt, 'base64'), HKDF_ADMIN_INFO);
  return unwrapVaultKey(env, wrappingKey, envelopeAad(env.keyId, env.type, version));
}

// ---------------------------------------------------------------------------
// Key / identifier generation
// ---------------------------------------------------------------------------

// RFC 4648 base32 alphabet (shared by the recovery key display and TOTP).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode bytes as unpadded RFC 4648 base32 (uppercase).
 * @param {Buffer} buf
 * @returns {string}
 */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decode an RFC 4648 base32 string to bytes. Tolerant of lowercase, whitespace,
 * hyphen grouping, and `=` padding. Rejects non-alphabet characters.
 * @param {string} str
 * @returns {Buffer}
 */
function base32Decode(str) {
  if (typeof str !== 'string') throw new VaultFormatError('base32: input must be a string');
  const clean = str.toUpperCase().replace(/=+$/g, '').replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new VaultFormatError(`base32: invalid character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Group a base32 string into hyphen-separated blocks for human display.
 * @param {string} b32
 * @param {number} [group]  block size (default 5).
 * @returns {string}
 */
function groupBase32(b32, group = 5) {
  const parts = [];
  for (let i = 0; i < b32.length; i += group) {
    parts.push(b32.slice(i, i + group));
  }
  return parts.join('-');
}

/**
 * Generate a recovery key: 20 random bytes of material (a clean 32-char base32
 * with no padding) plus a grouped-uppercase `display` string for printing.
 * @returns {{ display: string, material: Buffer }}
 */
function generateRecoveryKey() {
  const material = crypto.randomBytes(20);
  const display = groupBase32(base32Encode(material), 5);
  return { display, material };
}

/**
 * Parse a recovery-key display string back to its 20-byte material. Tolerant of
 * casing / grouping / whitespace (round-trips {@link generateRecoveryKey}).
 * @param {string} display
 * @returns {Buffer}
 */
function parseRecoveryKey(display) {
  const material = base32Decode(display);
  if (material.length !== 20) {
    throw new VaultFormatError(`recovery key: expected 20 bytes of material, got ${material.length}`);
  }
  return material;
}

/**
 * Mint a per-jar access key: a high-entropy `secret` and a SEPARATE random
 * `keyId` (independent of the secret) used as the envelope's plaintext id.
 * @returns {{ secret: string, keyId: string }}
 */
function generateAccessKey() {
  return {
    secret: crypto.randomBytes(32).toString('base64url'),
    keyId: crypto.randomBytes(8).toString('base64url'),
  };
}

/**
 * Generate an admin X25519 keypair. Returns the KeyObjects plus their SPKI/PKCS8
 * base64 exports — the public half goes in manager metadata; the private half is
 * operator-held (ownership/persistence is Leg 2's concern, not this module's).
 * @returns {{
 *   publicKey: crypto.KeyObject,
 *   privateKey: crypto.KeyObject,
 *   publicKeyB64: string,
 *   privateKeyB64: string
 * }}
 */
function generateAdminKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKey,
    privateKey,
    publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

/**
 * Reconstruct an admin PUBLIC KeyObject from its SPKI-DER base64 export.
 * @param {string} b64
 * @returns {crypto.KeyObject}
 */
function importAdminPublicKey(b64) {
  return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
}

/**
 * Reconstruct an admin PRIVATE KeyObject from its PKCS8-DER base64 export.
 * @param {string} b64
 * @returns {crypto.KeyObject}
 */
function importAdminPrivateKey(b64) {
  return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
}

// ---------------------------------------------------------------------------
// Serialization — the self-contained versioned `.gfvault` document
// ---------------------------------------------------------------------------

/**
 * Validate that an envelope set has no duplicate keyIds. Throws on a collision.
 * @param {Envelope[]} envelopes
 */
function assertUniqueKeyIds(envelopes) {
  const seen = new Set();
  for (const env of envelopes) {
    if (!env || typeof env.keyId !== 'string') {
      throw new VaultFormatError('envelope set: every envelope needs a string keyId');
    }
    if (seen.has(env.keyId)) {
      throw new VaultFormatError(`envelope set: duplicate keyId "${env.keyId}"`);
    }
    seen.add(env.keyId);
  }
}

/**
 * Serialize a vault into the single JSON `.gfvault` document. Stamps the format
 * id + current version; rejects a set with duplicate keyIds.
 * @param {Object} vaultObj
 * @param {string} [vaultObj.vaultId]  defaults to a fresh random hex id.
 * @param {ScryptParams} [vaultObj.kdf]  defaults to the production params.
 * @param {Envelope[]} vaultObj.envelopes
 * @param {GcmBlob} vaultObj.items
 * @returns {string}
 */
function serializeVault(vaultObj) {
  if (!vaultObj || typeof vaultObj !== 'object') {
    throw new VaultFormatError('serializeVault: expected a vault object');
  }
  const { vaultId, kdf, envelopes, items } = vaultObj;
  if (!Array.isArray(envelopes)) throw new VaultFormatError('serializeVault: envelopes must be an array');
  if (!items || typeof items !== 'object') throw new VaultFormatError('serializeVault: missing items blob');
  assertUniqueKeyIds(envelopes);
  /** @type {VaultDocument} */
  const doc = {
    format: FORMAT,
    version: VERSION,
    vaultId: vaultId ?? crypto.randomBytes(16).toString('hex'),
    kdf: kdf ?? SCRYPT_PARAMS,
    envelopes,
    items,
  };
  return JSON.stringify(doc);
}

/**
 * Parse + strictly validate a `.gfvault` document. Rejects malformed JSON, a
 * wrong format id, an unknown version, a bad shape, or duplicate keyIds with a
 * typed {@link VaultFormatError} — Leg 2's load-loudly rule depends on strictness.
 * @param {string | Buffer} input
 * @returns {VaultDocument}
 */
function parseVault(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (typeof text !== 'string') throw new VaultFormatError('parseVault: input must be a string or Buffer');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new VaultFormatError(`parseVault: invalid JSON (${/** @type {Error} */ (err).message})`);
  }
  if (!doc || typeof doc !== 'object') throw new VaultFormatError('parseVault: document is not an object');
  if (doc.format !== FORMAT) throw new VaultFormatError(`parseVault: unknown format "${doc.format}"`);
  if (doc.version !== VERSION) throw new VaultFormatError(`parseVault: unsupported version "${doc.version}"`);
  if (!doc.kdf || typeof doc.kdf !== 'object') throw new VaultFormatError('parseVault: missing kdf');
  if (!Array.isArray(doc.envelopes)) throw new VaultFormatError('parseVault: envelopes must be an array');
  if (!doc.items || typeof doc.items !== 'object'
    || typeof doc.items.iv !== 'string' || typeof doc.items.ct !== 'string' || typeof doc.items.tag !== 'string') {
    throw new VaultFormatError('parseVault: malformed items blob');
  }
  for (const env of doc.envelopes) {
    if (!env || typeof env !== 'object'
      || typeof env.keyId !== 'string' || typeof env.type !== 'string'
      || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.tag !== 'string') {
      throw new VaultFormatError('parseVault: malformed envelope');
    }
  }
  assertUniqueKeyIds(doc.envelopes);
  return /** @type {VaultDocument} */ (doc);
}

/**
 * List every envelope's plaintext keyId from a parsed document — readable with
 * no key material (the behavior test's key-inventory apparatus).
 * @param {VaultDocument} parsed
 * @returns {string[]}
 */
function listEnvelopeKeyIds(parsed) {
  if (!parsed || !Array.isArray(parsed.envelopes)) {
    throw new VaultFormatError('listEnvelopeKeyIds: expected a parsed vault document');
  }
  return parsed.envelopes.map((env) => env.keyId);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) + otpauth parsing — no dependencies
// ---------------------------------------------------------------------------

/**
 * Normalize an algorithm name to Node's HMAC id ('SHA1'/'SHA-256' → 'sha1'/'sha256').
 * @param {string} algorithm
 * @returns {string}
 */
function normalizeAlgorithm(algorithm) {
  return String(algorithm).toLowerCase().replace(/-/g, '');
}

/**
 * Generate an RFC 6238 TOTP code. The timestamp is an EXPLICIT argument (the pure
 * function never reads the clock) so callers pin it and tests reproduce the RFC
 * vectors. Counter = floor(timestampMs/1000/period), 8-byte big-endian.
 * @param {string} base32Secret  the shared secret, base32-encoded.
 * @param {{ algorithm?: string, digits?: number, period?: number } | null | undefined} opts
 *   `algorithm` 'SHA1' (default) / 'SHA256' / 'SHA512'; `digits` default 6;
 *   `period` seconds, default 30. May be null/undefined for all-defaults.
 * @param {number} timestampMs  the epoch time in milliseconds.
 * @returns {string}  the zero-padded code.
 */
function totp(base32Secret, opts, timestampMs) {
  const { algorithm = 'SHA1', digits = 6, period = 30 } = opts || {};
  if (!Number.isFinite(timestampMs)) throw new VaultFormatError('totp: timestampMs must be a finite number');
  const key = base32Decode(base32Secret);
  const counter = Math.floor(timestampMs / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(normalizeAlgorithm(algorithm), key).update(counterBuf).digest();
  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// The TOTP parameter ranges a stored/enrolled secret must satisfy (M12 F3 Leg 3).
// Out-of-range params are what crash `totp()` — period 0 divides by zero, an absurd
// digits count overflows `10 ** digits` — so enrollment MUST reject them before a
// value ever reaches `totp()` (this op AND F1's automation `vaultTotp` read).
const TOTP_ALGORITHMS = new Set(['SHA1', 'SHA256', 'SHA512']);
const TOTP_DIGITS = new Set([6, 7, 8]);

/**
 * Seconds until the current TOTP window rolls over, for the live countdown display
 * (M12 F3 Leg 3 / DD4). Pure: `period - (⌊now/1000⌋ mod period)`, always in
 * `[1, period]` (never 0 — a fresh window reports the full `period`). The main-side
 * live-code op returns this beside the code; the page counts DOWN locally from it and
 * re-fetches when it hits 0 (per-period, not per-second — a full-vault decrypt/call).
 * @param {number} period  the TOTP step in seconds (integer ≥ 1).
 * @param {number} timestampMs  epoch time in milliseconds.
 * @returns {number}
 */
function totpSecondsRemaining(period, timestampMs) {
  if (!Number.isInteger(period) || period < 1) {
    throw new VaultFormatError(`totpSecondsRemaining: period must be an integer >= 1 (got ${period})`);
  }
  if (!Number.isFinite(timestampMs)) {
    throw new VaultFormatError('totpSecondsRemaining: timestampMs must be a finite number');
  }
  return period - (Math.floor(timestampMs / 1000) % period);
}

/**
 * Normalize an enrolled TOTP secret (an `otpauth://totp/…` URI OR a bare base32
 * secret) to the CANONICAL `otpauth://totp/…` URI STRING the store persists
 * (M12 F3 Leg 3, Architect-ruled: `item.totp` stays a bare STRING, so the sole
 * value-reader — F1's automation `vault-context.js` `parseOtpauth(item.totp)` — is
 * unchanged and legacy items keep working).
 *
 * `parseOtpauth(raw)` (throws {@link VaultFormatError} on malformed input) →
 * RANGE-VALIDATE (`period` an integer ≥ 1, `digits` ∈ {6,7,8}, `algorithm` ∈
 * {SHA1,SHA256,SHA512}; a bad range throws {@link VaultFormatError}) → re-serialize
 * to a canonical URI that round-trips through `parseOtpauth`. A hostile/fat-finger
 * otpauth (`period=0`, `digits=99`, bad algorithm) can therefore never be persisted
 * or reach `totp()` — hardening BOTH this leg's live-code op and F1's un-try/catch'd
 * automation read.
 * @param {string} raw  the pasted otpauth URI or bare base32 secret.
 * @returns {string}  the canonical `otpauth://totp/…` URI string.
 */
function normalizeTotpField(raw) {
  const p = parseOtpauth(raw); // VaultFormatError on malformed URI / bad base32.
  const algorithm = String(p.algorithm).toUpperCase();
  if (!Number.isInteger(p.period) || p.period < 1) {
    throw new VaultFormatError(`normalizeTotpField: period must be an integer >= 1 (got ${p.period})`);
  }
  if (!TOTP_DIGITS.has(p.digits)) {
    throw new VaultFormatError(`normalizeTotpField: digits must be one of 6, 7, 8 (got ${p.digits})`);
  }
  if (!TOTP_ALGORITHMS.has(algorithm)) {
    throw new VaultFormatError(`normalizeTotpField: algorithm must be SHA1/SHA256/SHA512 (got ${p.algorithm})`);
  }
  const params = new URLSearchParams();
  params.set('secret', p.secret);
  params.set('algorithm', algorithm);
  params.set('digits', String(p.digits));
  params.set('period', String(p.period));
  if (p.issuer) params.set('issuer', p.issuer);
  // The label is the URI path segment; percent-encode it so any character (incl. a
  // colon issuer-prefix or spaces) round-trips through `parseOtpauth`'s new URL().
  const label = p.label != null ? p.label : (p.issuer || '');
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Parse an `otpauth://totp/...` URI (or a bare base32 secret) into its TOTP
 * parameters. base32 decode is local; percent-encoding is honored.
 * @param {string} uri
 * @returns {{ secret: string, algorithm: string, digits: number, period: number, issuer?: string, label?: string }}
 */
function parseOtpauth(uri) {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new VaultFormatError('parseOtpauth: expected a non-empty string');
  }
  // Bare base32 secret (no scheme): validate it decodes, return defaults.
  if (!uri.includes('://')) {
    base32Decode(uri); // throws VaultFormatError on invalid base32.
    return { secret: uri.replace(/[\s-]/g, '').toUpperCase(), algorithm: 'SHA1', digits: 6, period: 30 };
  }
  let url;
  try {
    url = new URL(uri);
  } catch (err) {
    throw new VaultFormatError(`parseOtpauth: invalid URI (${/** @type {Error} */ (err).message})`);
  }
  if (url.protocol !== 'otpauth:') throw new VaultFormatError(`parseOtpauth: unsupported scheme "${url.protocol}"`);
  if (url.host.toLowerCase() !== 'totp') throw new VaultFormatError(`parseOtpauth: unsupported type "${url.host}"`);

  const secretParam = url.searchParams.get('secret');
  if (!secretParam) throw new VaultFormatError('parseOtpauth: missing secret parameter');
  base32Decode(secretParam); // validate.

  const label = decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined;
  let issuer = url.searchParams.get('issuer') || undefined;
  // Fall back to the "Issuer:account" label prefix when no issuer parameter.
  if (!issuer && label && label.includes(':')) {
    issuer = label.slice(0, label.indexOf(':')).trim() || undefined;
  }
  const digitsParam = url.searchParams.get('digits');
  const periodParam = url.searchParams.get('period');
  const algorithmParam = url.searchParams.get('algorithm');

  return {
    secret: secretParam.replace(/[\s-]/g, '').toUpperCase(),
    algorithm: algorithmParam ? algorithmParam.toUpperCase() : 'SHA1',
    digits: digitsParam ? parseInt(digitsParam, 10) : 6,
    period: periodParam ? parseInt(periodParam, 10) : 30,
    ...(issuer ? { issuer } : {}),
    ...(label ? { label } : {}),
  };
}

// ---------------------------------------------------------------------------

module.exports = {
  // constants
  FORMAT,
  VERSION,
  SCRYPT_PARAMS,
  // errors
  VaultAuthError,
  VaultFormatError,
  // vault key + item crypto
  newVaultKey,
  encryptItems,
  decryptItems,
  // derivations + generic wrap
  deriveMasterKey,
  deriveHkdfKey,
  wrapVaultKey,
  unwrapVaultKey,
  // the four envelope operations
  wrapMaster,
  unwrapMaster,
  wrapRecovery,
  unwrapRecovery,
  wrapAccess,
  unwrapAccess,
  sealToAdmin,
  openAdminSeal,
  // key / identifier generation
  generateRecoveryKey,
  parseRecoveryKey,
  generateAccessKey,
  generateAdminKeypair,
  importAdminPublicKey,
  importAdminPrivateKey,
  // base32 helpers (shared)
  base32Encode,
  base32Decode,
  // serialization
  serializeVault,
  parseVault,
  listEnvelopeKeyIds,
  // TOTP
  totp,
  parseOtpauth,
  normalizeTotpField,
  totpSecondsRemaining,
};
