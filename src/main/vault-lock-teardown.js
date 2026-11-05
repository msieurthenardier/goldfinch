'use strict';
// @ts-check

// Sortie 06 Leg 1 (AC15): the capture/prompt half of the vault-lock teardown, extracted from
// main.js's store `onLock` so the ORDER is unit-testable with spies. Order is load-bearing:
//   1. every window's corner save prompt closes `vault-lock` FIRST - the manager sets
//      `settling` so the drop in step 2 cannot flash "This save request expired";
//   2. `dropAllCaptures()` zeroizes and drops every held capture;
//   3. the allowlisted credential sheets close;
//   4. the lock state is broadcast.
// A throwing prompt close must never skip the capture drop (the security-relevant step), so
// each is isolated.

/**
 * @param {{
 *   records: () => Array<{ savePrompt?: any }>,
 *   vaultHuman?: { dropAllCaptures: () => any } | null,
 *   closeSheets: () => void,
 *   broadcast: () => void
 * }} deps
 */
function runVaultLockTeardown({ records, vaultHuman, closeSheets, broadcast }) {
  for (const rec of records()) {
    try {
      rec.savePrompt?.close('vault-lock');
    } catch {
      // isolated: the capture drop below must still run.
    }
  }
  vaultHuman?.dropAllCaptures();
  closeSheets();
  broadcast();
}

module.exports = { runVaultLockTeardown };
