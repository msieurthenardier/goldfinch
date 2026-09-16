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
 * Pure derivation of the top-frame committed origin's security state (DD7;
 * reordered post-ship for HAT F5 — see below). Evaluation order, first match
 * wins:
 *   1. `internal` — a trusted `goldfinch://` entry.
 *   2. `none` — a blank/unparseable committed URL, or a parseable `about:`
 *      URL (about:blank, a failed load's pre-commit state, an
 *      `chrome-error:` document is caught earlier by guest-wiring.js's own
 *      dedicated guard, but a plain about:blank live tab reaches this rule).
 *   3. `insecure` — a parseable non-`https:`, non-`about:` URL.
 *   4. `overridden` — the caller's own decision fallback (`overridden`,
 *      already computed by matching `entry.certOverride` against the
 *      committed host:port) says so. Checked BEFORE the observer, and wins
 *      outright — see the HAT F5 note below.
 *   5. `secure` — the session verify-proc OBSERVED an OK verification for
 *      this hostname.
 *   6. `overridden` — the observer OBSERVED a non-OK verification for this
 *      hostname. Defensive only: unreachable in practice, since a non-OK
 *      verification with no override would have failed the load rather than
 *      committing one — kept as a fail-safe rather than an assumption.
 *   7. `secure` — no observer entry exists (evicted, or never verified in
 *      this session) and no override decision either.
 * Never throws — malformed input degrades to `none`.
 *
 * HAT F5 (post-ship fix): the observer's cache is keyed by HOSTNAME ONLY
 * (Electron's verify-proc `Request` carries no port), so a prior trusted
 * visit to one port on a host can leave a stale OK entry that a later,
 * different-port override on the SAME host would otherwise be outranked by
 * — the chip read secure/green on a tab the operator had just overridden.
 * `overridden` is the fresher, load-scoped signal: `cert-trust.js` writes
 * `entry.certOverride` only when `callback(true)` was the answer for THIS
 * main-frame commit (`certificate-error` refires on every navigation), and
 * `guest-wiring.js` clears it at the very next `did-start-navigation` — so
 * within one committed navigation it is authoritative, and checking it
 * before the (possibly stale, possibly wrong-port) observer entry is what
 * fixes the collision. A certificate that is fixed server-side mid-session
 * with no new navigation raises no `certificate-error` event, so it stamps
 * no override and this branch is skipped — falling through to the observer
 * (or the no-observer default), both `secure`. That residual staleness is
 * unavoidable without a live re-check and is accepted.
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
  // HAT F5: the fresh, load-scoped override stamp outranks the (possibly
  // stale, hostname-only-keyed) observer entry — see the doc comment above.
  if (overridden) return SECURITY_STATES.OVERRIDDEN;
  const hasVerification = verification != null && typeof verification.verificationResult === 'string';
  if (hasVerification) {
    return OK_RESULTS.has(/** @type {{ verificationResult: string }} */ (verification).verificationResult)
      ? SECURITY_STATES.SECURE
      : SECURITY_STATES.OVERRIDDEN;
  }
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
