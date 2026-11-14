'use strict';

// The per-open vault PICKER CONTEXT (Mission 23 Flight 1, leg `vault-fill-trust`, revised DD4/DD5).
//
// Minted by main when a gesture is ACCEPTED (an accepted fill-icon click, or an accepted "Fill login..."
// from the native icon menu) and held main-side. It binds one picker open to the page the operator was
// on: the tab, the COMMITTED origin at that moment, and whether the tab's navigation carries a
// certificate override. Its unguessable id rides the `vault-gesture` push to the chrome and back on the
// three chrome-facing vault channels (`vault-reachable-items`, `vault-fill-human`, `vault-fill-generated`);
// main refuses any of them without a live context for that tab and id, and refuses a fill whose tab is no
// longer at the context's origin.
//
// One live context per tab: a new one replaces the old. A context survives a vault LOCK (a fill against a
// locked vault answers `locked`, the chrome re-raises the unlock sheet, and the same open continues) and
// is bounded by `PICKER_TTL_MS`. It is dropped by a fill that used it, a cross-document navigation, the
// tab-lifecycle sites (switch / hide / close / move / fullscreen), window close, a dismissed picker or
// unlock sheet, and the time limit. Expiry is checked lazily (no timers: nothing to fire after quit).
//
// Electron-free and clock/random injected.

const crypto = require('node:crypto');
// Wall-clock time is deliberate here: a clock step can only lengthen or shorten one open by its own size.
const { PICKER_TTL_MS } = require('../../shared/vault-picker-limits');

/**
 * @typedef {{ id: string, wcId: number, origin: string, certOverride: boolean, expiresAt: number,
 *   acknowledged: boolean, pending: { vaultId: string, itemId: string } | null }} PickerContext
 *   `acknowledged`: the operator clicked Continue on the certificate warning (leg `vault-picker-controls`);
 *   a context with `certOverride` set and not acknowledged is refused by main's context gate.
 *   `pending`: the card / identity a confirmation is currently asked for - `{ vaultId, itemId }` - which the
 *   one explicit `confirm` call must match to fill on an unconfirmed origin.
 */

/**
 * @param {{ now?: () => number, randomId?: () => string, ttlMs?: number }} [deps]
 */
function createPickerContexts({
  now = Date.now,
  randomId = () => crypto.randomBytes(16).toString('hex'),
  ttlMs = PICKER_TTL_MS
} = {}) {
  /** @type {Map<number, PickerContext>} */
  const byTab = new Map();

  /** Remove contexts past their time limit (called on mint so the map cannot grow). */
  function sweep() {
    const t = now();
    for (const [wcId, ctx] of byTab) if (t >= ctx.expiresAt) byTab.delete(wcId);
  }

  /**
   * Mint a context for a tab, replacing any live one.
   * @param {{ wcId: number, origin: string, certOverride: boolean }} arg
   * @returns {PickerContext}
   */
  function mint({ wcId, origin, certOverride }) {
    sweep();
    /** @type {PickerContext} */
    const ctx = {
      id: randomId(),
      wcId,
      origin,
      certOverride: certOverride === true,
      expiresAt: now() + ttlMs,
      acknowledged: false,
      pending: null
    };
    byTab.set(wcId, ctx);
    return ctx;
  }

  /**
   * Look a context up by tab and id. `missing` = the tab has no live context (never minted, dropped or
   * past its time limit, or `wcId`/`id` not a number/string); `stale` = it has one, but not this id.
   * @param {number} wcId
   * @param {unknown} id
   * @returns {{ ok: true, context: PickerContext } | { ok: false, reason: 'missing' | 'stale' }}
   */
  function lookup(wcId, id) {
    const ctx = typeof wcId === 'number' ? byTab.get(wcId) : undefined;
    if (!ctx) return { ok: false, reason: 'missing' };
    if (now() >= ctx.expiresAt) {
      byTab.delete(wcId);
      return { ok: false, reason: 'missing' };
    }
    if (typeof id !== 'string' || id !== ctx.id) return { ok: false, reason: 'stale' };
    return { ok: true, context: ctx };
  }

  /** @param {number} wcId  @returns {boolean} whether a context was dropped */
  function drop(wcId) {
    return byTab.delete(wcId);
  }

  /** @param {Iterable<number>} wcIds  @returns {number} how many were dropped */
  function dropMany(wcIds) {
    let n = 0;
    for (const wcId of wcIds) if (byTab.delete(wcId)) n += 1;
    return n;
  }

  return { mint, lookup, drop, dropMany, _size: () => byTab.size };
}

module.exports = { createPickerContexts };
