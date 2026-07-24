// @ts-check
'use strict';

// Shared origin matcher for password fills (M12 Flight 4, Leg 4 / flight DD5). The
// single decision point behind the per-credential `matchMode: 'registrable-domain'`
// opt-in: exact-origin by default, optionally widened to the registrable domain
// (eTLD+1) behind the hardened, FAIL-CLOSED PSL matcher.
//
// CJS-by-design, main-consumed only (the guest-forward-allowlist.js precedent): the
// three fill sites (vault-context.js, vault-human.js, vault-store.js) require() it;
// the internal vault page does NOT import it (the page only toggles the per-item flag —
// the match decision is main-side), so there is no internal-page-map route.
//
// FAIL-CLOSED CONTRACT: `matchMode:'registrable-domain'` only ever WIDENS from exact.
// Any uncertainty — a non-'registrable-domain' matchMode (incl. absent/legacy null), an
// origin that will not URL-parse, an opaque/empty host, a scheme mismatch, or a PSL miss
// on EITHER host — degrades to the exact byte-for-byte origin string compare. A caller
// that omits `widen` (or passes false) gets today's exact behavior unchanged.
//
// KNOWN RESIDUAL (PR#112 finding 10): registrable-domain widening is only as correct as
// the vendored PSL snapshot. A NEW private (multi-tenant) suffix introduced beneath an
// already-known TLD, while the .dat predates it, can over-collapse two tenants to one
// registrable domain and WIDEN a credential across them — this matcher is NOT fail-closed
// against that specific case. It is bounded by psl.js's EXPIRY GATE (an over-stale snapshot
// makes registrableDomainSafe return null → this degrades to exact) and by keeping the
// .dat current. Widening is an explicit per-credential opt-in; exact origin is the default.

const { registrableDomainSafe } = require('../main/vault/psl.js');

/**
 * Parse an opaque `scheme://host:port` origin into { protocol, host }, or null when it
 * cannot be trusted for a widen: a non-string, empty, URL-unparseable, or opaque
 * ("null" host) origin. Port is intentionally dropped — a registrable-domain widen
 * requires the same scheme but not the same port (documented); exact mode still
 * compares the full origin string incl. port.
 * @param {any} origin
 * @returns {{ protocol: string, host: string } | null}
 */
function parseOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return null;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (!u.hostname || u.hostname === 'null') return null;
  return { protocol: u.protocol, host: u.hostname };
}

/**
 * Whether a saved login `item` should fill on `tabOrigin`.
 *
 * With `widen` omitted/false → byte-for-byte the exact origin compare (`item.origin ===
 * tabOrigin`, both non-empty strings). With `widen === true` AND
 * `item.matchMode === 'registrable-domain'` (a POSITIVE test — legacy null falls through
 * to exact): match iff the two origins share the same `protocol` AND
 * `registrableDomainSafe` of each host is non-null and equal; on any failure fall back to
 * the exact compare.
 * @param {{ origin?: any, matchMode?: any }} item
 * @param {string} tabOrigin
 * @param {{ widen?: boolean }} [opts]  the WHOLE object is defaulted so a 2-arg caller never throws.
 * @returns {boolean}
 */
function originMatches(item, tabOrigin, { widen = false } = {}) {
  const itemOrigin = item && item.origin != null ? String(item.origin) : null;
  // Exact = two non-empty origin strings that are byte-for-byte equal (a null/empty on
  // either side never matches — preserves the fill sites' `!itemOrigin`/`!tabOrigin` guards).
  const exact =
    typeof itemOrigin === 'string' && itemOrigin !== '' && itemOrigin === tabOrigin;

  if (!widen) return exact;
  // POSITIVE test: only an explicit opt-in widens; absent/legacy/exact all stay exact.
  if (!item || item.matchMode !== 'registrable-domain') return exact;

  const a = parseOrigin(itemOrigin);
  const b = parseOrigin(tabOrigin);
  if (!a || !b) return exact; // parse failure / opaque host → fail-closed to exact.
  if (a.protocol !== b.protocol) return exact; // scheme mismatch → refuse (the MITM guard).

  const ra = registrableDomainSafe(a.host);
  const rb = registrableDomainSafe(b.host);
  if (ra == null || rb == null) return exact; // PSL miss on EITHER host → fail-closed.
  if (ra !== rb) return exact; // different registrable domain (sibling / tenant) → refuse.
  return true;
}

module.exports = { originMatches };
