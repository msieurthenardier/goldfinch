'use strict';

// Update check (Mission 23 Flight 3, leg `update-check`; flight DD1). Notify only: once a day the
// main process asks GitHub whether a newer STABLE release exists and holds the answer as state.
// Nothing is downloaded, installed or executed, and nothing from the response but a validated
// version number is believed (src/shared/update-version.js). Electron-free: `fetch`, the version,
// timers and the sinks are injected, so the whole thing runs under `node --test` with fakes.
//
// State: { current, available, releaseUrl, checkEnabled }. A `newer` answer sets available /
// releaseUrl, a valid `current` answer clears them, every failure leaves them alone. `checkEnabled`
// is the SETTING's value only (an inert checker — no address — keeps it in step and never fetches).

const {
  LATEST_RELEASE_API_URL,
  MAX_BODY_BYTES,
  readLatestTag,
  isNewer,
  releaseUrlFor
} = require('../shared/update-version.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const DEV_FIRST_CHECK_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

const REQUEST_HEADERS = Object.freeze({
  'User-Agent': 'Goldfinch-update-check',
  Accept: 'application/vnd.github+json'
});

/**
 * Decided once, at construction. Packaged: the fixed API address (the override is ignored even if
 * set). Unpackaged: only a loopback http override (`http://127.0.0.1:<port>/…` or
 * `http://localhost:<port>/…`) runs checks; anything else means no checks at all.
 * @param {{ isPackaged: boolean, env: Record<string, string | undefined> }} input
 * @returns {{ url: string | null, initialDelayMs: number }}
 */
function decideUpdateCheck({ isPackaged, env }) {
  if (isPackaged) return { url: LATEST_RELEASE_API_URL, initialDelayMs: FIRST_CHECK_DELAY_MS };
  const raw = env && env.GOLDFINCH_UPDATE_CHECK_URL;
  if (typeof raw !== 'string' || raw === '') return { url: null, initialDelayMs: FIRST_CHECK_DELAY_MS };
  try {
    const u = new URL(raw);
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (u.protocol === 'http:' && loopback && u.port !== '' && u.username === '' && u.password === '') {
      return { url: u.href, initialDelayMs: DEV_FIRST_CHECK_DELAY_MS };
    }
  } catch {
    // fall through
  }
  return { url: null, initialDelayMs: FIRST_CHECK_DELAY_MS };
}

/**
 * @param {{
 *   fetch: (url: string, init: any) => Promise<any>,
 *   getVersion: () => string,
 *   url: string | null,
 *   onChange?: (state: any) => void,
 *   trace?: (code: string) => void,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 *   initialDelayMs?: number,
 *   intervalMs?: number,
 *   timeoutMs?: number,
 *   logger?: { error: (...a: any[]) => void }
 * }} deps
 */
function createUpdateChecker({
  fetch,
  getVersion,
  url,
  onChange = () => {},
  trace = () => {},
  setTimeout: setT = setTimeout,
  clearTimeout: clearT = clearTimeout,
  initialDelayMs = FIRST_CHECK_DELAY_MS,
  intervalMs = DAY_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  logger = console
}) {
  const inert = typeof url !== 'string' || url === '';
  let checkEnabled = false;
  let available = /** @type {string | null} */ (null);
  let releaseUrl = /** @type {string | null} */ (null);
  let timer = /** @type {any} */ (null);
  let stopped = false;
  /** @type {{ controller: AbortController, abortedBy: string | null } | null} */
  let run = null;

  const getState = () => ({ current: getVersion(), available, releaseUrl, checkEnabled });
  const emit = () => {
    try {
      onChange(getState());
    } catch (error) {
      logger.error('[update-check] onChange failed:', error);
    }
  };
  const clearTimer = () => {
    if (timer !== null) clearT(timer);
    timer = null;
  };
  const arm = (/** @type {number} */ ms) => {
    clearTimer();
    if (stopped || inert || !checkEnabled) return;
    timer = setT(() => {
      timer = null;
      // Re-arm first (24 h from THIS start); a check still in flight drops the second trigger.
      arm(intervalMs);
      void runCheck();
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  const abortRun = (/** @type {string} */ why) => {
    if (!run) return;
    const r = run;
    run = null;
    r.abortedBy = why;
    try {
      r.controller.abort();
    } catch {
      // best effort
    }
  };

  /** @param {any} reader */
  async function readCapped(reader, /** @type {AbortController} */ controller) {
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          // already aborted
        }
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    return new TextDecoder().decode(all);
  }

  async function runCheck() {
    if (stopped || inert || !checkEnabled || run) return;
    const mine = { controller: new AbortController(), abortedBy: /** @type {string | null} */ (null) };
    run = mine;
    let timedOut = false;
    const limit = setT(() => {
      timedOut = true;
      mine.controller.abort();
    }, timeoutMs);
    /** @type {string} */
    let outcome;
    try {
      const res = await fetch(/** @type {string} */ (url), {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { ...REQUEST_HEADERS },
        signal: mine.controller.signal
      });
      if (res.status !== 200) {
        try {
          await res.body?.cancel?.();
        } catch {
          // ignore
        }
        outcome = 'http-' + res.status;
      } else {
        const text = res.body ? await readCapped(res.body.getReader(), mine.controller) : '';
        if (text === null) {
          outcome = 'too-large';
        } else {
          const parsed = readLatestTag(text);
          if ('reason' in parsed) {
            outcome = parsed.reason;
          } else if (run === mine && isNewer(parsed.version, getVersion())) {
            outcome = 'newer';
            apply(parsed.version, releaseUrlFor(parsed.version));
          } else {
            outcome = 'current';
            if (run === mine) apply(null, null);
          }
        }
      }
    } catch (error) {
      if (mine.abortedBy !== null) outcome = 'aborted';
      else if (timedOut) outcome = 'timeout';
      else outcome = classifyFailure(error);
    } finally {
      clearT(limit);
      if (run === mine) run = null;
    }
    // A late answer from an aborted request changes nothing and is not reported as a result.
    if (mine.abortedBy === null) trace(outcome);
    else trace('aborted');
  }

  function apply(/** @type {string | null} */ nextAvailable, /** @type {string | null} */ nextUrl) {
    if (nextAvailable === available && nextUrl === releaseUrl) return;
    available = nextAvailable;
    releaseUrl = nextUrl;
    emit();
  }

  function classifyFailure(/** @type {any} */ error) {
    const text =
      String((error && error.message) || '') + ' ' + String((error && error.cause && error.cause.message) || '');
    return /redirect/i.test(text) ? 'redirect' : 'network';
  }

  return {
    getState,
    /** Called once from the ready chain with the stored setting; the first check waits the initial delay. */
    start(/** @type {boolean} */ enabled) {
      if (stopped) return;
      const on = enabled === true;
      if (on === checkEnabled) {
        if (on && timer === null && !run) arm(initialDelayMs);
        return;
      }
      checkEnabled = on;
      emit();
      if (on) arm(initialDelayMs);
    },
    setEnabled(/** @type {boolean} */ enabled) {
      if (stopped) return;
      const on = enabled === true;
      if (on === checkEnabled) return;
      checkEnabled = on;
      if (!on) {
        clearTimer();
        abortRun('disabled');
        available = null;
        releaseUrl = null;
        trace('disabled');
        emit();
        return;
      }
      emit();
      if (inert) return;
      arm(intervalMs);
      void runCheck();
    },
    /** Quit: clears the timer, aborts, fires nothing. Safe twice. */
    stop() {
      stopped = true;
      clearTimer();
      abortRun('stopped');
    }
  };
}

module.exports = {
  createUpdateChecker,
  decideUpdateCheck,
  REQUEST_HEADERS,
  DAY_MS,
  FIRST_CHECK_DELAY_MS,
  DEV_FIRST_CHECK_DELAY_MS,
  REQUEST_TIMEOUT_MS
};
