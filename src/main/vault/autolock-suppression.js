// @ts-check
'use strict';

// Refcounted idle-autolock suppression holder (M18 F2 Leg 4, flight DD5).
//
// Two flows hold the store's single `setAutoLockSuspended` flag while a
// dismiss-locked one-time-secret reveal is pending: the fresh-adopt admin-key
// chain (M17 F4 L3) and the compromise-mode recovery reveal (this flight).
// Before this module each flow would have driven the boolean with its own
// independent `size === 0` check — whichever emptied first would un-suppress
// while the other still had a live dismiss-locked reveal on screen: autolock
// during a one-time-key display, the exact lockout mission criterion 3 exists
// to prevent. This holder is the ONE suppression authority: the store flag is
// `holders > 0`, where a holder is a distinct `(chromeId, reason)` pair.
//
// Extracted as its own unit-testable module (leg design review M2 — the
// pending-imports.js precedent): main.js may not be loaded by any test (the
// source-scan pin), so a main.js-scoped holder could not satisfy this leg's
// direct unit tests. main.js wires it with
// `setSuspended: (on) => getVaultStore().setAutoLockSuspended(on)`.
//
// Semantics:
//  - `acquire(chromeId, reason)` registers one hold. Idempotent per pair —
//    each pair models ONE pending reveal of that kind for that window, so a
//    double-acquire is one hold, not two.
//  - `release(chromeId, reason)` drops EXACTLY that pair (flight design review
//    H1: never "any hold for this window") — a foreign reason or window is a
//    no-op.
//  - `releaseWindow(chromeId)` drops every hold of that window ONLY — the
//    window-`close` teardown hook (window-factory.js).
//  - `setSuspended` is invoked ONLY on 0↔>0 transitions, so an unrelated
//    window close (nothing held) never touches the store — preserving the
//    "never force-constructs the store on an unrelated close" discipline the
//    pre-migration main.js helpers carried.
//
// ELECTRON-FREE + PURE (the store lives in main.js): unit-tested headlessly.

/**
 * @param {{ setSuspended: (on: boolean) => void }} deps
 * @returns {{
 *   acquire: (chromeId: number | null | undefined, reason: string) => void,
 *   release: (chromeId: number | null | undefined, reason: string) => void,
 *   releaseWindow: (chromeId: number | null | undefined) => void,
 *   isHeld: (chromeId: number | null | undefined, reason: string) => boolean,
 *   count: () => number,
 * }}
 */
function createSuppressionHolder({ setSuspended }) {
  /** @type {Map<number, Set<string>>} chromeId -> the reasons it holds. */
  const holds = new Map();
  let suspended = false;

  // Push the flag to the store ONLY on a 0↔>0 transition (holders > 0 IS the flag).
  function apply() {
    const on = holds.size > 0;
    if (on === suspended) return;
    suspended = on;
    setSuspended(on);
  }

  /** @param {number | null | undefined} chromeId @param {string} reason */
  function acquire(chromeId, reason) {
    if (chromeId == null || typeof reason !== 'string' || reason.length === 0) return;
    let reasons = holds.get(chromeId);
    if (!reasons) {
      reasons = new Set();
      holds.set(chromeId, reasons);
    }
    reasons.add(reason);
    apply();
  }

  /** @param {number | null | undefined} chromeId @param {string} reason */
  function release(chromeId, reason) {
    const reasons = chromeId == null ? undefined : holds.get(chromeId);
    if (!reasons || !reasons.has(reason)) return;
    reasons.delete(reason);
    if (reasons.size === 0) holds.delete(/** @type {number} */ (chromeId));
    apply();
  }

  /** @param {number | null | undefined} chromeId */
  function releaseWindow(chromeId) {
    if (chromeId == null || !holds.has(chromeId)) return;
    holds.delete(chromeId);
    apply();
  }

  /** @param {number | null | undefined} chromeId @param {string} reason */
  function isHeld(chromeId, reason) {
    const reasons = chromeId == null ? undefined : holds.get(chromeId);
    return !!reasons && reasons.has(reason);
  }

  /** Total live `(chromeId, reason)` holds — tests/diagnostics. */
  function count() {
    let n = 0;
    for (const reasons of holds.values()) n += reasons.size;
    return n;
  }

  return { acquire, release, releaseWindow, isHeld, count };
}

module.exports = { createSuppressionHolder };
