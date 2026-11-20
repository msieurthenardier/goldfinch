'use strict';
// @ts-check

// Launch switches that turn off an installed build's protections (Mission 23 Flight 3,
// leg `launch-switches`, flight DD5). Electron-free, main-only, CJS: the live handles
// (`app.commandLine.*`, `dialog`, `app.exit`) are passed in or used by the one block in
// main.js, so the decision runs under `node --test` with fakes.
//
// Two sets, both frozen tables of switch names WITHOUT dashes. The decision asks Chromium's
// own parser through `hasSwitch` (bare, `=value`, and on Windows a `/` prefix all count) and
// never re-parses argv; every name it returns comes from these tables, never from the
// command line.
//
//  - STRIPPED: removal before `ready` was measured to stop the effect (packaged-measurements.md,
//    AC3/Q3), or the switch is meaningless once its partner is stripped, or Electron ignores it.
//  - REFUSED: removal was measured insufficient (`js-flags`: the main process's V8 has it before
//    any script runs) or was not measured at all. A refused switch stops the launch. When in
//    doubt a switch goes here: refusing needs no proof that removal is in time.
//
// `allow-file-access-from-files` is deliberately on NEITHER list: with the GrantFileProtocolExtraPrivileges
// fuse enabled (the chrome is a `file://` page) Electron puts that switch on the command line itself
// in every launch, so `hasSwitch` is always true (measured: present with no argument given, and the
// operator's own copy is indistinguishable) and an operator-supplied one adds nothing. Listing it
// would refuse every start.
//
// Not on either list, by decision: `no-sandbox`, `disable-gpu-sandbox`, `proxy-server` and its
// relatives, `user-data-dir`, `enable-features`, and `disable-features` in general (see
// DISABLE_FEATURES_NAME). Not covered: the process-launcher family (`gpu-launcher`,
// `renderer-cmd-prefix`, `utility-cmd-prefix`, `browser-subprocess-path`).

/** Removed (and reported) before the app goes on. */
const STRIPPED = Object.freeze([
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-debugging-address',
  'remote-allow-origins',
  'remote-debugging-targets',
  'ignore-certificate-errors',
  'disable-web-security',
  'host-rules',
  'host-resolver-rules',
  'load-extension',
  'disable-extensions-except'
]);

/** Refuse to start. Everything beyond `js-flags` is unmeasured and refused by default. */
const REFUSED = Object.freeze([
  'js-flags',
  'ignore-certificate-errors-spki-list',
  'unsafely-treat-insecure-origin-as-secure',
  'disable-site-isolation-trials',
  'disable-site-isolation-for-policy',
  'allow-running-insecure-content',
  'ssl-key-log-file',
  'log-net-log'
]);

/**
 * `--disable-features` is refused only when its value names one of these feature tokens
 * (exact, case-sensitive, after splitting on commas and trimming). Every other entry keeps
 * working, including `ForceThirdPartyCookieBlockingEnabled` (the operator override).
 */
const DISABLE_FEATURES_NAME = 'disable-features';
const SITE_ISOLATION_FEATURES = Object.freeze(['IsolateOrigins', 'SitePerProcess', 'site-per-process']);

/** Exit status of a refused launch: sysexits EX_USAGE. */
const REFUSAL_EXIT_CODE = 64;
const REFUSAL_TITLE = 'Goldfinch cannot start with these options';

/**
 * Does a `--disable-features` value name a site-isolation feature? A token may carry a
 * trial suffix (`Name<Study`) or parameters (`Name:k/v`); those are cut off before the exact
 * comparison so a suffix cannot hide the name.
 * @param {unknown} value
 * @returns {boolean}
 */
function disablesSiteIsolation(value) {
  if (typeof value !== 'string') return false;
  return value.split(',').some((raw) => {
    const token = raw.trim().split(/[<:]/)[0].trim();
    return SITE_ISOLATION_FEATURES.includes(token);
  });
}

