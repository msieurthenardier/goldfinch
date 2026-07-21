// @ts-check
'use strict';

// Electron-free registration for the guarded goldfinch://vault management surface
// (M12 Flight 3 / DD2). Every vault channel goes through registerInternalHandler
// (origin + session-identity gated) — a non-internal sender is rejected — mirroring
// register-settings-ipc.js. This is a SCAFFOLD: leg 1 lands only the metadata-only
// `internal-vault-state` read; later legs add CRUD / reveal / totp / access-key /
// setup / autolock handlers to THIS module.

const { GLOBAL_ID } = require('../shared/reserved-ids');
const { metadataOf } = require('../shared/vault-item-schema');
const { VaultLockedError } = require('./vault/vault-store');
const {
  parseOtpauth,
  totp,
  normalizeTotpField,
  totpSecondsRemaining,
} = require('./vault/vault-crypto');

// The manager-wide global vault's display label (the store keys it by GLOBAL_ID).
const GLOBAL_LABEL = 'Global';

/**
 * Wrap a handler body so a LOCKED store surfaces as a STRUCTURED `{ locked: true }`
 * result instead of a thrown error. A thrown error only serializes to a string
 * across `registerInternalHandler`, so the page could not `instanceof`-detect the
 * lock — it must receive an object it can branch on and route to the (leg-4) unlock
 * path. Any other error propagates (a rejected invoke) as before.
 * @template {any[]} A
 * @param {(...args: A) => any} fn
 * @returns {(...args: A) => any}
 */
function catchLocked(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      if (err instanceof VaultLockedError) return { locked: true };
      throw err;
    }
  };
}

/**
 * Return the item to persist with its `totp` field normalized to the canonical
 * `otpauth://` URI string (M12 F3 Leg 3) — but ONLY when a `totp` is present AND
 * NOT in `unchangedSecrets`. A preserved (unchanged) totp is already the stored
 * canonical string and is resolved from the existing item by the store's
 * saveItemPreservingSecrets — re-normalizing an empty placeholder here would throw.
 * A malformed/out-of-range totp throws VaultFormatError (nothing is stored).
 * @param {any} item
 * @param {string[]} unchangedSecrets
 * @returns {any}
 */
function normalizeTotpForSave(item, unchangedSecrets) {
  if (!item || typeof item !== 'object') return item;
  if (typeof item.totp !== 'string' || item.totp.length === 0) return item;
  if (Array.isArray(unchangedSecrets) && unchangedSecrets.includes('totp')) return item;
  return { ...item, totp: normalizeTotpField(item.totp) };
}

/**
 * @param {object} args
 * @param {{ handle: (channel: string, fn: (...a: any[]) => any) => void }} args.ipcMain
 * @param {(ipcMain: any, channel: string, handler: (...a: any[]) => any) => void} args.registerInternalHandler
 * @param {() => import('./vault/vault-store').VaultStore} args.getVaultStore
 *        Accessor for the memoized vault-store singleton (resolved per call so the
 *        handler always reads live lock/setup state).
 * @param {{ list: () => Array<{ id: string, name: string }> }} args.jars
 *        Injected because the store exposes no public vault-enumeration method — the
 *        handler composes the vault list itself as `'global' + jars.list()`.
 * @param {((bundle: any) => Promise<{ ok?: boolean, canceled?: boolean, path?: string }>)} [args.vaultSaveBundle]
 *        Main-side export delegate (M12 F4 Leg 1): given a ciphertext-only bundle, runs the
 *        save dialog + writes the chosen path. Injected because this module has no Electron
 *        `dialog` / `fs` handle. Gated — offline tests that omit it skip `internal-vault-export`.
 */
