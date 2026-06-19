// @ts-check
'use strict';

// Automation engine — find in page ops.
//
// Provides findInPage/stopFindInPage over a resolved webContents, keyed by
// wcId.
//
// DEVIATION D1 (renderer-routed find):
// The main-process `found-in-page` event is NEVER delivered to any
// main-process webContents (not the guest wc, not chromeContents) for
// <webview> guests. Electron only fires it on the renderer-side <webview>
// DOM element. Therefore, this module routes all find operations through
// the chrome renderer: deps.chromeContents.executeJavaScript injects a
// script that (1) finds the <webview> by getWebContentsId(), (2) attaches
// a DOM `found-in-page` listener on the element (where the event DOES fire),
// (3) calls wv.findInPage() with cold-start retry, and (4) resolves ONLY
// when result.finalUpdate is true AND result.matches > 0 (non-zero resolve),
// with a timeout fallback. The result (activeMatchOrdinal + matches) is
// returned to the main process via the executeJavaScript return value.
//
// COLD-START RETRY (resolve-on-nonzero):
// On freshly-loaded webviews in the WSLg automation environment, Chromium
// emits a spurious `found-in-page` event with finalUpdate:true, matches:0
// BEFORE the real count populates. Resolving on any finalUpdate returns {0,0}
// on a cold start; a re-issued find then reports the real count. The injected
// script therefore resolves IMMEDIATELY only when finalUpdate===true AND
// matches>0; on finalUpdate===true with matches===0 it records `last` and
// lets the retry interval re-issue the find. The setInterval retries every
// RETRY=500ms, up to MAX=5 attempts within the overall TIMEOUT. After MAX
// attempts or TIMEOUT, resolve with `last` (which is {…,matches:0} for a
// genuine no-match — correct). On a working webview a real match resolves on
// attempt 1 (~3ms); on a cold webview it retries until a non-zero finalUpdate
// arrives. A genuine no-match resolves after retries (slightly slower, still
// correct). Re-issues use the caller's original OPTS — no findNext:true on
// retry, which would corrupt the active-match ordinal.
//
// SECURITY (DD5): Both ops carry an op-local isInternalContents guard AFTER
// resolveContents. The admin engine builds deps with { allowInternal: true },
// so resolveContents alone would let admin find in goldfinch://settings. The
// op-local guard closes that path — internal pages are refused even under
// the admin key, matching the zoom.js/print.js discipline.
//
// ELECTRON-FREE: no require('electron') at the top. Electron handles are
// injected via deps so the module is unit-testable under plain node --test
// with fake deps (including a fake chromeContents.executeJavaScript).
//
// FOREGROUND-FIRST (AC5): For backgrounded guests, findInPage activates then
// re-resolves before issuing the search (mirrors print.js discipline).
// stopFindInPage has no foreground requirement — it clears any active find
// session regardless of foreground state.

const { resolveContents, classifyContents, isInternalContents } = require('./resolve');

