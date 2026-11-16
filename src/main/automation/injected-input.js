'use strict';

// Per-tab counts of input that AUTOMATION is injecting (Mission 23 Flight 2, leg `automation-input`,
// flight DD4). Electron-free: the clock and the timer come in as arguments and the one webContents
// method it calls (`setIgnoreMenuShortcuts`) is reached through the handle the caller passes.
//
// Why it exists. `webContents.sendInputEvent` input reaches the guest's `input-event` and
// `before-input-event` listeners exactly like a physical click or key, with nothing marking it as
// injected. Two consumers in guest-wiring.js must tell them apart:
//   - the click witness for the vault fill icon (an injected click is not the operator's click), at
//     EVERY automation tier -> `isInjecting`;
//   - the guest's chrome-shortcut handler (a jar-scoped key must not run the browser's own shortcuts)
//     -> `isJarInjecting`. The tier is known only where the engine was built for a jar identity, so the
//     jar count is raised by the engine's explicit `jarTier` option, never inferred.
//
// Two counts, not flags: two sessions can inject into one tab at once, so the tab reads as injecting
// until the LAST one releases. A release function is idempotent and the counts never go negative.
//
// Trailing allowance. After the last release the tab still reads as injecting for `allowanceMs`, for
// late delivery. Measured on Electron 45.3.2 (leg `automation-input`, AC1(c), scratch profile, 205
// injected events): `input-event` and `before-input-event` ran INSIDE `sendInputEvent` for both the
// mouse and the key path - largest lag from the start of the call 0.33 ms (key) and 0.15 ms (mouse),
// none after the call returned. The allowance is therefore a margin, not a need; it is also how long
// the operator's own click (or, for a jar key, shortcut) in that tab is ignored after automation stops.
//
// Menu shortcuts. A jar-tier KEY injection also asks the target to ignore the application menu's
// accelerators (`setIgnoreMenuShortcuts`), because Electron's default menu binds chords (Ctrl+Q quits
// the app) that never pass through the guest's `before-input-event` handler. The menu path runs after
// the renderer has handed the key back, i.e. AFTER `sendInputEvent` returned, so the ignore is held
// for `menuHoldMs` past the last release and then restored.

/** Trailing allowance for the counts; see the measurement above. */
const ALLOWANCE_MS = 50;
/** How long past the last jar-tier key release the target keeps ignoring menu shortcuts. */
const MENU_HOLD_MS = 500;

/**
 * @typedef {{ setIgnoreMenuShortcuts?: (ignore: boolean) => void, isDestroyed?: () => boolean }} MenuTarget
 * @typedef {{
 *   all: number,
 *   jar: number,
 *   allUntil: number,
 *   jarUntil: number,
 *   menuHolds: number,
 *   menuTarget: MenuTarget | null,
 *   ignoring: boolean,
 *   menuTimer: any
 * }} TabState
 */

/**
 * @param {{
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 *   allowanceMs?: number,
 *   menuHoldMs?: number
 * }} [deps]
 */
function createInjectedInput({
  now = () => Date.now(),
  setTimer = (fn, ms) => {
    const h = setTimeout(fn, ms);
    if (h && typeof h.unref === 'function') h.unref();
    return h;
  },
  clearTimer = (h) => clearTimeout(h),
  allowanceMs = ALLOWANCE_MS,
  menuHoldMs = MENU_HOLD_MS
} = {}) {
  /** @type {Map<number, TabState>} */
  const tabs = new Map();

  /** @param {number} wcId */
  function stateFor(wcId) {
    let s = tabs.get(wcId);
    if (!s) {
      s = {
        all: 0,
        jar: 0,
        allUntil: 0,
        jarUntil: 0,
        menuHolds: 0,
        menuTarget: null,
        ignoring: false,
        menuTimer: null
      };
      tabs.set(wcId, s);
    }
    return s;
  }

  /** @param {TabState} s */
  function setIgnore(s, ignore) {
    const t = s.menuTarget;
    if (!t || typeof t.setIgnoreMenuShortcuts !== 'function') return;
    try {
      if (typeof t.isDestroyed === 'function' && t.isDestroyed()) return;
      t.setIgnoreMenuShortcuts(ignore);
    } catch {
      // A contents torn down between the injection and the restore has nothing left to restore.
    }
  }

  /** Drop an entry that holds nothing (called when it is read). @param {number} wcId @param {TabState} s */
  function prune(wcId, s) {
    if (s.all === 0 && s.jar === 0 && s.menuHolds === 0 && !s.ignoring && s.menuTimer === null) {
      const t = now();
      if (t >= s.allUntil && t >= s.jarUntil) tabs.delete(wcId);
    }
  }

  /**
   * Raise the counts for one injection into `wcId` and return its release function (idempotent).
   * @param {number} wcId
   * @param {{ jar?: boolean, menuTarget?: MenuTarget | null }} [opts]
   *   jar - the call came through a jar-scoped key; menuTarget - for a jar-tier KEY injection, the
   *   webContents whose application-menu shortcuts are ignored while it runs
   * @returns {() => void}
   */
  function begin(wcId, { jar = false, menuTarget = null } = {}) {
    const s = stateFor(wcId);
    s.all += 1;
    if (jar) s.jar += 1;
    const holdMenu = jar && menuTarget != null;
    if (holdMenu) {
      s.menuHolds += 1;
      s.menuTarget = menuTarget;
      if (s.menuTimer !== null) {
        clearTimer(s.menuTimer);
        s.menuTimer = null;
      }
      if (!s.ignoring) {
        setIgnore(s, true);
        s.ignoring = true;
      }
    }
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      s.all = Math.max(0, s.all - 1);
      if (s.all === 0) s.allUntil = now() + allowanceMs;
      if (jar) {
        s.jar = Math.max(0, s.jar - 1);
        if (s.jar === 0) s.jarUntil = now() + allowanceMs;
      }
      if (holdMenu) {
        s.menuHolds = Math.max(0, s.menuHolds - 1);
        if (s.menuHolds === 0) {
          if (s.menuTimer !== null) clearTimer(s.menuTimer);
          s.menuTimer = setTimer(() => {
            s.menuTimer = null;
            if (s.menuHolds === 0 && s.ignoring) {
              setIgnore(s, false);
              s.ignoring = false;
              s.menuTarget = null;
            }
            if (tabs.get(wcId) === s) prune(wcId, s);
          }, menuHoldMs);
        }
      }
    };
  }

  /** Any tier: an injection into the tab is in flight, or ended within the allowance. @param {number} wcId */
  function isInjecting(wcId) {
    const s = tabs.get(wcId);
    if (!s) return false;
    if (s.all > 0 || now() < s.allUntil) return true;
    prune(wcId, s);
    return false;
  }

  /** Jar tier only. @param {number} wcId */
  function isJarInjecting(wcId) {
    const s = tabs.get(wcId);
    if (!s) return false;
    if (s.jar > 0 || now() < s.jarUntil) return true;
    prune(wcId, s);
    return false;
  }

  /** The tab's contents was destroyed: drop everything, including a pending menu restore. @param {number} wcId */
  function forget(wcId) {
    const s = tabs.get(wcId);
    if (!s) return;
    if (s.menuTimer !== null) clearTimer(s.menuTimer);
    tabs.delete(wcId);
  }

  return { begin, isInjecting, isJarInjecting, forget };
}

module.exports = { createInjectedInput, ALLOWANCE_MS, MENU_HOLD_MS };
