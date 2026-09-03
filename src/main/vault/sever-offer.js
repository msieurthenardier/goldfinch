// @ts-check
'use strict';

// The DD7 post-fresh-adopt sever offer's route computation (M18 F3 Leg 3), extracted so the
// (secretKind × lock-state) truth table is unit-testable without Electron or a live store —
// the vault-sheet-errors.js / pending-imports.js extraction precedent. main.js owns the
// offer's session-state lifetime (`_severOffer`, set on every fresh adopt, cleared on
// dismiss/change-master/recover-success/relaunch); this module owns only the pure projection.

/**
 * @param {'master' | 'recovery'} secretKind  the fresh adopt's own secretKind (the literal
 *   third parameter of the restore commit — `vaultImportCommit`'s `pending.secretKind`).
 * @param {boolean} unlocked  the CURRENT lock state (read fresh at query time, not cached —
 *   a lock/unlock flips the route live on the same held offer).
 * @returns {'change-master' | 'recover'}
 */
function computeSeverOfferRoute(secretKind, unlocked) {
  // master-kind adopt while UNLOCKED → the operator knows the donor password, a real step-up
  // for changeMasterPassword (which itself requires the manager unlocked). Every other case —
  // recovery-kind adopt, or ANY kind while locked (changeMasterPassword is unreachable locked)
  // — routes to recover: the just-recorded recovery key IS the step-up, and recoverMasterPassword
  // works from locked.
  return secretKind === 'master' && unlocked ? 'change-master' : 'recover';
}

module.exports = { computeSeverOfferRoute };
