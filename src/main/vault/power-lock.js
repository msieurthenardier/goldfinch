// @ts-check
'use strict';

// Lock the vault when the machine does (Mission 23 Flight 2, leg `vault-lifecycle`, flight DD7).
//
// Electron-free, injected deps (the house shape): `powerMonitor` is any emitter with `on` / `removeListener`,
// `lockNow` is the store's single lock path (the same one the toolbar's lock takes, so vault sheets close in
// every window, automation's vault keys are zeroized and the indicator updates - nothing is duplicated here).
//
// Two kinds of event:
//   LOCK events   `suspend`, `lock-screen`, `user-did-resign-active`, `shutdown` - lock at once.
//   RESUME events `resume`, `unlock-screen` - lock only if the wall clock says the idle limit passed while
//                 the machine slept (a Node timer does not count suspended time). Belt and braces: `suspend`
//                 normally locked already; this covers a missed event.
//
// Platforms (Electron 45 typings): `suspend`/`resume` everywhere; `lock-screen`/`unlock-screen` macOS and
// Windows only; `user-did-resign-active` macOS only; `shutdown` Linux and macOS. On Linux there is NO
// screen-lock event, so locking the screen does not lock the vault there - only suspend does.
//
// The fresh-adopt key-surfacing window (`isAutoLockSuspended`) defers a POWER lock exactly as it defers the
// idle timer: locking there would close the one screen that shows a freshly adopted profile's recovery key.
// A power LOCK event deferred this way is REMEMBERED (`deferLock`, wired to the store): the store locks
// the moment the suspension ends. A deferred resume check is not remembered (the idle timer covers it).
// A listener never throws into the emitter, and an already-locked vault is a no-op.

/** Events that lock immediately. */
const LOCK_EVENTS = Object.freeze(['suspend', 'lock-screen', 'user-did-resign-active', 'shutdown']);
/** Events that lock only after a long idle (the stamp is wall-clock). */
const RESUME_EVENTS = Object.freeze(['resume', 'unlock-screen']);

/**
 * @param {object} deps
 * @param {{ on: (event: string, fn: () => void) => any, removeListener: (event: string, fn: () => void) => any }} deps.powerMonitor
 * @param {() => void} deps.lockNow
 * @param {() => boolean} deps.isUnlocked
 * @param {() => boolean} [deps.isAutoLockSuspended]
 * @param {() => void} [deps.deferLock]   remember a lock that arrived while auto-lock was suspended
 * @param {() => number | null} deps.idleMs        wall-clock ms since the last touch, null when locked
 * @param {() => number} deps.autoLockMs           the store's own coerced idle interval
 * @param {(line: string) => void} [deps.trace]
 * @param {{ error?: (...a: any[]) => void }} [deps.logger]
 */
function createPowerLock({
  powerMonitor,
  lockNow,
  isUnlocked,
  isAutoLockSuspended = () => false,
  deferLock = () => {},
  idleMs,
  autoLockMs,
  trace = () => {},
  logger = {}
}) {
  /** @type {Array<[string, () => void]>} */
  let registered = [];

  /** @param {string} line */
  function say(line) {
    try {
      trace(line);
    } catch {
      // a trace sink never changes behaviour
    }
  }

  /**
   * @param {string} event
   * @param {boolean} onlyIfIdleLong
   */
  function handle(event, onlyIfIdleLong) {
    try {
      if (!isUnlocked()) return;
      if (isAutoLockSuspended()) {
        say(`[vault-power-lock] event=${event} deferred=key-surfacing`);
        if (!onlyIfIdleLong) deferLock();
        return;
      }
      if (onlyIfIdleLong) {
        const idle = idleMs();
        if (idle === null || idle < autoLockMs()) return;
      }
      say(`[vault-power-lock] event=${event} lock`);
      lockNow();
    } catch (err) {
      try {
        logger.error?.(`[vault-power-lock] ${event} lock failed:`, err);
      } catch {
        // ignore
      }
    }
  }

  /** @param {string} event */
  const onLockEvent = (event) => () => handle(event, false);
  /** @param {string} event */
  const onResumeEvent = (event) => () => handle(event, true);

  return {
    /** Subscribe once (idempotent). Call after `app.ready`: `powerMonitor` is unusable before it. */
    register() {
      if (registered.length) return;
      for (const event of LOCK_EVENTS) registered.push([event, onLockEvent(event)]);
      for (const event of RESUME_EVENTS) registered.push([event, onResumeEvent(event)]);
      for (const [event, fn] of registered) powerMonitor.on(event, fn);
      say(`[vault-power-lock] registered events=${registered.length}`);
    },
    /** Remove every listener (harmless to skip: the process is exiting). */
    dispose() {
      for (const [event, fn] of registered) {
        try {
          powerMonitor.removeListener(event, fn);
        } catch {
          // ignore
        }
      }
      registered = [];
    },
    isRegistered: () => registered.length > 0
  };
}

module.exports = { createPowerLock, LOCK_EVENTS, RESUME_EVENTS };
