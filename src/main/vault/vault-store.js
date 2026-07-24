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
const MANAGER_FORMAT = 'gfmanager';
const MANAGER_VERSION = 1;

// The portable export-bundle format id + version (M12 F4 Leg 1 / DD1 — Option A).
// A bundle is `{ format, version, sourceVaultId, kdf, mrk:{master,recovery,admin},
// adminPublicKeyB64, vault:<.gfvault doc> }` — ALL ciphertext + the KDF params + the
// admin PUBLIC key; NO plaintext secret, NO password needed to build it. vault-store
// OWNS this format independently of the gfmanager / gfvault version spaces.
const BUNDLE_FORMAT = 'gfvault-bundle';
const BUNDLE_VERSION = 1;

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

/**
 * A secret argument is valid when it is a NON-EMPTY string OR a NON-EMPTY Buffer — the
 * `setup` guard (`:401-405`) generalized for the M12 F4 Leg 2 rotation ops, whose master
 * passwords arrive from the chrome-owned sheet as zeroizable Buffers (scrypt /
 * deriveMasterKey accept either, exactly as the unlock path already does).
 * @param {unknown} secret
 * @returns {boolean}
 */
function isNonEmptySecret(secret) {
  return (typeof secret === 'string' && secret.length > 0)
    || (Buffer.isBuffer(secret) && secret.length > 0);
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

    // Unlock state — held ONLY in memory as Buffers.
    /** @type {Buffer | null} */
    this.mrk = null;
    /** @type {Map<string, Buffer>} */
    this.vaultKeys = new Map();
    /** @type {any} */
    this._timer = null;

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
      throw new vc.VaultFormatError(
        `manager.json: invalid JSON (${/** @type {Error} */ (err).message})`
      );
    }
    if (!doc || typeof doc !== 'object') {
      throw new vc.VaultFormatError('manager.json: document is not an object');
    }
    if (doc.format !== MANAGER_FORMAT) {
      throw new vc.VaultFormatError(`manager.json: unknown format "${doc.format}"`);
    }
    if (doc.version !== MANAGER_VERSION) {
      throw new vc.VaultFormatError(`manager.json: unsupported version "${doc.version}"`);
    }
    if (!doc.kdf || typeof doc.kdf !== 'object') {
      throw new vc.VaultFormatError('manager.json: missing kdf');
    }
    if (typeof doc.adminPublicKeyB64 !== 'string') {
      throw new vc.VaultFormatError('manager.json: missing adminPublicKeyB64');
    }
    if (!doc.mrk || typeof doc.mrk !== 'object') {
      throw new vc.VaultFormatError('manager.json: missing mrk envelope set');
    }
    for (const slot of ['master', 'recovery', 'admin']) {
      const env = doc.mrk[slot];
      if (!env || typeof env !== 'object'
        || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.tag !== 'string') {
        throw new vc.VaultFormatError(`manager.json: malformed mrk.${slot} envelope`);
      }
    }
    return doc;
  }

  /**
   * @param {any} manager
   */
  _writeManager(manager) {
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
    this._ensureVaultsDir();
    const json = vc.serializeVault({
      vaultId,
      kdf: parts.kdf,
      envelopes: parts.envelopes,
      items: parts.items,
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
      this.lockNow();
    }, ms);
    // Don't let a real idle timer keep the process alive (headless / tests).
    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
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
    const result = this._managerLock.then(() => fn(), () => fn());
    // Advance the chain on both outcomes; swallow here so one failed op never poisons
    // the lock for the next (the caller still sees `result`'s rejection).
    this._managerLock = result.then(() => {}, () => {});
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
      throw new VaultLockedError(
        'vault-store: the manager was locked or re-keyed during the operation — retry'
      );
    }
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
    // vault-crypto's `.gfvault` VERSION (M12 F1 review). Both are 1 today, but the
    // two version spaces are OWNED separately — passing MANAGER_VERSION explicitly
    // keeps the mrk envelopes bound to the manager format's version, so a future
    // gfmanager bump (independent of the gfvault bump) does not silently relabel
    // these envelopes' AAD. The matching unwrap sites (unlock / unlockWithRecovery /
    // unlockWithAdmin / mintAccessKey step-up / openAllWithAdminKey) pass the SAME
    // MANAGER_VERSION so GCM auth still matches.
    const masterEnv = await vc.wrapMaster(mrk, masterPassword, { version: MANAGER_VERSION, params });
    const recoveryEnv = vc.wrapRecovery(mrk, recovery.material, { version: MANAGER_VERSION });
    const adminEnv = vc.sealToAdmin(mrk, admin.publicKey, { version: MANAGER_VERSION });

    const manager = {
      format: MANAGER_FORMAT,
      version: MANAGER_VERSION,
      kdf: params,
      adminPublicKeyB64: admin.publicKeyB64,
      mrk: { master: masterEnv, recovery: recoveryEnv, admin: adminEnv },
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
      ...vc.wrapVaultKey(vaultKey, mrk, mrkEnvelopeAad(vc.VERSION)),
    };
    this._writeVault(vaultId, {
      envelopes: [mrkEnv],
      items: vc.encryptItems(items, vaultKey),
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
    const mrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, { version: MANAGER_VERSION, params: manager.kdf });
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
      mrk = vc.unwrapRecovery(manager.mrk.recovery, material, { version: MANAGER_VERSION });
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
    let privateKey;
    try {
      privateKey = vc.importAdminPrivateKey(adminPrivateKeyB64);
    } catch (err) {
      throw new vc.VaultFormatError(
        `admin private key: unreadable (${/** @type {Error} */ (err).message})`
      );
    }
    const mrk = vc.openAdminSeal(manager.mrk.admin, privateKey, { version: MANAGER_VERSION });
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
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, oldMasterPassword, { version: MANAGER_VERSION, params: manager.kdf });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      this._assertMrkGeneration(gen); // locked/re-keyed during the step-up derive → refuse before using mrk.
      const newMasterEnv = await vc.wrapMaster(mrk, newMasterPassword, { version: MANAGER_VERSION, params: manager.kdf });
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
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, { version: MANAGER_VERSION, params: manager.kdf });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      // finding 3: refuse if a lockNow fired during the derive — else wrapRecovery below
      // would seal a zeroized MRK into the recovery slot (the exact reproduced defect).
      this._assertMrkGeneration(gen);
      const rec = vc.generateRecoveryKey();
      manager.mrk.recovery = vc.wrapRecovery(mrk, rec.material, { version: MANAGER_VERSION });
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
      const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, { version: MANAGER_VERSION, params: manager.kdf });
      stepUpMrk.fill(0); // zeroize the transient step-up buffer after the re-unwrap.
      this._assertMrkGeneration(gen); // finding 3: never seal a zeroized/replaced MRK to the new admin key.
      const admin = vc.generateAdminKeypair();
      manager.mrk.admin = vc.sealToAdmin(mrk, admin.publicKey, { version: MANAGER_VERSION });
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
        mrk = vc.unwrapRecovery(manager.mrk.recovery, material, { version: MANAGER_VERSION });
      } finally {
        material.fill(0);
      }
      this._installMrk(mrk); // the user ends UNLOCKED (they recovered); fires onUnlock — bumps the generation.
      const gen = this._mrkGen; // capture AFTER install so a lockNow during the wrap below is caught.
      // Rewrap the master envelope under the new password — the recovery proof authenticated it.
      const newMasterEnv = await vc.wrapMaster(mrk, newMasterPassword, { version: MANAGER_VERSION, params: manager.kdf });
      this._assertMrkGeneration(gen); // finding 3: refuse if locked/re-keyed mid-derive.
      manager.mrk.master = newMasterEnv;
      this._writeManager(manager);
      this._touch();
    });
  }

  // -------------------------------------------------------------------------
  // Portable export / import (M12 F4 Leg 1 / DD1 — Option A, no network egress)
  // -------------------------------------------------------------------------

  /**
   * Build a self-contained, portable export bundle for one vault (flight DD1 —
   * Option A). Requires the manager UNLOCKED (POLICY, not a crypto necessity — every
   * input is already on disk); takes NO password (satisfies mission.md:150 "encrypted
   * export not re-prompted"). The bundle carries the manager's ALL THREE mrk envelopes
   * (`master`, `recovery`, `admin` — `_readManager` structurally requires all three, so
   * the fresh-profile adopt must have all three or the adopted profile wedges at boot;
   * `mrk.admin` is ciphertext sealed to the pubkey, no plaintext, preserving admin
   * portability), the KDF params, the admin PUBLIC key, and the target `.gfvault`
   * document (its `mrk` envelope + item ciphertext). EVERYTHING is ciphertext — no
   * plaintext secret ever enters the bundle. NO write.
   * @param {string} target  `'global'` or a persistent jar id.
   * @returns {{ format: string, version: number, sourceVaultId: string, kdf: any,
   *   mrk: { master: any, recovery: any, admin: any }, adminPublicKeyB64: string, vault: any }}
   */
  exportVault(target) {
    this._requireMrk(); // POLICY: export is an unlock-window op (VaultLockedError → catchLocked).
    const sourceVaultId = this._resolveTarget(target);
    const m = this._readManager(); // requires format+version+kdf+adminPublicKeyB64+all three mrk slots.
    const vaultDoc = this._readVault(sourceVaultId);
    if (vaultDoc === null) {
      throw new VaultStateError(`vault-store: no vault for "${sourceVaultId}" — nothing to export`);
    }
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      sourceVaultId,
      kdf: m.kdf,
      // All THREE envelopes (review [HIGH]) — ciphertext only.
      mrk: { master: m.mrk.master, recovery: m.mrk.recovery, admin: m.mrk.admin },
      adminPublicKeyB64: m.adminPublicKeyB64,
      vault: vaultDoc,
    };
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
   * FRESH profile (`!isSetUp()`): ADOPT the bundle's manager — write the vault file FIRST
   * (to GLOBAL_ID, the only target resolvable on a jar-less fresh profile — review [MED]:
   * vault-before-manager so a failure never flips isSetUp() true without a vault), then
   * `manager.json` from the bundle (all three mrk slots + kdf + adminPublicKeyB64), then
   * `_installMrk` (leaves the profile UNLOCKED, fires onUnlock — analogous to setup). The
   * source master password / recovery key unlock this profile on restart. The installed
   * MRK is RETAINED (never zeroized).
   *
   * EXISTING profile (set up + unlocked): re-key the (source) vault key under the
   * DESTINATION MRK (`this.mrk`) at the allowlist-resolved destination target; refuse a
   * collision unless `overwrite`; evict the destination's cached key (a stale cached key
   * GCM-fails against the new ciphertext); zeroize the transient bundle MRK + vault key.
   * @param {any} bundle
   * @param {{ destinationTarget?: string, secret: Buffer, secretKind?: 'master'|'recovery', overwrite?: boolean }} opts
   * @returns {Promise<{ imported: true, fresh: boolean, vaultId: string }>}
   */
  async importVault(bundle, opts = /** @type {any} */ ({})) {
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
    if (!bundle.mrk || typeof bundle.mrk !== 'object') {
      throw new vc.VaultFormatError('vault-store: bundle missing mrk envelope set');
    }
    for (const slot of ['master', 'recovery', 'admin']) {
      const env = bundle.mrk[slot];
      if (!env || typeof env !== 'object'
        || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.tag !== 'string') {
        throw new vc.VaultFormatError(`vault-store: malformed bundle mrk.${slot} envelope`);
      }
    }
    if (typeof bundle.adminPublicKeyB64 !== 'string') {
      throw new vc.VaultFormatError('vault-store: bundle missing adminPublicKeyB64');
    }
    // Bounded scrypt-param schema (finding 4): reject absent fields (they silently
    // collapse to Node's weak scrypt defaults) AND resource-exhausting values —
    // BEFORE bundle.kdf is used to derive the unwrap key or persisted on adopt.
    validateImportedKdf(bundle.kdf);
    if (!Buffer.isBuffer(secret)) {
      throw new VaultStateError('vault-store: import secret must be a Buffer');
    }
    const kind = secretKind === 'recovery' ? 'recovery' : 'master';

    // Parse the embedded `.gfvault` doc loudly (a tampered/malformed vault → VaultFormatError).
    // The bundle round-trips through JSON on disk, so `bundle.vault` arrives as a parsed
    // OBJECT; re-serialize for parseVault (it takes a string/Buffer) to get the same strict
    // validation the load path uses. Tolerates a raw string too.
    const vaultDoc = vc.parseVault(
      typeof bundle.vault === 'string' ? bundle.vault : JSON.stringify(bundle.vault)
    );
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
        mrk = vc.unwrapRecovery(bundle.mrk.recovery, material, { version: MANAGER_VERSION });
      } finally {
        material.fill(0); // zeroize the transient recovery material (mirrors unlockWithRecovery).
      }
    } else {
      mrk = await vc.unwrapMaster(bundle.mrk.master, secret, { version: MANAGER_VERSION, params: bundle.kdf });
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
        // target resolvable on a jar-less fresh profile), then manager.json, then install.
        this._writeVaultForKey(GLOBAL_ID, vaultKey, mrk, items);
        this._writeManager({
          format: MANAGER_FORMAT,
          version: MANAGER_VERSION,
          kdf: bundle.kdf,
          adminPublicKeyB64: bundle.adminPublicKeyB64,
          mrk: {
            master: bundle.mrk.master,
            recovery: bundle.mrk.recovery,
            admin: bundle.mrk.admin,
          },
        });
        this._installMrk(mrk); // leaves UNLOCKED, fires onUnlock; takes ownership of `mrk`.
        mrk = null; // INSTALLED — do NOT zeroize in the finally.
        return { imported: true, fresh: true, vaultId: GLOBAL_ID };
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
    if (typeof target !== 'string'
      || !this.listJars().some((j) => j.id === target && j.id !== GLOBAL_ID)) {
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
      throw new VaultStateError(
        `vault-store: item.type must be one of login|card|note (got "${item.type}")`
      );
    }
    const id = typeof item.id === 'string' && item.id.length > 0
      ? item.id
      : crypto.randomBytes(8).toString('hex');
    const now = this._now();
    return {
      ...item,
      id,
      type: item.type,
      createdAt: existingCreatedAt ?? (typeof item.createdAt === 'number' ? item.createdAt : now),
      updatedAt: now,
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
    const idx = typeof item?.id === 'string'
      ? items.findIndex((it) => it.id === item.id)
      : -1;
    const existingCreatedAt = idx >= 0 ? items[idx].createdAt : undefined;
    const normalized = this._normalizeItem(item, existingCreatedAt);
    if (idx >= 0) items[idx] = normalized;
    else items.push(normalized);

    this._writeVault(vaultId, {
      kdf: doc.kdf,
      envelopes: doc.envelopes,
      items: vc.encryptItems(items, vaultKey),
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
      items: vc.encryptItems(kept, vaultKey),
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
    this._requireMrk();
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new VaultStateError('vault-store: item must be an object');
    }
    if (!ITEM_TYPES.has(item.type)) {
      throw new VaultStateError(
        `vault-store: item.type must be one of login|card|note (got "${item.type}")`
      );
    }
    const unchanged = Array.isArray(unchangedFields) ? unchangedFields : [];
    const secret = new Set(secretFieldsFor(item.type));
    for (const name of unchanged) {
      if (!secret.has(name)) {
        throw new VaultStateError(
          `vault-store: "${name}" is not a secret field of ${item.type} — cannot preserve`
        );
      }
    }

    // Find the existing record (read-merge source). listItems handles MRK/resolve/
    // uncreated-vault ([]); an unknown/burner jar throws VaultStateError here.
    const existing = typeof item.id === 'string' && item.id.length > 0
      ? this.listItems(target).find((it) => it.id === item.id)
      : undefined;

    if (!existing) {
      // CREATE-DEFENSE: a new item has no existing secret to preserve.
      if (unchanged.length > 0) {
        throw new VaultStateError(
          'vault-store: cannot preserve secrets on a new item (create-defense)'
        );
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
            widened: item.origin !== origin,
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
    return vc.listEnvelopeKeyIds(doc)
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
  async mintAccessKey(target, { masterPassword } = /** @type {any} */ ({})) {
    this._requireMrk();
    const vaultId = this._resolveTarget(target);
    this._touch();

    // Step-up re-auth: re-unwrap the master envelope with the supplied password.
    // A wrong password throws (VaultAuthError) and mints nothing.
    const manager = this._readManager();
    const stepUpMrk = await vc.unwrapMaster(manager.mrk.master, masterPassword, { version: MANAGER_VERSION, params: manager.kdf });
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
      items: doc.items,
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
   * @returns {string}
   */
  adminPublicKey() {
    return this._readManager().adminPublicKeyB64;
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
    let privateKey;
    try {
      privateKey = vc.importAdminPrivateKey(adminPrivateKeyB64);
    } catch (err) {
      throw new vc.VaultFormatError(
        `admin private key: unreadable (${/** @type {Error} */ (err).message})`
      );
    }
    const mrk = vc.openAdminSeal(manager.mrk.admin, privateKey, { version: MANAGER_VERSION });
    /** @type {Map<string, Buffer>} */
    const out = new Map();
    try {
      // GLOBAL_ID is enumerated FIRST (the true manager-wide vault); the jar list
      // then EXCLUDES any entry whose id === GLOBAL_ID (defense-in-depth, M12 F1
      // review). A pre-existing `{ id: 'global' }` jar (mintable only before jars.js
      // reserved the id) must not double-visit global.gfvault or mis-map the `global`
      // Map slot onto a jar — the slot is always the manager-wide global vault.
      const ids = [GLOBAL_ID, ...this.listJars().map((j) => j.id).filter((id) => id !== GLOBAL_ID)];
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
    this._requireMrk();
    this._touch();
    const doc = this._readVault(vaultId);
    if (doc === null) {
      throw new VaultStateError(`vault-store: no vault for "${vaultId}"`);
    }
    const kept = doc.envelopes.filter(
      (/** @type {any} */ e) => !(e.keyId === keyId && e.keyId !== 'mrk')
    );
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
  // Re-exported (M12 F3 DD8) so the reserved-id cross-module test can assert this
  // store's global sentinel ∈ jars' reserved ids without re-typing the literal.
  GLOBAL_ID,
  VaultLockedError,
  VaultStateError,
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
};
