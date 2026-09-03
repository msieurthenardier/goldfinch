// @ts-check
'use strict';

// Vault store — the stateful, persisted, lockable manager that composes the pure
// `vault-crypto` core into real `.gfvault` files on disk (Mission 12, Flight 1,
// Leg 2).
//
// ELECTRON-FREE: this module requires ONLY `vault-crypto`, `./atomic-write`, and
// Node built-ins. Every host handle (`userDataPath`, a `listJars()` provider, the
// idle-timer functions, a lock callback) is INJECTED at `load(userDataPath, deps)`
// — the exact pattern settings-store / jars use, so the whole surface unit-tests
// headlessly with real temp dirs and no Electron. It never imports the electron
// module and never imports the app-db module — `.gfvault` files are self-contained
// documents, not `app.db` rows (DD1).
//
// MANAGER ROOT KEY (MRK) composition (leg DECISION resolving DD3 vs. lazy jars):
//   - `setup()` mints ONE random 256-bit MRK. The MRK is wrapped three ways in
//     `manager.json`: under the master password (scrypt), under the one-time
//     recovery key (HKDF), and sealed to the admin public key (X25519). The MRK
//     is NEVER stored in plaintext; only the admin PUBLIC key is plaintext.
//   - Each vault key (the global vault + every lazily-created jar vault) is
//     wrapped under the MRK — a single `mrk` envelope on each `.gfvault`. So
//     master OR recovery OR admin unwraps the MRK, which unwraps every vault key,
//     including jar vaults created AFTER setup — with no new operator secret at
//     jar creation.
//   - Per-jar automation access keys wrap the individual vault key DIRECTLY (an
//     `access` envelope on that jar's vault). An access key therefore opens ONLY
//     its own vault — it holds no envelope for the MRK, so it cannot reach the
//     global vault or sibling jars (structural compartmentalization).
//
// LOAD-LOUDLY (opposite of app-db.js): a truncated / tampered `manager.json` or
// `.gfvault` throws a typed error (VaultFormatError / VaultAuthError). The file is
// NEVER quarantined, renamed, or recreated — the operator's ciphertext is sacred.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const vc = require('./vault-crypto');
const { writeFileAtomic } = require('./atomic-write');
// M18 F2 Leg 2 (DD2): the multi-file transaction primitive. The store consumes
// ONLY `recover` today (idempotent load-time recovery in the constructor);
// beginTransaction/commit are driven by the compromise rotation (leg 3).
const vtxn = require('./vault-txn');

// The global (non-jar) vault's stable id / filename base. Single-sourced in
// src/shared/reserved-ids.js (M12 F3 DD8) so this sentinel and jars.js's
// `isReservedId` `'global'` can never drift. reserved-ids.js is a dependency-free
// plain-CJS constant, so importing it keeps this store Electron-free / app-db-free.
const { GLOBAL_ID } = require('../../shared/reserved-ids');

// Per-type secret/non-secret taxonomy (M12 F3 Leg 2 / DD3, DD6, DD10). The SINGLE
// SOURCE both the metadata projection (`listItemsMeta` → `metadataOf`, a positive
// whitelist) and the preserving save-merge (`saveItemPreservingSecrets` →
// `secretFieldsFor`) consume as complements — so a field can never drift into a
// leak (metadata) or a drop (save). Plain-CJS shared constant; keeps the store
// Electron-free / app-db-free (the reserved-ids.js precedent).
const { metadataOf, secretFieldsFor } = require('../../shared/vault-item-schema');

// Fill matcher (M12 F4 Leg 4 / DD5) — exact-origin by default, optionally widened to
// the registrable domain for `matchMode:'registrable-domain'` items behind the
// fail-closed PSL matcher. reachableLoginItems passes `widen` through per call.
const { originMatches } = require('../../shared/origin-match');

// The manager document format id + version (vault-store OWNS this format).
//
// TWO versions are READABLE (M18 F2 Leg 1 / DD1; v1 relaxed M18 F3 Leg 2 /
// ruling 10):
//   - v1 and v2: `mrk.master` + `mrk.recovery` required; the ADMIN PAIR
//     (`mrk.admin` + `adminPublicKeyB64`) may be deliberately ABSENT
//     (unprovisioned/revoked, or a no-admin fresh adopt) — but always present
//     TOGETHER or absent TOGETHER (a lone seal is unopenable; a lone pubkey
//     corrupts export and fools revalidate) — one without the other is
//     malformed-present → VaultFormatError. v1 originally REQUIRED the pair
//     (every profile `setup()` ever writes it); the relaxation costs nothing
//     for those profiles and is what makes a no-admin adopt of a
//     v1-effective bundle legal (Flight 3's multi-vault portability) — a
//     slot-deletion tamper on a v1 manager now degrades to the no-admin
//     STATE instead of a loud format error; envelope integrity itself stays
//     GCM/AAD-protected regardless.
// MANAGER_VERSION stays 1: `setup()` still WRITES v1 (v2 writers are the
// compromise rotation / Flight 3's adopt — later legs). Every manager-envelope
// wrap/unwrap site passes the DOCUMENT'S stated version (never the constant), and
// single-slot rotations preserve the version they read — so a document's
// envelopes are always AAD-homogeneous and no operation can create a
// mixed-version document.
const MANAGER_FORMAT = 'gfmanager';
const MANAGER_VERSION = 1;
// v2 is written ONLY by operations that rewrite the FULL envelope set (DD1's
// homogeneity rule): the compromise rotation below (M18 F2 Leg 3 — the first
// legitimate v2 writer) and Flight 3's fresh adopt (bundle-driven).
const MANAGER_VERSION_V2 = 2;
const READABLE_MANAGER_VERSIONS = new Set([MANAGER_VERSION, MANAGER_VERSION_V2]);

// The portable export-bundle format id + version (M12 F4 Leg 1 / DD1 — Option A).
// A bundle is `{ format, version, sourceVaultId, kdf, mrk:{master,recovery,admin},
// adminPublicKeyB64, vault:<.gfvault doc> }` — ALL ciphertext + the KDF params + the
// admin PUBLIC key; NO plaintext secret, NO password needed to build it. vault-store
// OWNS this format independently of the gfmanager / gfvault version spaces.
const BUNDLE_FORMAT = 'gfvault-bundle';
const BUNDLE_VERSION = 1;
// The whole-profile, multi-vault bundle format (M18 F3 Leg 2 / DD1 ruling 2):
// `{ format, version: 2, managerVersion, kdf, mrk:{master,recovery,admin?},
// adminPublicKeyB64?, vaults: [{ sourceId, jarMeta?, vault }] }` — every jar
// entry's `jarMeta` ({name,color}) rides as CIPHERTEXT (see `encryptJarMeta`/
// `decryptJarMeta` below), keyed off the bundle MRK. `exportVault`/`importVault`
// (single-vault, BUNDLE_VERSION) are UNCHANGED this leg; `exportProfile`/
// `restoreProfile` are the new v2 entry points. `restoreProfile` additionally
// ACCEPTS a v1 bundle (normalized to a one-row v2 shape internally — ruling 9);
// `importVault`'s own gate stays v1-only — it never learns v2 exists.
const BUNDLE_VERSION_V2 = 2;

// The item types this store recognizes. vault-crypto treats items as opaque
// JSON; the schema is validated HERE.
const ITEM_TYPES = new Set(['login', 'card', 'note']);

// ---------------------------------------------------------------------------
// Typed errors — a locked / not-set-up / unknown-jar condition throws these; the
// crypto-layer VaultAuthError / VaultFormatError propagate unchanged.
// ---------------------------------------------------------------------------

/** The manager is locked (no MRK in memory) but the operation needs it. */
class VaultLockedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultLockedError';
  }
}

/**
 * A compromise rotation holds write exclusivity (M18 F2 Leg 2 / DD3): the store
 * is temporarily refusing mutating (and export-read) operations. Transient by
 * design — callers surface "busy, retry when the rotation completes" and never
 * treat it as an auth/format failure.
 */
class VaultBusyError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultBusyError';
  }
}

/**
 * The compromise rotation's R7 refusal (M18 F2 Leg 3): the NEW master password
 * matches the OLD one on either credential branch. A DISTINCT class — leg 4's
 * sheet handler maps it to the ruled inline copy ("Your new master password
 * must be different from your old one"), so it must be discriminable from a
 * wrong-credential VaultAuthError without message-matching.
 */
class VaultPasswordReuseError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultPasswordReuseError';
  }
}

/** A state / argument problem: not set up, double setup, unknown jar, no vault. */
class VaultStateError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultStateError';
  }
}

/**
 * A DISTINGUISHABLE import-collision: a vault already exists at the resolved import destination
 * and `overwrite` was not passed (M12 F5 HAT tail). importVault throws VaultStateError for
 * SEVERAL other reasons (bad bundle/secret args, an unknown/burner destination target), so the
 * import path must NOT message-match to tell "already exists" apart from those or from a
 * wrong-secret VaultAuthError. This subclass (a `code` marker + `instanceof VaultStateError`
 * still holding, so existing catchers are unaffected) lets the sheet surface a truthful "a vault
 * already exists" message rather than a misleading "check the secret" one.
 */
class VaultCollisionError extends VaultStateError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultCollisionError';
    /** @type {'vault-collision'} */
    this.code = 'vault-collision';
  }
}

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * The item payload shape (opaque to vault-crypto, validated here). One of three
 * kinds — Login / Card / Secure note — sharing an id + type + timestamps and
 * carrying kind-specific fields verbatim.
 * @typedef {Object} VaultItem
 * @property {string} id  stable per-item id (minted here if absent).
 * @property {'login' | 'card' | 'note'} type
 * @property {number} createdAt  epoch ms (from the injected clock).
 * @property {number} updatedAt  epoch ms.
 */

/**
 * Injected host dependencies. Everything the store needs from Electron / the app
 * is passed here so the module stays Electron-free.
 * @typedef {Object} VaultStoreDeps
 * @property {() => Array<{ id: string }>} [listJars]  persistent jars (burner excluded).
 * @property {() => number} [getAutoLockMinutes]  idle auto-lock minutes.
 * @property {(() => void)} [onLock]  called after any lock (Lock now / idle / quit).
 * @property {(() => void)} [onUnlock]  called after any MRK install (master / recovery / admin unlock).
 * @property {(fn: () => void, ms: number) => any} [setTimeout]  idle-timer arm (default global).
 * @property {(handle: any) => void} [clearTimeout]  idle-timer clear (default global).
 * @property {() => number} [now]  clock (default Date.now) — item timestamps.
 * @property {any} [scryptParams]  master-KDF params (default production SCRYPT_PARAMS).
 * @property {(name: string, color: string) => { id: string, name: string, color: string, partition: string, retentionDays: number }} [createJar]
 *   create a persistent jar (`jars.js`'s `add`) — injected so this module stays
 *   jars.js-free (Electron-free discipline); consumed by `restoreProfile`'s
 *   `'new'` directive (M18 F3 Leg 2 / DD3 ruling 4). Wiring the real `jars.add`
 *   is main.js's job (Leg 3) — unit tests inject a fake.
 * @property {(id: string) => boolean} [verifyJarPersisted]  read-back confirmation
 *   that a jar id landed durably (`jars.js`'s `verifyPersisted`) — required
 *   alongside `createJar` for the create-then-verify step a `'new'` directive
 *   runs before writing its vault (DD3 ruling 4: `jars.add`'s `save()` is
 *   fail-soft, so an unverified create could land a vault under a jar that
 *   evaporates on restart).
 */

// ---------------------------------------------------------------------------
// AAD for the `mrk` envelope. vault-crypto's internal `envelopeAad` is not
// exported, so bind a concrete, stable AAD mirroring its scheme: the `.gfvault`
// document version. The IDENTICAL buffer is passed on wrap and unwrap, so a
// version-downgrade / relabel of the `mrk` envelope fails GCM authentication —
// the tamper protection DD3 mandates for every envelope.
// ---------------------------------------------------------------------------

/**
 * @param {number} version  the `.gfvault` document version.
 * @returns {Buffer}
 */
function mrkEnvelopeAad(version) {
  return Buffer.from(`gfvault/mrk-env/v${version}`, 'utf8');
}

// ---------------------------------------------------------------------------
// jarMeta — the bundle v2 encrypted jar identity (M18 F3 Leg 2 / DD1 ruling 2).
// A jar's PORTABLE identity (`{ name, color }` — everything else on the jar
// record is destination-local) rides in the bundle as ciphertext keyed off the
// bundle MRK, via the EXPORTED generic primitives (`deriveHkdfKey` +
// `wrapVaultKey`/`unwrapVaultKey`, `vault-crypto.js`) — no new crypto surface,
// mirroring the `mrkEnvelopeAad` local-helper idiom above. `restoreProfile`
// itself never reads jarMeta (cycle-1 review question 3, ruled): it consumes
// the explicit `mapping[].newJar.{name,color}` the mapping step supplies;
// `decryptJarMeta` is exported for THAT (leg 3's) pre-mapping label step.
// ---------------------------------------------------------------------------

const JARMETA_SALT_BYTES = 16;
// Domain-separation label for the jarMeta wrapping-key HKDF derive — distinct
// from every vault-crypto internal HKDF info string (recovery/access/admin),
// so a jarMeta key can never collide with an envelope wrapping key even though
// both derive from key material an attacker might control (the bundle MRK is
// never attacker-controlled, but domain separation is cheap and correct).
const JARMETA_HKDF_INFO = Buffer.from('gfvault-bundle/jarMeta', 'utf8');

/**
 * AAD for a jarMeta envelope: binds the bundle context + the vault's sourceId
 * (the `mrkEnvelopeAad` idiom) — a jarMeta envelope spliced onto a DIFFERENT
 * bundle vault entry fails GCM authentication rather than silently relabeling.
 * @param {string} sourceId
 * @returns {Buffer}
 */
function jarMetaAad(sourceId) {
  return Buffer.from(`gfvault-bundle/jarMeta/${sourceId}`, 'utf8');
}

/**
 * Encrypt a jar's portable identity for the bundle. Ruling 2's requirement:
 * NOTHING human-readable about a jar may appear in a bundle before the bundle
 * secret is entered — a byte-scan of the serialized bundle must find no name
 * or color string.
 * @param {Buffer} mrk  the LIVE bundle/profile MRK.
 * @param {string} sourceId
 * @param {{ name: string, color: string }} meta
 * @returns {{ salt: string, iv: string, ct: string, tag: string }}
 */
function encryptJarMeta(mrk, sourceId, meta) {
  const salt = crypto.randomBytes(JARMETA_SALT_BYTES);
  const key = vc.deriveHkdfKey(mrk, salt, JARMETA_HKDF_INFO);
  const blob = vc.wrapVaultKey(Buffer.from(JSON.stringify(meta), 'utf8'), key, jarMetaAad(sourceId));
  return { salt: salt.toString('base64'), ...blob };
}

/**
 * Decrypt a bundle vault entry's jarMeta (leg 3's pre-mapping label step — NOT
 * called by `restoreProfile`, ruling 2's split). A tampered envelope (wrong
 * bundle MRK, altered ciphertext, or an AAD mismatch from a spliced sourceId)
 * fails GCM authentication LOUDLY — never a silent unnamed jar (the "lone
 * jarMeta tamper" edge case).
 * @param {Buffer} mrk  the LIVE bundle MRK (already authenticated by the bundle secret).
 * @param {string} sourceId
 * @param {{ salt: string, iv: string, ct: string, tag: string }} envelope
 * @returns {{ name: string, color: string }}
 */
function decryptJarMeta(mrk, sourceId, envelope) {
  if (!envelope || typeof envelope !== 'object' || typeof envelope.salt !== 'string') {
    throw new vc.VaultFormatError('vault-store: jarMeta envelope missing salt');
  }
  const key = vc.deriveHkdfKey(mrk, Buffer.from(envelope.salt, 'base64'), JARMETA_HKDF_INFO);
  const plain = vc.unwrapVaultKey(envelope, key, jarMetaAad(sourceId));
  let meta;
  try {
    meta = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new vc.VaultFormatError('vault-store: jarMeta did not decrypt to valid JSON');
  }
  if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string' || typeof meta.color !== 'string') {
    throw new vc.VaultFormatError('vault-store: jarMeta has an invalid shape');
  }
  return meta;
}

/**
 * A secret argument is valid when it is a NON-EMPTY string OR a NON-EMPTY Buffer — the
 * `setup` guard (`:401-405`) generalized for the M12 F4 Leg 2 rotation ops, whose master
 * passwords arrive from the chrome-owned sheet as zeroizable Buffers (scrypt /
 * deriveMasterKey accept either, exactly as the unlock path already does).
 * @param {unknown} secret
 * @returns {boolean}
 */
function isNonEmptySecret(secret) {
  return (typeof secret === 'string' && secret.length > 0) || (Buffer.isBuffer(secret) && secret.length > 0);
}

/**
 * Byte-equality of two secret arguments (string or Buffer — the shapes
 * `isNonEmptySecret` admits). The compromise rotation's master-branch R7 check
 * (M18 F2 Leg 3). Timing safety is deliberately NOT required here: the
 * comparison's outcome is disclosed to the operator who supplied BOTH inputs,
 * so there is no oracle to protect. Any temp Buffer minted from a string
 * argument is zeroized before returning; caller-supplied Buffers are never
 * touched (the sheet handler owns their lifetime).
 * @param {string | Buffer} a
 * @param {string | Buffer} b
 * @returns {boolean}
 */
function secretsEqual(a, b) {
  const aBuf = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bBuf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  const equal = aBuf.equals(bBuf);
  if (aBuf !== a) aBuf.fill(0);
  if (bBuf !== b) bBuf.fill(0);
  return equal;
}

/**
 * Structural shape check for a stored GCM envelope (the manager `mrk.*` slots and
 * the bundle's `mrk.*` slots share it): an object carrying string iv/ct/tag. The
 * crypto layer authenticates the CONTENT; this only rejects malformed documents
 * loudly at read/validate time (M18 F2 Leg 1 — one helper so the manager's and the
 * bundle's slot validation cannot drift).
 * @param {unknown} env
 * @returns {boolean}
 */
function isEnvelopeShaped(env) {
  const e = /** @type {any} */ (env);
  return Boolean(
    e && typeof e === 'object' && typeof e.iv === 'string' && typeof e.ct === 'string' && typeof e.tag === 'string'
  );
}

