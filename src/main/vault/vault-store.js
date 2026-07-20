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

// The global (non-jar) vault's stable id / filename base.
const GLOBAL_ID = 'global';

// The manager document format id + version (vault-store OWNS this format).
const MANAGER_FORMAT = 'gfmanager';
const MANAGER_VERSION = 1;

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
   * @param {{ masterPassword: string }} args
   * @returns {Promise<{ recoveryKeyDisplay: string, adminPrivateKeyB64: string }>}
   */
  async setup({ masterPassword } = /** @type {any} */ ({})) {
    if (this.isSetUp()) {
      throw new VaultStateError('vault-store: already set up');
    }
    if (typeof masterPassword !== 'string' || masterPassword.length === 0) {
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
   * @param {string} masterPassword
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
    this.vaultKeys = new Map();
    this._touch();
  }

  /**
   * Re-wrap the MRK's master envelope under a new password (master change /
   * recovery-after-forgotten flow). Requires the manager to be unlocked; touches
   * ONLY the master envelope in manager.json — item ciphertext is never rewritten.
   * @param {{ newMasterPassword: string }} args
   * @returns {Promise<void>}
   */
  async changeMasterPassword({ newMasterPassword } = /** @type {any} */ ({})) {
    const mrk = this._requireMrk();
    if (typeof newMasterPassword !== 'string' || newMasterPassword.length === 0) {
      throw new VaultStateError('vault-store: newMasterPassword is required');
    }
    const manager = this._readManager();
    manager.mrk.master = await vc.wrapMaster(mrk, newMasterPassword, { version: MANAGER_VERSION, params: manager.kdf });
    this._writeManager(manager);
    this._touch();
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

  // -------------------------------------------------------------------------
  // Access keys (per-jar automation grants — DD6 step-up)
  // -------------------------------------------------------------------------

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
    const doc = this._readVault(vaultId);
    if (doc === null) {
      throw new VaultStateError(`vault-store: no vault for "${vaultId}"`);
    }
    for (const env of doc.envelopes) {
      if (env.keyId === 'mrk') continue; // access key never touches the MRK envelope.
      try {
        return vc.unwrapAccess(env, secret);
      } catch (err) {
        if (err instanceof vc.VaultAuthError) continue;
        throw err;
      }
    }
    throw new vc.VaultAuthError(`access key does not open vault "${vaultId}"`);
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
  VaultLockedError,
  VaultStateError,
  // Re-exported for callers/tests that catch the crypto-layer errors.
  VaultAuthError: vc.VaultAuthError,
  VaultFormatError: vc.VaultFormatError,
};
