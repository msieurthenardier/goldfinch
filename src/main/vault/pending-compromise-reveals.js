// @ts-check
'use strict';

// Per-window pending compromise-mode recovery-key reveals (M18 F2 Leg 4,
// design-review H1/H2).
//
// When `compromiseRotate` resolves, main FIRST stashes the one-time recovery
// key here and acquires the refcounted autolock-suppression hold — BEFORE any
// sheet interaction — so a window that died during the 2–3-scrypt await can
// never lose the reveal to a throw on a dead sheet handle (H2). The reveal is
// keyed by the owning CHROME webContents id (the `_pendingAdoptAdminKeys`
// keying idiom) so the `vault-recovery-show` ack can discriminate this flow
// from the adopt flow per window (H1): the ack consumes a window's compromise
// marker ONLY if present, releasing the holder by the exact
// `(chromeId, 'compromise')` pair.
//
// If the owning window is gone at op resolution, the reveal STAYS pending and
// re-surfaces on the next chrome boot: `rekey(from, to)` moves the reveal to
// the new window's id and moves the hold with it (release old pair, acquire
// new pair), so the re-opened dismiss-locked sheet is suppressed exactly like
// the original. An app-quit while a reveal is pending loses it — the accepted,
// documented residual (not a lockout: the operator set the new master password
// and can re-mint a recovery key from it; see docs/vault.md).
//
// The recovery key is a JS string — immutable, not fill(0)-zeroizable —
// consistent with the other one-time display secrets (recovery display, mint
// secret, adopt admin key); dwell is minimized (dropped on the ack, or lost at
// app quit). ELECTRON-FREE + PURE: unit-tested headlessly.

/** The holder reason every compromise reveal acquires/releases under. */
const COMPROMISE_REASON = 'compromise';

/**
 * @param {{ acquire: (chromeId: number, reason: string) => void, release: (chromeId: number, reason: string) => void }} holder
 *        The refcounted suppression holder (autolock-suppression.js).
 * @returns {{
 *   stash: (chromeId: number | null | undefined, recoveryKey: string) => void,
 *   has: (chromeId: number | null | undefined) => boolean,
 *   ack: (chromeId: number | null | undefined) => boolean,
 *   rekey: (fromChromeId: number, toChromeId: number | null | undefined) => { recoveryKey: string } | null,
 *   chromeIds: () => number[],
 * }}
 */
function createCompromiseRevealStore(holder) {
  /** @type {Map<number, { recoveryKey: string }>} chromeId -> the pending reveal. */
  const reveals = new Map();

  /**
   * Stash the pending reveal for a window AND acquire its suppression hold —
   * one call, so the H2 "stash + hold BEFORE any sheet interaction" ordering
   * is atomic at the call site. A re-stash for the same window replaces the
   * reveal (the hold is already held — acquire is idempotent per pair).
   * @param {number | null | undefined} chromeId
   * @param {string} recoveryKey
   */
  function stash(chromeId, recoveryKey) {
    if (chromeId == null || typeof recoveryKey !== 'string' || recoveryKey.length === 0) return;
    reveals.set(chromeId, { recoveryKey });
    holder.acquire(chromeId, COMPROMISE_REASON);
  }

  /** @param {number | null | undefined} chromeId */
  function has(chromeId) {
    return chromeId != null && reveals.has(chromeId);
  }

  /**
   * Consume a window's pending reveal on the recovery-show ack: drop the
   * record and release EXACTLY the `(chromeId, 'compromise')` hold (H1 —
   * never "any hold for this window"). Returns whether a reveal was consumed,
   * so the caller fires the completion broadcast ONLY for a real compromise
   * ack (setup / rotate-recovery / adopt acks return false here).
   * @param {number | null | undefined} chromeId
   */
  function ack(chromeId) {
    if (chromeId == null || !reveals.has(chromeId)) return false;
    reveals.delete(chromeId);
    holder.release(chromeId, COMPROMISE_REASON);
    return true;
  }

  /**
   * Re-key an orphaned reveal to a freshly booted window (H2 resurface): move
   * the record AND its hold (release the old pair, acquire the new) so the
   * re-opened sheet is suppressed under the new window's identity. Returns the
   * reveal for the caller to open the sheet with, or null when nothing was
   * pending under `fromChromeId`.
   * @param {number} fromChromeId
   * @param {number | null | undefined} toChromeId
   */
  function rekey(fromChromeId, toChromeId) {
    const reveal = reveals.get(fromChromeId);
    if (!reveal || toChromeId == null) return null;
    reveals.delete(fromChromeId);
    holder.release(fromChromeId, COMPROMISE_REASON);
    reveals.set(toChromeId, reveal);
    holder.acquire(toChromeId, COMPROMISE_REASON);
    return reveal;
  }

  /** The chromeIds with a pending reveal — the boot-time orphan scan. */
  function chromeIds() {
    return [...reveals.keys()];
  }

  return { stash, has, ack, rekey, chromeIds };
}

module.exports = { createCompromiseRevealStore, COMPROMISE_REASON };
