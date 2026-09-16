// @ts-check
// Mission 20 Flight 2 Leg 2 (DD5/DD7): the security-state enum and its pure
// derivation — the single source for main (guest-wiring.js's did-navigate
// stamp), the chrome (site-security-controller.js's `tab.security` store, the
// address-chip/site-info vocabulary in a later leg), and the automation
// census (`tab-controller.js`'s `listTabs`). Copy is app-authored — this
// module produces only the enum value, never prose (the `page-context-model.js`
// / `load-failure.js` precedent).

/** @type {{ SECURE: 'secure', INSECURE: 'insecure', OVERRIDDEN: 'overridden', NONE: 'none', INTERNAL: 'internal' }} */
export const SECURITY_STATES = Object.freeze({
  SECURE: 'secure',
  INSECURE: 'insecure',
  OVERRIDDEN: 'overridden',
  NONE: 'none',
  INTERNAL: 'internal'
});

// The verify-proc's "no error" verdict (spike (a), live-measured: Electron's
// `request.verificationResult` reads `net::OK`). Bare `OK` is accepted too —
// belt-and-suspenders against a future Electron format change; never load-
// bearing on the spike's own measured shape.
const OK_RESULTS = new Set(['net::OK', 'OK']);

/**
 * Pure derivation of the top-frame committed origin's security state (DD7).
 * Evaluation order, first match wins:
 *   1. `internal` — a trusted `goldfinch://` entry.
 *   2. `none` — a blank/unparseable committed URL, or a parseable `about:`
 *      URL (about:blank, a failed load's pre-commit state, an
 *      `chrome-error:` document is caught earlier by guest-wiring.js's own
 *      dedicated guard, but a plain about:blank live tab reaches this rule).
 *   3. `insecure` — a parseable non-`https:`, non-`about:` URL.
 *   4. `overridden` — the session verify-proc OBSERVED a non-OK verification
 *      for this hostname (the load succeeded despite an error — an override
 *      let it through).
 *   5. `overridden` — no observer entry exists (evicted, or never verified in
 *      this session) but the caller's own decision fallback (`overridden`,
 *      already computed by matching `entry.certOverride` against the
 *      committed host:port) says so.
 *   6. `secure` — everything else.
 * Never throws — malformed input degrades to `none`.
 * @param {{
 *   url?: string | null,
 *   internal?: boolean,
 *   verification?: { verificationResult?: string } | null,
 *   overridden?: boolean
 * } | null | undefined} [args]
 * @returns {string}
 */
export function deriveSecurityState(args) {
  const { url, internal, verification, overridden } = args || {};
  if (internal) return SECURITY_STATES.INTERNAL;
  if (typeof url !== 'string' || url.length === 0) return SECURITY_STATES.NONE;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return SECURITY_STATES.NONE;
  }
  // `about:blank` (the one non-internal, non-http(s) URL a live tab can
  // legitimately carry — a brand-new tab, pre-navigation) is content-less: it
  // has no connection to label insecure. Any other `about:` URL degrades the
  // same way (defensive; Goldfinch never navigates a web tab to one).
  if (parsed.protocol === 'about:') return SECURITY_STATES.NONE;
  if (parsed.protocol !== 'https:') return SECURITY_STATES.INSECURE;
  const hasVerification = verification != null && typeof verification.verificationResult === 'string';
  if (hasVerification) {
    return OK_RESULTS.has(/** @type {{ verificationResult: string }} */ (verification).verificationResult)
      ? SECURITY_STATES.SECURE
      : SECURITY_STATES.OVERRIDDEN;
  }
  if (overridden) return SECURITY_STATES.OVERRIDDEN;
  return SECURITY_STATES.SECURE;
}

/**
 * DD8: true for the two states that must say "not secure" — `insecure`
 * (plain http:) and `overridden` (a certificate error the operator let
 * through this session). `secure`/`internal`/`none` (and anything
 * unrecognized) are not-secure = false — `none` (a blank/failed/pre-push
 * tab) deliberately carries no security claim at all, positive or negative.
 * @param {unknown} state
 * @returns {boolean}
 */
export function isNotSecure(state) {
  return state === SECURITY_STATES.INSECURE || state === SECURITY_STATES.OVERRIDDEN;
}

/**
 * DD8: the ONE "not secure" vocabulary source for the site-info popup's
 * Connection row (chip labels/titles are chipAriaLabel/chipTitle below —
 * same words, different rendering slot). `overridden` is the only state that
 * names the certificate; `secure` names neither "not secure" nor the
 * certificate. An unrecognized/`none` state renders '' (no connection claim
 * to make — a blank/failed tab, or a fresh tab with no committed URL yet).
 * @param {unknown} state
 * @returns {string}
 */
export function connectionLabel(state) {
  if (state === SECURITY_STATES.SECURE) return 'Secure (HTTPS)';
  if (state === SECURITY_STATES.INSECURE) return 'Not secure (HTTP)';
  if (state === SECURITY_STATES.OVERRIDDEN) return 'Not secure — certificate error overridden (HTTPS)';
  return '';
}

/**
 * DD8: the address chip's aria-label, keyed off the SAME vocabulary as
 * connectionLabel — "Site information, {host}" for `secure`/`none`/any
 * unrecognized state (no claim, positive or negative), "…, not secure" for
 * `insecure`, and "…, not secure — certificate error overridden" for
 * `overridden`. A falsy/unparseable host degrades to the bare "Site
 * information" (the chip's own neutral-default wording) — never throws.
 * @param {unknown} host
 * @param {unknown} state
 * @returns {string}
 */
export function chipAriaLabel(host, state) {
  const h = typeof host === 'string' && host ? host : '';
  if (!h) return 'Site information';
  if (state === SECURITY_STATES.OVERRIDDEN) return `Site information, ${h}, not secure — certificate error overridden`;
  if (state === SECURITY_STATES.INSECURE) return `Site information, ${h}, not secure`;
  return `Site information, ${h}`;
}
