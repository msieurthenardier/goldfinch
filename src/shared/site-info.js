// @ts-check
'use strict';

// Pure site-info derivation (M05 Flight 8, Leg 3 / AC3). ONE derivation source
// shared by TWO renderers during the parallel-run: the chrome's innerHTML popup
// (gate OFF — buildSiteInfo in renderer.js) and the sheet's info-popup template
// model (gate ON — siteInfoModel in renderer.js). Extracting the derivation makes
// the gate-OFF/gate-ON parity claim unit-pinned rather than behavior-only.
//
// The internal decision is CALLER-resolved (isInternalTab / isInternalPageUrl live
// with the chrome's tab state, not here) — this module derives display values only.

/**
 * @param {{ url?: string, privacy?: any } | null | undefined} tab
 * @param {boolean} internal  caller-resolved: isInternalTab(tab) || isInternalPageUrl(tab.url)
 * @returns {{ internal: true, note: string } |
 *   { internal: false, host: string, connection: string, trackers: number, permissions: number }}
 */
function deriveSiteInfo(tab, internal) {
  if (!tab || internal) {
    // Internal tab — static secure-page note; no site data, no "Site settings" link.
    return { internal: true, note: "You're viewing a secure Goldfinch page." };
  }
  // Web tab — origin/connection/privacy summary. Fresh tab (no parseable URL) → '—'.
  let host;
  try {
    host = new URL(/** @type {string} */ (tab.url)).host;
  } catch {
    host = '—';
  }
  const connection = /^https:/i.test(tab.url || '') ? 'HTTPS' : 'HTTP';
  const trackers = tab.privacy?.net?.trackers?.blocked ?? 0;
  const permissions = tab.privacy?.permissions?.length ?? 0;
  return { internal: false, host, connection, trackers, permissions };
}

// Dual export: CommonJS (test runner) and global (the chrome renderer, which runs
// with nodeIntegration:false and cannot require()). index.html loads this via
// <script> before renderer.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deriveSiteInfo };
} else {
  /** @type {any} */ (globalThis).deriveSiteInfo = deriveSiteInfo;
}
