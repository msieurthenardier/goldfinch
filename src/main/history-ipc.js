// @ts-check
'use strict';

// IPC surface over the per-jar history store (flight DD9, M08 Flight 1 Leg 3).
//
// Twin-registered exactly like jar-ipc.js (M06 F1 Leg 3 / DD6): every handler
// body is defined ONCE and registered TWICE — bare `ipcMain.handle` on the
// chrome-trusted channel, and `registerInternalHandler` on the
// internal-origin-gated `internal-history-*` twin (reached only by the
// goldfinch://jars page, which hosts the history UI in Flights 2-3 — no new
// internal origin this flight). Extract-don't-fork: a behavior fix here fixes
// both trust domains at once.
//
// Validation is fail-closed, in order — first failure returns immediately.
// Every error string is a STATIC literal of the form `history: <op> — <code>`
// (the M07 F1 branch-discriminable contract). Unlike jar-ipc.js's
// `clear-data`/`wipe` channels, NONE of these strings interpolate — the two
// dynamic-interpolation branches in jar-ipc are the precedent this module must
// NOT repeat (leg spec, flight DD9).
//
// This module is ELECTRON-FREE: `ipcMain`, `historyStore`, `jars`, and
// `broadcast` are all injected at registerHistoryIpc(deps), so the whole
// surface is unit-testable without Electron (the jar-ipc.js precedent).

const { registerInternalHandler } = require('./internal-ipc');

/**
 * Register the five history IPC channels (chrome-trusted + internal-origin-
 * gated twins). Returns nothing — mutation broadcasts fire inside the
 * handlers via the injected `broadcast`; main.js needs no returned broadcaster
 * (unlike registerJarIpc, whose broadcastJarsChanged is reused by a second,
 * renderer-tangled add entry point).
 *
 * @param {{
 *   ipcMain: { handle: (channel: string, fn: (event: any, payload?: any) => any) => void },
 *   historyStore: typeof import('./history-store'),
 *   jars: typeof import('./jars'),
 *   broadcast: (channel: string, payload: unknown) => void
 * }} deps
 */
function registerHistoryIpc({ ipcMain, historyStore, jars, broadcast }) {
  // Payload guard, shared shape (jar-ipc.js precedent): renderer payloads are
  // untrusted input — a missing/undefined/primitive payload must return the
  // channel's failure value, never throw. The explicit object check runs
  // BEFORE any property access.
  function isMalformed(p) {
    return p === null || typeof p !== 'object';
  }

  function isKnownJar(jarId) {
    return jars.list().some((j) => j.id === jarId);
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  // Handler bodies (DD9): each is registered TWICE below — once bare on the
  // chrome-trusted channel, once through registerInternalHandler on the
  // internal-origin-gated `internal-history-*` twin.

  function handleList(_e, p) {
    if (isMalformed(p)) return { ok: false, error: 'history: list — malformed-payload' };
    if (!isKnownJar(p.jarId)) return { ok: false, error: 'history: list — unknown-jar' };
    // `before: null` is the documented no-cursor value (edge case, leg spec) —
    // explicitly excluded from the bad-args check, not just "absent".
    if ((p.limit !== undefined && !isFiniteNumber(p.limit)) ||
        (p.before !== undefined && p.before !== null && !isFiniteNumber(p.before))) {
      return { ok: false, error: 'history: list — bad-args' };
    }
    try {
      /** @type {{ limit?: number, before?: number | null }} */
      const opts = {};
      if (p.limit !== undefined) opts.limit = p.limit;
      // `before: null` is the documented no-cursor value — pass it through
      // (the store's default param already treats null the same as absent);
      // an explicit `undefined` is simply omitted (opts key absent either way).
      if (p.before !== undefined) opts.before = p.before;
      return { ok: true, visits: historyStore.listRecent(p.jarId, opts) };
    } catch (err) {
      console.error('[history]', err);
      return { ok: false, error: 'history: list — store-failure' };
    }
  }

  function handleSearch(_e, p) {
    if (isMalformed(p)) return { ok: false, error: 'history: search — malformed-payload' };
    if (!isKnownJar(p.jarId)) return { ok: false, error: 'history: search — unknown-jar' };
    if (typeof p.query !== 'string' || (p.limit !== undefined && !isFiniteNumber(p.limit))) {
      return { ok: false, error: 'history: search — bad-args' };
    }
    try {
      /** @type {{ limit?: number }} */
      const opts = {};
      if (p.limit !== undefined) opts.limit = p.limit;
      return { ok: true, visits: historyStore.search(p.jarId, p.query, opts) };
    } catch (err) {
      console.error('[history]', err);
      return { ok: false, error: 'history: search — store-failure' };
    }
  }

  function handleDelete(_e, p) {
    if (isMalformed(p)) return { ok: false, error: 'history: delete — malformed-payload' };
    if (!isKnownJar(p.jarId)) return { ok: false, error: 'history: delete — unknown-jar' };
    if (!isFiniteNumber(p.visitId)) return { ok: false, error: 'history: delete — bad-args' };
    try {
      const deleted = historyStore.deleteVisit(p.jarId, p.visitId);
      if (!deleted) return { ok: false, error: 'history: delete — not-found' };
      broadcast('history-changed', { jarId: p.jarId });
      return { ok: true };
    } catch (err) {
      console.error('[history]', err);
      return { ok: false, error: 'history: delete — store-failure' };
    }
  }

  function handleClear(_e, p) {
    if (isMalformed(p)) return { ok: false, error: 'history: clear — malformed-payload' };
    if (!isKnownJar(p.jarId)) return { ok: false, error: 'history: clear — unknown-jar' };
    try {
      const n = historyStore.clearJar(p.jarId);
      if (n > 0) broadcast('history-changed', { jarId: p.jarId });
      return { ok: true, cleared: n };
    } catch (err) {
      console.error('[history]', err);
      return { ok: false, error: 'history: clear — store-failure' };
    }
  }

  // M08 Flight 2 Leg 1 / DD6: the jars page's History panel count line. Read-only
  // — no broadcast (querying never changes state).
  function handleCount(_e, p) {
    if (isMalformed(p)) return { ok: false, error: 'history: count — malformed-payload' };
    if (!isKnownJar(p.jarId)) return { ok: false, error: 'history: count — unknown-jar' };
    try {
      return { ok: true, count: historyStore.countByJar(p.jarId) };
    } catch (err) {
      console.error('[history]', err);
      return { ok: false, error: 'history: count — store-failure' };
    }
  }

  // Chrome-trusted channels.
  ipcMain.handle('history-list', handleList);
  ipcMain.handle('history-search', handleSearch);
  ipcMain.handle('history-delete', handleDelete);
  ipcMain.handle('history-clear', handleClear);
  ipcMain.handle('history-count', handleCount);

  // Internal-origin-gated twins — same handler bodies, reached only by an
  // allowlisted goldfinch:// internal page (the jars/history management page).
  registerInternalHandler(ipcMain, 'internal-history-list', handleList);
  registerInternalHandler(ipcMain, 'internal-history-search', handleSearch);
  registerInternalHandler(ipcMain, 'internal-history-delete', handleDelete);
  registerInternalHandler(ipcMain, 'internal-history-clear', handleClear);
  registerInternalHandler(ipcMain, 'internal-history-count', handleCount);
}

module.exports = { registerHistoryIpc };
