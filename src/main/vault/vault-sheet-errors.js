// @ts-check
'use strict';

// M18 F3 L1 (DD9, Flight 2 debrief recommendation 1): the single source of truth for
// the vault sheet delegates' error-class -> reason mapping. Extracted from EIGHT
// inline catch ladders in main.js (grepped, design-review confirmed: main.js:1119,
// :1757, :1798, :1834, :1865, :1883, :1900, :1926) — every one of them followed the
// same shape (try the store op; on a KNOWN VaultStore error class, return a
// non-secret `{ ok:false }` / `{ ok:false, reason }` / bare `false` so the sheet
// re-prompts instead of crashing the invoke; on an UNKNOWN class, rethrow so the
// handler's dual-zeroize `finally` still runs and the invoke genuinely rejects) but
// disagreed, delegate by delegate, on (a) which classes are even REACHABLE at that
// call site (squawk-0058: the width is deliberate — e.g. vaultRotateRecovery admits
// only auth + busy; a VaultStateError there was never a ruled outcome and must keep
// propagating) and (b) how a mapped auth failure renders (vaultUnlock's bare boolean
// `false`; every bare-shape delegate's `{ ok:false }`; vaultCompromiseRotate's WIDER
// `{ ok:false, reason:'auth' }` — compare the historical main.js:1835 vs :1900).
//
// Design: data (the per-delegate CONFIG below, one object per delegate, preserving
// each delegate's history/comments) + one function (mapVaultSheetError). A config
// only lists the classes ITS delegate actually admits — a class absent from a
// delegate's config is never checked for that delegate, so the per-delegate width
// stays exactly as narrow as the original ladder. mapVaultSheetError returns the
// mapped result shape, or `null` when `e` matches no admitted class — `null` is
// never itself a valid mapped shape (the three shapes are `false`, `{ok:false}`,
// `{ok:false, reason}`), so callers can do `if (mapped === null) throw e;` unambiguously.
//
// VaultCollisionError EXTENDS VaultStateError (vault-store.js) — `e instanceof
// VaultStateError` is also true for a VaultCollisionError. No delegate below admits
// BOTH 'state' and 'collision' — collision was admitted only by the now-retired
// vaultImportFromSheet (M18 F3 Leg 3 / DD2 ruling 2 moved the destination/collision
// decision to the commit step, whose config admits 'state' but no longer names
// 'collision' at all) — so CLASS_CHECK_ORDER's fixed State-before-Collision
// placement never actually matters for the delegates this module was built
// for — recorded here so a future delegate that admits both classes doesn't ship
// silently on the wrong branch.

const vaultStoreModule = require('./vault-store');

/**
 * Fixed check order — see the VaultCollisionError-extends-VaultStateError note above.
 * @type {Array<[string, new (...args: any[]) => Error]>}
 */
const CLASS_CHECK_ORDER = [
  ['VaultAuthError', vaultStoreModule.VaultAuthError],
  ['VaultBusyError', vaultStoreModule.VaultBusyError],
  ['VaultStateError', vaultStoreModule.VaultStateError],
  ['VaultFormatError', vaultStoreModule.VaultFormatError],
  ['VaultPasswordReuseError', vaultStoreModule.VaultPasswordReuseError],
  ['VaultCollisionError', vaultStoreModule.VaultCollisionError]
];

/**
 * @typedef {Object.<string, true | 'bare-false' | string>} VaultSheetErrorConfig
 * Keys are VaultStore error class names (from CLASS_CHECK_ORDER); a key absent from
 * the config is never admitted for that delegate. Values:
 *   - `true`          -> mapped result is `{ ok: false }`
 *   - `'bare-false'`  -> mapped result is the bare boolean `false` (vaultUnlock only)
 *   - any other string -> mapped result is `{ ok: false, reason: <that string> }`
 */

/**
 * Classify a caught VaultStore error against a delegate's config.
 * @param {unknown} e
 * @param {VaultSheetErrorConfig} config
 * @returns {false | { ok: false } | { ok: false, reason: string } | null} the mapped
 *   result, or `null` when `e` doesn't match any class this config admits — the
 *   caller must rethrow `e` unchanged (an unknown/unadmitted class is never
 *   silently swallowed into a reason).
 */
function mapVaultSheetError(e, config) {
  for (const [name, cls] of CLASS_CHECK_ORDER) {
    if (!(name in config)) continue;
    if (e instanceof cls) {
      const rule = config[name];
      if (rule === 'bare-false') return false;
      if (rule === true) return { ok: false };
      return { ok: false, reason: rule };
    }
  }
  return null;
}

// Per-delegate configs, one per catch ladder site (main.js:1119, :1757, :1798, :1834,
// :1865, :1883, :1900, :1926) — preserving each site's original comment history below
// each export, since the comments explain WHY a delegate's width is what it is
// (mostly squawk-0058), not just what the mapping is.

// vaultImportPreviewFromSheet (M18 F3 Leg 3 / DD2 ruling 10 — the reshaped
// `vaultImportFromSheet`; RENAMED, not silent-edited, because the delegate's own
// contract changed: the secret step no longer resolves a destination, so it can no
// longer throw a CODED collision — that check moved to the commit step, where a
// destination collision is now a per-vault OUTCOME in the reply, not a thrown error).
// A wrong secret -> bare { ok:false } (the sheet re-prompts, nothing stashed);
// format/busy/state ride as non-secret reasons (a malformed bundle, a re-key gate up,
// or a stale/missing held record). Other errors propagate.
/** @type {VaultSheetErrorConfig} */
const VAULT_IMPORT_PREVIEW_CONFIG = {
  VaultAuthError: true,
  VaultFormatError: 'format',
  VaultBusyError: 'busy',
  VaultStateError: 'state'
};

