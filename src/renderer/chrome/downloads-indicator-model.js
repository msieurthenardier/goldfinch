// @ts-check

// Pure decision model for the chrome top-bar downloads indicator (M11 F1 Leg 2,
// DD5). DOM-free and TIMER-free — the reducer folds the download-progress /
// download-done broadcast stream (plus explicit acknowledge / expire events) into
// an immutable accumulator state, and deriveModel projects that state into the
// view-model the controller applies to the DOM. Expiry is time-injected (the
// caller passes `now`), so the whole truth table is unit-testable without a clock.
// Same pure-reducer→render split as buildAutomationIndicatorModel /
// renderAutomationIndicator (privacy-controller.js).
//
// The chrome kept no recent-completed list before this leg (DD5). State shape:
//   - inFlight: Map<id, { filename, received, total, paused, state }> — live downloads
//     keyed by the main-side numeric download id (download-progress feed).
//   - recent:   Array<{ id, filename, state, savePath }> — newest-first, capped at 25
//     (download-done feed); oldest evicted past the cap.
//   - acknowledged: true once the popup was opened (Leg 3 calls acknowledge()); reset
//     to false by any new completion so a fresh finish re-shows the indicator.
//   - lastCompletionAt: timestamp of the most recent completion, for the idle expiry.
//
// Visibility (HAT fix, Leg 4): inFlight.size > 0 || recent.length > 0 — the indicator
// PERSISTS after a completion AND after the popup has been viewed (Chrome-like), hiding
// only via the 5-minute idle `expire` event clearing `recent`. Acknowledgment
// (`acknowledged`) no longer affects visibility at all; it now only controls the
// separate `attention` (new/unseen) emphasis flag deriveModel returns.

const RECENT_CAP = 25;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes after the last completion

/**
 * @typedef {{ id: number, filename: string, received?: number, total?: number, paused?: boolean, state?: string }} InFlightEntry
 * @typedef {{ id: number, filename: string, state?: string, savePath?: string|null }} RecentEntry
 * @typedef {{ inFlight: Map<number, InFlightEntry>, recent: RecentEntry[], acknowledged: boolean, lastCompletionAt: number|null }} DownloadsState
 */

/** @returns {DownloadsState} */
export function initialState() {
  return { inFlight: new Map(), recent: [], acknowledged: false, lastCompletionAt: null };
}

/**
 * Pure reducer — never mutates `state`; returns a fresh state (fresh Map + array).
 * @param {DownloadsState} state
 * @param {{ type: 'progress'|'done'|'acknowledge'|'expire', d?: any, now?: number }} event
 * @returns {DownloadsState}
 */
export function reduce(state, event) {
  switch (event && event.type) {
    case 'progress': {
      const d = event.d || {};
      const inFlight = new Map(state.inFlight);
      inFlight.set(d.id, {
        id: d.id,
        filename: d.filename,
        received: d.received,
        total: d.total,
        paused: d.paused,
        state: d.state,
      });
      return { ...state, inFlight };
    }
    case 'done': {
      const d = event.d || {};
      const inFlight = new Map(state.inFlight);
      inFlight.delete(d.id);
      // Prepend newest-first, then truncate to the cap (evict oldest / tail).
      const recent = [
        { id: d.id, filename: d.filename, state: d.state, savePath: d.savePath ?? null },
        ...state.recent,
      ].slice(0, RECENT_CAP);
      return {
        ...state,
        inFlight,
        recent,
        acknowledged: false,
        lastCompletionAt: typeof event.now === 'number' ? event.now : state.lastCompletionAt,
      };
    }
    case 'acknowledge': {
      return { ...state, acknowledged: true };
    }
    case 'expire': {
      // Only clears once nothing is in-flight AND the idle window has fully elapsed
      // since the last completion. Otherwise a no-op (returns state unchanged).
      if (state.inFlight.size > 0) return state;
      if (state.lastCompletionAt == null) return state;
      if (typeof event.now !== 'number') return state;
      if (event.now - state.lastCompletionAt < IDLE_TIMEOUT_MS) return state;
      return { ...state, recent: [], acknowledged: false, lastCompletionAt: null };
    }
    default:
      return state;
  }
}

/**
 * Project the accumulator into the view-model the controller applies to the DOM.
 * State is conveyed in WORDS via ariaLabel (never color/animation alone).
 * `visible` persists across acknowledgment (HAT fix, Leg 4) — only `active` /
 * `recentCount` drive it. `attention` is the separate "new/unseen" emphasis flag:
 * true when there are recent completions the user hasn't viewed (opened the popup)
 * yet; acknowledging clears it without hiding the button.
 * @param {DownloadsState} state
 * @returns {{ visible: boolean, active: boolean, activeCount: number, recentCount: number, attention: boolean, ariaLabel: string }}
 */
export function deriveModel(state) {
  const activeCount = state.inFlight.size;
  const active = activeCount > 0;
  const recentCount = state.recent.length;
  const visible = active || recentCount > 0;
  const attention = recentCount > 0 && !state.acknowledged;

  let ariaLabel;
  if (active) {
    const allPaused = [...state.inFlight.values()].every((e) => e && e.paused);
    const lead = allPaused ? 'Downloads paused' : 'Downloading';
    ariaLabel = `${lead} — ${activeCount} in progress`;
  } else if (recentCount > 0) {
    ariaLabel = `Downloads — ${recentCount} recently completed`;
  } else {
    ariaLabel = 'Downloads';
  }

  return { visible, active, activeCount, recentCount, attention, ariaLabel };
}

export { RECENT_CAP, IDLE_TIMEOUT_MS };
