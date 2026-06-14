// @ts-check
'use strict';
// Shared CDP debugger discipline for the automation engine.
//
// This module owns:
//   - The single-client lock Set (`attached`) keyed on stable wcId
//   - The debugger-unavailable refusal builder
//   - The withDebuggerSession() helper that enforces attach-on-demand /
//     detach-in-finally / single-client lock as one unit
//
// Both readAxTree (observe.js) and scroll (input.js) share the SAME `attached`
// Set so a concurrent scroll + readAxTree on the SAME wcId cannot both attach.
// This is the DD8-crossing approved by the operator: scroll is now a debugger
// op; input.js is no longer debugger-free, but the shared lock prevents the
// single-client CDP conflict that would otherwise arise.
//
// ELECTRON-FREE at top — injected deps only, so this module is unit-testable
// offline with fakes.

// Single-client lock (DD7): wcIds with an in-flight debugger attach. The
// has()/add() pair is synchronous (no await between) so concurrent calls on
// the same contents are race-safe.
const attached = new Set();

/**
 * Build the discriminated debugger-unavailable refusal object (DD8/DD9).
 * Returned (NOT thrown) when the contents is already held — either the
 * in-engine lock (`reason: 'locked'`) or a real attach failure
 * (`reason: 'attach-failed'`, another CDP client holds it).
 *
 * Structurally distinct from any success value — callers discriminate by
 * checking `result.automation === 'debugger-unavailable'` or, for readAxTree,
 * `Array.isArray(result)`.
 *
 * @param {number} wcId
 * @param {'locked' | 'attach-failed'} reason
 * @returns {{ automation: 'debugger-unavailable', reason: string, wcId: number }}
 */
const debuggerUnavailable = (wcId, reason) =>
  ({ automation: 'debugger-unavailable', reason, wcId });

/**
 * Acquire the single-client lock for `wcId`, attach the CDP debugger, run
 * `fn(wc)`, detach in a finally, release the lock in a finally.
 *
 * Lock discipline (mirrors readAxTree):
 *   - `attached.has(wcId)` + `attached.add(wcId)` are synchronous with NO
 *     await between them, so concurrent callers cannot both slip through.
 *   - If `attached.has(wcId)` → returns `debuggerUnavailable(wcId, 'locked')`
 *     (a normal result, not a throw).
 *   - If `wc.debugger.attach('1.3')` throws → returns
 *     `debuggerUnavailable(wcId, 'attach-failed')` (another CDP client holds
 *     it).
 *   - Post-attach errors from `fn(wc)` propagate — the debugger WAS available
 *     (these are not "debugger-unavailable" outcomes). `detach()` still runs in
 *     the finally and its own throw is swallowed so the original error is not
 *     masked.
 *
 * @param {number} wcId  stable wcId (key for the lock)
 * @param {any} wc  the resolved webContents (post-activate, post-re-resolve)
 * @param {(wc: any) => Promise<any>} fn  async body that issues sendCommand calls
 * @returns {Promise<any>}  fn's return value, or a debugger-unavailable refusal
 */
async function withDebuggerSession(wcId, wc, fn) {
  if (attached.has(wcId)) return debuggerUnavailable(wcId, 'locked'); // sync check…
  attached.add(wcId);                                                  // …+ add (no await between)
  try {
    try {
      wc.debugger.attach('1.3');
    } catch {
      return debuggerUnavailable(wcId, 'attach-failed');  // another CDP client holds it (DD8)
    }
    try {
      return await fn(wc);
    } finally {
      try { wc.debugger.detach(); } catch { /* already detached — don't mask the outcome */ }
    }
  } finally {
    attached.delete(wcId);  // release lock even on attach-throw or fn() throw/return
  }
}

module.exports = { attached, debuggerUnavailable, withDebuggerSession };