// vaultImportCommit (M18 F3 Leg 3 / DD2 ruling 3(e), DD9/DD10): the restore commit
// delegate. The secret was already verified at the preview step, so a VaultAuthError
// is not a ruled outcome here (the SAME held secret buffer re-derives the identical
// unwrap) — deliberately narrower than the preview config. 'busy' is the re-key gate
// (restore is a GATED op); 'state' covers both a stale/dropped held record (lock,
// timer expiry, or a re-pick since the secret step) and any mapping-validation refusal
// restoreProfile raises. Per-vault failures are OUTCOMES in the reply, never thrown —
// only a WHOLE-op failure maps here; unknown errors still propagate.
/** @type {VaultSheetErrorConfig} */
const VAULT_RESTORE_COMMIT_CONFIG = { VaultBusyError: 'busy', VaultStateError: 'state' };

// vaultUnlock (main.js:1757): the ONLY delegate with a bare-boolean IPC surface (never
// changed by this leg — AC pins it) — a wrong password maps to bare `false`, not
// `{ok:false}`. Any other error propagates (the handler still zeroizes in its finally).
/** @type {VaultSheetErrorConfig} */
const VAULT_UNLOCK_CONFIG = { VaultAuthError: 'bare-false' };

// vaultMintAccessKey (main.js:1798): squawk 0058 — the two OTHER reachable failure
// classes ride as non-secret reasons instead of rejecting: 'state' is the lazy-vault gap
// (a jar with no item ever saved has no .gfvault -> VaultStateError from
// _mintAccessKey, reached with a CORRECT password); 'busy' is the re-key gate (mint is a
// GATED op). Unknown errors still propagate.
/** @type {VaultSheetErrorConfig} */
const VAULT_MINT_ACCESS_KEY_CONFIG = { VaultAuthError: true, VaultStateError: 'state', VaultBusyError: 'busy' };

// vaultCompromiseRotate (main.js:1834): deliberately the WIDEST config — five ruled
// failure classes (the op's own rotation logic distinguishes reuse/auth/format/busy/
// state), and the ONLY delegate whose auth failure renders WITH a reason
// (`{ok:false, reason:'auth'}`, not the bare-shape sibling delegates' `{ok:false}`).
/** @type {VaultSheetErrorConfig} */
const VAULT_COMPROMISE_ROTATE_CONFIG = {
  VaultPasswordReuseError: 'reuse',
  VaultAuthError: 'auth',
  VaultFormatError: 'format',
  VaultBusyError: 'busy',
  VaultStateError: 'state'
};

// vaultRotateRecovery (main.js:1865): squawk 0058 — 'busy' rides as a non-secret reason
// (rotateRecovery has no entry gate itself, but its _writeManager hits the sinks'
// second wall — VaultBusyError — when a compromise rotation's re-key gate is up during
// the step-up scrypt derive). A VaultStateError here was never a ruled outcome and
// still propagates (the width is deliberately narrower than vaultMintAccessKey's).
/** @type {VaultSheetErrorConfig} */
const VAULT_ROTATE_RECOVERY_CONFIG = { VaultAuthError: true, VaultBusyError: 'busy' };

// vaultRotateAdminKey (main.js:1883): squawk 0058 — same second-wall reachability as
// vaultRotateRecovery (a compromise rotation's re-key gate rising during the step-up
// derive makes _writeManager throw VaultBusyError). Kept as its own named config
// (rather than reused) so a future width change to one delegate can never silently
// widen its sibling.
/** @type {VaultSheetErrorConfig} */
const VAULT_ROTATE_ADMIN_KEY_CONFIG = { VaultAuthError: true, VaultBusyError: 'busy' };

// vaultChangeMaster (main.js:1900): squawk 0058 — same second-wall reachability
// (either scrypt derive can hit the busy gate). Own named config, same reason as above.
/** @type {VaultSheetErrorConfig} */
const VAULT_CHANGE_MASTER_CONFIG = { VaultAuthError: true, VaultBusyError: 'busy' };

// vaultRecover (main.js:1926): squawk 0058 — two reasons beyond the vaultUnlock
// pattern: 'format' is a MALFORMED recovery display (a typo — parseRecoveryKey throws
// VaultFormatError on a bad character or wrong length, operator-reachable on every
// submit) and 'busy' is the sinks' second wall (a compromise rotation's re-key gate
// rising during the new-master wrap derive).
/** @type {VaultSheetErrorConfig} */
const VAULT_RECOVER_CONFIG = { VaultAuthError: true, VaultFormatError: 'format', VaultBusyError: 'busy' };

module.exports = {
  mapVaultSheetError,
  VAULT_IMPORT_PREVIEW_CONFIG,
  VAULT_RESTORE_COMMIT_CONFIG,
  VAULT_UNLOCK_CONFIG,
  VAULT_MINT_ACCESS_KEY_CONFIG,
  VAULT_COMPROMISE_ROTATE_CONFIG,
  VAULT_ROTATE_RECOVERY_CONFIG,
  VAULT_ROTATE_ADMIN_KEY_CONFIG,
  VAULT_CHANGE_MASTER_CONFIG,
  VAULT_RECOVER_CONFIG
};
