/**
 * Pure, DOM-free pagination + freshness state machine for the Settings activity
 * viewer (Flight 7, Leg 6, DD4). Windows the renderer-side audit ring snapshot
 * at 20 entries/page, newest-first, with freeze-on-page-2+ so the operator can
 * read older entries coherently while a bulk run floods the live ring.
 *
 * Real ES module (M07 Flight 2 sweep): pure `export` bindings only — the six
 * functions are exported under their canonical names (the test runner requires
 * them via require(esm); settings.html loads the file via a `type="module"`
 * tag and pages/settings.js imports what it uses). Canonical name: `activeLog`
 * (the old page-global alias `activeLogOf` was retired with the M07-F2
 * transitional-bridge removal).
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
export function windowPage(activeLog, page, pageSize) {
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
export function countNewer(liveLog, frozenLog) {
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
export function activeLog(state) {
  return state.frozenLog ?? state.liveLog;
}

/**
 * Number of pages for `total` entries at `pageSize`. Always >= 1 (an empty log
 * is still "page 1 of 1") so navigation/clamping has a coherent floor.
 *
 * @param {number} total
 * @param {number} pageSize
 * @returns {number}
 */
export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Pure helper that builds a conventional numbered-pagination model: a list of
 * page numbers interleaved with `'…'` ellipsis markers for gaps. Always shows
 * the first/last `edge` pages and `around` pages on each side of `currentPage`;
 * collapses the rest to a single `'…'`. An ellipsis is only emitted when it
 * replaces MORE than one page (a lone gap of 1 is rendered as that page number,
 * never as `…`) — the standard `‹ 1 … 4 5 6 … 12 ›` look.
 *
 * @param {number} total       total entries
 * @param {number} pageSize    entries per page
 * @param {number} currentPage 1-based current page
 * @param {{edge?: number, around?: number}} [opts]
 * @returns {Array<number|'…'>} e.g. [1, '…', 4, 5, 6, '…', 12]
 */
export function pageList(total, pageSize, currentPage, opts) {
  const edge = opts && typeof opts.edge === 'number' ? opts.edge : 1;
  const around = opts && typeof opts.around === 'number' ? opts.around : 1;
  const count = pageCount(total, pageSize);
  const cur = Math.min(Math.max(currentPage, 1), count);

  // Collect the set of page numbers to show explicitly.
  const show = new Set();
  for (let p = 1; p <= edge && p <= count; p += 1) show.add(p);
  for (let p = count - edge + 1; p <= count; p += 1) { if (p >= 1) show.add(p); }
  for (let p = cur - around; p <= cur + around; p += 1) { if (p >= 1 && p <= count) show.add(p); }

  const pages = [...show].sort((a, b) => a - b);
  /** @type {Array<number|'…'>} */
  const out = [];
  let prev = 0;
  for (const p of pages) {
    const gap = p - prev;
    if (prev !== 0 && gap > 1) {
      // A gap of exactly 1 missing page is filled with that page (no lone …).
      if (gap === 2) out.push(prev + 1);
      else out.push('…');
    }
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * The freshness state machine. Pure: returns a new state, never mutates.
 *
 * Events:
 *  - {type:'broadcast', log} — page 1: update liveLog, stay live (frozenLog
 *    stays null). page >= 2: update liveLog only, KEEP frozenLog (rows stable;
 *    only what a higher page renders is the frozen snapshot).
 *  - {type:'next'} — no-op if !hasNext (clamp). Else page+1; entering page >= 2
 *    from page 1 snapshots frozenLog = liveLog.
 *  - {type:'prev'} — no-op if !hasPrev. Else page-1; landing on page 1 clears
 *    frozenLog (resumes live). A broadcast arriving the same tick will NOT
 *    re-freeze (page is 1 -> stays live).
 *  - {type:'goto', page:N} — clamp N to [1, pageCount]. Page 1 clears frozenLog
 *    (resumes live). Page >= 2 freezes frozenLog = liveLog if currently live,
 *    else keeps the existing snapshot (navigating between frozen pages does not
 *    re-snapshot). This is the single navigation event the numbered pager uses;
 *    next/prev are kept as thin wrappers over the same freeze contract.
 *  - {type:'back-to-live'} — page=1, frozenLog=null (same end-state as goto 1).
 *
 * @param {PagerState} state
 * @param {{type:string, log?: AuditEntry[], page?: number}} event
 * @returns {PagerState}
 */
export function reduceAudit(state, event) {
  const PAGE_SIZE = 20;
  switch (event.type) {
    case 'broadcast': {
      const log = Array.isArray(event.log) ? event.log : [];
      // page 1 -> live: update liveLog, frozenLog stays null.
      // page >= 2 -> frozen: update liveLog only, keep frozenLog.
      return { ...state, liveLog: log };
    }
    case 'goto': {
      // Clamp the target into [1, pageCount] against the ACTIVE log (frozen while
      // frozen, live on page 1) so a navigation can't overshoot the snapshot.
      const total = activeLog(state).length;
      const target = Math.min(Math.max(event.page | 0, 1), pageCount(total, PAGE_SIZE));
      if (target === 1) {
        // Page 1 always resumes live.
        return { ...state, page: 1, frozenLog: null };
      }
      // Page >= 2: freeze the live ring on first leaving page 1; otherwise keep
      // the snapshot already taken (moving between frozen pages must not re-snap).
      const frozenLog = state.frozenLog != null ? state.frozenLog : state.liveLog;
      return { ...state, page: target, frozenLog };
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
