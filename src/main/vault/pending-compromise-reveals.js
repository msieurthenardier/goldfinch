// @ts-check
'use strict';

// Per-window pending vault-credential reveals (M18 F2 Leg 4, design-review H1/H2;
// GENERALIZED M18 F3 Leg 3 / DD6 ruling 5 to cover BOTH one-time-reveal flows that need
// the same window-death-safe stash/ack/resurface machinery: a compromise-mode rotation's
// recovery-key reveal AND a fresh-adopt's recovery-key reveal. Adopt no longer mints an
// admin pair (DD6) — the recovery-key reveal IS its whole one-time-secret surfacing chain
// now, so the OLD two-sheet admin-key chain's own stash/take store (`_pendingAdoptAdminKeys`
// + the ack-chained `vault-adminkey-show` send) is deleted, and adopt joins THIS store
// instead of growing a parallel one (the mission's no-ad-hoc-sequencing constraint).
//
// When an op resolves, main FIRST stashes the one-time recovery key here and acquires the
// refcounted autolock-suppression hold — BEFORE any sheet interaction — so a window that
// died during the op's await can never lose the reveal to a throw on a dead sheet handle
// (H2). The reveal is keyed by the owning CHROME webContents id (the `_pendingAdoptAdminKeys`
// keying idiom) so the `vault-recovery-show` ack can discriminate this window's flow (H1):
// the ack consumes a window's marker ONLY if present, releasing the holder by the exact
// `(chromeId, reason)` pair. `reason` ('compromise' | 'adopt') rides the stash and is
// RETURNED (not discriminated away) by `ack` — main's ack handler fires the completion
// broadcast for EITHER flow (adopt ends unlocked too) while keeping any compromise-only
// behavior keyed on the returned reason.
//
// If the owning window is gone at op resolution, the reveal STAYS pending and re-surfaces on
// the next chrome boot: `rekey(from, to)` moves the reveal (reason preserved) to the new
// window's id and moves the hold with it (release old pair, acquire new pair), so the
// re-opened dismiss-locked sheet is suppressed exactly like the original. An app-quit while a
// reveal is pending loses it — the accepted, documented residual (not a lockout: the operator
// set the new master password / adopted the profile and can re-mint a recovery key from it;
// see docs/vault.md).
//
// The recovery key is a JS string — immutable, not fill(0)-zeroizable — consistent with the
// other one-time display secrets (recovery display, mint secret). Dwell is minimized (dropped
// on the ack, or lost at app quit). ELECTRON-FREE + PURE: unit-tested headlessly.

/** The compromise-mode rotation's holder reason. */
const COMPROMISE_REASON = 'compromise';
/** The fresh-adopt reveal's holder reason (M18 F3 Leg 3 / DD6 ruling 5). */
const ADOPT_REASON = 'adopt';

/**
 * @param {{ acquire: (chromeId: number, reason: string) => void, release: (chromeId: number, reason: string) => void }} holder
 *        The refcounted suppression holder (autolock-suppression.js).
 * @returns {{
 *   stash: (chromeId: number | null | undefined, recoveryKey: string, reason?: string) => void,
 *   has: (chromeId: number | null | undefined) => boolean,
 *   ack: (chromeId: number | null | undefined) => { reason: string } | null,
 *   rekey: (fromChromeId: number, toChromeId: number | null | undefined) => { recoveryKey: string, reason: string } | null,
 *   chromeIds: () => number[],
 * }}
 */
function createCompromiseRevealStore(holder) {
  /** @type {Map<number, { recoveryKey: string, reason: string }>} chromeId -> the pending reveal. */
  const reveals = new Map();

  /**
   * Stash the pending reveal for a window AND acquire its suppression hold — one call, so
   * the H2 "stash + hold BEFORE any sheet interaction" ordering is atomic at the call site.
   * A re-stash for the same window replaces the reveal (the hold is already held — acquire
   * is idempotent per pair). `reason` defaults to 'compromise' (the flow this store
   * originated for) when omitted — every NEW call site (the adopt path) passes it explicitly.
   * @param {number | null | undefined} chromeId
   * @param {string} recoveryKey
   * @param {string} [reason]
   */
  function stash(chromeId, recoveryKey, reason) {
    if (chromeId == null || typeof recoveryKey !== 'string' || recoveryKey.length === 0) return;
    const r = reason === ADOPT_REASON ? ADOPT_REASON : COMPROMISE_REASON;
    reveals.set(chromeId, { recoveryKey, reason: r });
    holder.acquire(chromeId, r);
  }

  /** @param {number | null | undefined} chromeId */
  function has(chromeId) {
    return chromeId != null && reveals.has(chromeId);
  }

  /**
   * Consume a window's pending reveal on the recovery-show ack: drop the record and release
   * EXACTLY the `(chromeId, reason)` hold (H1 — never "any hold for this window"). Returns
   * `{ reason }` when a reveal was consumed (so the caller fires the completion broadcast for
   * EITHER flow, branching any flow-specific behavior on the reason), or `null` for a window
   * with no pending marker (setup / rotate-recovery acks are a strict no-op here).
   * @param {number | null | undefined} chromeId
   */
  function ack(chromeId) {
    if (chromeId == null || !reveals.has(chromeId)) return null;
    const { reason } = /** @type {{ recoveryKey: string, reason: string }} */ (reveals.get(chromeId));
    reveals.delete(chromeId);
    holder.release(chromeId, reason);
    return { reason };
  }

  /**
   * Re-key an orphaned reveal to a freshly booted window (H2 resurface): move the record
   * (reason preserved) AND its hold (release the old pair, acquire the new) so the re-opened
   * sheet is suppressed under the new window's identity. Returns the reveal for the caller to
   * open the sheet with, or null when nothing was pending under `fromChromeId`.
   * @param {number} fromChromeId
   * @param {number | null | undefined} toChromeId
   */
  function rekey(fromChromeId, toChromeId) {
    const reveal = reveals.get(fromChromeId);
    if (!reveal || toChromeId == null) return null;
    reveals.delete(fromChromeId);
    holder.release(fromChromeId, reveal.reason);
    reveals.set(toChromeId, reveal);
    holder.acquire(toChromeId, reveal.reason);
    return reveal;
  }

  /** The chromeIds with a pending reveal — the boot-time orphan scan. */
  function chromeIds() {
    return [...reveals.keys()];
  }

  return { stash, has, ack, rekey, chromeIds };
}

module.exports = { createCompromiseRevealStore, COMPROMISE_REASON, ADOPT_REASON };
