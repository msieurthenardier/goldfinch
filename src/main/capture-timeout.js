// @ts-check
'use strict';

// Bounded race for capturePage() (F7 DD7). capturePage() on a DETACHED-but-live
// view NEVER settles — resolveContents (resolve.js:98-140) proves a view LIVE,
// never ATTACHED, so every isDestroyed() guard passes and the request hangs
// forever with no server-side recovery (recon S3; F6 flight-log:274-278).
//
// BORROWED FROM find.js: the 3000ms budget (find.js:106) and the done-guarded
// settle (find.js:130-135). NOTHING ELSE. find.js RESOLVES BENIGNLY on timeout
// (finish(last), last = {activeMatchOrdinal:0, matches:0} — find.js:122/:155);
// carrying that here would yield a silently-empty capture, the exact
// silent-success class S1/DD6 exists to kill. THIS HELPER ALWAYS REJECTS.
// Mechanism differs too: find.js wraps an event-listener flow in a Promise
// constructor; capturePage() is an unrejectable promise you must Promise.race.
//
// ONE semantic: reject. Layer degradation (DD7) is the CALL SITE's policy —
// never this module's, so no caller can inherit a benign settle by accident.
//
// ELECTRON-FREE by construction (no require('electron')): the only ambient
// dependency is the global setTimeout/clearTimeout pair, exactly as find.js
// uses them, so the unit net drives it with MockTimers and no injection seam.
const CAPTURE_TIMEOUT_MS = 3000;

/**
 * Bound an in-flight capturePage() promise with a named rejection.
 *
 * Takes an ALREADY-STARTED promise, not a thunk: main.js's Promise.all starts the
 * chrome and guest captures in parallel, and a thunk would invite serializing them.
 *
 * @param {Promise<any>} capture   an in-flight capturePage() promise
 * @param {string} label           names the target in the refusal ('chrome', 'active guest',
 *                                 'find overlay layer', 'sheet overlay layer', 'wcId 42')
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>} the capture's value; REJECTS at the bound with
 *   `automation: capture-timeout — {label} did not settle within {ms}ms (the view may be detached)`
 */
function withCaptureTimeout(capture, label, { timeoutMs = CAPTURE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // done guard (find.js:130-135's shape): the capture can still settle AFTER the
    // timeout fired — a late settle must neither re-settle the promise nor throw.
    let done = false;
    /** @type {any} */
    let timer = null;

    const settle = (/** @type {() => void} */ act) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);   // no dangling handle on the happy path
      timer = null;
      act();
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error(
        'automation: capture-timeout — ' + label + ' did not settle within ' + timeoutMs +
        'ms (the view may be detached)'
      )));
    }, timeoutMs);

    // Promise.race semantics, written out so the done guard covers BOTH arms:
    // a rejection arriving before the bound propagates VERBATIM (never masked by
    // the timeout message — the cause is the caller's to read).
    Promise.resolve(capture).then(
      (value) => settle(() => resolve(value)),
      (err) => settle(() => reject(err))
    );
  });
}

module.exports = { withCaptureTimeout, CAPTURE_TIMEOUT_MS };
