'use strict';

/**
 * Pure, DOM-free pagination + freshness state machine for the Settings activity
 * viewer (Flight 7, Leg 6, DD4). Windows the renderer-side audit ring snapshot
 * at 20 entries/page, newest-first, with freeze-on-page-2+ so the operator can
 * read older entries coherently while a bulk run floods the live ring.
 *
 * Mirrors the `src/shared/url-safety.js` dual-export idiom: a UMD tail that is
 * lint-clean here (the `src/shared/**` eslint block grants node globals, so
 * `module` is defined). The renderer loads it via `<script src=".../audit-paging.js">`
 * (sets browser globals); the test runner / main use `require()`.
 *
 * @typedef {Object} AuditEntry
 * @property {number} ts          epoch-ms timestamp
 * @property {string|null} [sessionId]
 * @property {string} [identity]
 * @property {string} [op]
 * @property {number|null} [targetWcId]
 * @property {string} [outcome]
 * @property {string|null} [errorCode]
 * @property {string|null} [detail]
 *
 * @typedef {Object} PagerState
 * @property {number} page                 1-based current page
 * @property {AuditEntry[]|null} frozenLog  snapshot taken on entering page >= 2, else null (live)
 * @property {AuditEntry[]} liveLog         the latest broadcast ring (newest-last)
 *
 * @typedef {Object} PageWindow
 * @property {AuditEntry[]} rows  the page's entries, newest-first
 * @property {number} total       total entries in the active log
 * @property {number} showingFrom 1-based index of the first row (0 when empty)
 * @property {number} showingTo   1-based index of the last row (0 when empty)
 * @property {boolean} hasPrev    page > 1
 * @property {boolean} hasNext    page * pageSize < total
 */

/**
 * Window a single page out of an activity log.
 *
 * `activeLog` is newest-LAST (the ring's natural append order). We reverse to
 * newest-first, then slice `[(page-1)*pageSize, page*pageSize)`. `total` is
 * derived from the PASSED `activeLog` — callers pass `activeLog(state)`
 * (`frozenLog ?? liveLog`), so the indicator never jumps to the live ring while
 * frozen.
 *
 * @param {AuditEntry[]} activeLog newest-last log to window
 * @param {number} page            1-based page number
 * @param {number} pageSize        entries per page (20 in the viewer)
 * @returns {PageWindow}
 */
function windowPage(activeLog, page, pageSize) {
  const log = Array.isArray(activeLog) ? activeLog : [];
  const total = log.length;
  const start = (page - 1) * pageSize;
  const end = page * pageSize;
  const rows = log.slice().reverse().slice(start, end);
  const showingFrom = rows.length ? start + 1 : 0;
  const showingTo = rows.length ? start + rows.length : 0;
  return {
    rows,
    total,
    showingFrom,
    showingTo,
    hasPrev: page > 1,
    hasNext: page * pageSize < total,
  };
}

/**
 * Count how many `liveLog` entries are strictly newer (by `ts`) than the newest
 * entry in `frozenLog`. Robust to ring eviction: it compares timestamps, NOT a
 * length delta — so when the ring is at capacity and `liveLog.length ===
 * frozenLog.length` but newer entries have arrived (evicting the oldest), the
 * count is still correct.
 *
 * @param {AuditEntry[]} liveLog   the latest live ring (newest-last)
 * @param {AuditEntry[]|null} frozenLog the frozen snapshot
 * @returns {number} count of liveLog entries with ts > max(frozenLog.ts)
 */
function countNewer(liveLog, frozenLog) {
  const live = Array.isArray(liveLog) ? liveLog : [];
  const frozen = Array.isArray(frozenLog) ? frozenLog : [];
  if (!frozen.length) return live.length;
  let maxFrozenTs = -Infinity;
  for (const e of frozen) {
    if (typeof e.ts === 'number' && e.ts > maxFrozenTs) maxFrozenTs = e.ts;
  }
  let n = 0;
  for (const e of live) {
    if (typeof e.ts === 'number' && e.ts > maxFrozenTs) n += 1;
  }
  return n;
}

/**
 * The single source of truth for rendering + windowing: the frozen snapshot if
 * frozen, else the live ring. Using this everywhere prevents any call site from
 * accidentally windowing the live ring while frozen.
 *
 * @param {PagerState} state
 * @returns {AuditEntry[]}
 */
function activeLog(state) {
  return state.frozenLog ?? state.liveLog;
}

/**
 * The freshness state machine. Pure: returns a new state, never mutates.
 *
 * Events:
 *  - {type:'broadcast', log} — page 1: update liveLog, stay live (frozenLog
 *    stays null). page >= 2: update liveLog only, KEEP frozenLog (rows stable;
 *    only the newer-count changes).
 *  - {type:'next'} — no-op if !hasNext (clamp). Else page+1; entering page >= 2
 *    from page 1 snapshots frozenLog = liveLog.
 *  - {type:'prev'} — no-op if !hasPrev. Else page-1; landing on page 1 clears
 *    frozenLog (resumes live). A broadcast arriving the same tick will NOT
 *    re-freeze (page is 1 -> stays live).
 *  - {type:'back-to-live'} — page=1, frozenLog=null (same end-state as prev-ing
 *    back to page 1).
 *
 * @param {PagerState} state
 * @param {{type:string, log?: AuditEntry[]}} event
 * @returns {PagerState}
 */
function reduceAudit(state, event) {
  const PAGE_SIZE = 20;
  switch (event.type) {
    case 'broadcast': {
      const log = Array.isArray(event.log) ? event.log : [];
      // page 1 -> live: update liveLog, frozenLog stays null.
      // page >= 2 -> frozen: update liveLog only, keep frozenLog.
      return { ...state, liveLog: log };
    }
    case 'next': {
      const win = windowPage(activeLog(state), state.page, PAGE_SIZE);
      if (!win.hasNext) return state; // clamp
      const nextPage = state.page + 1;
      // Entering page >= 2 from page 1 snapshots the live ring.
      const frozenLog = state.page === 1 ? state.liveLog : state.frozenLog;
      return { ...state, page: nextPage, frozenLog };
    }
    case 'prev': {
      const win = windowPage(activeLog(state), state.page, PAGE_SIZE);
      if (!win.hasPrev) return state; // clamp
      const prevPage = state.page - 1;
      // Landing on page 1 clears the freeze and resumes live.
      const frozenLog = prevPage === 1 ? null : state.frozenLog;
      return { ...state, page: prevPage, frozenLog };
    }
    case 'back-to-live': {
      return { ...state, page: 1, frozenLog: null };
    }
    default:
      return state;
  }
}

// Dual export: CommonJS (main process + test runner) and global (renderer,
// which runs with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { windowPage, countNewer, activeLog, reduceAudit };
} else {
  /** @type {any} */ (globalThis).windowPage = windowPage;
  /** @type {any} */ (globalThis).countNewer = countNewer;
  /** @type {any} */ (globalThis).activeLogOf = activeLog;
  /** @type {any} */ (globalThis).reduceAudit = reduceAudit;
}
