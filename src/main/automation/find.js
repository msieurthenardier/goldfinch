// @ts-check
'use strict';

// Automation engine — find in page ops.
//
// Provides findInPage/stopFindInPage over a resolved webContents, keyed by
// wcId.
//
// MAIN-PROCESS found-in-page MODEL:
// Guests are now WebContentsViews whose webContents emit found-in-page to
// main — proven in production since Flight 3, where the user find bar already
// runs through it (tab-find IPC main.js:1499 → wc.findInPage() → the
// permanent found-in-page listener main.js:670 → tab-found-in-page →
// renderer.js:2787). This module operates on the guest wc directly: it calls
// wc.findInPage() and listens for found-in-page on the same wc, correlating
// on the requestId returned by wc.findInPage().
//
// REQUEST-ID CORRELATION:
// wc.findInPage(text, opts) returns a numeric requestId. The found-in-page
// event's result object carries the same requestId. This op listens on wc for
// found-in-page and ignores events whose result.requestId is not one it
// issued — so concurrent finds (e.g. the user bar firing at the same time,
// which the permanent main.js:670 listener also services) are never
// misattributed. Each retry issue() gets a fresh requestId; all are tracked in
// a Set so a late event from an earlier retry attempt still correlates.
//
// COLD-START RETRY (resolve-on-nonzero):
// On freshly-loaded guests in the WSLg automation environment, Chromium may
// emit a spurious found-in-page event with finalUpdate:true, matches:0 BEFORE
// the real count populates. Resolving on any finalUpdate returns {0,0} on a
// cold start; a re-issued find then reports the real count. The op therefore
// resolves IMMEDIATELY only when finalUpdate===true AND matches>0; on
// finalUpdate===true with matches===0 it records `last` and the retry interval
// re-issues the find (every RETRY=500ms, up to MAX=5 attempts within the
// overall findTimeoutMs). After MAX attempts or timeout, resolve with `last`
// ({0,0} for a genuine no-match — correct). Re-issues use the caller's
// original opts — no findNext:true on retry (that would corrupt the
// active-match ordinal). Whether the cold-start quirk still reproduces under
// WebContentsView is re-verified live in Leg 4's find-in-page Witnessed run;
// porting the retry keeps correctness regardless.
//
// SECURITY (DD5): Both ops carry an op-local isInternalContents guard AFTER
// resolveContents. The admin engine builds deps with { allowInternal: true },
// so resolveContents alone would let admin find in goldfinch://settings. The
// op-local guard closes that path — internal pages are refused even under
// the admin key, matching the zoom.js/print.js discipline. The guard fires
// BEFORE the foreground-first activate.
//
// FOREGROUND-FIRST (AC5): For backgrounded guests, findInPage activates then
// re-resolves before issuing the search (mirrors print.js discipline). The
// post-activate re-resolve result is ASSIGNED back to wc so the find is
// issued on the live, re-resolved handle.
// stopFindInPage has no foreground requirement — it clears any active find
// session regardless of foreground state.
//
// ELECTRON-FREE: no require('electron') at the top. Electron handles are
// injected via deps so the module is unit-testable under plain node --test
// with fake deps (a fake wc EventEmitter + findInPage/stopFindInPage methods).

const { resolveContents, classifyContents, isInternalContents } = require('./resolve');

/**
 * Search for text in a webContents (identified by wcId) by calling
 * wc.findInPage() on the guest webContents and listening for the
 * found-in-page event on the same wc, correlated by requestId.
 *
 * Resolves only when finalUpdate===true AND matches>0 (non-zero resolve)
 * to guard against the WSLg cold-start spurious finalUpdate:true,matches:0
 * event. On cold-start spurious events the op records `last` and the retry
 * interval re-issues the find (up to MAX=5 every 500ms within the overall
 * findTimeoutMs). A genuine no-match resolves after retries with {0,0}.
 *
 * SECURITY: op-local internal-session guard AFTER resolveContents — internal
 * pages are refused even when deps carries allowInternal:true. Guard fires
 * BEFORE activate.
 *
 * @param {number} wcId
 * @param {string} text  text to search for
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents?: any,
 *   allowInternal?: boolean,
 *   activate?: (wcId: number) => Promise<void>,
 *   findTimeoutMs?: number,
 * }} deps
 * @param {{ forward?: boolean, findNext?: boolean, matchCase?: boolean }} [opts]
 * @returns {Promise<{ activeMatchOrdinal: number, matches: number }>}
 */
async function findInPage(wcId, text, deps, { forward = true, findNext = false, matchCase = false } = {}) {
  let wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: findInPage — internal-session excluded');
  }

  // Foreground-first for guest tabs (mirrors print.js discipline).
  // Post-activate re-resolve is ASSIGNED to wc so the find is issued on the
  // live, re-resolved handle (the pre-activate handle may be stale after the
  // async hop).
  if (classifyContents(wc, deps.chromeContents) === 'guest' && typeof deps.activate === 'function') {
    await deps.activate(wcId);
    wc = resolveContents(wcId, deps); // post-activate stale-handle re-resolve (bad-handle / dead check)
  }

  const timeoutMs = (deps && deps.findTimeoutMs) || 3000;
  const findOpts = { forward, findNext, matchCase };

  // requestId-correlated promise with cold-start retry.
  //
  // Each issue() call obtains a fresh requestId from Electron and adds it to
  // `issued`. The found-in-page listener ignores events whose requestId is not
  // in `issued`, so concurrent finds (e.g. the user bar) are never
  // misattributed. All retry requestIds are tracked so a late event from an
  // earlier retry still correlates.
  //
  // MAX-retry exhaustion resolves `last` immediately (finish(last) in the
  // interval) so the interval does not busy-spin until the timeout fires.
  const res = await new Promise((resolve) => {
    const RETRY = 500, MAX = 5;
    const issued = new Set();
    let last = { activeMatchOrdinal: 0, matches: 0 };
    let attempts = 0, done = false, iv = null, to = null;

    const cleanup = () => {
      if (iv) clearInterval(iv);
      if (to) clearTimeout(to);
      wc.removeListener('found-in-page', onFound);
    };
    const finish = (v) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(v);
    };

    function onFound(_e, result) {
      if (!result || !issued.has(result.requestId)) return; // requestId correlation
      last = { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches };
      if (result.finalUpdate === true && result.matches > 0) finish(last); // cold-start: resolve only on nonzero
    }

    const issue = () => {
      attempts++;
      issued.add(wc.findInPage(text, findOpts)); // same opts on retry — no findNext flip
    };

    wc.on('found-in-page', onFound);
    issue();
    iv = setInterval(() => {
      if (done) return;
      if (attempts >= MAX) { finish(last); return; }
      issue();
    }, RETRY);
    to = setTimeout(() => finish(last), timeoutMs);
  });

  return { activeMatchOrdinal: res.activeMatchOrdinal || 0, matches: res.matches || 0 };
}

/**
 * Clear the active find session on a webContents (clearSelection) by calling
 * wc.stopFindInPage('clearSelection') on the guest webContents directly.
 *
 * Op-local internal-session guard: runs AFTER resolveContents so it fires
 * even when deps carries allowInternal:true (admin).
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents?: any,
 *   allowInternal?: boolean,
 * }} deps
 * @returns {Promise<{ ok: true }>}
 */
async function stopFindInPage(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: stopFindInPage — internal-session excluded');
  }

  wc.stopFindInPage('clearSelection');
  return { ok: true };
}

module.exports = { findInPage, stopFindInPage };
