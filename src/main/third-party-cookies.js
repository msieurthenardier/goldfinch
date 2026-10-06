// @ts-check
'use strict';

// Native third-party cookie isolation helpers (sortie 02 DD1/DD6). Pure and
// Electron-free: the startup decision over the persisted Shields config and
// the operator's command-line feature switches, and the `Set-Cookie`
// attribute parser behind the honest isolate accounting.

/** Chromium feature that blocks unpartitioned third-party cookies (HTTP + document.cookie), keeps CHIPS. */
const FEATURE = 'ForceThirdPartyCookieBlockingEnabled';

/**
 * Split a Chromium feature list: entries on `,`, trimmed, empties dropped.
 * @param {string | null | undefined} list
 * @returns {string[]}
 */
function splitFeatureList(list) {
  if (typeof list !== 'string') return [];
  return list
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

/**
 * An entry's NAME is everything before the first `:` or `<` (Chromium's
 * `Name:param/val` and `Name<Trial` forms).
 * @param {string} entry
 */
function featureName(entry) {
  const m = /^[^:<]*/.exec(entry);
  return (m ? m[0] : entry).trim();
}

/** @param {string[]} entries */
function namesFeature(entries) {
  return entries.some((e) => featureName(e) === FEATURE);
}

/**
 * The startup decision. `configured` is `isolateConfigured(cfg)`; the two
 * lists are the raw `getSwitchValue` strings ('' when absent). A repeated
 * `--enable-features` is outside our control (getSwitchValue returns one
 * value) — documented, not handled.
 *
 * @param {{ configured: boolean, enableFeatures?: string, disableFeatures?: string }} input
 * @returns {{ isolateEffective: boolean, enableFeatures: string, operatorOverride: 'disabled' | 'enabled' | null }}
 */
function decideStartup({ configured, enableFeatures, disableFeatures }) {
  const enableEntries = splitFeatureList(enableFeatures);
  const operatorEnables = namesFeature(enableEntries);
  const operatorDisables = namesFeature(splitFeatureList(disableFeatures));

  const composed = [...new Set(enableEntries)];
  if (configured && !operatorEnables) composed.push(FEATURE);

  /** @type {'disabled' | 'enabled' | null} */
  const operatorOverride = operatorDisables ? 'disabled' : operatorEnables ? 'enabled' : null;
  return {
    isolateEffective: (!!configured || operatorEnables) && !operatorDisables,
    enableFeatures: composed.join(','),
    operatorOverride
  };
}

/**
 * Main-side twin of the shared ESM `effectiveAfterRestart` (src/shared/shields-isolation-model.js):
 * what isolation would be in force after a restart, from `isolateConfigured(cfg)` (a boolean) and
 * the operator override. Drift-guarded against `decideStartup` and the ESM twin (sortie 02 leg 2).
 * Main never imports the ESM one: the Restart now business gate stays main-authoritative.
 * @param {boolean} configured
 * @param {'disabled' | 'enabled' | null | undefined} operatorOverride
 */
function effectiveAfterRestartFromConfigured(configured, operatorOverride) {
  if (operatorOverride === 'disabled') return false;
  if (operatorOverride === 'enabled') return true;
  return !!configured;
}

/**
 * True iff the cookie line carries BOTH `Partitioned` and `Secure` as
 * attribute NAMES (case-insensitive, whitespace-tolerant) — never a
 * substring of the name=value pair or of another attribute's value.
 * Chromium rejects `Partitioned` without `Secure`.
 * @param {unknown} line
 */
function isValidPartitionedSetCookie(line) {
  if (typeof line !== 'string') return false;
  const parts = line.split(';').slice(1);
  let partitioned = false;
  let secure = false;
  for (const part of parts) {
    const attr = part.split('=')[0].trim().toLowerCase();
    if (attr === 'partitioned') partitioned = true;
    else if (attr === 'secure') secure = true;
  }
  return partitioned && secure;
}

/**
 * True iff any line is NOT a valid partitioned cookie (so Chromium refuses
 * it as a third-party cookie). An empty list is not refused.
 * @param {readonly unknown[] | null | undefined} setCookieLines
 */
function refusedThirdPartySetCookie(setCookieLines) {
  if (!Array.isArray(setCookieLines)) return false;
  return setCookieLines.some((l) => !isValidPartitionedSetCookie(l));
}

module.exports = {
  FEATURE,
  decideStartup,
  effectiveAfterRestartFromConfigured,
  isValidPartitionedSetCookie,
  refusedThirdPartySetCookie
};
