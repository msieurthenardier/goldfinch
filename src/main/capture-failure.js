// @ts-check
'use strict';

// Named capture refusals + the ONE bounded guest-capture retry for main.js's Wayland
// composite fallback in grabWindow (squawk 0155).
//
// Before this module, every composite failure that was not a capture-timeout collapsed
// to `return null`, which observe.captureWindow reports as the generic
// 'automation: chrome window unavailable' — a window that was alive and well. Live
// diagnosis (squawk 0155 Evidence) found the swallowed error was the ACTIVE GUEST's
// capturePage() rejecting with `UnknownVizError` (no compositor frame to copy) in two
// shapes: a freshly created guest that has not painted its first frame yet (~100-200ms
// after openTab), and a guest hidden behind a chrome takeover panel (main.js now skips
// that one — it is not on screen). This module names whatever is left, the way F7 DD7
// already names a capture-timeout, so the tool returns the cause as isError.
//
// ELECTRON-FREE by construction (requires nothing): the only ambient dependency is the
// global setTimeout, so the unit net drives it with MockTimers and fake captures.

/** Every named capture refusal starts with this — capture-timeout (capture-timeout.js) and capture-failed (here). */
const CAPTURE_REFUSAL_PREFIX = 'automation: capture-';

/**
 * The single guest retry waits this long. Live-measured on WSLg/Electron 44: a fresh
 * guest's first capturable frame arrived 93-199ms after the first rejected attempt
 * (16 tabs, squawk 0155 Verification), so one retry at 250ms covers it with margin while
 * keeping a genuine failure's refusal well under the 3000ms capture-timeout budget.
 */
const GUEST_CAPTURE_RETRY_MS = 250;

/**
 * @param {unknown} err
 * @returns {boolean} true when `err` already IS a named capture refusal (never re-wrapped)
 */
function isNamedCaptureRefusal(err) {
  const msg = err && typeof err === 'object' ? /** @type {any} */ (err).message : undefined;
  return typeof msg === 'string' && msg.startsWith(CAPTURE_REFUSAL_PREFIX);
}

/**
 * Map a failure at a named composite step to the refusal the caller sees.
 *
 * An error that is already a named capture refusal (a capture-timeout, or a capture-failed
 * thrown by an inner step) passes through VERBATIM — the innermost step names the cause,
 * and an outer catch-all must never relabel it. Anything else becomes
 * `automation: capture-failed — {step}: {reason}`.
 *
 * @param {string} step   names the composite step ('chrome', 'active guest', 'composite')
 * @param {unknown} err
 * @returns {Error}
 */
function captureFailure(step, err) {
  if (isNamedCaptureRefusal(err)) return /** @type {Error} */ (err);
  const anyErr = /** @type {any} */ (err);
  const raw = anyErr && typeof anyErr.message === 'string' ? anyErr.message : String(err);
  const reason = raw.trim() || 'unknown error';
  return new Error('automation: capture-failed — ' + step + ': ' + reason);
}

/**
 * Run a capture, retrying it ONCE after `retryDelayMs` if it rejects with anything other
 * than a named capture refusal. A capture-timeout is never retried: it has already spent
 * the whole 3000ms budget, and a view that hung once (detached) would hang again. A
 * second failure is refused as `captureFailure(step, err)`.
 *
 * Takes a THUNK (unlike withCaptureTimeout, which takes an in-flight promise) because a
 * retry has to START a new capture.
 *
 * @template T
 * @param {() => Promise<T>} start   starts one bounded capture attempt
 * @param {string} step              names the step in the refusal
 * @param {{ retryDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
async function captureWithOneRetry(start, step, { retryDelayMs = GUEST_CAPTURE_RETRY_MS } = {}) {
  try {
    return await start();
  } catch (err) {
    if (isNamedCaptureRefusal(err)) throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  try {
    return await start();
  } catch (err) {
    throw captureFailure(step, err);
  }
}

module.exports = {
  CAPTURE_REFUSAL_PREFIX,
  GUEST_CAPTURE_RETRY_MS,
  isNamedCaptureRefusal,
  captureFailure,
  captureWithOneRetry
};
