// @ts-check
'use strict';

// Continuous, debounced session-snapshot writer (squawk 0073). Before this module
// existed, the on-disk session snapshot was written ONLY at `before-quit` (graceful
// quit) and per-window `close` — nothing wrote it while the app was just sitting there
// being browsed. A hard kill (the Windows NSIS installer's Stop-Process, a crash, power
// loss, `taskkill /F`) fires none of those events, so the relaunch restored whatever the
// LAST graceful quit had written, however stale.
//
// Electron-free / injected-deps (the house shape — automation/engine.js,
// menu-overlay-manager.js, find-overlay-geometry.js precedent): this module owns the
// debounce/flush/cancel MECHANICS only and knows nothing about settings, the window
// registry, or session-store. The domain-specific gate (is restoreSession on, is a
// boot-restore still in flight, has the snapshot actually changed) lives entirely in the
// injected `write`/`isPending` callbacks, built once in main.js where every dependency
// they need (settings, registry, jars, sessionStore, buildSessionSnapshot, appDb) is
// already in scope — so this module unit-tests offline with fakes, same as its siblings.
//
// API: schedule() arms/re-arms a single trailing debounce timer (default 1500ms);
// flush() performs the pending write NOW (if one is armed) and cancels the timer;
// cancel() drops a pending write without writing. A write that throws — or an isPending
// check that throws — is swallowed and logged: a broken snapshot write must never
// propagate into whatever IPC/event handler called schedule()/flush().
//
// THE BOOT-RESTORE HAZARD (squawk 0073 #4): a debounced write firing while a window has
// received only SOME of its saved tabs would overwrite the good on-disk snapshot with a
// partial one — the exact data loss this module exists to prevent. `isPending` is the
// injected escape hatch for that: when it reports true at fire time, the scheduler
// RE-ARMS itself (same delay) instead of writing and instead of dropping the request —
// a later topology event's schedule() call is redundant with that re-arm (harmless,
// `schedule()` just replaces the pending timer), and if no later event ever arrives, the
// re-arm loop itself keeps retrying until `isPending` finally clears (typically the
// settle timeout in `isRestorePending` below).

const DEFAULT_DELAY_MS = 1500;

/**
 * @param {{
 *   write: () => void,
 *   setTimeout: (fn: () => void, ms: number) => any,
 *   clearTimeout: (handle: any) => void,
 *   delayMs?: number,
 *   isPending?: () => boolean,
 *   logger?: { error: (...args: any[]) => void }
 * }} deps
 * @returns {{ schedule: () => void, flush: () => void, cancel: () => void }}
 */
function createSessionSnapshotScheduler({
  write,
  setTimeout: scheduleTimer,
  clearTimeout: cancelTimer,
  delayMs = DEFAULT_DELAY_MS,
  isPending = () => false,
  logger = console
}) {
  /** @type {any} */
  let timer = null;

  function arm() {
    if (timer !== null) cancelTimer(timer);
    timer = scheduleTimer(fire, delayMs);
    // Standing-timer hygiene (matches pruneAllJars' interval, clipboardClearTimer, the
    // vault timers): never let this debounce alone hold the event loop open. Guarded —
    // MockTimers handles (and any other fake timer used in tests) may not expose unref.
    if (typeof (/** @type {any} */ (timer)?.unref) === 'function') timer.unref();
  }

  function fire() {
    timer = null;
    let pending = false;
    try {
      pending = !!isPending();
    } catch (error) {
      logger.error('[session-snapshot-scheduler] isPending check failed:', error);
    }
    if (pending) {
      // Still mid boot-restore (or the caller's own gate refused): re-arm rather than
      // write a partial snapshot, and rather than silently dropping the request.
      arm();
      return;
    }
    try {
      write();
    } catch (error) {
      logger.error('[session-snapshot-scheduler] write failed:', error);
    }
  }

  function flush() {
    if (timer === null) return;
    cancelTimer(timer);
    timer = null;
    fire(); // re-arms internally (via arm()) if `isPending` is still true — flush can
    // never force a partial write through the gate.
  }

  function cancel() {
    if (timer === null) return;
    cancelTimer(timer);
    timer = null;
  }

  return { schedule: arm, flush, cancel };
}

/**
 * Pure boot-restore gate (squawk 0073 #4). A record is PENDING iff it carries a
 * non-empty `restoreTabs` (the boot-restore payload set on the record when a saved
 * window is recreated) AND its live `tabViews` has not yet reached that count —
 * UNLESS `settleMs` has elapsed since that record's boot config was served
 * (`bootConfigServedAt`), which covers a saved URL legitimately rejected by
 * `isSafeTabUrl` at `tab-create` and never arriving at all. A record with no
 * `restoreTabs` (a fresh window, a `noBootTab` window, or one whose restore already
 * completed) never blocks. The overall result is `true` iff ANY record is pending —
 * a debounced write touches every window's topology at once (`buildSessionSnapshot`
 * walks `windows`), so one still-restoring window must gate the whole write.
 * @param {Array<{
 *   restoreTabs?: Array<any> | null,
 *   tabViews?: Map<any, any> | { size: number } | null,
 *   bootConfigServedAt?: number | null
 * }> | null | undefined} records
 * @param {number} now
 * @param {number} [settleMs]
 * @returns {boolean}
 */
function isRestorePending(records, now, settleMs = 30000) {
  for (const rec of records || []) {
    if (!rec || !rec.restoreTabs || rec.restoreTabs.length === 0) continue;
    const have = rec.tabViews ? rec.tabViews.size : 0;
    if (have >= rec.restoreTabs.length) continue;
    const servedAt = rec.bootConfigServedAt;
    if (typeof servedAt === 'number' && now - servedAt >= settleMs) continue; // settled — release
    return true;
  }
  return false;
}

/**
 * Wrap a snapshot builder + persist call with a process-local dedupe cache (squawk
 * 0073 #2): skip the persist call when the newly built snapshot serializes IDENTICALLY
 * to the last one this process actually wrote — avoids hammering app.db on a no-op
 * topology event (e.g. a same-URL in-page navigation that didn't change the tab set).
 * `buildSnapshot` returning `null`/`undefined` means "nothing to write this time" (the
 * restoreSession setting is off, the boot-restore gate is pending, there are no
 * windows, …) and is a no-op that does NOT touch the dedupe cache — a later real
 * snapshot is still compared against the last one actually PERSISTED, not the last one
 * merely considered.
 * @param {{
 *   buildSnapshot: () => any,
 *   persist: (snapshot: any) => void,
 *   serialize?: (snapshot: any) => string
 * }} deps
 * @returns {() => void} suitable as `createSessionSnapshotScheduler`'s `write`.
 */
function createDedupedSnapshotWriter({ buildSnapshot, persist, serialize = JSON.stringify }) {
  /** @type {string | null} */
  let lastSerialized = null;
  return function writeSnapshotDeduped() {
    const snapshot = buildSnapshot();
    if (snapshot == null) return;
    const serialized = serialize(snapshot);
    if (serialized === lastSerialized) return;
    persist(snapshot);
    lastSerialized = serialized;
  };
}

module.exports = { createSessionSnapshotScheduler, isRestorePending, createDedupedSnapshotWriter };