// ---------------------------------------------------------------------------
// Import hardening (PR#112 finding 4). An imported bundle is attacker-shaped
// until proven otherwise: its `kdf` is used to derive the master-unwrap key AND,
// on a fresh-profile adopt, PERSISTED as the new profile's KDF; its `vault`
// decrypts to items later mapped/encrypted. Two structural gates below run BEFORE
// any persistence:
//   • bounded scrypt-param schema — reject absent fields (which silently collapse
//     to Node's weak scrypt defaults, e.g. N=16384) AND reject resource-exhausting
//     values (a huge N/r/p/maxmem the importer would then run);
//   • decrypted item-array validation — a bundle whose ciphertext decrypts to a
//     non-array / malformed items must never reach `items.map` / re-encryption.
// ---------------------------------------------------------------------------

// Absolute structural bounds for an imported scrypt KDF. The floor rejects the
// degenerate/absent-field cases (a missing N/r/p defaults to Node's weak scrypt
// params); the ceilings bound CPU (N, p) and memory (maxmem) so a crafted bundle
// cannot pin the importer deriving a pathologically expensive key. Chosen to admit
// both the production params (N=2^17) and the deliberately-fast test params
// (N=2^12) while excluding downgrade-to-nothing and exhaustion.
const KDF_N_MIN = 2 ** 12;
const KDF_N_MAX = 2 ** 21;
const KDF_R_MAX = 32;
const KDF_P_MAX = 16;
const KDF_MAXMEM_CAP = 512 * 1024 * 1024; // 512 MiB hard ceiling.

/** @param {number} n @returns {boolean} positive power of two. */
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Validate an imported bundle's scrypt KDF against an EXACT bounded schema. Throws
 * VaultFormatError on any deviation (absent/extra-typed field, out-of-range value,
 * or a maxmem too small for scrypt's `128*N*r` floor — which would otherwise throw
 * deep in the derive). Accepting only well-formed bounded params closes both the
 * silent-downgrade (absent N/r/p → Node defaults) and the resource-exhaustion class.
 * @param {any} kdf
 * @returns {void}
 */
function validateImportedKdf(kdf) {
  if (!kdf || typeof kdf !== 'object' || Array.isArray(kdf)) {
    throw new vc.VaultFormatError('vault-store: bundle kdf must be an object');
  }
  if (kdf.algo !== 'scrypt') {
    throw new vc.VaultFormatError(`vault-store: unsupported bundle kdf algo "${kdf.algo}"`);
  }
  const { N, r, p, maxmem } = kdf;
  if (!isPowerOfTwo(N) || N < KDF_N_MIN || N > KDF_N_MAX) {
    throw new vc.VaultFormatError(`vault-store: bundle kdf.N out of range (${N})`);
  }
  if (!Number.isInteger(r) || r < 1 || r > KDF_R_MAX) {
    throw new vc.VaultFormatError(`vault-store: bundle kdf.r out of range (${r})`);
  }
  if (!Number.isInteger(p) || p < 1 || p > KDF_P_MAX) {
    throw new vc.VaultFormatError(`vault-store: bundle kdf.p out of range (${p})`);
  }
  if (!Number.isInteger(maxmem) || maxmem < 128 * N * r || maxmem > KDF_MAXMEM_CAP) {
    throw new vc.VaultFormatError(`vault-store: bundle kdf.maxmem out of range (${maxmem})`);
  }
}

// A bundle's decrypted item array is bounded so a crafted bundle cannot import an
// absurd count/size. Generous vs. any real vault; a hard ceiling all the same.
const MAX_IMPORT_ITEMS = 10000;

/**
 * Validate the DECRYPTED items of an imported bundle BEFORE any write. The bundle's
 * ciphertext is GCM-authentic but its PLAINTEXT shape is still attacker-chosen: it
 * may decrypt to a non-array (later crashing at `items.map`), or to items with a
 * bad/absent type or a duplicate/absent id. Throws VaultFormatError on any of these.
 * @param {any} items  the value returned by decryptItems.
 * @returns {any[]} the same array, once validated.
 */
function validateImportedItems(items) {
  if (!Array.isArray(items)) {
    throw new vc.VaultFormatError('vault-store: bundle vault did not decrypt to an item array');
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    throw new vc.VaultFormatError(`vault-store: bundle vault has too many items (${items.length})`);
  }
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new vc.VaultFormatError('vault-store: bundle vault item must be an object');
    }
    if (!ITEM_TYPES.has(item.type)) {
      throw new vc.VaultFormatError(`vault-store: bundle vault item has invalid type "${item.type}"`);
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new vc.VaultFormatError('vault-store: bundle vault item is missing a string id');
    }
    if (seen.has(item.id)) {
      throw new vc.VaultFormatError(`vault-store: bundle vault has a duplicate item id "${item.id}"`);
    }
    seen.add(item.id);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Shared bundle-envelope validation (M18 F3 Leg 2 — extracted so `_importVault`
// (v1-only gate) and `restoreProfile` ({1,2} gate, via `normalizeRestoreBundle`
// below) cannot drift on what "a well-formed bundle envelope" means). Runs
// AFTER the format/version gate (each caller owns its own — `_importVault`
// stays v1-only, DD9/ruling 9). Validates the mrk envelope set (master +
// recovery required, admin optional-but-paired — mirrors `_readManager`'s
// relaxed rule) and the bounded KDF schema; resolves the bundle's EFFECTIVE
// managerVersion (absent ⇒ 1 — every pre-M18-F2 bundle).
// ---------------------------------------------------------------------------

/**
 * @param {{ managerVersion?: any, mrk: any, adminPublicKeyB64?: any, kdf: any }} bundle
 * @returns {number} the resolved effective managerVersion.
 */
function validateBundleEnvelope(bundle) {
  let managerVersion = 1;
  if (bundle.managerVersion !== undefined) {
    if (!READABLE_MANAGER_VERSIONS.has(bundle.managerVersion)) {
      throw new vc.VaultFormatError(`vault-store: unsupported bundle managerVersion "${bundle.managerVersion}"`);
    }
    managerVersion = bundle.managerVersion;
  }
  if (!bundle.mrk || typeof bundle.mrk !== 'object') {
    throw new vc.VaultFormatError('vault-store: bundle missing mrk envelope set');
  }
  for (const slot of ['master', 'recovery']) {
    if (!isEnvelopeShaped(bundle.mrk[slot])) {
      throw new vc.VaultFormatError(`vault-store: malformed bundle mrk.${slot} envelope`);
    }
  }
  // Admin pair is tolerated ABSENT — present together or absent together, a
  // lone field is malformed (mirrors `_readManager`'s optional-but-paired rule).
  const bundleHasAdminSeal = bundle.mrk.admin !== undefined;
  const bundleHasAdminPub = bundle.adminPublicKeyB64 !== undefined;
  if (bundleHasAdminSeal !== bundleHasAdminPub) {
    throw new vc.VaultFormatError(
      'vault-store: bundle mrk.admin and adminPublicKeyB64 must be present together or absent together'
    );
  }
  if (bundleHasAdminSeal) {
    if (!isEnvelopeShaped(bundle.mrk.admin)) {
      throw new vc.VaultFormatError('vault-store: malformed bundle mrk.admin envelope');
    }
    if (typeof bundle.adminPublicKeyB64 !== 'string') {
      throw new vc.VaultFormatError('vault-store: bundle missing adminPublicKeyB64');
    }
  }
  // Bounded scrypt-param schema (finding 4, shared): reject absent fields AND
  // resource-exhausting values BEFORE bundle.kdf is used to derive the unwrap
  // key or persisted on adopt.
  validateImportedKdf(bundle.kdf);
  return managerVersion;
}

// ---------------------------------------------------------------------------
// restoreProfile's v1/v2 normalization (M18 F3 Leg 2 / DD1 ruling 9). A v1
// bundle is the "one-row case" of the same flow: its single `sourceVaultId` +
// `vault` become a one-entry `vaults` array with no jarMeta. Runs BEFORE
// `validateBundleEnvelope` (format/version-specific shape first, then the
// shared envelope rules). Never mutates the input bundle.
// ---------------------------------------------------------------------------

/**
 * @param {any} bundle
 * @returns {{ managerVersion?: any, kdf: any, mrk: any, adminPublicKeyB64?: any,
 *   vaults: Array<{ sourceId: string, jarMeta?: any, vault: any }> }}
 */
function normalizeRestoreBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new VaultStateError('vault-store: restore bundle must be an object');
  }
  if (bundle.format !== BUNDLE_FORMAT) {
    throw new vc.VaultFormatError(`vault-store: unknown bundle format "${bundle.format}"`);
  }
  if (bundle.version === BUNDLE_VERSION) {
    if (typeof bundle.sourceVaultId !== 'string' || bundle.sourceVaultId.length === 0) {
      throw new vc.VaultFormatError('vault-store: v1 bundle missing sourceVaultId');
    }
    if (bundle.vault === undefined) {
      throw new vc.VaultFormatError('vault-store: v1 bundle missing its vault document');
    }
    return {
      managerVersion: bundle.managerVersion,
      kdf: bundle.kdf,
      mrk: bundle.mrk,
      adminPublicKeyB64: bundle.adminPublicKeyB64,
      vaults: [{ sourceId: bundle.sourceVaultId, vault: bundle.vault }]
    };
  }
  if (bundle.version === BUNDLE_VERSION_V2) {
    if (!Array.isArray(bundle.vaults)) {
      throw new vc.VaultFormatError('vault-store: v2 bundle missing vaults array');
    }
    const seen = new Set();
    for (const entry of bundle.vaults) {
      if (!entry || typeof entry !== 'object' || typeof entry.sourceId !== 'string' || entry.sourceId.length === 0) {
        throw new vc.VaultFormatError('vault-store: v2 bundle vault entry missing sourceId');
      }
      if (seen.has(entry.sourceId)) {
        throw new vc.VaultFormatError(`vault-store: v2 bundle has a duplicate sourceId "${entry.sourceId}"`);
      }
      seen.add(entry.sourceId);
      if (entry.vault === undefined) {
        throw new vc.VaultFormatError(`vault-store: v2 bundle vault "${entry.sourceId}" missing its vault document`);
      }
    }
    return {
      managerVersion: bundle.managerVersion,
      kdf: bundle.kdf,
      mrk: bundle.mrk,
      adminPublicKeyB64: bundle.adminPublicKeyB64,
      vaults: bundle.vaults.map((/** @type {any} */ e) => ({
        sourceId: e.sourceId,
        jarMeta: e.jarMeta,
        vault: e.vault
      }))
    };
  }
  throw new vc.VaultFormatError(`vault-store: unsupported bundle version "${bundle.version}"`);
}

// ---------------------------------------------------------------------------
// Merge (DD4 / M18 F3 Leg 2 ruling 6): id identity, keep-both on divergence,
// no picker. A generic structural deep-equal (items are flat JSON records —
// string/number/boolean fields, no nesting beyond that) decides "identical
// content"; a diverged id lands as a COPY under a FRESH id with its display
// `title` suffixed ' (imported)' — every item type's non-secret display field
// is `title` (vault-item-schema.js), so one suffix site covers all three.
// ---------------------------------------------------------------------------

/**
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepValueEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepValueEqual(v, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepValueEqual(a[k], b[k]));
}

/**
 * Merge `incoming` decrypted items into a destination vault's decrypted
 * `existing` items. Non-interactive; zero data loss (every pre-merge
 * destination item survives, whether untouched, confirmed-identical, or —
 * on divergence — joined by a marked copy of the incoming version).
 * @param {VaultItem[]} existing
 * @param {VaultItem[]} incoming
 * @returns {{ items: VaultItem[], mergeReport: { imported: number, skippedIdentical: number, conflictCopies: number } }}
 */
function mergeVaultItems(existing, incoming) {
  const byId = new Map(existing.map((it) => [it.id, it]));
  const merged = existing.slice();
  let imported = 0;
  let skippedIdentical = 0;
  let conflictCopies = 0;
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (current === undefined) {
      merged.push(item);
      byId.set(item.id, item);
      imported++;
      continue;
    }
    if (deepValueEqual(current, item)) {
      skippedIdentical++;
      continue;
    }
    // Diverged: land as a copy under a FRESH id — the destination's original
    // (same-id) item is untouched; different ids always coexist by construction.
    // `title` is every type's non-secret display field (vault-item-schema.js) but
    // not part of the base VaultItem typedef — read/write it through `any`.
    const itemAny = /** @type {any} */ (item);
    const copy = {
      ...item,
      id: crypto.randomBytes(8).toString('hex'),
      title: typeof itemAny.title === 'string' ? `${itemAny.title} (imported)` : itemAny.title
    };
    merged.push(copy);
    conflictCopies++;
  }
  return { items: merged, mergeReport: { imported, skippedIdentical, conflictCopies } };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

class VaultStore {
  /**
   * @param {string} userDataPath  injected Electron userData directory.
   * @param {VaultStoreDeps} [deps]
   */
  constructor(userDataPath, deps = {}) {
    if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
      throw new VaultStateError('vault-store: userDataPath is required');
    }
    this.userDataPath = userDataPath;
    this.vaultsDir = path.join(userDataPath, 'vaults');
    this.managerPath = path.join(this.vaultsDir, 'manager.json');

    this.listJars = deps.listJars ?? (() => []);
    this.getAutoLockMinutes = deps.getAutoLockMinutes ?? (() => 10);
    this.onLock = deps.onLock ?? null;
    this.onUnlock = deps.onUnlock ?? null;
    this._setTimeout = deps.setTimeout ?? setTimeout;
    this._clearTimeout = deps.clearTimeout ?? clearTimeout;
    this._now = deps.now ?? Date.now;
    this.scryptParams = deps.scryptParams ?? vc.SCRYPT_PARAMS;
    // M18 F3 Leg 2: injected jars.js surface for `restoreProfile`'s 'new'
    // directive (create-then-verify, DD3 ruling 4) — keeps this module
    // jars.js-free. `_createJar` stays null when not injected (a 'new'
    // directive without it throws a clear VaultStateError rather than a
    // TypeError); `_verifyJarPersisted` defaults to a hard "not verified" so a
    // misconfigured store never LOOKS like a successful create.
    this._createJar = typeof deps.createJar === 'function' ? deps.createJar : null;
    this._verifyJarPersisted = typeof deps.verifyJarPersisted === 'function' ? deps.verifyJarPersisted : () => false;

    // Unlock state — held ONLY in memory as Buffers.
    /** @type {Buffer | null} */
    this.mrk = null;
    /** @type {Map<string, Buffer>} */
    this.vaultKeys = new Map();
    /** @type {any} */
    this._timer = null;

    // M17 F4 L3 (AC4): idle auto-lock SUPPRESSION flag — consulted ONLY in the
    // _touch timer callback (never in any crypto/rotation path). While set, a
    // fired idle timer RE-ARMS instead of calling lockNow(). Main drives it
    // across a fresh-adopt key-surfacing window (SET when the one-time admin key
    // is stashed, CLEARED on the recovery-show ack / pending drop / window
    // teardown) so the recovery-adopt path cannot autolock into a permanent
    // lockout before its rotated one-time recovery key is acknowledged.
    this._suspendAutoLock = false;

    // Unlock GENERATION (PR#112 finding 3): bumped on every lock-state transition
    // (install / lock / reset). An async manager mutation captures it before its
    // scrypt await and re-checks after, so a lockNow()/re-unlock that fired mid-derive
    // is detected — refusing to wrap or persist against a zeroized/replaced MRK.
    this._mrkGen = 0;
    // Serializes async manager.json mutations (rotations / recovery / change-master)
    // so two concurrent ops cannot each capture the pre-write manager and clobber the
    // other's slot update (finding 3). A single promise chain; each op runs after the
    // prior settles (success OR failure).
    /** @type {Promise<any>} */
    this._managerLock = Promise.resolve();

    // M18 F2 Leg 2 (DD3): write-exclusivity machinery for the compromise
    // rotation. `_rekeyInProgress` is the store-wide re-key gate — ELEVEN gated
    // ops (M18 F3 Leg 2 / DD10 ruling 8 added `exportProfile` + `restoreProfile`
    // to the original eight; M18 F3 Leg 3 added `previewRestoreBundle` — a
    // preview writes nothing, but must not let an operator START a multi-step
    // import while a compromise rotation is rewriting the profile) refuse at
    // ENTRY (VaultBusyError) while it is up,
    // and the write sinks (`_writeManager` / `_writeVault`) re-check it as a
    // SECOND WALL so a mutator that awaited past its entry check can never
    // persist a pre-rotation document. `_inFlightOps` counts gated ops currently
    // executing (each holds it for its FULL duration, released in `finally`);
    // `_acquireRekeyGate` raises the gate then DRAINS — awaits the counter
    // reaching zero — before its caller may write. The four `_withManagerLock`
    // ops do NOT join the counter (designer ruling for leg 3): the rotation
    // enters `_withManagerLock` first and raises the gate inside its lock turn,
    // so lock serialization is their coverage; the sink-level second wall
    // covers them incidentally regardless.
    this._rekeyInProgress = false;
    this._inFlightOps = 0;
    /** @type {Array<() => void>} */
    this._drainWaiters = [];

    // M18 F3 Leg 2 (DD3 ruling 7): `restoreProfile`'s SINGLE-FLIGHT guard — an
    // INSTANCE field (the `_rekeyInProgress` pattern), never module-scope,
    // which would leak across the many per-test store instances `vs.load()`
    // creates. This is IN ADDITION to the re-key gate above, which is a
    // COUNTER (`_inFlightOps`), not a mutex — it does not serialize two
    // concurrent `restoreProfile` calls against EACH OTHER.
    this._restoreInFlight = false;

    // M18 F2 Leg 2 (DD2): idempotent transaction recovery runs on EVERY store
    // construction — between path setup above and the load-loudly manager
    // validation below (a committed journal may be what MAKES manager.json
    // current). Committed journal ⇒ roll forward; uncommitted ⇒ roll back;
    // orphaned `.tmp-*` atomic-write temps are swept. ENOENT-tolerant on a
    // missing `vaults/` dir (fresh profile) and ciphertext-only — it never
    // reads or repairs vault content.
    vtxn.recover(this.vaultsDir);

