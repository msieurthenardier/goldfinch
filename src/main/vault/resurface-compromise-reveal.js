// @ts-check
'use strict';

// M18 F3 L1 (DD9, Flight 2 debrief recommendation 1): the H2 resurface composition,
// extracted from main.js's `resurfaceCompromiseReveal` (formerly main.js:934-948) into
// an Electron-free, injected-deps unit. On a chrome boot, re-key any ORPHANED pending
// compromise reveal (its owning window is gone) to the freshly booted window and open
// the dismiss-locked recovery-show sheet there. The recovery-show display needs no
// unlock, so this works whatever the lock state. At most one reveal can be orphaned in
// practice (the store's busy gate serializes rotations), but the scan runs over the
// full pending set anyway. An app-quit with a reveal still pending loses it — the
// accepted, documented residual (docs/vault.md).
//
// main.js keeps ONLY the Electron plumbing this unit can't do itself: resolving the
// booted window's chrome webContents (and its liveness), building the live-chromeIds
// set from `registry.records()`, and binding `send` to the real `chrome.send(...)`.

/**
 * @param {{
 *   chromeId: number,
 *   liveChromeIds: Set<number>,
 *   reveals: { chromeIds: () => number[], rekey: (from: number, to: number) => ({ recoveryKey: string } | null) },
 *   send: (payload: { recoveryKey: string, replacing: true }) => void
 * }} args
 */
function resurfaceCompromiseReveal({ chromeId, liveChromeIds, reveals, send }) {
  if (chromeId == null) return;
  for (const staleId of reveals.chromeIds()) {
    if (liveChromeIds.has(staleId)) continue; // still owned by a live window — nothing to resurface
    const reveal = reveals.rekey(staleId, chromeId);
    if (reveal) send({ recoveryKey: reveal.recoveryKey, replacing: true });
    break; // at-most-one — the store's busy gate serializes rotations in practice
  }
}

module.exports = { resurfaceCompromiseReveal };
