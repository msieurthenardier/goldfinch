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
 * @typedef {{ id: number, filename: string, state?: string, savePath?: string|null, endTime?: number }} RecentEntry
 * @typedef {{ inFlight: Map<number, InFlightEntry>, recent: RecentEntry[], acknowledged: boolean, lastCompletionAt: number|null }} DownloadsState
 */

/** @returns {DownloadsState} */
export function initialState() {
  return { inFlight: new Map(), recent: [], acknowledged: false, lastCompletionAt: null };
}

/**
 * Pure reducer — never mutates `state`; returns a fresh state (fresh Map + array).
 * @param {DownloadsState} state
 * @param {{ type: 'progress'|'done'|'hydrate'|'acknowledge'|'expire', d?: any, now?: number, seen?: Set<number> }} event
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
      // Cancelled/interrupted terminal events are not completions. Remove them
      // from the live set without polluting the completed count or rendering an
      // eternally "In progress" terminal row in the popup.
      if (d.state !== 'completed') return { ...state, inFlight };
      const eventNow = typeof event.now === 'number' ? event.now : null;
      // A gap of five minutes starts a new completion epoch. This makes the
      // live reducer reconstructible from the canonical terminal history when
      // a later window hydrates.
      const sameEpoch = eventNow == null || state.lastCompletionAt == null
        || eventNow - state.lastCompletionAt < IDLE_TIMEOUT_MS;
      // Prepend newest-first, then truncate to the cap (evict oldest / tail).
      const recent = [
        {
          id: d.id,
          filename: d.filename,
          state: d.state,
          savePath: d.savePath ?? null,
          endTime: eventNow ?? undefined
        },
        ...(sameEpoch ? state.recent : []).filter((entry) => entry.id !== d.id),
      ].slice(0, RECENT_CAP);
      return {
        ...state,
        inFlight,
        recent,
        acknowledged: false,
        lastCompletionAt: eventNow ?? state.lastCompletionAt,
      };
    }
    case 'hydrate': {
      const now = typeof event.now === 'number' ? event.now : null;
      const rows = Array.isArray(event.d) ? event.d : [];
      const seen = event.seen instanceof Set ? event.seen : new Set();
      const inFlight = new Map(state.inFlight);
      const recentById = new Map(state.recent.map((entry) => [entry.id, entry]));
      for (const row of rows) {
        if (!row || typeof row.id !== 'number' || seen.has(row.id)) continue;
        if (row.active === true) {
          inFlight.set(row.id, {
            id: row.id,
            filename: row.filename,
            received: row.received,
            total: row.total,
            paused: row.paused,
            state: row.state,
          });
          continue;
        }
        if (row.state !== 'completed' || typeof row.endTime !== 'number') continue;
        recentById.set(row.id, {
          id: row.id,
          filename: row.filename,
          state: row.state,
          savePath: null,
          endTime: row.endTime,
        });
      }
      const candidates = [...recentById.values()].sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
      const latestAt = candidates[0]?.endTime ?? null;
      const epochActive = now != null && latestAt != null && now - latestAt < IDLE_TIMEOUT_MS;
      const recent = [];
      if (epochActive) {
        let newerAt = /** @type {number} */ (latestAt);
        for (const entry of candidates) {
          const endTime = entry.endTime ?? 0;
          if (newerAt - endTime >= IDLE_TIMEOUT_MS) break;
          recent.push(entry);
          newerAt = endTime;
          if (recent.length === RECENT_CAP) break;
        }
      }
      return {
        ...state,
        inFlight,
        recent,
        lastCompletionAt: epochActive ? latestAt : null,
      };
    }
    case 'acknowledge': {
      return { ...state, acknowledged: true };
    }
    case 'expire': {
      // Clear completion history once its idle window elapsed. An active download
      // still keeps the indicator visible through inFlight; it must not bridge two
      // otherwise-separated completion epochs.
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