function registerVaultIpc({ ipcMain, registerInternalHandler, getVaultStore, jars, vaultSaveBundle }) {
  // Page state: the manager-wide `global` vault followed by each persistent jar's
  // vault, as { vaultId, label }. When the store is UNLOCKED each row also carries
  // a metadata-only item `count` (via listItemsMeta — no secret, no plaintext); when
  // LOCKED the count is OMITTED and the read stays NON-THROWING (labels need no MRK).
  registerInternalHandler(ipcMain, 'internal-vault-state', () => {
    const store = getVaultStore();
    const unlocked = store.isUnlocked();
    const vaults = [{ vaultId: GLOBAL_ID, label: GLOBAL_LABEL }];
    for (const jar of jars.list()) {
      // Defense in depth (M12 F1): jars.js reserves the `global` id, so no
      // persistent jar can hold it — but never double-list the reserved sentinel.
      if (jar.id === GLOBAL_ID) continue;
      vaults.push({ vaultId: jar.id, label: jar.name });
    }
    if (unlocked) {
      for (const row of vaults) {
        // Guarded on isUnlocked() above; still per-vault try/catch so a single
        // corrupt/absent vault can never make the whole state read throw.
        try {
          row.count = store.listItemsMeta(row.vaultId).length;
        } catch {
          // leave count omitted — non-throwing.
        }
      }
    }
    return { setUp: store.isSetUp(), unlocked, vaults };
  });

  // Explicit global LOCK (M12 F5 HAT batch 1, I6). The vault page's "Lock now" button
  // invokes this to zeroize ALL vault keys immediately. `lockNow()` is global (clears every
  // vaultKey + the MRK) and idempotent — a no-op when already locked — and its onLock hook
  // ALREADY broadcasts `vault-lock-state` to every chrome + internal page, so this handler
  // must NOT re-broadcast (double-broadcast). Carries NO secret in either direction;
  // registerInternalHandler rejects any non-internal sender before the body runs.
  registerInternalHandler(ipcMain, 'internal-vault-lock', () => {
    getVaultStore().lockNow();
    return { ok: true };
  });

  // Per-jar vault-file presence (M12 F4 Leg 6). Answers "does THIS jar have a
  // `.gfvault` file" so the jars page's Delete confirm can decide whether to surface
  // the export-first offer. `internal-vault-state` cannot answer this — it enumerates
  // every jar regardless of file presence and its item count is locked-ambiguous. A
  // pure filesystem probe: needs no MRK, non-throwing on a locked store, non-secret.
  registerInternalHandler(ipcMain, 'internal-vault-has', (_event, vaultId) => {
    if (typeof vaultId !== 'string') return { present: false };
    return { present: getVaultStore().hasVault(vaultId) };
  });

  // Metadata-only item list for one vault (DD10). Returns { items } (no secret) or
  // the structured { locked: true }. `vaultId` is the row id from internal-vault-state.
  registerInternalHandler(ipcMain, 'internal-vault-list', catchLocked((_event, vaultId) => {
    return { items: getVaultStore().listItemsMeta(vaultId) };
  }));

  // Explicit single-item reveal (DD6). Returns the FULL item (incl. secrets) for the
  // requested id ONLY — { item } (item null when absent) — or { locked: true }.
  registerInternalHandler(ipcMain, 'internal-vault-reveal', catchLocked((_event, payload) => {
    const { vaultId, itemId } = payload || {};
    return { item: getVaultStore().revealItem(vaultId, itemId) };
  }));

  // Full-item save with the OUT-OF-BAND unchanged-secret signal (DD3/DD6):
  // { item, unchangedSecrets:[names] } → saveItemPreservingSecrets. Returns the saved
  // item's METADATA only (never echoes a secret back to the page) or { locked: true }.
  //
  // TOTP ENROLLMENT (M12 F3 Leg 3): normalize the `totp` field to the canonical
  // `otpauth://` URI string — but ONLY when it is present AND NOT in unchangedSecrets
  // (an unchanged/preserved totp is already the stored canonical string; the store
  // pulls it from the existing item, so re-normalizing here would be wrong). A
  // malformed/out-of-range totp throws VaultFormatError (propagates as a rejected
  // invoke — nothing is stored), NOT caught by catchLocked (that's lock-only).
  registerInternalHandler(ipcMain, 'internal-vault-item-save', catchLocked((_event, payload) => {
    const { vaultId, item, unchangedSecrets } = payload || {};
    const unchanged = unchangedSecrets || [];
    const toSave = normalizeTotpForSave(item, unchanged);
    const saved = getVaultStore().saveItemPreservingSecrets(vaultId, toSave, unchanged);
    return { item: metadataOf(saved) };
  }));

  // Live TOTP code (M12 F3 Leg 3 / DD4): MRK-gated single-item reveal → compute the
  // current code + seconds-remaining IN MAIN and return { code, secondsRemaining }
  // ONLY. The seed NEVER crosses this channel (the page's live display needs no
  // seed). { code: null } when the item has no totp (or is absent); { locked: true }
  // when the store is locked. The page polls per-period and counts down locally.
  registerInternalHandler(ipcMain, 'internal-vault-totp-code', catchLocked((_event, payload) => {
    const { vaultId, itemId } = payload || {};
    // `totp` is a login-only field carried verbatim on the opaque item payload; the
    // store's VaultItem typedef declares only the shared keys, so read it as `any`.
    const item = /** @type {any} */ (getVaultStore().revealItem(vaultId, itemId));
    if (!item || !item.totp) return { code: null };
    const p = parseOtpauth(item.totp);
    const nowMs = Date.now();
    return {
      code: totp(p.secret, p, nowMs),
      secondsRemaining: totpSecondsRemaining(p.period, nowMs),
    };
  }));

  // Delete an item by id. Returns { deleted } (false on a missing id) or { locked: true }.
  registerInternalHandler(ipcMain, 'internal-vault-item-delete', catchLocked((_event, payload) => {
    const { vaultId, itemId } = payload || {};
    return { deleted: getVaultStore().deleteItem(vaultId, itemId) };
  }));

  // Access-key management (M12 F3 Leg 5, flight DD5 / mission durable-grant step-up).
  // These are the vault-store `access` ENVELOPES (mintAccessKey/revokeAccessKey), NOT
  // the MCP `automationKeyHashes` transport tokens. Minting requires a fresh master
  // password on the chrome-owned vault-stepup sheet (register-overlay-ipc.js) — it does
  // NOT ride an internal channel. These two channels cover LIST + REVOKE only; no secret
  // ever crosses either (keyIds are plaintext envelope fingerprints).

  // List a vault's access-key grants by keyId ONLY (no secret — grep AC). MRK-gated →
  // structured { locked: true } via catchLocked; the store's listAccessKeys resolves the
  // target through _resolveTarget (burner/unknown rejected). `vaultId` is the row id.
  registerInternalHandler(ipcMain, 'internal-vault-accesskey-list', catchLocked((_event, vaultId) => {
    return { keys: getVaultStore().listAccessKeys(vaultId) };
  }));

  // Revoke an access key by keyId — immediate (envelope deletion). The store's
  // revokeAccessKey takes a RAW vaultId (unlike mint/list, which _resolveTarget
  // internally), so the handler resolves the caller's target through the store's PUBLIC
  // resolveTarget FIRST — rejecting a burner/unknown/traversal target with no raw-path
  // construction, the same main-side authority for symmetry. A VaultStateError (bad
  // target) propagates as a rejected invoke; a LOCKED store surfaces { locked: true } via
  // catchLocked (revokeAccessKey's _requireMrk throws VaultLockedError). Returns
  // { revoked } (false for a stale keyId — the page refresh reflects reality).
  registerInternalHandler(ipcMain, 'internal-vault-accesskey-revoke', catchLocked((_event, payload) => {
    const { vaultId, keyId } = payload || {};
    const store = getVaultStore();
    return { revoked: store.revokeAccessKey(store.resolveTarget(vaultId), keyId) };
  }));

  // Portable EXPORT (M12 F4 Leg 1 / DD1 — Option A). Fully MAIN-SIDE: build the ciphertext-only
  // bundle from the store (exportVault requires unlocked → VaultLockedError → { locked: true }),
  // then hand it to the injected save-dialog delegate which writes the chosen path. The bundle
  // (all ciphertext + kdf + admin PUBLIC key) never transits to the page — the internal page is
  // sandbox:true and can't write files anyway. NO password is entered anywhere (the export is a
  // frictionless unlock-window op). catchLocked is lock-only; exportVault is synchronous, so its
  // VaultLockedError is mapped here explicitly (the async wrapper would swallow catchLocked's
  // synchronous try/catch). Gated on the vaultSaveBundle injection (offline tests omit it).
  if (vaultSaveBundle) {
    registerInternalHandler(ipcMain, 'internal-vault-export', async (_event, target) => {
      let bundle;
      try {
        bundle = getVaultStore().exportVault(target);
      } catch (err) {
        if (err instanceof VaultLockedError) return { locked: true };
        throw err;
      }
      return await vaultSaveBundle(bundle);
    });
  }
}

module.exports = { registerVaultIpc };