/**
 * Search for text in a webContents (identified by wcId) by routing the find
 * through the chrome renderer's <webview> DOM element.
 *
 * DEVIATION D1: main-process `found-in-page` events are never delivered for
 * <webview> guests. Instead, this op injects a script into the chrome renderer
 * that attaches a DOM `found-in-page` listener on the <webview> element (where
 * the event DOES fire), calls wv.findInPage() with cold-start retry, and
 * resolves ONLY when finalUpdate===true AND matches>0 (non-zero resolve). On a
 * cold webview Chromium emits finalUpdate:true,matches:0 before the count
 * populates; the handler records `last` and lets the retry interval re-issue
 * the find (up to MAX=5 every 500ms within the overall TIMEOUT=3000ms). A
 * genuine no-match resolves after retries with {0,0}. Re-issues use the
 * caller's original OPTS — no findNext:true on retry (ordinal corruption).
 *
 * SECURITY: op-local internal-session guard AFTER resolveContents — internal
 * pages are refused even when deps carries allowInternal:true.
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
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: findInPage — internal-session excluded');
  }

  // Foreground-first for guest tabs (mirrors print.js discipline).
  if (classifyContents(wc, deps.chromeContents) === 'guest' && typeof deps.activate === 'function') {
    await deps.activate(wcId);
    resolveContents(wcId, deps); // post-activate stale-handle re-resolve (bad-handle / dead check)
  }

  if (!deps.chromeContents) {
    throw new Error('automation: findInPage — chromeContents unavailable (chrome window closed?)');
  }

  const timeoutMs = (deps && deps.findTimeoutMs) || 3000;

  // Route the find through the chrome renderer: inject a script that attaches
  // a DOM `found-in-page` listener on the <webview> element and calls
  // wv.findInPage() with cold-start retry. The renderer-side DOM event fires
  // correctly for <webview> guests; the main-process event does not (D1).
  //
  // Cold-start resolve-on-nonzero: resolve ONLY when finalUpdate===true AND
  // matches>0. On a cold webview Chromium emits a spurious finalUpdate:true,
  // matches:0 before the real count; recording `last` and re-issuing via
  // setInterval (every RETRY=500ms, up to MAX=5) captures the real result.
  // A genuine no-match resolves from `last` after MAX or TIMEOUT.
  // Re-issues use the caller's original OPTS — no findNext:true (D1).
  //
  // Text and opts are JSON-encoded into the script — never string-concatenated.
  const opts = { forward, findNext, matchCase };
  const code = `(function(){return new Promise(function(resolve){
  var WCID = ${JSON.stringify(wcId)}, TEXT = ${JSON.stringify(text)}, OPTS = ${JSON.stringify(opts)};
  var TIMEOUT = ${JSON.stringify(timeoutMs)}, RETRY = 500, MAX = 5;
  var wv = Array.prototype.find.call(document.querySelectorAll('webview'), function(w){
    try { return w.getWebContentsId() === WCID; } catch(e){ return false; }
  });
  if (!wv) { resolve({ activeMatchOrdinal: 0, matches: 0 }); return; }
  var done = false, last = { activeMatchOrdinal: 0, matches: 0 }, attempts = 0, iv = null, to = null;
  function cleanup(){ if(iv) clearInterval(iv); if(to) clearTimeout(to); wv.removeEventListener('found-in-page', h); }
  function finish(v){ if (done) return; done = true; cleanup(); resolve(v); }
  function h(e){ var r = e.result || {}; last = { activeMatchOrdinal: r.activeMatchOrdinal, matches: r.matches }; if (r.finalUpdate === true && r.matches > 0) finish(last); }
  wv.addEventListener('found-in-page', h);
  function issue(){ attempts++; wv.findInPage(TEXT, OPTS); }
  issue();
  iv = setInterval(function(){ if (done) return; if (attempts >= MAX) return; issue(); }, RETRY);
  to = setTimeout(function(){ finish(last); }, TIMEOUT);
});
})()`;

  const res = await deps.chromeContents.executeJavaScript(code, true);
  return { activeMatchOrdinal: res.activeMatchOrdinal || 0, matches: res.matches || 0 };
}

/**
 * Clear the active find session on a webContents (clearSelection), routed
 * through the chrome renderer's <webview> DOM element.
 *
 * DEVIATION D1: stopFindInPage is similarly routed through the chrome renderer
 * for consistency with findInPage.
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

  if (!deps.chromeContents) {
    throw new Error('automation: stopFindInPage — chromeContents unavailable (chrome window closed?)');
  }

  const code = `(function(){
  var wcId = ${JSON.stringify(wcId)};
  var wv = Array.prototype.find.call(document.querySelectorAll('webview'), function(w){
    try { return w.getWebContentsId() === wcId; } catch(e){ return false; }
  });
  if (wv) wv.stopFindInPage('clearSelection');
  return { ok: true };
})()`;

  await deps.chromeContents.executeJavaScript(code, true);
  return { ok: true };
}

module.exports = { findInPage, stopFindInPage };
