'use strict';

// What the CHROME view may see of the settings object (Mission 23 Flight 1, leg `ipc-gate`,
// DD13). The chrome is a file:// view whose bridge is reachable from a page that holds the
// guest preload's IPC object, so the automation key HASHES — the credential-verification
// material for the MCP transport — never leave main toward it, on `settings-get` or on the
// `settings-changed` broadcast. The toolbar's automation indicator needs only WHICH jars have
// a key and WHETHER the admin key is set, so main computes that non-secret summary and the
// chrome reads it instead (`automationKeyState`). Nothing here is derived from a hash VALUE:
// only from key presence.
//
// Internal goldfinch:// pages are unaffected: `internal-settings-get` and the store API are
// untouched, and no internal page reads a hash from the broadcast (the Automation page lists
// keys through `automation:list-keys`).

const WITHHELD_KEYS = Object.freeze(['automationKeyHashes', 'automationAdminKeyHash']);

/**
 * @param {Record<string, any>} all a `settings.getAll()` snapshot
 * @returns {Record<string, any>} the same snapshot without the hashes, plus `automationKeyState`
 */
function projectSettingsForChrome(all) {
  const out = { ...(all || {}) };
  const hashes = out.automationKeyHashes && typeof out.automationKeyHashes === 'object' ? out.automationKeyHashes : {};
  const adminSet = !!out.automationAdminKeyHash;
  for (const key of WITHHELD_KEYS) delete out[key];
  out.automationKeyState = { jarIdsWithKey: Object.keys(hashes), adminKeyEnabled: adminSet };
  return out;
}

/**
 * `settings-get` for the chrome: the whole projected object, or one key. A key naming either
 * hash answers `undefined`; `automationKeyState` is derivable by name too.
 * @param {{ get: (key: string) => any, getAll: () => Record<string, any> }} settings
 * @param {unknown} key
 */
function chromeSettingsGet(settings, key) {
  if (!key) return projectSettingsForChrome(settings.getAll());
  // Only a string names a key; an array / object key would coerce to a hash key's name inside the store.
  if (typeof key !== 'string') return undefined;
  if (WITHHELD_KEYS.includes(key)) return undefined;
  if (key === 'automationKeyState') return projectSettingsForChrome(settings.getAll()).automationKeyState;
  return settings.get(key);
}

module.exports = { WITHHELD_KEYS, projectSettingsForChrome, chromeSettingsGet };
