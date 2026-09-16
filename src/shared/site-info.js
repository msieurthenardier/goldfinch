// @ts-check

// Pure site-info derivation (M05 Flight 8, Leg 3 / AC3). ONE derivation source
// shared by TWO renderers during the parallel-run: the chrome's innerHTML popup
// (gate OFF — buildSiteInfo in renderer.js) and the sheet's info-popup template
// model (gate ON — siteInfoModel in renderer.js). Extracting the derivation makes
// the gate-OFF/gate-ON parity claim unit-pinned rather than behavior-only.
//
// The internal decision is CALLER-resolved (isInternalTab / isInternalPageUrl live
// with the chrome's tab state, not here) — this module derives display values only.
//
// Mission 20 Flight 2 Leg 4 (DD8): `connection` now reads `tab.security` (the
// chrome-stored enum, DD7) through the shared `connectionLabel` vocabulary —
// the SAME words the address chip uses — rather than re-deriving HTTP/HTTPS
// from the URL scheme alone (which could never say "overridden"). `showCertificate`
// is a NEW boolean — `security` is `secure`/`overridden`, OR a cert-blocked
// interstitial's own folded failure — both already held SYNCHRONOUSLY on the
// chrome record (DD7's push / Flight 1's push), never the async
// tab-certificate-get read.
//
// Acceptance-run fix pass, F4 (tls-trust-surface checkpoint 9): a tab with no
// known security state yet (pre-push, or a `none`/unrecognized value) used to
// fall back to a scheme-derived HTTPS/HTTP label — asserting trust before the
// connection was actually verified (a brand-new https: tab briefly read
// "Secure (HTTPS)" even when the certificate would end up overridden). The
// RULE: this popup never claims a state main has not pushed — `connectionLabel`
// already renders '' for an unrecognized state, so the Connection row is
// blank until the first `tab-security` push lands; the pushed state then
// governs.

import { SECURITY_STATES, connectionLabel } from './site-security.js';

/**
 * @param {{ url?: string, privacy?: any, security?: string, loadFailure?: any } | null | undefined} tab
 * @param {boolean} internal  caller-resolved: isInternalTab(tab) || isInternalPageUrl(tab.url)
 * @returns {{ internal: true, note: string } |
 *   { internal: false, host: string, connection: string, trackers: number, permissions: number, showCertificate: boolean }}
 */
export function deriveSiteInfo(tab, internal) {
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
  const connection = connectionLabel(tab.security);
  const trackers = tab.privacy?.net?.trackers?.blocked ?? 0;
  const permissions = tab.privacy?.permissions?.length ?? 0;
  const showCertificate =
    tab.security === SECURITY_STATES.SECURE || tab.security === SECURITY_STATES.OVERRIDDEN || !!tab.loadFailure?.cert;
  return { internal: false, host, connection, trackers, permissions, showCertificate };
}