    // Load-loudly: validate an existing manager.json up front so a corrupt file
    // surfaces at load(), not silently later. A missing file just means "not set
    // up yet".
    if (fs.existsSync(this.managerPath)) {
      this._readManager();
    }
  }

  // -------------------------------------------------------------------------
  // Paths + filesystem
  // -------------------------------------------------------------------------

  /**
   * @param {string} vaultId
   * @returns {string}
   */
  _vaultPath(vaultId) {
    return path.join(this.vaultsDir, `${vaultId}.gfvault`);
  }

  _ensureVaultsDir() {
    fs.mkdirSync(this.vaultsDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // manager.json (vault-store owns this format)
  // -------------------------------------------------------------------------

  /**
   * Read + strictly validate manager.json. Throws VaultStateError when the
   * manager does not exist yet (not set up), VaultFormatError on a malformed /
   * unknown-version document — NEVER quarantines.
   * @returns {any}
   */
  _readManager() {
    if (!fs.existsSync(this.managerPath)) {
      throw new VaultStateError('vault-store: not set up');
    }
    const text = fs.readFileSync(this.managerPath, 'utf8');
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      throw new vc.VaultFormatError(`manager.json: invalid JSON (${/** @type {Error} */ (err).message})`);
    }
    if (!doc || typeof doc !== 'object') {
      throw new vc.VaultFormatError('manager.json: document is not an object');
    }
    if (doc.format !== MANAGER_FORMAT) {
      throw new vc.VaultFormatError(`manager.json: unknown format "${doc.format}"`);
    }
    if (!READABLE_MANAGER_VERSIONS.has(doc.version)) {
      throw new vc.VaultFormatError(`manager.json: unsupported version "${doc.version}"`);
    }
    if (!doc.kdf || typeof doc.kdf !== 'object') {
      throw new vc.VaultFormatError('manager.json: missing kdf');
    }
    // M17 F4 DD1: fail-closed KDF validation on read. setup() is the sole writer of
    // manager.json.kdf and always writes in-bounds params, so out-of-bounds kdf here
    // means vault-file tampering — refuse to open rather than trust downgraded params.
    validateImportedKdf(doc.kdf);
    if (!doc.mrk || typeof doc.mrk !== 'object') {
      throw new vc.VaultFormatError('manager.json: missing mrk envelope set');
    }
    // master + recovery are required at EVERY version; the admin slot follows
    // the SAME optional-but-paired rule at EVERY version (M18 F2 Leg 1 / DD1,
    // relaxed from v1-required M18 F3 Leg 2 / ruling 10 — see the format
    // comment above).
    for (const slot of ['master', 'recovery']) {
      if (!isEnvelopeShaped(doc.mrk[slot])) {
        throw new vc.VaultFormatError(`manager.json: malformed mrk.${slot} envelope`);
      }
    }
    const hasAdminSeal = doc.mrk.admin !== undefined;
    const hasAdminPub = doc.adminPublicKeyB64 !== undefined;
    if (hasAdminSeal !== hasAdminPub) {
      // Present TOGETHER or absent TOGETHER — a lone field is malformed-present,
      // never a deliberate absence.
      throw new vc.VaultFormatError(
        'manager.json: mrk.admin and adminPublicKeyB64 must be present together or absent together'
      );
    } else if (hasAdminSeal) {
      // With-admin: the pair is validated identically at v1 and v2.
      if (typeof doc.adminPublicKeyB64 !== 'string') {
        throw new vc.VaultFormatError('manager.json: missing adminPublicKeyB64');
      }
      if (!isEnvelopeShaped(doc.mrk.admin)) {
        throw new vc.VaultFormatError('manager.json: malformed mrk.admin envelope');
      }
    }
    return doc;
  }

  /**
   * @param {any} manager
   */
  _writeManager(manager) {
    // M18 F2 Leg 2 (DD3): the SECOND WALL lives inside the write sinks — a
    // mutator that awaited past its entry check while the gate rose must never
    // persist a pre-rotation document. Leg 3's rotation writes go through the
    // transaction primitive, never these sinks, so it cannot self-block.
    this._assertNotRekeying('write refused');
    this._ensureVaultsDir();
    writeFileAtomic(this.managerPath, Buffer.from(JSON.stringify(manager), 'utf8'));
  }

  // -------------------------------------------------------------------------
  // .gfvault documents
  // -------------------------------------------------------------------------

  /**
   * Read + parse a vault file. Returns null when absent; throws VaultFormatError
   * on a corrupt document (load-loudly — never quarantines).
   * @param {string} vaultId
   * @returns {any | null}
   */
  _readVault(vaultId) {
    const p = this._vaultPath(vaultId);
    if (!fs.existsSync(p)) return null;
    return vc.parseVault(fs.readFileSync(p));
  }

  /**
   * Serialize + atomically write a vault document.
   * @param {string} vaultId
   * @param {{ envelopes: any[], items: any, kdf?: any }} parts
   */
  _writeVault(vaultId, parts) {
    // M18 F2 Leg 2 (DD3): second wall — see _writeManager. Living in the sink
    // (not at call sites) automatically covers the indirect sink
    // `_writeVaultForKey` and every future caller.
    this._assertNotRekeying('write refused');
    this._ensureVaultsDir();
    const json = vc.serializeVault({
      vaultId,
      kdf: parts.kdf,
      envelopes: parts.envelopes,
      items: parts.items
    });
    writeFileAtomic(this._vaultPath(vaultId), Buffer.from(json, 'utf8'));
  }

  // -------------------------------------------------------------------------
  // Lock lifecycle
  // -------------------------------------------------------------------------

  _clearTimer() {
    if (this._timer !== null) {
      this._clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Reset the idle auto-lock timer. Called on every store operation. Only arms
   * while unlocked; a fired timer zeroizes keys via lockNow().
   */
  _touch() {
    this._clearTimer();
    if (this.mrk === null) return;
    const mins = this.getAutoLockMinutes();
    const safeMins = typeof mins === 'number' && mins >= 1 ? mins : 10;
    const ms = safeMins * 60 * 1000;
    this._timer = this._setTimeout(() => {
      // M17 F4 L3 (AC4): while a fresh-adopt is surfacing its one-time recovery +
      // admin keys, autolock would be a permanent lockout on the recovery-adopt
      // path. Re-arm instead of locking; main clears the suppression once the
      // recovery key is acknowledged (or on window teardown), and the next fire
      // locks normally. Timer surface ONLY — no crypto/rotation state touched.
      if (this._suspendAutoLock) {
        this._touch();
        return;
      }
      this.lockNow();
    }, ms);
    // Don't let a real idle timer keep the process alive (headless / tests).
    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  /**
   * M17 F4 L3 (AC4): set/clear the idle auto-lock suppression flag. Consulted
   * ONLY by the _touch timer callback (a re-arm-instead-of-lock guard); it never
   * touches key material or the arming logic. Driven by main across a fresh-adopt
   * key-surfacing window so the rotated one-time recovery key cannot be lost to
   * autolock before the operator acknowledges it (a hard lockout on the
   * recovery-adopt path).
   * @param {boolean} suspended
   */
  setAutoLockSuspended(suspended) {
    this._suspendAutoLock = suspended === true;
  }

  /**
   * Zeroize every in-memory key Buffer and drop references. Safe to call when
   * already locked (the quit hook wires `before-quit` → lockNow at the call site).
   */
  lockNow() {
    this._clearTimer();
    if (this.mrk !== null) {
      this.mrk.fill(0);
      this.mrk = null;
      this._mrkGen++; // finding 3: signal any in-flight async mutation the MRK is gone.
    }
    for (const key of this.vaultKeys.values()) {
      key.fill(0);
    }
    this.vaultKeys.clear();
    if (this.onLock) {
      try {
        this.onLock();
      } catch {
        // a lock-notify failure must not throw out of lockNow.
      }
    }
  }

  /**
   * Zeroize any prior unlock state before installing a fresh MRK (re-unlock).
   */
  _resetKeys() {
    if (this.mrk !== null) {
      this.mrk.fill(0);
      this.mrk = null;
      this._mrkGen++; // finding 3: a re-unlock is also a generation change.
    }
    for (const key of this.vaultKeys.values()) {
      key.fill(0);
    }
    this.vaultKeys.clear();
  }

  /**
   * @returns {Buffer} the in-memory MRK.
   */
  _requireMrk() {
    if (this.mrk === null) {
      throw new VaultLockedError('vault-store: manager is locked');
    }
    return this.mrk;
  }

  /**
   * Serialize an async manager.json mutation (PR#112 finding 3). Each call runs after
   * the prior manager mutation settles (success OR failure), so two concurrent rotations
   * cannot both read the pre-write manager and clobber each other's slot update. Returns
   * the op's promise; the chain advances regardless of outcome.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  _withManagerLock(fn) {
    const result = this._managerLock.then(
      () => fn(),
      () => fn()
    );
    // Advance the chain on both outcomes; swallow here so one failed op never poisons
    // the lock for the next (the caller still sees `result`'s rejection).
    this._managerLock = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  /**
   * Assert the unlock state has NOT changed since `gen` was captured (finding 3): the
   * MRK must still be installed AND the generation unchanged. Called after every async
   * step inside a manager mutation, BEFORE the captured MRK buffer is used to wrap/seal
   * or the manager is written — so a lockNow()/re-unlock that fired during a scrypt
   * derive can never persist an envelope wrapping a zeroized or replaced MRK.
   * @param {number} gen
   * @returns {void}
   */
  _assertMrkGeneration(gen) {
    if (this.mrk === null || this._mrkGen !== gen) {
      throw new VaultLockedError('vault-store: the manager was locked or re-keyed during the operation — retry');
    }
  }

  // -------------------------------------------------------------------------
  // Write exclusivity — re-key gate + in-flight drain (M18 F2 Leg 2 / DD3)
  // -------------------------------------------------------------------------

  /**
   * Throw VaultBusyError while the re-key gate is up. Used at every gated op's
   * ENTRY and, with a distinct qualifier, as the sinks' SECOND WALL.
   * @param {string} [what]
   * @returns {void}
   */
  _assertNotRekeying(what = 'operation refused') {
    if (this._rekeyInProgress) {
      throw new VaultBusyError(`vault-store: a security rotation is in progress — ${what}, retry when it completes`);
    }
  }

  /**
   * Enter a gated op: refuse (VaultBusyError) while the gate is up, else hold
   * the in-flight counter. Returns the release function — the caller MUST call
   * it in `finally` (design review: ANY throw while holding, a second-wall
   * VaultBusyError or an ordinary auth error included, must not deadlock the
   * drain). Idempotent per handle; nested holds (an op calling another gated
   * op) count and release correctly.
   * @returns {() => void}
   */
  _enterGatedOp() {
    this._assertNotRekeying();
    this._inFlightOps++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._inFlightOps--;
      if (this._inFlightOps === 0 && this._drainWaiters.length > 0) {
        const waiters = this._drainWaiters;
        this._drainWaiters = [];
        for (const wake of waiters) wake();
      }
    };
  }

  /**
   * Raise the re-key gate and DRAIN: resolves only once every in-flight gated
   * op has finished (success or failure), so the caller may then write with
   * write exclusivity. New gated ops refuse at entry from the moment the gate
   * rises; an op already past its entry check either completes (fully
   * synchronous ops) or fails on the sinks' second wall (the mid-await ops) —
   * either way it releases the counter and the drain completes. Returns the
   * release function (idempotent). No public consumer yet — leg 3's rotation
   * acquires this inside its `_withManagerLock` turn.
   * @returns {Promise<() => void>}
   */
  async _acquireRekeyGate() {
    // Only one rotation at a time — an already-raised gate is a busy condition,
    // never a queue.
    this._assertNotRekeying('cannot start another rotation');
    this._rekeyInProgress = true;
    while (this._inFlightOps > 0) {
      await new Promise((resolve) => this._drainWaiters.push(() => resolve(undefined)));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._rekeyInProgress = false;
    };
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** @returns {boolean} */
  isSetUp() {
    return fs.existsSync(this.managerPath);
  }

  /** @returns {boolean} */
  isUnlocked() {
    return this.mrk !== null;
  }

  // -------------------------------------------------------------------------
  // First-run setup
  // -------------------------------------------------------------------------

  /**
   * First-run setup: mint the MRK, a one-time recovery key, and an admin keypair;
   * write manager.json (MRK wrapped under master + recovery + admin-pub) and the
   * global vault (its key wrapped under the MRK). Leaves the manager UNLOCKED.
   * Returns the recovery-key display + admin private key EXACTLY once — neither is
   * persisted.
   * @param {{ masterPassword: string | Buffer }} args
   * @returns {Promise<{ recoveryKeyDisplay: string, adminPrivateKeyB64: string }>}
   */
  async setup({ masterPassword } = /** @type {any} */ ({})) {
    if (this.isSetUp()) {
      throw new VaultStateError('vault-store: already set up');
    }
    // Accept a non-empty STRING (the F1 API) OR a non-empty Buffer (M12 F3 Leg 4: the
    // chrome-owned vault-set sheet submits the master password as a zeroizable Buffer
    // over menu-overlay:vault-setup — scrypt/deriveMasterKey accepts a Buffer password,
    // exactly as the unlock path already does, so no crypto change).
    const isNonEmptyString = typeof masterPassword === 'string' && masterPassword.length > 0;
    const isNonEmptyBuffer = Buffer.isBuffer(masterPassword) && masterPassword.length > 0;
    if (!isNonEmptyString && !isNonEmptyBuffer) {
      throw new VaultStateError('vault-store: masterPassword is required');
    }
    this._ensureVaultsDir();

    const mrk = vc.newVaultKey(); // random 256-bit MRK
    const recovery = vc.generateRecoveryKey();
    const admin = vc.generateAdminKeypair();
    const params = this.scryptParams;

    // Manager-envelope AAD binds the MANAGER document version (gfmanager), NOT
    // vault-crypto's `.gfvault` VERSION (M12 F1 review) — the two version spaces are
    // OWNED separately. setup() still WRITES v1 (M18 F2 Leg 1: v2 writers are the
    // full-envelope-set rewrites of later legs), so these wraps pass MANAGER_VERSION.
    // Every unwrap site (unlock / unlockWithRecovery / unlockWithAdmin / the rotation
    // step-ups / mintAccessKey / openAllWithAdminKey / import's bundle unwraps) passes
    // the DOCUMENT'S stated version — v1 documents keep matching these envelopes, and
    // a v2 document's envelopes (wrapped at 2 by their writer) match theirs. A
    // relabel/downgrade of the document version fails GCM auth (DD1 homogeneity).
    const masterEnv = await vc.wrapMaster(mrk, masterPassword, { version: MANAGER_VERSION, params });
    const recoveryEnv = vc.wrapRecovery(mrk, recovery.material, { version: MANAGER_VERSION });
    const adminEnv = vc.sealToAdmin(mrk, admin.publicKey, { version: MANAGER_VERSION });

    const manager = {
      format: MANAGER_FORMAT,
      version: MANAGER_VERSION,
      kdf: params,
      adminPublicKeyB64: admin.publicKeyB64,
      mrk: { master: masterEnv, recovery: recoveryEnv, admin: adminEnv }
    };
    this._writeManager(manager);

    // Global vault: fresh key wrapped under the MRK.
    const vaultKey = vc.newVaultKey();
    this._writeVaultForKey(GLOBAL_ID, vaultKey, mrk, []);

    // Recovery material is now operator-held via `display` — drop the buffer.
    recovery.material.fill(0);

    // Enter the unlocked state (we just generated the MRK).
    this.mrk = mrk;
    this._mrkGen++; // finding 3: setup transitions locked → unlocked.
    this.vaultKeys = new Map([[GLOBAL_ID, vaultKey]]);
    this._touch();

    return { recoveryKeyDisplay: recovery.display, adminPrivateKeyB64: admin.privateKeyB64 };
  }

  /**
   * Write a brand-new vault: its key wrapped under `mrk` (mrk envelope) plus the
   * encrypted item array. Used by setup + lazy jar creation.
   * @param {string} vaultId
   * @param {Buffer} vaultKey
   * @param {Buffer} mrk
   * @param {VaultItem[]} items
   */
  _writeVaultForKey(vaultId, vaultKey, mrk, items) {
    const mrkEnv = {
      keyId: 'mrk',
      type: 'mrk',
      ...vc.wrapVaultKey(vaultKey, mrk, mrkEnvelopeAad(vc.VERSION))
    };
    this._writeVault(vaultId, {
      envelopes: [mrkEnv],
      items: vc.encryptItems(items, vaultKey)
    });
  }

  // -------------------------------------------------------------------------
  // Unlock paths — each unwraps the MRK; assign this.mrk ONLY after success so a
  // failed unlock leaves the manager LOCKED.
  // -------------------------------------------------------------------------

  /**
   * @param {string | Buffer} masterPassword  a zeroizable Buffer from the human
   *   unlock path (DD4) or a string from other callers; deriveMasterKey accepts both.
   * @returns {Promise<void>}
   */
  async unlock(masterPassword) {
    const manager = this._readManager();
    const mrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, {
      version: manager.version, // the DOCUMENT'S stated version (DD1) — never the constant.
      params: manager.kdf
    });
    this._installMrk(mrk);
  }

  /**
   * @param {string} recoveryDisplay
   * @returns {void}
   */
  unlockWithRecovery(recoveryDisplay) {
    const manager = this._readManager();
    const material = vc.parseRecoveryKey(recoveryDisplay);
    let mrk;
    try {
      mrk = vc.unwrapRecovery(manager.mrk.recovery, material, { version: manager.version });
    } finally {
      material.fill(0);
    }
    this._installMrk(mrk);
  }

  /**
   * @param {string} adminPrivateKeyB64
   * @returns {void}
   */
  unlockWithAdmin(adminPrivateKeyB64) {
    const manager = this._readManager();
    if (manager.mrk.admin === undefined) {
      // M18 F2 Leg 1 / DD1: deliberate absence (a no-admin v2 manager) is a named,
      // discriminable STATE — not a format defect, not a GCM failure. The exact
      // message is a ruled contract the flow-wiring leg's Settings state relies on.
      throw new VaultStateError('no admin key provisioned');
    }
    let privateKey;
    try {
      privateKey = vc.importAdminPrivateKey(adminPrivateKeyB64);
    } catch (err) {
      throw new vc.VaultFormatError(`admin private key: unreadable (${/** @type {Error} */ (err).message})`);
    }
    const mrk = vc.openAdminSeal(manager.mrk.admin, privateKey, { version: manager.version });
    this._installMrk(mrk);
  }

  /**
   * @param {Buffer} mrk
   */
  _installMrk(mrk) {
    this._resetKeys();
    this.mrk = mrk;
    this._mrkGen++; // finding 3: an unlock/re-key is a generation change.
    this.vaultKeys = new Map();
    this._touch();
    // DD10: fire the unlock hook from the single MRK-install choke point so ALL
    // three unlock paths (master / recovery / admin) broadcast `unlocked`.
    // Guarded — symmetric with onLock in lockNow: a failing lock-state notify
    // (e.g. broadcastToChromeAndInternal) must never reject unlock() (the store
    // is already unlocked by the time we get here).
    if (this.onUnlock) {
      try {
        this.onUnlock();
      } catch {
        // an unlock-notify failure must not throw out of the unlock paths.
      }
    }
  }

  /**
   * Re-wrap the MRK's master envelope under a NEW password, gated by an OLD-PASSWORD
   * STEP-UP (M12 F4 Leg 2 / DD3). Requires the manager unlocked AND a fresh re-unwrap of
   * the current master envelope with `oldMasterPassword` — a wrong old password throws
   * VaultAuthError BEFORE any write (unlocked-session-hijack hardening, mirroring the
   * `mintAccessKey` step-up). Touches ONLY `manager.mrk.master` — item ciphertext / the
   * other mrk slots / every `.gfvault` file are never rewritten. Both passwords accept a
   * zeroizable Buffer OR a string (the chrome-owned vault-change-master sheet submits both
   * as Buffers; deriveMasterKey / unwrapMaster accept either — mirrors `setup`'s guard).
   * @param {{ oldMasterPassword: string | Buffer, newMasterPassword: string | Buffer }} args
   * @returns {Promise<void>}
   */
  async changeMasterPassword({ oldMasterPassword, newMasterPassword } = /** @type {any} */ ({})) {
    if (!isNonEmptySecret(oldMasterPassword)) {
      throw new VaultStateError('vault-store: oldMasterPassword is required');
    }
    if (!isNonEmptySecret(newMasterPassword)) {
      throw new VaultStateError('vault-store: newMasterPassword is required');
    }
    // Serialized + generation-guarded (finding 3): re-read the manager fresh inside the
    // lock, and re-check the unlock generation after each scrypt await so a lockNow /
    // re-unlock mid-derive never persists an envelope over a zeroized/replaced MRK.
    return this._withManagerLock(async () => {
      const mrk = this._requireMrk();
      const gen = this._mrkGen;
      const manager = this._readManager();
      // Step-up re-auth: re-unwrap the master envelope with the OLD password. A wrong old
      // password throws VaultAuthError and rewrites NOTHING (the step-up precedes any write).
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, oldMasterPassword, {
        version: manager.version, // the document's stated version (DD1) — a v1 manager stays v1, a v2 stays v2.
        params: manager.kdf
      });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      this._assertMrkGeneration(gen); // locked/re-keyed during the step-up derive → refuse before using mrk.
      const newMasterEnv = await vc.wrapMaster(mrk, newMasterPassword, {
        version: manager.version, // wrap at the SAME version the document carries (AAD homogeneity).
        params: manager.kdf
      });
      this._assertMrkGeneration(gen); // and again before persisting.
      manager.mrk.master = newMasterEnv;
      this._writeManager(manager);
      this._touch();
    });
  }

  /**
   * Rotate the one-time RECOVERY KEY, gated by a MASTER-PASSWORD STEP-UP (M12 F4 Leg 2 /
   * DD3, mission durable-grant re-auth). Requires the manager unlocked AND a fresh re-unwrap
   * of the master envelope with the entered master password — a wrong password throws
   * VaultAuthError BEFORE any write (mirroring the `mintAccessKey` step-up). On success mints
   * a fresh recovery key, rewraps ONLY `manager.mrk.recovery`, writes the manager, and returns
   * the new one-time `display` (shown once on the chrome-owned sheet). The MRK is never
   * re-keyed — item ciphertext / the other mrk slots / every `.gfvault` file are untouched.
   * @param {{ masterPassword: string | Buffer }} args
   * @returns {Promise<string>}  the new recovery-key display (one-time).
   */
  async rotateRecovery({ masterPassword } = /** @type {any} */ ({})) {
    if (!isNonEmptySecret(masterPassword)) {
      throw new VaultStateError('vault-store: masterPassword is required');
    }
    return this._withManagerLock(async () => {
      const mrk = this._requireMrk();
      const gen = this._mrkGen;
      const manager = this._readManager();
      // Step-up re-auth: re-unwrap the master envelope. Wrong password → VaultAuthError, no write.
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, {
        version: manager.version, // the document's stated version (DD1).
        params: manager.kdf
      });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      // finding 3: refuse if a lockNow fired during the derive — else wrapRecovery below
      // would seal a zeroized MRK into the recovery slot (the exact reproduced defect).
      this._assertMrkGeneration(gen);
      const rec = vc.generateRecoveryKey();
      manager.mrk.recovery = vc.wrapRecovery(mrk, rec.material, { version: manager.version });
      this._writeManager(manager);
      rec.material.fill(0); // the recovery is now operator-held via `display` — drop the buffer.
      this._touch();
      return rec.display;
    });
  }

  /**
   * Rotate (or from-scratch PROVISION) the ADMIN KEYPAIR, gated by a MASTER-PASSWORD STEP-UP
   * (M12 F4 Leg 3 / DD4, mission durable-grant re-auth). Requires the manager unlocked AND a
   * fresh re-unwrap of the master envelope with the entered master password — a wrong password
   * throws VaultAuthError BEFORE any write (mirroring `rotateRecovery`'s step-up). On success
   * mints a FRESH X25519 admin keypair, re-seals ONLY `manager.mrk.admin` to the new public key,
   * overwrites `manager.adminPublicKeyB64` (BOTH — else a stale pubkey mismatches the seal and
   * corrupts a subsequent export), writes the manager, and returns the new one-time admin PRIVATE
   * key (base64; shown once on the chrome-owned sheet). This is BOTH admin rotation AND the
   * from-scratch provision (F3's setup-minted admin private key was discarded, so the current seal
   * is orphaned): it mints anew UNCONDITIONALLY — no old-admin-key input — and the prior admin key
   * is invalidated (its seal is replaced). The MRK is never re-keyed — item ciphertext / the other
   * mrk slots / every `.gfvault` file are untouched.
   * @param {{ masterPassword: string | Buffer }} args
   * @returns {Promise<string>}  the new admin private key, base64 (one-time).
   */
  async rotateAdminKey({ masterPassword } = /** @type {any} */ ({})) {
    if (!isNonEmptySecret(masterPassword)) {
      throw new VaultStateError('vault-store: masterPassword is required');
    }
    return this._withManagerLock(async () => {
      const mrk = this._requireMrk();
      const gen = this._mrkGen;
      const manager = this._readManager();
      // Step-up re-auth: re-unwrap the master envelope. Wrong password → VaultAuthError, no write.
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, {
        version: manager.version, // the document's stated version (DD1).
        params: manager.kdf
      });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      this._assertMrkGeneration(gen); // finding 3: never seal a zeroized/replaced MRK to the new admin key.
      const admin = vc.generateAdminKeypair();
      // On a no-admin manager (v1 or v2 — M18 F3 Leg 2 / ruling 10 relaxed v1 to the
      // same optional-but-paired rule) this IS the from-scratch provision (M18 F2
      // Leg 1 / DD1): both fields are written together below, and the document's
      // version is preserved — the seal is wrapped at that same version (AAD
      // homogeneity).
      manager.mrk.admin = vc.sealToAdmin(mrk, admin.publicKey, { version: manager.version });
      manager.adminPublicKeyB64 = admin.publicKeyB64; // BOTH — a stale pubkey mismatches the seal + corrupts export.
      this._writeManager(manager);
      this._touch();
      return admin.privateKeyB64; // operator-held one-time; the KeyObjects are GC'd with `admin`.
    });
  }

  /**
   * Recover after a FORGOTTEN master password (M12 F4 Leg 2 / DD3). A SINGLE dedicated op —
   * NOT an `authenticated` flag on `changeMasterPassword` (that would bypass the step-up), NOT
   * two calls: the RECOVERY KEY is itself the step-up (master-equivalent proof). Works FROM
   * LOCKED (unlike the other rotations) — the recovery key installs the MRK. Unwraps the MRK
   * from `manager.mrk.recovery` with the supplied recovery display STRING (a wrong key throws
   * VaultAuthError and writes NOTHING), installs it (the user ends UNLOCKED — they recovered),
   * then rewraps ONLY `manager.mrk.master` under the new password + writes the manager. The MRK
   * is never re-keyed — item ciphertext / the other mrk slots / every `.gfvault` are untouched.
   * @param {{ recoveryDisplay: string, newMasterPassword: string | Buffer }} args
   * @returns {Promise<void>}
   */
  async recoverMasterPassword({ recoveryDisplay, newMasterPassword } = /** @type {any} */ ({})) {
    if (typeof recoveryDisplay !== 'string' || recoveryDisplay.length === 0) {
      throw new VaultStateError('vault-store: recoveryDisplay is required');
    }
    if (!isNonEmptySecret(newMasterPassword)) {
      throw new VaultStateError('vault-store: newMasterPassword is required');
    }
    return this._withManagerLock(async () => {
      const manager = this._readManager();
      // The recovery key IS the step-up: unwrap the MRK. Wrong key → VaultAuthError, nothing
      // installed / written. The transient recovery material is zeroized in the finally
      // (mirrors unlockWithRecovery).
      const material = vc.parseRecoveryKey(recoveryDisplay);
      let mrk;
      try {
        mrk = vc.unwrapRecovery(manager.mrk.recovery, material, { version: manager.version });
      } finally {
        material.fill(0);
      }
      this._installMrk(mrk); // the user ends UNLOCKED (they recovered); fires onUnlock — bumps the generation.
      const gen = this._mrkGen; // capture AFTER install so a lockNow during the wrap below is caught.
      // Rewrap the master envelope under the new password — the recovery proof authenticated it.
      const newMasterEnv = await vc.wrapMaster(mrk, newMasterPassword, {
        version: manager.version, // preserve the document's version (DD1 — no mixed-version documents).
        params: manager.kdf
      });
      this._assertMrkGeneration(gen); // finding 3: refuse if locked/re-keyed mid-derive.
      manager.mrk.master = newMasterEnv;
      this._writeManager(manager);
      this._touch();
    });
  }

  // -------------------------------------------------------------------------
  // Compromise rotation (M18 F2 Leg 3 / flight DD1–DD3)
  // -------------------------------------------------------------------------

  /**
   * COMPROMISE-MODE ROTATION: the single operation that severs every previously
   * issued or extracted credential in one crash-safe transaction. Mints a fresh
   * MRK and a fresh key for EVERY vault, re-encrypts every vault's items, drops
   * every access envelope, removes the admin provision, re-wraps under a
   * REQUIRED NEW master password (v2 no-admin manager — the first legitimate v2
   * writer, DD1), commits it all through the leg-2 transaction primitive,
   * installs the new MRK strictly POST-COMMIT, and returns the new one-time
   * recovery key plus the revocation report.
   *
   * Works from LOCKED or UNLOCKED (DD3's re-derived discipline): the OLD MRK is
   * derived from the supplied credential — never `this.mrk` — and every wrap
   * targets the fresh local MRK, so the op is independent of live lock state
   * mid-flight and `_assertMrkGeneration` is not applicable. The profile ends
   * UNLOCKED regardless of entry state (`_installMrk` fires onUnlock).
   *
   * Two credential branches:
   *  - MASTER: `{ oldMasterPassword, newMasterPassword }` — step-up = unwrap
   *    the old master envelope. R7: byte-equality of old/new FIRST (cheapest,
   *    before any scrypt) → VaultPasswordReuseError.
   *  - RECOVERY: `{ recoveryKey, newMasterPassword }` (display string +
   *    Buffer) — unwrap the MRK via the recovery envelope. R7: TEST-UNWRAP the
   *    old master envelope with the candidate; an unwrap SUCCESS is the reuse.
   *    A malformed display throws VaultFormatError from parseRecoveryKey
   *    (distinct from wrong-credential VaultAuthError — leg 4's error mapping).
   *
   * The caller-supplied password Buffers are NOT zeroized here — the sheet
   * handler owns them (the `changeMasterPassword` idiom, inherited by leg 4).
   * @param {{ oldMasterPassword?: string | Buffer, recoveryKey?: string, newMasterPassword: string | Buffer }} args
   * @returns {Promise<{ recoveryKey: string, revoked: { admin: boolean, vaultIds: string[] } }>}
   *   `recoveryKey` is the one-time display (surfaced once by leg 4, never
   *   persisted); `revoked.admin` is true iff the manager carried the admin
   *   pair; `revoked.vaultIds` names exactly the vaults that carried ≥1 access
   *   envelope (GLOBAL_ID may legitimately appear — mintAccessKey accepts the
   *   global target).
   */
  async compromiseRotate({ oldMasterPassword, recoveryKey, newMasterPassword } = /** @type {any} */ ({})) {
    const viaRecovery = recoveryKey !== undefined;
    if (viaRecovery) {
      if (typeof recoveryKey !== 'string' || recoveryKey.length === 0) {
        throw new VaultStateError('vault-store: recoveryKey must be a non-empty string');
      }
      if (oldMasterPassword !== undefined) {
        throw new VaultStateError('vault-store: supply oldMasterPassword OR recoveryKey, not both');
      }
    } else if (!isNonEmptySecret(oldMasterPassword)) {
      throw new VaultStateError('vault-store: oldMasterPassword or recoveryKey is required');
    }
    if (!isNonEmptySecret(newMasterPassword)) {
      throw new VaultStateError('vault-store: newMasterPassword is required');
    }
    if (!this.isSetUp()) {
      throw new VaultStateError('vault-store: not set up');
    }
    // Serialized with the other manager mutations; the re-key gate is acquired
    // INSIDE this lock turn (leg-2 designer ruling) so the four lock-serialized
    // ops need no counter and the rotation cannot interleave with them.
    return this._withManagerLock(async () => {
      const manager = this._readManager();

      /** @type {Buffer | null} */
      let oldMrk = null;
      /** @type {Buffer | null} */
      let newMrk = null;
      let installed = false;
      // Every OLD and NEW vault-key working buffer lands here for the finally.
      /** @type {Buffer[]} */
      const workingKeys = [];
      /** @type {(() => void) | null} */
      let releaseGate = null;
      try {
        // ---- credential step-up + R7 — BEFORE the gate (fail cheap, never drain
        // in-flight ops for a credential that was wrong all along) ----
        if (viaRecovery) {
          // Malformed display → VaultFormatError (parseRecoveryKey), before any unwrap.
          const material = vc.parseRecoveryKey(recoveryKey);
          try {
            // Wrong key → VaultAuthError, nothing derived, nothing written.
            oldMrk = vc.unwrapRecovery(manager.mrk.recovery, material, { version: manager.version });
          } finally {
            material.fill(0); // transient recovery material (mirrors unlockWithRecovery).
          }
          // R7 (recovery branch): the operator never typed the old password, so
          // reuse is detected by TEST-UNWRAPPING the old master envelope with
          // the candidate (doc kdf + doc version). An unwrap SUCCESS is the
          // reuse; the GOOD case throws VaultAuthError and is swallowed as "not
          // a reuse" — ONLY that class from THIS call, anything else propagates.
          /** @type {Buffer | null} */
          let reuseMrk = null;
          try {
            reuseMrk = await vc.unwrapMaster(manager.mrk.master, newMasterPassword, {
              version: manager.version,
              params: manager.kdf
            });
          } catch (err) {
            if (!(err instanceof vc.VaultAuthError)) throw err;
          }
          if (reuseMrk !== null) {
            reuseMrk.fill(0); // the probe unwrapped a LIVE MRK — zeroize before surfacing the refusal.
            throw new VaultPasswordReuseError(
              'vault-store: the new master password must be different from the old one'
            );
          }
        } else {
          // R7 (master branch): byte-equality FIRST — cheapest check, before the
          // step-up scrypt (see secretsEqual for the timing-safety justification).
          if (secretsEqual(/** @type {string | Buffer} */ (oldMasterPassword), newMasterPassword)) {
            throw new VaultPasswordReuseError(
              'vault-store: the new master password must be different from the old one'
            );
          }
          // Step-up: the old password must unwrap the CURRENT master envelope
          // (doc's stated version + doc kdf). Wrong password → VaultAuthError,
          // nothing derived, nothing written.
          oldMrk = await vc.unwrapMaster(manager.mrk.master, oldMasterPassword, {
            version: manager.version,
            params: manager.kdf
          });
        }

        // ---- write exclusivity: raise the gate + drain (released in finally).
        // From here every gated op refuses at entry and the sinks' second wall
        // refuses any straddler — ALL rotation writes go through the
        // transaction primitive, which bypasses the sinks (no self-block). ----
        releaseGate = await this._acquireRekeyGate();

        // ---- enumerate: the REGISTRY recipe ∪ a DISK readdir (designer ruling,
        // design review Q3). Registry recipe = openAllWithAdminKey's idiom
        // (GLOBAL first; jars minus any 'global' impostor; lazily-absent vaults
        // null-skip below). The union adds any *.gfvault outside the registry:
        // one whose mrk envelope unwraps under the old MRK is rotated like any
        // other (registry drift must never leave a vault severed under the old
        // key); one that fails to parse or unwrap fails the rotation LOUDLY,
        // PRE-COMMIT — a foreign/corrupt vault file during a security operation
        // is an integrity anomaly to surface, never to skip silently. ----
        this._ensureVaultsDir();
        const registryIds = [
          GLOBAL_ID,
          ...this.listJars()
            .map((j) => j.id)
            .filter((id) => id !== GLOBAL_ID)
        ];
        const diskIds = fs
          .readdirSync(this.vaultsDir)
          .filter((name) => name.endsWith('.gfvault') && name.length > '.gfvault'.length)
          .map((name) => name.slice(0, -'.gfvault'.length));
        const vaultIds = [...new Set([...registryIds, ...diskIds])];

        // ---- mint + rebuild every vault IN MEMORY (nothing touches disk until
        // the transaction below) ----
        newMrk = vc.newVaultKey();
        const rec = vc.generateRecoveryKey();
        const hadAdmin = manager.mrk.admin !== undefined;
        /** @type {string[]} */
        const revokedVaultIds = [];
        /** @type {Array<{ finalName: string, content: Buffer }>} */
        const rebuilt = [];
        for (const vaultId of vaultIds) {
          // Direct _readVault-level reads ONLY — the gated public ops would
          // self-block at entry now that the gate is up.
          const doc = this._readVault(vaultId); // corrupt → VaultFormatError, loud pre-commit.
          if (doc === null) continue; // lazily-absent registry vault — skip (the enumeration recipe's null-skip).
          const env = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
          if (!env) {
            throw new vc.VaultFormatError(`vault "${vaultId}": missing mrk envelope`);
          }
          // Un-unwrappable under the old MRK → VaultAuthError, loud pre-commit.
          const oldKey = vc.unwrapVaultKey(env, oldMrk, mrkEnvelopeAad(doc.version));
          workingKeys.push(oldKey);
          const items = vc.decryptItems(doc.items, oldKey);
          if (doc.envelopes.some((/** @type {any} */ e) => e.keyId !== 'mrk')) {
            revokedVaultIds.push(vaultId); // carried ≥1 access envelope — reported as revoked.
          }
          const newKey = vc.newVaultKey();
          workingKeys.push(newKey);
          // EXACTLY ONE envelope on the rebuilt doc: the new mrk envelope at the
          // vault-doc's own AAD version (unchanged) — every access envelope is
          // dropped by construction, which is what revokes the access keys.
          const newEnv = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(newKey, newMrk, mrkEnvelopeAad(doc.version)) };
          const json = vc.serializeVault({
            vaultId,
            kdf: doc.kdf,
            envelopes: [newEnv],
            items: vc.encryptItems(items, newKey)
          });
          rebuilt.push({ finalName: `${vaultId}.gfvault`, content: Buffer.from(json, 'utf8') });
          // The decrypted item plaintext lives only in `items` — transient JS
          // objects released with this iteration (the same exposure class as
          // every listItems call); no Buffer form exists at this layer to fill.
        }

        // ---- the new manager: version 2 with NO admin fields (DD1 — absence is
        // the deliberate revoked/unprovisioned state; rotateAdminKey is the
        // from-scratch re-provision if the operator ever wants one back).
        // KDF ruling (design review Q2): PRESERVE manager.kdf — the document's
        // existing params, exactly as every existing rotation does; never the
        // bare SCRYPT_PARAMS constant and never a silent swap of an adopted
        // profile's params. Read-time bounds are already guaranteed by
        // validateImportedKdf on every _readManager. ----
        const masterEnv = await vc.wrapMaster(newMrk, newMasterPassword, {
          version: MANAGER_VERSION_V2, // v2 AAD — homogeneous with every envelope written below.
          params: manager.kdf
        });
        const recoveryEnv = vc.wrapRecovery(newMrk, rec.material, { version: MANAGER_VERSION_V2 });
        rec.material.fill(0); // operator-held via `display` from here — drop the buffer (the setup idiom).
        const newManager = {
          format: MANAGER_FORMAT,
          version: MANAGER_VERSION_V2,
          kdf: manager.kdf,
          mrk: { master: masterEnv, recovery: recoveryEnv }
        };

        // ---- ONE transaction: manager.json + every rebuilt vault (DD2) ----
        /** @type {ReturnType<typeof vtxn.beginTransaction> | null} */
        let handle = null;
        try {
          handle = vtxn.beginTransaction(this.vaultsDir, [
            { finalName: 'manager.json', content: Buffer.from(JSON.stringify(newManager), 'utf8') },
            ...rebuilt
          ]);
          vtxn.commit(handle);
        } catch (err) {
          // FAILURE DISCRIMINATION (design-review HIGH): branch on the handle's
          // `committed` flag — set immediately after the commit-discriminator
          // rename in vault-txn.commit.
          if (handle !== null && handle.committed) {
            // COMMITTED: the rotation SUCCEEDED — a final rename or the journal
            // unlink threw in-process AFTER the discriminator. Finish the
            // roll-forward and proceed to install + return; NEVER rethrow on
            // this branch — a rethrow would tell the operator "nothing changed"
            // over a durably rotated disk and lose the one-time recovery key.
            try {
              vtxn.recover(this.vaultsDir);
            } catch {
              // Best-effort: recovery is idempotent and re-runs on every store
              // construction, so the next load finishes the roll-forward. Still
              // never rethrow over a durably committed rotation.
            }
          } else {
            // UNCOMMITTED: roll back — disk untouched, live state untouched.
            vtxn.recover(this.vaultsDir);
            throw err;
          }
        }

        // ---- POST-COMMIT: install the fresh MRK. _resetKeys inside zeroizes
        // and clears EVERY cached vault key wholesale, bumps the generation,
        // and fires onUnlock — the profile ends UNLOCKED regardless of entry
        // lock state (DD3/DD6). _installMrk takes OWNERSHIP of newMrk. ----
        this._installMrk(newMrk);
        installed = true;
        return {
          recoveryKey: rec.display,
          revoked: { admin: hadAdmin, vaultIds: revokedVaultIds }
        };
      } finally {
        // Zeroization discipline (design-review ownership ruling): the old MRK
        // and every old/new vault-key WORKING buffer die here on every path;
        // newMrk is owned by _installMrk on success and by this finally only on
        // the uncommitted-failure path; the caller-supplied password buffers
        // are NOT zeroized by the op — the sheet handler owns them.
        if (releaseGate) releaseGate();
        if (oldMrk) oldMrk.fill(0);
        for (const key of workingKeys) key.fill(0);
        if (newMrk && !installed) newMrk.fill(0);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Portable export / import (M12 F4 Leg 1 / DD1 — Option A, no network egress)
  // -------------------------------------------------------------------------

  /**
   * Build a self-contained, portable export bundle for one vault (flight DD1 —
   * Option A). Requires the manager UNLOCKED (POLICY, not a crypto necessity — every
   * input is already on disk); takes NO password (satisfies mission.md:150 "encrypted
   * export not re-prompted"). The bundle carries the manager's `mrk.master` +
   * `mrk.recovery` envelopes ALWAYS, the admin pair (`mrk.admin` +
   * `adminPublicKeyB64`) only WHEN PROVISIONED (M18 F2 Leg 1 / DD7 — a no-admin v2
   * manager omits both; `mrk.admin` is ciphertext sealed to the pubkey, no plaintext,
   * preserving admin portability when present), the KDF params, the source MANAGER'S
   * VERSION as `managerVersion` (always written — bundle envelopes are AAD-bound to
   * it, so import must unwrap at this version), and the target `.gfvault` document
   * (its `mrk` envelope + item ciphertext). `format`/`version` stay at bundle v1 —
   * the bundle-version bump is reserved for Flight 3's multi-vault format.
   * EVERYTHING is ciphertext — no plaintext secret ever enters the bundle. NO write.
   * @param {string} target  `'global'` or a persistent jar id.
   * @returns {{ format: string, version: number, managerVersion: number,
   *   sourceVaultId: string, kdf: any,
   *   mrk: { master: any, recovery: any, admin?: any }, adminPublicKeyB64?: string, vault: any }}
   */
  exportVault(target) {
    // GATED for its READS (M18 F2 Leg 2 / DD3, second-review coherence note):
    // export performs no write, but minting a portable bundle of
    // about-to-be-severed credentials mid-rotation must be refused, and the
    // gate guarantees a consistent manager+vault snapshot. Fully synchronous,
    // so entry-check + drain genuinely suffice.
    const releaseOp = this._enterGatedOp();
    try {
      return this._exportVault(target);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} target
   * @returns {ReturnType<VaultStore['exportVault']>}
   */
  _exportVault(target) {
    this._requireMrk(); // POLICY: export is an unlock-window op (VaultLockedError → catchLocked).
    const sourceVaultId = this._resolveTarget(target);
    const m = this._readManager(); // requires format+version+kdf+master/recovery slots; admin pair per-version.
    const vaultDoc = this._readVault(sourceVaultId);
    if (vaultDoc === null) {
      throw new VaultStateError(`vault-store: no vault for "${sourceVaultId}" — nothing to export`);
    }
    // _readManager enforces the pairing rule, so seal-presence implies pub-presence.
    const hasAdmin = m.mrk.admin !== undefined;
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      // The source manager's version (DD7): the bundle's mrk envelopes carry it in
      // their AAD, so import unwraps at this — absent (pre-change bundles) means 1.
      managerVersion: m.version,
      sourceVaultId,
      kdf: m.kdf,
      // master + recovery always; the admin pair only when provisioned — ciphertext only.
      mrk: {
        master: m.mrk.master,
        recovery: m.mrk.recovery,
        ...(hasAdmin ? { admin: m.mrk.admin } : {})
      },
      ...(hasAdmin ? { adminPublicKeyB64: m.adminPublicKeyB64 } : {}),
      vault: vaultDoc
    };
  }

  /**
   * Build a v2 portable bundle for the WHOLE profile (M18 F3 Leg 2 / DD1 ruling
   * 2): the global vault plus every JAR vault that EXISTS on disk (a lazy,
   * never-saved jar vault is simply absent — the `vaults` array names exactly
   * what was carried), each jar entry's identity (`{name,color}`) riding as an
   * ENCRYPTED `jarMeta` envelope (`encryptJarMeta` above) so nothing
   * human-readable about a jar appears before the bundle secret is entered.
   * GATED + the same unlock-window POLICY as `exportVault` (ruling 8 / DD10).
   * NO write, NO password argument (every input is already on disk).
   * @returns {{ format: string, version: number, managerVersion: number, kdf: any,
   *   mrk: { master: any, recovery: any, admin?: any }, adminPublicKeyB64?: string,
   *   vaults: Array<{ sourceId: string, jarMeta?: any, vault: any }> }}
   */
  exportProfile() {
    const releaseOp = this._enterGatedOp();
    try {
      return this._exportProfile();
    } finally {
      releaseOp();
    }
  }

  /**
   * @returns {ReturnType<VaultStore['exportProfile']>}
   */
  _exportProfile() {
    const mrk = this._requireMrk(); // POLICY: export is an unlock-window op (mirrors _exportVault).
    const m = this._readManager();
    const hasAdmin = m.mrk.admin !== undefined;
    const jars = this.listJars().filter((j) => j.id !== GLOBAL_ID);
    const sourceIds = [GLOBAL_ID, ...jars.map((j) => j.id)];
    const jarById = new Map(jars.map((j) => [j.id, j]));
    /** @type {Array<{ sourceId: string, jarMeta?: any, vault: any }>} */
    const vaults = [];
    for (const sourceId of sourceIds) {
      const doc = this._readVault(sourceId);
      if (doc === null) continue; // lazy vault — absent by design.
      /** @type {{ sourceId: string, jarMeta?: any, vault: any }} */
      const entry = { sourceId, vault: doc };
      if (sourceId !== GLOBAL_ID) {
        const jar = /** @type {{ id: string, name: string, color: string }} */ (jarById.get(sourceId));
        entry.jarMeta = encryptJarMeta(mrk, sourceId, { name: jar.name, color: jar.color });
      }
      vaults.push(entry);
    }
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION_V2,
      managerVersion: m.version,
      kdf: m.kdf,
      mrk: {
        master: m.mrk.master,
        recovery: m.mrk.recovery,
        ...(hasAdmin ? { admin: m.mrk.admin } : {})
      },
      ...(hasAdmin ? { adminPublicKeyB64: m.adminPublicKeyB64 } : {}),
      vaults
    };
  }

  /**
   * Shared fresh-adopt core (M18 F3 Leg 2 / ruling 1) — the SINGLE place a
   * fresh adopt mints its rotated recovery key and writes manager.json, used
   * by BOTH `_importVault`'s fresh branch and `restoreProfile`'s fresh branch
   * so DD6's no-admin-mint change lands once for both callers. CALLER
   * CONTRACT: every vault this adopt carries must already be WRITTEN to disk
   * (ruling 4's vault-before-manager invariant — call this only after the
   * caller's own vault write(s) land).
   *
   * Writes manager.json at the bundle's EFFECTIVE managerVersion with the
   * DONOR master envelope retained VERBATIM (DD4 residual — the source master
   * password keeps unlocking the adopted profile) and a FRESH recovery
   * envelope minted under the live `mrk` — NO admin fields, legal at EITHER
   * manager version (ruling 10's optional-but-paired relaxation is what makes
   * a no-admin v1 write legal) — then installs the MRK (profile ends
   * UNLOCKED, `onUnlock` fires).
   *
   * mrk OWNERSHIP HAND-OFF (cycle-1 review, load-bearing): `_installMrk`
   * (`:967-985` area) takes ownership of the SAME buffer passed in as `mrk`.
   * A callee's reassignment of its own parameter binding does NOT propagate
   * to the CALLER's local variable, so this function SIGNALS installation via
   * the returned `installed: true` rather than mutating anything of the
   * caller's. EVERY caller MUST null its own local `mrk` binding when it sees
   * that signal — otherwise the caller's own `finally` will zeroize the
   * buffer this function just installed as `this.mrk` (the exact defect class
   * `_importVault`'s pre-existing `mrk = null` guard exists to avoid).
   * @param {{ mrk: Buffer, managerVersion: number, kdf: any, masterEnvelope: any }} args
   * @returns {{ installed: true, recoveryKeyDisplay: string }}
   */
  _adoptManagerCore({ mrk, managerVersion, kdf, masterEnvelope }) {
    const rec = vc.generateRecoveryKey();
    const recoveryEnv = vc.wrapRecovery(mrk, rec.material, { version: managerVersion });
    rec.material.fill(0); // operator-held via `display` from here — drop the buffer (the setup idiom).
    this._writeManager({
      format: MANAGER_FORMAT,
      version: managerVersion,
      kdf,
      mrk: {
        master: masterEnvelope, // DONOR master envelope RETAINED verbatim (DD4).
        recovery: recoveryEnv // NEW — the donor recovery envelope is discarded.
        // NO admin fields (DD6) — legal at both manager versions (ruling 10).
      }
    });
    this._installMrk(mrk); // leaves UNLOCKED, fires onUnlock; takes ownership of `mrk`.
    return { installed: true, recoveryKeyDisplay: rec.display };
  }

  /**
   * Import a portable bundle (flight DD1 — Option A). Validates the bundle, then does
   * ALL crypto BEFORE ANY write (a wrong secret throws VaultAuthError here → nothing is
   * written / installed). The source MASTER PASSWORD (a Buffer) OR the source RECOVERY
   * KEY (a base32 display STRING) opens the bundle:
   *  - `secretKind:'master'` → `unwrapMaster(bundle.mrk.master, secret, { params: bundle.kdf })`.
   *  - `secretKind:'recovery'` → `unwrapRecovery(bundle.mrk.recovery,
   *    parseRecoveryKey(secret.toString('utf8')))` — parseRecoveryKey→base32Decode throws
   *    on a non-string, so the recovery secret is decoded as a STRING (review [HIGH]); the
   *    transient recovery material is zeroized in a finally (mirrors unlockWithRecovery).
   * Then unwrap the vault key from the bundle vault's `mrk` envelope + decrypt its items.
   *
   * FRESH profile (`!isSetUp()`): ADOPT the bundle's manager via the SHARED
   * `_adoptManagerCore` (M18 F3 Leg 2 / ruling 1) — write the vault file FIRST
   * (to GLOBAL_ID, the only target resolvable on a jar-less fresh profile — review [MED]:
   * vault-before-manager so a failure never flips isSetUp() true without a vault), then
   * `manager.json` from the bundle (master + recovery — NO admin fields, M18 F3 Leg 2 /
   * DD6), then `_installMrk` (leaves the profile UNLOCKED, fires onUnlock — analogous to
   * setup). The source master password / recovery key unlock this profile on restart. The
   * installed MRK is RETAINED (never zeroized).
   *
   * EXISTING profile (set up + unlocked): re-key the (source) vault key under the
   * DESTINATION MRK (`this.mrk`) at the allowlist-resolved destination target; refuse a
   * collision unless `overwrite`; evict the destination's cached key (a stale cached key
   * GCM-fails against the new ciphertext); zeroize the transient bundle MRK + vault key.
   * @param {any} bundle
   * On a FRESH adopt the return also carries the force-rotated one-time recovery key
   * (`recoveryKeyDisplay`) for the surfacing leg — NO `adminPrivateKeyB64` (DD6, M18 F3
   * Leg 2: adopt no longer mints an admin keypair at all); the EXISTING-profile return
   * omits `recoveryKeyDisplay` too (M17 F4 Leg 2 / DD2).
   * @param {{ destinationTarget?: string, secret: Buffer, secretKind?: 'master'|'recovery', overwrite?: boolean }} opts
   * @returns {Promise<{ imported: true, fresh: boolean, vaultId: string, recoveryKeyDisplay?: string }>}
   */
  async importVault(bundle, opts = /** @type {any} */ ({})) {
    // GATED (M18 F2 Leg 2 / DD3): import awaits scrypt mid-op, so it holds the
    // in-flight counter for its FULL duration (released in finally — any throw
    // included) and its writes hit the sinks' second wall if the gate rises
    // during the derive.
    const releaseOp = this._enterGatedOp();
    try {
      return await this._importVault(bundle, opts);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {any} bundle
   * @param {{ destinationTarget?: string, secret: Buffer, secretKind?: 'master'|'recovery', overwrite?: boolean }} opts
   * @returns {Promise<{ imported: true, fresh: boolean, vaultId: string, recoveryKeyDisplay?: string }>}
   */
  async _importVault(bundle, opts) {
    const { destinationTarget, secret, secretKind, overwrite } = opts;

    // ---- validate the bundle (loud — VaultFormatError / VaultStateError) ----
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new VaultStateError('vault-store: import bundle must be an object');
    }
    if (bundle.format !== BUNDLE_FORMAT) {
      throw new vc.VaultFormatError(`vault-store: unknown bundle format "${bundle.format}"`);
    }
    if (bundle.version !== BUNDLE_VERSION) {
      throw new vc.VaultFormatError(`vault-store: unsupported bundle version "${bundle.version}"`);
    }
    // The bundle's EFFECTIVE manager version (M18 F2 Leg 1 / DD7): absent means 1
    // (every pre-change bundle), else it must be a readable manager version. The
    // bundle's mrk envelopes are AAD-bound to it, so both unwrap sites below pass it —
    // without this, a v2-source bundle would fail unwrap with a misleading
    // "wrong secret" GCM error. The mrk-envelope-shape + admin-pairing + bounded-KDF
    // checks are the SHARED `validateBundleEnvelope` helper (M18 F3 Leg 2) — restoreProfile
    // ({1,2} gate) runs the identical rules; this call site keeps importVault's OWN
    // v1-only format/version gate above (ruling 9 — importVault never learns v2).
    const managerVersion = validateBundleEnvelope(bundle);
    if (!Buffer.isBuffer(secret)) {
      throw new VaultStateError('vault-store: import secret must be a Buffer');
    }
    const kind = secretKind === 'recovery' ? 'recovery' : 'master';

    // Parse the embedded `.gfvault` doc loudly (a tampered/malformed vault → VaultFormatError).
    // The bundle round-trips through JSON on disk, so `bundle.vault` arrives as a parsed
    // OBJECT; re-serialize for parseVault (it takes a string/Buffer) to get the same strict
    // validation the load path uses. Tolerates a raw string too.
    const vaultDoc = vc.parseVault(typeof bundle.vault === 'string' ? bundle.vault : JSON.stringify(bundle.vault));
    const mrkEnv = vaultDoc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
    if (!mrkEnv) {
      throw new vc.VaultFormatError('vault-store: bundle vault missing mrk envelope');
    }

    // ---- crypto phase (before ANY write) ----
    let mrk;
    if (kind === 'recovery') {
      // Recovery is a base32 STRING (review [HIGH]) — parseRecoveryKey throws on a Buffer.
      const material = vc.parseRecoveryKey(secret.toString('utf8'));
      try {
        // The bundle's EFFECTIVE manager version (DD7) — its envelopes are AAD-bound to it.
        mrk = vc.unwrapRecovery(bundle.mrk.recovery, material, { version: managerVersion });
      } finally {
        material.fill(0); // zeroize the transient recovery material (mirrors unlockWithRecovery).
      }
    } else {
      mrk = await vc.unwrapMaster(bundle.mrk.master, secret, { version: managerVersion, params: bundle.kdf });
    }

    // From here `mrk` is a live buffer. The FRESH path INSTALLS it (retains); every other
    // exit zeroizes it. `vaultKey` is transient on BOTH paths. A throw anywhere below still
    // runs the finally, so a wrong-vault-envelope / collision / unknown-target leaves nothing
    // installed and both buffers zeroized.
    let vaultKey = null;
    try {
      vaultKey = vc.unwrapVaultKey(mrkEnv, mrk, mrkEnvelopeAad(vaultDoc.version));
      // The ciphertext is GCM-authentic but its PLAINTEXT shape is attacker-chosen:
      // validate the decrypted array (type / string id / uniqueness / bound) BEFORE
      // any write or `items.map` (finding 4) — a non-array previously crashed later.
      const items = validateImportedItems(vc.decryptItems(vaultDoc.items, vaultKey));

      if (!this.isSetUp()) {
        // FRESH profile: adopt the bundle's manager. Vault FIRST (to GLOBAL_ID — the sole
        // target resolvable on a jar-less fresh profile), then manager.json, then install —
        // via the SHARED adopt core (M18 F3 Leg 2 / ruling 1), so `restoreProfile`'s fresh
        // branch and this one stop minting admin at the same commit (DD6).
        this._writeVaultForKey(GLOBAL_ID, vaultKey, mrk, items);

        // M17 F4 Leg 2 / DD2: FORCE ROTATION of the one-time recovery key inline under the
        // ALREADY-LIVE `mrk` (unwrapped above from the donor secret), so the donor recovery
        // envelope does not survive in the adopted manager.json — the donor operator can
        // never recovery-open this adopted profile. Minted exactly as setup() does (no
        // master-password step-up: a recovery-kind adopt has no password, and the live MRK
        // already authenticates the wrap). The new one-time recovery key is RETURNED so the
        // surfacing leg (Leg 3) can reveal it. The donor MASTER envelope is intentionally
        // RETAINED (DD4 residual — documented in Leg 4, not severed here). M18 F3 Leg 2 /
        // DD6: adopt no longer mints an admin keypair at all — `_adoptManagerCore` writes
        // NO admin fields, legal at the bundle's effective managerVersion under ruling 10's
        // relaxation (a v1-effective adopt is the mission's default-state scenario).
        const adopted = this._adoptManagerCore({
          mrk,
          managerVersion,
          kdf: bundle.kdf,
          masterEnvelope: bundle.mrk.master
        });
        if (adopted.installed) {
          mrk = null; // ruling 1 hand-off — the core took ownership; do NOT zeroize below.
        }
        return {
          imported: true,
          fresh: true,
          vaultId: GLOBAL_ID,
          recoveryKeyDisplay: adopted.recoveryKeyDisplay
        };
      }

      // EXISTING profile: re-key the source vault key under the DESTINATION MRK.
      this._requireMrk(); // must be unlocked (VaultLockedError → catchLocked at the IPC layer).
      const dest = this.resolveTarget(destinationTarget ?? '');
      if (fs.existsSync(this._vaultPath(dest)) && !overwrite) {
        // CODED collision (M12 F5 HAT tail): a dedicated subclass so the import path can tell this
        // apart from the other VaultStateError causes above (bundle/secret guards, unknown target)
        // and from a wrong-secret VaultAuthError — WITHOUT message-matching. ONLY this :846
        // destination-collision gets the code.
        throw new VaultCollisionError(
          `vault-store: a vault already exists for "${dest}" — pass overwrite to replace it`
        );
      }
      this._writeVaultForKey(dest, vaultKey, this.mrk, items);
      // Evict the destination's cached key — else a stale key GCM-fails on the new ciphertext.
      this.vaultKeys.get(dest)?.fill(0);
      this.vaultKeys.delete(dest);
      return { imported: true, fresh: false, vaultId: dest };
    } finally {
      if (mrk) mrk.fill(0); // transient bundle MRK (existing path / any pre-install throw).
      if (vaultKey) vaultKey.fill(0); // transient vault key (both paths).
    }
  }

  // -------------------------------------------------------------------------
  // Multi-vault restore (M18 F3 Leg 2 / flight DD1-DD4, DD10)
  // -------------------------------------------------------------------------

  /**
   * Validate a restore's per-sourceId directive mapping against the bundle's
   * vault list — STRUCTURAL legality — entirely BEFORE any crypto or write
   * (the loud, pre-write edge cases: an unknown sourceId in the mapping, a
   * bundle vault with no mapping entry — "every row demands an explicit
   * directive"). Ruling 3's fresh-profile restriction ("only 'new'/'skip'/
   * global→global on a fresh profile") falls out of `_resolveTarget` itself —
   * a truly fresh profile's `listJars()` is empty, so no non-global
   * destination resolves — WITHOUT an extra fresh-specific gate here, which
   * would otherwise make the adopt-rerun residue recovery path (ruling 4: a
   * failed fresh adopt's created-but-unadopted jars stay mappable as
   * 'existing' destinations on rerun, while `isSetUp()` is still false)
   * unreachable. Touches neither disk nor crypto.
   * @param {Array<{ sourceId: string }>} vaults
   * @param {any} mapping
   * @returns {void}
   */
  _validateRestoreMapping(vaults, mapping) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new VaultStateError('vault-store: restore mapping must be an object');
    }
    const bundleIds = new Set(vaults.map((v) => v.sourceId));
    for (const key of Object.keys(mapping)) {
      if (!bundleIds.has(key)) {
        throw new VaultStateError(`vault-store: restore mapping references unknown sourceId "${key}"`);
      }
    }
    for (const { sourceId } of vaults) {
      const directive = mapping[sourceId];
      if (!directive || typeof directive !== 'object') {
        throw new VaultStateError(`vault-store: restore mapping is missing a directive for "${sourceId}"`);
      }
      if (directive.directive !== 'existing' && directive.directive !== 'new' && directive.directive !== 'skip') {
        throw new VaultStateError(`vault-store: restore mapping has an invalid directive for "${sourceId}"`);
      }
      if (directive.directive === 'new') {
        const nj = directive.newJar;
        if (!nj || typeof nj !== 'object' || typeof nj.name !== 'string' || typeof nj.color !== 'string') {
          throw new VaultStateError(
            `vault-store: restore mapping's 'new' directive for "${sourceId}" needs a valid newJar`
          );
        }
      }
      if (directive.directive === 'existing') {
        if (typeof directive.destination !== 'string' || directive.destination.length === 0) {
          throw new VaultStateError(
            `vault-store: restore mapping's 'existing' directive for "${sourceId}" needs a destination`
          );
        }
        // Resolve NOW (loud, pre-write) — an unknown/burner/non-existent jar id refuses
        // the WHOLE restore rather than surfacing per-vault mid-write. This is ALSO
        // ruling 3's fresh-profile enforcement: a truly fresh profile's listJars() is
        // empty, so `_resolveTarget` naturally admits only 'global' — no separate
        // fresh-specific gate is needed. Deliberately NOT gated further on `fresh`
        // (cycle-2 correction): the adopt-rerun residue edge case (ruling 4) leaves
        // created-but-unadopted jars in the registry while `isSetUp()` is still
        // false, and the documented recovery path is mapping a rerun's directives
        // onto exactly those residue jars via 'existing' — a hard fresh-profile ban
        // here would make that recovery path unreachable.
        this._resolveTarget(directive.destination);
      }
      if (directive.mode !== undefined && directive.mode !== 'replace' && directive.mode !== 'merge') {
        throw new VaultStateError(`vault-store: restore mapping has an invalid mode for "${sourceId}"`);
      }
    }
  }

  /**
   * Restore a whole-profile bundle (v1 or v2 — ruling 9 normalizes v1 to the
   * one-row v2 shape) with an explicit per-vault directive mapping (DD2/DD3).
   * SINGLE-FLIGHT guarded (ruling 7) in addition to the re-key gate (ruling 8).
   * @param {any} bundle
   * @param {{ secret: Buffer, secretKind?: 'master'|'recovery', mapping: any }} opts
   * @returns {Promise<{ fresh: boolean, results: Array<{ sourceId: string,
   *   outcome: 'landed'|'skipped'|'collision-refused'|'failed', destination?: string,
   *   mergeReport?: { imported: number, skippedIdentical: number, conflictCopies: number } }>,
   *   generation: { completedAt: number, nonce: string }, recoveryKeyDisplay?: string }>}
   */
  async restoreProfile(bundle, opts = /** @type {any} */ ({})) {
    // Single-flight guard (DD3 ruling 7) — ADDITIONAL to the re-key gate below,
    // which is a COUNTER (`_inFlightOps`, `:759-773` area) and does not
    // serialize two restores against EACH OTHER. An INSTANCE field (never
    // module-scope — the `_rekeyInProgress` idiom, since the unit suite
    // constructs many store instances via `vs.load()`).
    if (this._restoreInFlight) {
      throw new VaultBusyError('vault-store: a restore is already in progress');
    }
    this._restoreInFlight = true;
    // GATED (DD10 ruling 8): restoreProfile awaits scrypt mid-op, so it holds
    // the in-flight counter for its full duration exactly as importVault does.
    const releaseOp = this._enterGatedOp();
    try {
      return await this._restoreProfile(bundle, opts);
    } finally {
      releaseOp();
      this._restoreInFlight = false; // released on success AND on throw.
    }
  }

  /**
   * @param {any} bundle
   * @param {{ secret: Buffer, secretKind?: 'master'|'recovery', mapping: any }} opts
   * @returns {ReturnType<VaultStore['restoreProfile']>}
   */
  async _restoreProfile(bundle, opts) {
    const { secret, secretKind, mapping } = opts;

    // ---- validate the bundle shape (v1/v2 normalization, ruling 9) + the shared
    // envelope rules (ruling 9's {1,2} gate — restoreProfile, unlike importVault,
    // learns v2) — loud, pre-write, pre-crypto. ----
    const normalized = normalizeRestoreBundle(bundle);
    const managerVersion = validateBundleEnvelope(normalized);
    if (!Buffer.isBuffer(secret)) {
      throw new VaultStateError('vault-store: restore secret must be a Buffer');
    }
    const kind = secretKind === 'recovery' ? 'recovery' : 'master';
    const fresh = !this.isSetUp();

    // ---- validate the mapping against the bundle's vault list (structural +
    // fresh-profile legality) — still before any crypto or write. ----
    this._validateRestoreMapping(normalized.vaults, mapping);

    // Parse + shape-check every embedded .gfvault doc up front (loud, pre-write —
    // mirrors _importVault's single parseVault call, done here for every entry).
    const parsedVaults = normalized.vaults.map((entry) => {
      const doc = vc.parseVault(typeof entry.vault === 'string' ? entry.vault : JSON.stringify(entry.vault));
      const mrkEnv = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
      if (!mrkEnv) {
        throw new vc.VaultFormatError(`vault-store: bundle vault "${entry.sourceId}" missing mrk envelope`);
      }
      return { sourceId: entry.sourceId, doc, mrkEnv };
    });

    if (!fresh) {
      this._requireMrk(); // destination must be unlocked (mirrors importVault's existing-profile check).
    }

    // ---- bundle-secret crypto (before any write) ----
    let mrk;
    if (kind === 'recovery') {
      const material = vc.parseRecoveryKey(secret.toString('utf8'));
      try {
        mrk = vc.unwrapRecovery(normalized.mrk.recovery, material, { version: managerVersion });
      } finally {
        material.fill(0); // zeroize the transient recovery material (mirrors unlockWithRecovery).
      }
    } else {
      mrk = await vc.unwrapMaster(normalized.mrk.master, secret, { version: managerVersion, params: normalized.kdf });
    }

    /** @type {Array<{ sourceId: string, outcome: 'landed'|'skipped'|'collision-refused'|'failed',
     *   destination?: string, mergeReport?: { imported: number, skippedIdentical: number, conflictCopies: number } }>} */
    const results = [];
    let anyFailed = false;
    try {
      for (const { sourceId, doc, mrkEnv } of parsedVaults) {
        const directive = mapping[sourceId];
        if (directive.directive === 'skip') {
          results.push({ sourceId, outcome: 'skipped' });
          continue;
        }

        let destId;
        if (directive.directive === 'new') {
          // DD3 (a): create THEN verify — jars.add's save() is fail-soft, so an
          // unverified create could land a vault under a jar that evaporates on
          // restart. A failed verify → outcome 'failed', NO vault write, NO
          // rollback attempt (the in-memory jar stays until restart; rerun recovers).
          if (this._createJar === null) {
            throw new VaultStateError('vault-store: jar creation is not configured on this store');
          }
          const created = this._createJar(directive.newJar.name, directive.newJar.color);
          const verified = this._verifyJarPersisted(created.id);
          if (!verified) {
            results.push({ sourceId, outcome: 'failed' });
            anyFailed = true;
            break; // per-vault atomicity + rerun (ruling 4) — stop; later entries untouched.
          }
          destId = created.id;
        } else {
          destId = this._resolveTarget(directive.destination);
        }

        const destExists = fs.existsSync(this._vaultPath(destId));
        if (destExists && !directive.mode) {
          results.push({ sourceId, outcome: 'collision-refused', destination: destId });
          continue;
        }

        let vaultKey = null;
        try {
          // Ruling 11: at most ONE bundle vault key live at a time — unwrap → write →
          // zeroize in this per-iteration finally (stricter than changeMasterPassword's
          // collect-array, which that op needs for its batch-then-one-txn shape; this
          // loop writes each vault immediately, so there is nothing to batch).
          vaultKey = vc.unwrapVaultKey(mrkEnv, mrk, mrkEnvelopeAad(doc.version));
          const items = validateImportedItems(vc.decryptItems(doc.items, vaultKey));

          /** @type {{ imported: number, skippedIdentical: number, conflictCopies: number } | undefined} */
          let mergeReport;
          if (destExists && directive.mode === 'merge') {
            // Merge requires decrypting the DESTINATION vault under ITS OWN key
            // (guaranteed reachable — fresh can never reach here, destExists is
            // always false before any vault is written).
            const destDoc = this._readVault(destId);
            const destKey = this._vaultKeyFromDoc(destId, destDoc);
            const destItems = /** @type {VaultItem[]} */ (vc.decryptItems(destDoc.items, destKey));
            const merge = mergeVaultItems(destItems, items);
            this._writeVault(destId, {
              kdf: destDoc.kdf,
              envelopes: destDoc.envelopes,
              items: vc.encryptItems(merge.items, destKey)
            });
            mergeReport = merge.mergeReport;
          } else {
            // Fresh write (no destination vault) OR an explicit whole-vault replace —
            // this bundle vault's OWN key, wrapped under the profile's LIVE mrk (fresh:
            // the bundle mrk itself, which becomes the profile's new MRK; existing:
            // this.mrk, exactly as importVault's existing-profile branch).
            const wrappingMrk = fresh ? mrk : this._requireMrk();
            this._writeVaultForKey(destId, vaultKey, wrappingMrk, items);
            if (!fresh) {
              // Evict the destination's cached key — a stale cached key GCM-fails
              // against the new ciphertext (mirrors importVault's existing-profile path).
              this.vaultKeys.get(destId)?.fill(0);
              this.vaultKeys.delete(destId);
            }
          }
          results.push({
            sourceId,
            outcome: 'landed',
            destination: destId,
            ...(mergeReport ? { mergeReport } : {})
          });
        } finally {
          if (vaultKey) vaultKey.fill(0);
        }
      }

      /** @type {string | undefined} */
      let recoveryKeyDisplay;
      if (fresh && !anyFailed) {
        // Vault-before-manager (ruling 4): adopt ONLY after the whole loop, and ONLY
        // when nothing failed — a mid-list failure leaves vaults+jars on disk but NO
        // manager, so isSetUp() stays false and a rerun re-adopts over the residue.
        const adopted = this._adoptManagerCore({
          mrk,
          managerVersion,
          kdf: normalized.kdf,
          masterEnvelope: normalized.mrk.master
        });
        if (adopted.installed) {
          mrk = null; // ruling 1 hand-off — do NOT zeroize below.
        }
        recoveryKeyDisplay = adopted.recoveryKeyDisplay;
      }

      // Generation-identity field (DD3 / the flight's evidence-cheapening item):
      // timestamp + crypto-random nonce, so two consecutive restores of the same
      // bundle are distinguishable.
      const generation = { completedAt: this._now(), nonce: crypto.randomBytes(16).toString('hex') };
      return {
        fresh,
        results,
        generation,
        ...(recoveryKeyDisplay !== undefined ? { recoveryKeyDisplay } : {})
      };
    } finally {
      // The bundle mrk: zeroized here UNLESS the adopt core installed it (ruling 1's
      // hand-off nulls the local binding on that signal, above).
      if (mrk) mrk.fill(0);
    }
  }

  /**
   * Preview a restore bundle's SECRET step (M18 F3 Leg 3 / DD2 ruling 2, cycle-1
   * mechanism correction): verify the bundle secret unwraps the mrk (auth), then
   * return NON-SECRET per-vault labels for the page's mapping step — never any key
   * material, never a decrypted item.
   *
   * Item counts cannot come from ciphertext shape (`doc.items` is one AES-GCM blob) —
   * this is decrypt-then-discard, the `listItemsMeta` precedent (fully decrypt +
   * project a non-secret whitelist). Runs `validateImportedItems` on EVERY bundle
   * vault's decrypted plaintext (cycle-2 HIGH): a malformed-plaintext vault must fail
   * HERE, at the secret step where nothing is written — never mid-commit after
   * earlier vaults already landed. jarMeta (present for jar vaults only) is decrypted
   * via `decryptJarMeta` for display; a tamper there fails loudly (that helper's own
   * contract), never a silent unnamed jar.
   *
   * Gated via `_enterGatedOp` — NOT for `exportVault`'s local-read rationale (preview
   * touches no local vault state) but so an operator cannot START a multi-step import
   * while a compromise rotation is rewriting the profile. NOT single-flight-guarded
   * (that guard belongs to `restoreProfile`, which writes) — a preview never mutates.
   * @param {any} bundle
   * @param {{ secret: Buffer, secretKind?: 'master'|'recovery' }} opts
   * @returns {Promise<{ labels: Array<{ sourceId: string, jarMeta: { name: string, color: string } | null, itemCount: number }> }>}
   */
  async previewRestoreBundle(bundle, opts = /** @type {any} */ ({})) {
    const releaseOp = this._enterGatedOp();
    try {
      return await this._previewRestoreBundle(bundle, opts);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {any} bundle
   * @param {{ secret: Buffer, secretKind?: 'master'|'recovery' }} opts
   * @returns {ReturnType<VaultStore['previewRestoreBundle']>}
   */
  async _previewRestoreBundle(bundle, opts) {
    const { secret, secretKind } = opts;
    const normalized = normalizeRestoreBundle(bundle);
    const managerVersion = validateBundleEnvelope(normalized);
    if (!Buffer.isBuffer(secret)) {
      throw new VaultStateError('vault-store: preview secret must be a Buffer');
    }
    const kind = secretKind === 'recovery' ? 'recovery' : 'master';

    // Parse + shape-check every embedded .gfvault doc up front (mirrors _restoreProfile).
    const parsedVaults = normalized.vaults.map((entry) => {
      const doc = vc.parseVault(typeof entry.vault === 'string' ? entry.vault : JSON.stringify(entry.vault));
      const mrkEnv = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
      if (!mrkEnv) {
        throw new vc.VaultFormatError(`vault-store: bundle vault "${entry.sourceId}" missing mrk envelope`);
      }
      return { sourceId: entry.sourceId, jarMeta: entry.jarMeta, doc, mrkEnv };
    });

    // ---- bundle-secret crypto (auth) ----
    let mrk;
    if (kind === 'recovery') {
      const material = vc.parseRecoveryKey(secret.toString('utf8'));
      try {
        mrk = vc.unwrapRecovery(normalized.mrk.recovery, material, { version: managerVersion });
      } finally {
        material.fill(0); // zeroize the transient recovery material (mirrors restoreProfile).
      }
    } else {
      mrk = await vc.unwrapMaster(normalized.mrk.master, secret, { version: managerVersion, params: normalized.kdf });
    }

    try {
      const labels = [];
      for (const { sourceId, jarMeta, doc, mrkEnv } of parsedVaults) {
        let vaultKey = null;
        try {
          // Ruling 11's per-iteration discipline: at most one bundle vault key live at a time.
          vaultKey = vc.unwrapVaultKey(mrkEnv, mrk, mrkEnvelopeAad(doc.version));
          const items = validateImportedItems(vc.decryptItems(doc.items, vaultKey));
          labels.push({
            sourceId,
            jarMeta: jarMeta !== undefined ? decryptJarMeta(mrk, sourceId, jarMeta) : null,
            itemCount: items.length
          });
          // The decrypted item objects themselves are dropped by scope here (JS strings, not
          // zeroizable — the accepted listItemsMeta posture; ruling 2's "decrypt-then-discard").
        } finally {
          if (vaultKey) vaultKey.fill(0);
        }
      }
      return { labels };
    } finally {
      // Preview never installs anything — the bundle mrk is ALWAYS zeroized here (unlike
      // restoreProfile's finally, which honors the adopt hand-off).
      mrk.fill(0);
    }
  }

  // -------------------------------------------------------------------------
  // Vault-key access (unwrap from the mrk envelope, cache in memory)
  // -------------------------------------------------------------------------

  /**
   * Resolve a save/list/mint target to a vault id, enforcing the burner/unknown
   * gate. The literal `'global'` names the global vault (always allowed); any
   * other id must be a persistent jar in listJars() — the positive-allowlist
   * idiom (burner + unknown ids excluded structurally).
   *
   * DEFENSE-IN-DEPTH (M12 F1 review): the jar allowlist EXPLICITLY excludes any
   * listJars() entry whose id === GLOBAL_ID. jars.js now reserves `global`
   * (isReservedId) so a container can no longer mint that id, but a store written
   * BEFORE that fix could still surface a `{ id: 'global' }` jar — which must never
   * become a second, jar-scoped route to the manager-wide global vault. The `global`
   * vault is reachable ONLY through the sentinel above (the legitimate manager path),
   * never by matching the jar allowlist. This exclusion also keeps the invariant if
   * the sentinel is ever refactored away.
   * @param {string} target
   * @returns {string}
   */
  _resolveTarget(target) {
    if (target === GLOBAL_ID) return GLOBAL_ID;
    if (typeof target !== 'string' || !this.listJars().some((j) => j.id === target && j.id !== GLOBAL_ID)) {
      throw new VaultStateError(`vault-store: unknown or non-persistent jar "${target}"`);
    }
    return target;
  }

  /**
   * PUBLIC allowlist resolution for a vault target — the exact `_resolveTarget`
   * check surfaced for handlers that must validate a caller-supplied target BEFORE
   * calling a raw-`vaultId` store method. `revokeAccessKey` (unlike mint/list) takes
   * a raw vaultId; the internal-IPC revoke handler resolves the target through this
   * first (M12 F3 Leg 5), so a burner/unknown/traversal target is rejected with no
   * raw-path construction — the same main-side authority mint/list get internally.
   * Returns the validated vaultId (the target unchanged for a valid one) or throws
   * VaultStateError. Needs no MRK (the allowlist is manager-lock-independent).
   * @param {string} target
   * @returns {string}
   */
  resolveTarget(target) {
    return this._resolveTarget(target);
  }

  /**
   * Delete a jar vault's `.gfvault` file (M12 F4 Leg 6 / flight DD7). Completes the
   * vault lifecycle: a jar DELETE removes its vault, while a jar WIPE spares it.
   * DESTRUCTIVE + IRREVERSIBLE.
   *
   * ENOENT-tolerant: a jar with no vault (the common case — a `.gfvault` is created
   * LAZILY on the first credential save into that jar) is a clean no-op returning
   * `{ deleted: false }`. Any other filesystem error (permissions, races) propagates —
   * `handleRemove` catches it fail-soft. After the unlink, evict + zeroize any cached
   * vault key (the exact `:853`-`:854` idiom) so no key material dangles once the file
   * is gone.
   *
   * There is NO per-vault "manager row" to prune — `manager.json` holds only
   * `{ format, version, kdf, adminPublicKeyB64, mrk }` and vault enumeration is
   * `GLOBAL + jars.list()`, so this touches ONLY the `.gfvault` file.
   *
   * GLOBAL GUARD: refuses `GLOBAL_ID` — a jar delete must NEVER remove the manager-wide
   * global vault. Defensive: a live jar id can never equal `'global'` (jars reserves it
   * via `isReservedId`), but the guard is asserted here FIRST so even a mis-call can
   * never unlink the global vault.
   * @param {string} vaultId  A persistent jar id (never `GLOBAL_ID`).
   * @returns {{ deleted: boolean }}  `deleted: true` iff a file was actually removed.
   */
  deleteVault(vaultId) {
    // GATED (M18 F2 Leg 2 / DD3): reached from jar delete — a racing jar delete
    // could otherwise unlink a journal-named file and have roll-forward
    // resurrect a vault for a jar the registry no longer has. Mutates via
    // unlinkSync (not the sinks) but is fully synchronous, so entry-check +
    // drain suffice. The jar-delete composition is fail-closed on the busy
    // throw ({ok:false, 'vault-delete-failed'}, jar kept — verified at flight
    // design review).
    const releaseOp = this._enterGatedOp();
    try {
      return this._deleteVault(vaultId);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} vaultId
   * @returns {{ deleted: boolean }}
   */
  _deleteVault(vaultId) {
    if (vaultId === GLOBAL_ID) {
      throw new VaultStateError('vault-store: refusing to delete the global vault');
    }
    let deleted = false;
    try {
      fs.unlinkSync(this._vaultPath(vaultId));
      deleted = true;
    } catch (err) {
      // A no-vault jar → ENOENT → clean no-op. Any other error propagates.
      if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
    }
    // Evict + zeroize any cached key (idiom at :853-854) — no dangling key material.
    this.vaultKeys.get(vaultId)?.fill(0);
    this.vaultKeys.delete(vaultId);
    return { deleted };
  }

  /**
   * Does a `.gfvault` file exist for this vault id? (M12 F4 Leg 6.) Lets the renderer
   * decide whether to surface the export-first offer before a jar delete. A pure
   * filesystem probe — needs no MRK, never throws on a locked store, and (unlike
   * `internal-vault-state`, which enumerates every jar regardless of file presence and
   * whose count is locked-ambiguous) answers "does THIS jar have a vault file".
   * @param {string} vaultId
   * @returns {boolean}
   */
  hasVault(vaultId) {
    return fs.existsSync(this._vaultPath(vaultId));
  }

  /**
   * Get a vault key: from the in-memory cache, else unwrap it from the parsed
   * document's `mrk` envelope and cache it.
   * @param {string} vaultId
   * @param {any} doc  the parsed vault document.
   * @returns {Buffer}
   */
  _vaultKeyFromDoc(vaultId, doc) {
    const cached = this.vaultKeys.get(vaultId);
    if (cached) return cached;
    const mrk = this._requireMrk();
    const env = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
    if (!env) {
      throw new vc.VaultFormatError(`vault "${vaultId}": missing mrk envelope`);
    }
    const key = vc.unwrapVaultKey(env, mrk, mrkEnvelopeAad(doc.version));
    this.vaultKeys.set(vaultId, key);
    return key;
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /**
   * Validate + normalize an inbound item (schema owned here). Mints an id when
   * absent and stamps timestamps from the injected clock.
   * @param {any} item
   * @param {number | undefined} existingCreatedAt
   * @returns {VaultItem}
   */
  _normalizeItem(item, existingCreatedAt) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new VaultStateError('vault-store: item must be an object');
    }
    if (!ITEM_TYPES.has(item.type)) {
      throw new VaultStateError(`vault-store: item.type must be one of login|card|note (got "${item.type}")`);
    }
    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : crypto.randomBytes(8).toString('hex');
    const now = this._now();
    return {
      ...item,
      id,
      type: item.type,
      createdAt: existingCreatedAt ?? (typeof item.createdAt === 'number' ? item.createdAt : now),
      updatedAt: now
    };
  }

  /**
   * Save (upsert by id) an item into a vault, lazy-creating the vault on first
   * save. Requires the manager unlocked. Refuses a burner/unknown jar with no
   * file created.
   *
   * FULL-REPLACE CONTRACT (M12 F3 DD3): on update this writes the supplied item
   * WHOLESALE — only `createdAt` is carried over from the existing record; every
   * other field (secret or not) is taken verbatim from `item`. This is correct and
   * lossless for the full-item vault-page editor (which holds every field and lets
   * the user CLEAR one — a blind merge could not). The durable rule for the class
   * is: **partial-update callers must read-merge first** (F2 capture does; verified
   * by vault-capture.test.js). The vault page's masked-untouched secret fields are
   * resolved BEFORE this call by `saveItemPreservingSecrets` — never inside here.
   * @param {string} target  `'global'` or a persistent jar id.
   * @param {any} item
   * @returns {VaultItem}
   */
  saveItem(target, item) {
    // GATED (M18 F2 Leg 2 / DD3). Fully synchronous — entry-check + drain
    // suffice; the counter hold is still released in finally (uniform shape).
    const releaseOp = this._enterGatedOp();
    try {
      return this._saveItem(target, item);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} target
   * @param {any} item
   * @returns {VaultItem}
   */
  _saveItem(target, item) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();

    const doc = this._readVault(vaultId);
    if (doc === null) {
      // Lazy creation — new vault key wrapped under the MRK; no new operator secret.
      const mrk = this._requireMrk();
      const normalized = this._normalizeItem(item, undefined);
      const vaultKey = vc.newVaultKey();
      this._writeVaultForKey(vaultId, vaultKey, mrk, [normalized]);
      this.vaultKeys.set(vaultId, vaultKey);
      return normalized;
    }

    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    const items = /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
    const idx = typeof item?.id === 'string' ? items.findIndex((it) => it.id === item.id) : -1;
    const existingCreatedAt = idx >= 0 ? items[idx].createdAt : undefined;
    const normalized = this._normalizeItem(item, existingCreatedAt);
    if (idx >= 0) items[idx] = normalized;
    else items.push(normalized);

    this._writeVault(vaultId, {
      kdf: doc.kdf,
      envelopes: doc.envelopes,
      items: vc.encryptItems(items, vaultKey)
    });
    return normalized;
  }

  /**
   * List a vault's items (decrypted). Requires the manager unlocked. An
   * uncreated vault lists as empty.
   * @param {string} target
   * @returns {VaultItem[]}
   */
  listItems(target) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) return [];
    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    return /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
  }

  /**
   * All-types METADATA-ONLY list for the vault management page (M12 F3 DD10). Maps
   * each item through `metadataOf` — a POSITIVE WHITELIST that emits only the type's
   * non-secret fields plus `id`/`type`/`hasTotp`, tagged with `vaultId`. NO secret
   * (password / totp / note `body` / card `number`/`cvv` / any `notes`) can appear.
   * Requires the manager unlocked; an uncreated vault lists as empty. Also backs
   * leg-1's deferred item counts.
   * @param {string} target
   * @returns {Array<{ vaultId: string, id: any, type: string, hasTotp: boolean, [k: string]: any }>}
   */
  listItemsMeta(target) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) return [];
    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    const items = /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
    return items.map((it) => ({ vaultId, ...metadataOf(it) }));
  }

  /**
   * Reveal a SINGLE item in full (including its secrets) by id — the DD6 explicit-
   * reveal path. Requires the manager unlocked; exact-scope by id (never the whole
   * vault). Returns null for a missing id or an uncreated vault.
   * @param {string} target
   * @param {string} itemId
   * @returns {VaultItem | null}
   */
  revealItem(target, itemId) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) return null;
    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    const items = /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
    return items.find((it) => it.id === itemId) ?? null;
  }

  /**
   * Delete an item by id (filter out + atomic re-write). Requires the manager
   * unlocked. Returns false (no write) on a missing id or an uncreated vault —
   * never throws for absence.
   * @param {string} target
   * @param {string} itemId
   * @returns {boolean} true if an item was removed.
   */
  deleteItem(target, itemId) {
    // GATED (M18 F2 Leg 2 / DD3). Fully synchronous — see saveItem.
    const releaseOp = this._enterGatedOp();
    try {
      return this._deleteItem(target, itemId);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} target
   * @param {string} itemId
   * @returns {boolean}
   */
  _deleteItem(target, itemId) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) return false;
    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    const items = /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
    const kept = items.filter((it) => it.id !== itemId);
    if (kept.length === items.length) return false;
    this._writeVault(vaultId, {
      kdf: doc.kdf,
      envelopes: doc.envelopes,
      items: vc.encryptItems(kept, vaultKey)
    });
    return true;
  }

  /**
   * Save a full item from the vault-page editor while PRESERVING the secret fields
   * the user never revealed/edited (M12 F3 DD3/DD6). The masked-untouched fields
   * arrive OUT-OF-BAND in `unchangedFields` (never an in-band magic string); their
   * values are pulled from the EXISTING item here (plaintext + schema live in the
   * store, not the IPC handler), then the merged item goes through the unchanged
   * full-replace `saveItem`. A field NOT named in `unchangedFields` is taken
   * verbatim from `item` — including an explicit empty string, so field-clearing
   * still works.
   *
   * Guards: every name in `unchangedFields` must be ∈ `secretFieldsFor(item.type)`
   * (a non-secret or unknown field is rejected — it can never be used to smuggle a
   * non-secret preserve). CREATE-DEFENSE: if there is no existing item (a new id)
   * and `unchangedFields` is non-empty → throw; a create has nothing to preserve
   * and must never persist a placeholder secret.
   * @param {string} target
   * @param {any} item
   * @param {string[]} [unchangedFields]
   * @returns {VaultItem}
   */
  saveItemPreservingSecrets(target, item, unchangedFields = []) {
    // GATED (M18 F2 Leg 2 / DD3). Fully synchronous; the inner `saveItem` call
    // takes a nested (correctly counted) hold of its own.
    const releaseOp = this._enterGatedOp();
    try {
      return this._saveItemPreservingSecrets(target, item, unchangedFields);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} target
   * @param {any} item
   * @param {string[]} unchangedFields
   * @returns {VaultItem}
   */
  _saveItemPreservingSecrets(target, item, unchangedFields) {
    this._requireMrk();
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new VaultStateError('vault-store: item must be an object');
    }
    if (!ITEM_TYPES.has(item.type)) {
      throw new VaultStateError(`vault-store: item.type must be one of login|card|note (got "${item.type}")`);
    }
    const unchanged = Array.isArray(unchangedFields) ? unchangedFields : [];
    const secret = new Set(secretFieldsFor(item.type));
    for (const name of unchanged) {
      if (!secret.has(name)) {
        throw new VaultStateError(`vault-store: "${name}" is not a secret field of ${item.type} — cannot preserve`);
      }
    }

    // Find the existing record (read-merge source). listItems handles MRK/resolve/
    // uncreated-vault ([]); an unknown/burner jar throws VaultStateError here.
    const existing =
      typeof item.id === 'string' && item.id.length > 0
        ? this.listItems(target).find((it) => it.id === item.id)
        : undefined;

    if (!existing) {
      // CREATE-DEFENSE: a new item has no existing secret to preserve.
      if (unchanged.length > 0) {
        throw new VaultStateError('vault-store: cannot preserve secrets on a new item (create-defense)');
      }
      return this.saveItem(target, item);
    }

    const merged = { ...item };
    for (const name of unchanged) {
      merged[name] = existing[name];
    }
    return this.saveItem(target, merged);
  }

  /**
   * Human picker reachability (M12 F2 Leg 3, DD5/DD6; widen: M12 F4 Leg 4, DD5).
   * Given a persistent jar id and the current tab origin, return the METADATA of the
   * login items reachable for that jar — the GLOBAL vault + that jar only — that MATCH
   * the tab origin, each tagged with its source `vaultId` for badging. Exposes ONLY
   * `{ vaultId, id, title, origin, username, hasTotp, widened }` — NEVER the password /
   * TOTP secret (metadata-only; parallels vault-context.list on the MRK/human side).
   *
   * MATCH MODE (the `{ widen }` option — DEFAULT false, so the whole option object is
   * defaulted and the 2-arg capture-disposition caller never throws): with `widen:false`
   * the match is EXACT origin, byte-for-byte as before. With `widen:true` a per-item
   * `matchMode:'registrable-domain'` opt-in widens to the eTLD+1 behind the fail-closed
   * `originMatches` matcher; `widened` on the row is true iff the match was a
   * registrable-domain widen (not exact) so the picker can badge it. **Only the picker
   * passes widen:true; capture disposition passes nothing (stays exact) — a subdomain
   * submit must never disposition as an update to an eTLD+1 item.**
   *
   * `[]`-SAFE, never throws (DD9 state-machine guards): returns an EMPTY list when
   * the store is LOCKED (guarded up front — `listItems` would throw VaultLockedError),
   * when `jarId` is null/non-persistent (a burner tab — the caller passes null; a
   * per-target `listItems` on an unknown jar throws VaultStateError and is caught),
   * or when a vault has not been lazily created yet (`listItems` returns `[]`). The
   * read is per-open (no caching) — a capture-added item shows on the next pick.
   * @param {string | null} jarId  the tab's persistent jar id, or null (burner/none).
   * @param {string} origin  the tab origin to match.
   * @param {{ widen?: boolean }} [opts]  widen to registrable-domain for opt-in items (picker only).
   * @returns {Array<{ vaultId: string, id: string, title: string|null, origin: string|null, username: string|null, hasTotp: boolean, widened: boolean }>}
   */
  reachableLoginItems(jarId, origin, { widen = false } = {}) {
    if (!this.isUnlocked()) return []; // locked → no MRK → nothing reachable.
    // A null / falsy jarId is a BURNER / non-persistent tab (DD9): the global vault
    // is NOT reachable via the picker for a burner tab — return [] rather than leak
    // global metadata. (The vaultReachableItems caller already guards this; refusing
    // here too keeps the store method itself honoring "[] on burner", defense in
    // depth — a burner must never reach global.)
    if (!jarId) return [];
    // GLOBAL first, then the tab's jar (dedup a literal-'global' jarId so global is
    // never double-visited).
    const targets = jarId !== GLOBAL_ID ? [GLOBAL_ID, jarId] : [GLOBAL_ID];
    const out = [];
    for (const id of targets) {
      let items;
      try {
        items = this.listItems(id);
      } catch {
        continue; // non-persistent/unknown jar (VaultStateError) or a lock race — skip.
      }
      for (const item of /** @type {any[]} */ (items)) {
        if (item && item.type === 'login' && originMatches(item, origin, { widen })) {
          out.push({
            vaultId: id,
            id: item.id,
            title: item.title ?? null,
            origin: item.origin ?? null,
            username: item.username ?? null,
            hasTotp: Boolean(item.totp),
            // A match whose stored origin differs from the tab origin can only be a
            // registrable-domain widen (an exact match requires equality). false for
            // every exact match and for every row when widen is false.
            widened: item.origin !== origin
          });
        }
      }
    }
    return out;
  }

  /**
   * The reachable payment-CARD items for a tab's jar (issue #152) — the card twin of
   * `reachableLoginItems`, with ONE deliberate difference: there is **no origin
   * filter**, and the method takes no origin at all.
   *
   * WHY NO ORIGIN GATE (issue #152 design decision): a login belongs to the site that
   * issued it, so an origin match is the natural authorization. A payment card belongs
   * to the OPERATOR and is legitimately used at any merchant — gating it on a stored
   * origin would make cards unfillable at every shop the operator hasn't already
   * recorded, i.e. all of them. The authorization that remains is the same set the
   * login path relies on for everything except the origin: the vault must be UNLOCKED,
   * the tab must resolve a PERSISTENT jar (never a burner), only the tab's own jar
   * vault + the global vault are visited, the fill is TOP-FRAME only, and nothing is
   * dispatched without an explicit per-fill operator selection in the chrome-owned
   * picker. This mirrors how dedicated password managers treat cards.
   *
   * METADATA ONLY — the row carries the card's non-secret fields per
   * `vault-item-schema.js` (title / cardholder / brand / last4). The PAN, CVV and
   * expiry are secret and NEVER leave main; they are resolved only inside `fillHuman`.
   *
   * `[]`-SAFE, never throws — same guards as the login twin.
   * @param {string | null} jarId  the tab's persistent jar id, or null (burner/none).
   * @returns {Array<{ vaultId: string, id: string, title: string|null, cardholder: string|null, brand: string|null, last4: string|null }>}
   */
  reachableCardItems(jarId) {
    if (!this.isUnlocked()) return []; // locked → no MRK → nothing reachable.
    // A burner / non-persistent tab reaches NOTHING, global included — the same
    // refusal the login twin makes, for the same reason (no metadata leak to a
    // non-persistent tab).
    if (!jarId) return [];
    const targets = jarId !== GLOBAL_ID ? [GLOBAL_ID, jarId] : [GLOBAL_ID];
    const out = [];
    for (const id of targets) {
      let items;
      try {
        items = this.listItems(id);
      } catch {
        continue; // non-persistent/unknown jar (VaultStateError) or a lock race — skip.
      }
      for (const item of /** @type {any[]} */ (items)) {
        if (item && item.type === 'card') {
          out.push({
            vaultId: id,
            id: item.id,
            title: item.title ?? null,
            cardholder: item.cardholder ?? null,
            brand: item.brand ?? null,
            last4: item.last4 ?? null
          });
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Access keys (per-jar automation grants — DD6 step-up)
  // -------------------------------------------------------------------------

  /**
   * List a vault's access-key grants by keyId ONLY — NEVER a secret (keyIds are the
   * plaintext envelope fingerprints, safe to surface; an access secret exists only at
   * mint time). MRK-gated as a POLICY choice (uniform locked-routing for the
   * management page — not a crypto necessity), then allowlist-resolved via
   * `_resolveTarget` (excludes burner/unknown targets, no raw-target path
   * construction), read, and filtered to the non-`mrk` (i.e. `access`) envelopes via
   * the sentinel idiom (`TYPE_ACCESS` is not exported from vault-crypto). An uncreated
   * vault lists as empty.
   * @param {string} target
   * @returns {Array<{ keyId: string }>}
   */
  listAccessKeys(target) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) return [];
    return vc
      .listEnvelopeKeyIds(doc)
      .filter((keyId) => keyId !== 'mrk')
      .map((keyId) => ({ keyId }));
  }

  /**
   * Mint a per-jar access key. STEP-UP (DD6): refuses unless the supplied master
   * password still unwraps the MRK's master envelope — even while already
   * unlocked. On success adds an `access` envelope wrapping THAT vault's key and
   * returns the secret + keyId exactly once.
   * @param {string} target
   * @param {{ masterPassword: string }} args
   * @returns {Promise<{ secret: string, keyId: string }>}
   */
  async mintAccessKey(target, args = /** @type {any} */ ({})) {
    // GATED (M18 F2 Leg 2 / DD3): mint awaits scrypt between its entry check
    // and its write — DD3's named mid-await hazard. It holds the counter for
    // its full duration (released in finally, auth failures included) and its
    // `_writeVault` hits the second wall if the gate rose during the derive.
    const releaseOp = this._enterGatedOp();
    try {
      return await this._mintAccessKey(target, args);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} target
   * @param {{ masterPassword: string }} args
   * @returns {Promise<{ secret: string, keyId: string }>}
   */
  async _mintAccessKey(target, { masterPassword } = /** @type {any} */ ({})) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();

    // Step-up re-auth: re-unwrap the master envelope with the supplied password.
    // A wrong password throws (VaultAuthError) and mints nothing.
    const manager = this._readManager();
    const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, {
      version: manager.version, // the document's stated version (DD1) — never the constant.
      params: manager.kdf
    });
    stepUpMrk.fill(0); // zeroize the transient step-up buffer after the compare.

    const doc = this._readVault(vaultId);
    if (doc === null) {
      throw new VaultStateError(`vault-store: no vault for "${vaultId}" — save an item first`);
    }
    const vaultKey = this._vaultKeyFromDoc(vaultId, doc);
    const { secret, keyId } = vc.generateAccessKey();
    const accessEnv = vc.wrapAccess(vaultKey, secret, keyId);
    this._writeVault(vaultId, {
      kdf: doc.kdf,
      envelopes: [...doc.envelopes, accessEnv],
      items: doc.items
    });
    return { secret, keyId };
  }

  /**
   * Open a vault with an access-key secret ALONE (the automation path — no MRK,
   * no manager unlock). A bare secret does not name its envelope, so iterate the
   * vault's non-mrk (`access`) envelopes calling unwrapAccess, catching
   * VaultAuthError and continuing, until one succeeds or all fail.
   * @param {string} vaultId
   * @param {string} secret
   * @returns {Buffer} the unwrapped vault key.
   */
  unlockVaultWithAccessKey(vaultId, secret) {
    return this.openVaultWithAccessKey(vaultId, secret).key;
  }

  /**
   * Like `unlockVaultWithAccessKey` but ALSO returns the plaintext `keyId` of the
   * `access` envelope that opened the vault (PR#112 finding 2). A live automation
   * session records this keyId as its GRANT and re-checks per operation that the
   * envelope still exists — so revoking THAT access key (envelope deletion) drops the
   * session's key immediately, not only at teardown/idle. keyIds are non-secret
   * envelope fingerprints (already surfaced by `listAccessKeys`).
   * @param {string} vaultId
   * @param {string} secret
   * @returns {{ key: Buffer, keyId: string }}
   */
  openVaultWithAccessKey(vaultId, secret) {
    const doc = this._readVault(vaultId);
    if (doc === null) {
      throw new VaultStateError(`vault-store: no vault for "${vaultId}"`);
    }
    for (const env of doc.envelopes) {
      if (env.keyId === 'mrk') continue; // access key never touches the MRK envelope.
      try {
        const key = vc.unwrapAccess(env, secret);
        return { key, keyId: env.keyId };
      } catch (err) {
        if (err instanceof vc.VaultAuthError) continue;
        throw err;
      }
    }
    throw new vc.VaultAuthError(`access key does not open vault "${vaultId}"`);
  }

  /**
   * Does a specific `access` envelope still exist on a vault? (PR#112 finding 2.) The
   * per-op revalidation probe for a live automation session: a revoked access key had
   * its envelope removed, so this returns false and the session drops its cached key.
   * A no-vault jar (deleted) → false. Never decrypts — a cheap envelope-presence read.
   * @param {string} vaultId
   * @param {string} keyId
   * @returns {boolean}
   */
  accessEnvelopeExists(vaultId, keyId) {
    const doc = this._readVault(vaultId);
    if (doc === null) return false;
    return doc.envelopes.some((/** @type {any} */ e) => e.keyId === keyId && e.keyId !== 'mrk');
  }

  /**
   * The manager's current admin PUBLIC key (base64). (PR#112 finding 2.) A live ADMIN
   * automation session captures this at unlock and re-checks it per op — a `rotateAdminKey`
   * overwrites it, so a mismatch means the admin key was rotated and the session must drop
   * its keys (the rotated-out admin private key can no longer open the vaults). Reads
   * manager.json fresh; throws (→ caller drops the session) if the manager is gone.
   * NULL — coerced, never `undefined` — on a no-admin v2 manager (M18 F2 Leg 1 / DD1);
   * vault-context.revalidate's strict-equality grant check fail-closes against it.
   * @returns {string | null}
   */
  adminPublicKey() {
    return this._readManager().adminPublicKeyB64 ?? null;
  }

  /**
   * Open EVERY existing vault key with the admin X25519 private key — the
   * automation ADMIN unlock path (Mission 12, Flight 1, Leg 3). STATELESS: opens
   * the MRK from `manager.json` via the admin seal, then unwraps each present
   * `.gfvault`'s `mrk` envelope into a FRESH Buffer, zeroizes the transient local
   * MRK, and returns a `Map<vaultId, Buffer>`. Touches NEITHER `this.mrk` NOR
   * `this.vaultKeys` and uses neither `_installMrk` nor the `_vaultKeyFromDoc`
   * cache — no singleton mutation, so an MCP session that calls this never
   * changes the store's human lock state. The caller owns the returned buffers'
   * lifetime (an MCP session ctx zeroizes them on teardown / idle).
   *
   * Lazily-absent jar vaults (no `.gfvault` on disk yet) are skipped. Admin's
   * seal-to-future property holds: a jar vault created AFTER setup is still opened
   * (the MRK unwraps its `mrk` envelope like any other).
   * @param {string} adminPrivateKeyB64  the X25519 admin private key, base64 (PKCS8-DER).
   * @returns {Map<string, Buffer>}  vaultId → fresh vault-key Buffer.
   */
  openAllWithAdminKey(adminPrivateKeyB64) {
    const manager = this._readManager();
    if (manager.mrk.admin === undefined) {
      // M18 F2 Leg 1 / DD1: deliberate absence is a named, discriminable state —
      // the exact message is a ruled contract (mirrors unlockWithAdmin).
      throw new VaultStateError('no admin key provisioned');
    }
    let privateKey;
    try {
      privateKey = vc.importAdminPrivateKey(adminPrivateKeyB64);
    } catch (err) {
      throw new vc.VaultFormatError(`admin private key: unreadable (${/** @type {Error} */ (err).message})`);
    }
    const mrk = vc.openAdminSeal(manager.mrk.admin, privateKey, { version: manager.version });
    /** @type {Map<string, Buffer>} */
    const out = new Map();
    try {
      // GLOBAL_ID is enumerated FIRST (the true manager-wide vault); the jar list
      // then EXCLUDES any entry whose id === GLOBAL_ID (defense-in-depth, M12 F1
      // review). A pre-existing `{ id: 'global' }` jar (mintable only before jars.js
      // reserved the id) must not double-visit global.gfvault or mis-map the `global`
      // Map slot onto a jar — the slot is always the manager-wide global vault.
      const ids = [
        GLOBAL_ID,
        ...this.listJars()
          .map((j) => j.id)
          .filter((id) => id !== GLOBAL_ID)
      ];
      for (const vaultId of ids) {
        const doc = this._readVault(vaultId);
        if (doc === null) continue; // lazily-absent jar vault — skip
        const env = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
        if (!env) {
          throw new vc.VaultFormatError(`vault "${vaultId}": missing mrk envelope`);
        }
        out.set(vaultId, vc.unwrapVaultKey(env, mrk, mrkEnvelopeAad(doc.version)));
      }
    } finally {
      mrk.fill(0); // zeroize the transient MRK — the returned vault keys are what live on.
    }
    return out;
  }

  /**
   * Read + decrypt a vault's items with a SUPPLIED vault key — stateless, no MRK,
   * no cache, no singleton (Mission 12, Flight 1, Leg 3). This is the automation
   * session read path: `vault-context` holds its own session-scoped key Buffers
   * (from `unlockVaultWithAccessKey` / `openAllWithAdminKey`) and reads item
   * metadata through this, WITHOUT ever installing an MRK. The human `listItems`
   * path (which requires the MRK) is untouched. An absent vault reads as empty.
   * @param {string} vaultId
   * @param {Buffer} vaultKey
   * @returns {VaultItem[]}
   */
  readVaultItems(vaultId, vaultKey) {
    const doc = this._readVault(vaultId);
    if (doc === null) return [];
    return /** @type {VaultItem[]} */ (vc.decryptItems(doc.items, vaultKey));
  }

  /**
   * Revoke an access key by keyId (immediate effect). Removes the matching
   * `access` envelope and persists; never removes the `mrk` envelope.
   * @param {string} vaultId
   * @param {string} keyId
   * @returns {boolean} true if an envelope was removed.
   */
  revokeAccessKey(vaultId, keyId) {
    // GATED (M18 F2 Leg 2 / DD3). Fully synchronous — see saveItem.
    const releaseOp = this._enterGatedOp();
    try {
      return this._revokeAccessKey(vaultId, keyId);
    } finally {
      releaseOp();
    }
  }

  /**
   * @param {string} vaultId
   * @param {string} keyId
   * @returns {boolean}
   */
  _revokeAccessKey(vaultId, keyId) {
    this._requireMrk();
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) {
      throw new VaultStateError(`vault-store: no vault for "${vaultId}"`);
    }
    const kept = doc.envelopes.filter((/** @type {any} */ e) => !(e.keyId === keyId && e.keyId !== 'mrk'));
    const removed = kept.length !== doc.envelopes.length;
    if (removed) {
      this._writeVault(vaultId, { kdf: doc.kdf, envelopes: kept, items: doc.items });
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// load(userDataPath, deps) — construct the store. Reading manager.json (if
// present) validates it loudly; unlock is a separate, explicit step.
// ---------------------------------------------------------------------------

/**
 * @param {string} userDataPath
 * @param {VaultStoreDeps} [deps]
 * @returns {VaultStore}
 */
function load(userDataPath, deps = {}) {
  return new VaultStore(userDataPath, deps);
}

module.exports = {
  load,
  VaultStore,
  // Re-exported (M12 F4 Leg 1) so callers/tests reference the portable bundle format
  // id + version without re-typing the literals.
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  // The whole-profile, multi-vault bundle version (M18 F3 Leg 2 / DD1 ruling 2).
  BUNDLE_VERSION_V2,
  // Re-exported (M12 F3 DD8) so the reserved-id cross-module test can assert this
  // store's global sentinel ∈ jars' reserved ids without re-typing the literal.
  GLOBAL_ID,
  VaultLockedError,
  VaultStateError,
  // M18 F2 Leg 2 (DD3): a compromise rotation holds write exclusivity — gated
  // ops refuse with this while the gate is up. Transient; callers surface
  // "busy, retry", never an auth/format failure.
  VaultBusyError,
  // M18 F2 Leg 3 (R7): the compromise rotation's new-password-equals-old
  // refusal — discriminable from a wrong-credential VaultAuthError so leg 4's
  // sheet maps it to the ruled inline copy.
  VaultPasswordReuseError,
  // The coded import-collision (M12 F5 HAT tail) — re-exported so main/tests distinguish an
  // "already exists" refusal from a wrong-secret / bad-target failure.
  VaultCollisionError,
  // Re-exported for callers/tests that catch the crypto-layer errors.
  VaultAuthError: vc.VaultAuthError,
  VaultFormatError: vc.VaultFormatError,
  // Import hardening validators (PR#112 finding 4) — exported so the bounded KDF
  // schema and the decrypted-item-array guard are unit-tested directly.
  validateImportedKdf,
  validateImportedItems,
  // M18 F3 Leg 2 (DD1 ruling 2): the bundle v2 jarMeta decrypt helper — leg 3's
  // pre-mapping label step consumes this directly; unit-tested here (including
  // the tamper → loud auth/format error case).
  decryptJarMeta
};