/**
 * @param {{ isPackaged: boolean, hasSwitch: (name: string) => boolean, getSwitchValue: (name: string) => string }} deps
 * @returns {{ remove: string[], refuse: string[] }}
 */
function decideLaunchSwitches({ isPackaged, hasSwitch, getSwitchValue }) {
  /** @type {string[]} */
  const remove = [];
  /** @type {string[]} */
  const refuse = [];
  if (!isPackaged) return { remove, refuse };
  /** @param {string} name */
  const present = (name) => {
    try {
      return hasSwitch(name) === true;
    } catch {
      return null; // unknown: fail closed
    }
  };
  for (const name of STRIPPED) {
    const p = present(name);
    if (p === null) refuse.push(name);
    else if (p) remove.push(name);
  }
  for (const name of REFUSED) {
    const p = present(name);
    if (p === null || p) refuse.push(name);
  }
  const df = present(DISABLE_FEATURES_NAME);
  if (df === null) {
    refuse.push(DISABLE_FEATURES_NAME);
  } else if (df) {
    let value = '';
    let failed = false;
    try {
      value = getSwitchValue(DISABLE_FEATURES_NAME);
    } catch {
      failed = true;
    }
    if (failed || disablesSiteIsolation(value)) refuse.push(DISABLE_FEATURES_NAME);
  }
  // Table order: a stripped name that could not be read is refused; keep one canonical order.
  const order = [...STRIPPED, ...REFUSED, DISABLE_FEATURES_NAME];
  refuse.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { remove, refuse };
}

/**
 * Remove each `remove` name (each in its own try), then re-ask `hasSwitch`. A removal that
 * throws, or a switch still present afterwards, is promoted to a refusal.
 * @param {{ remove: string[], refuse: string[] }} decision
 * @param {{ removeSwitch: (name: string) => void, hasSwitch: (name: string) => boolean }} deps
 * @returns {string[]} the final refusal list (decision's refusals first, then promotions)
 */
function applyLaunchSwitches(decision, { removeSwitch, hasSwitch }) {
  const refuse = [...decision.refuse];
  for (const name of decision.remove) {
    let ok = true;
    try {
      removeSwitch(name);
    } catch {
      ok = false;
    }
    if (ok) {
      try {
        ok = hasSwitch(name) !== true;
      } catch {
        ok = false;
      }
    }
    if (!ok && !refuse.includes(name)) refuse.push(name);
  }
  return refuse;
}

/**
 * The names of `decision.remove` that were actually removed (not promoted to a refusal).
 * @param {{ remove: string[] }} decision
 * @param {string[]} finalRefuse
 * @returns {string[]}
 */
function removedNames(decision, finalRefuse) {
  return decision.remove.filter((n) => !finalRefuse.includes(n));
}

/** @param {string[]} names */
const dashed = (names) => names.map((n) => '--' + n).join(', ');

/**
 * One stderr line listing the switches removed. Names come from the tables only.
 * @param {string[]} names
 * @returns {string}
 */
function removalLine(names) {
  return 'goldfinch: ignored launch switches: ' + dashed(names);
}

/**
 * One stderr line naming the refused switches and the exit status.
 * @param {string[]} names
 * @returns {string}
 */
function refusalLine(names) {
  return 'goldfinch: refusing to start: ' + dashed(names) + ' (exit ' + REFUSAL_EXIT_CODE + ')';
}

/**
 * The error box body. Names only; never a value or any command-line text.
 * @param {string[]} names
 * @returns {string}
 */
function refusalBody(names) {
  return (
    'Goldfinch did not start because these launch switches turn off its protections: ' +
    dashed(names) +
    '. Remove them from the shortcut or command and start it again.'
  );
}

module.exports = {
  STRIPPED,
  REFUSED,
  DISABLE_FEATURES_NAME,
  REFUSAL_EXIT_CODE,
  REFUSAL_TITLE,
  decideLaunchSwitches,
  applyLaunchSwitches,
  removedNames,
  removalLine,
  refusalLine,
  refusalBody
};
