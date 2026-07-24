// @ts-check
'use strict';

// Public Suffix List parser — the credential-safe registrable-domain (eTLD+1)
// resolver behind the per-credential `matchMode: 'registrable-domain'` fill opt-in
// (M12 Flight 4, Leg 4 / flight DD5).
//
// WHY A VENDORED PSL (not trackers.js): a curated suffix subset CANNOT make the
// mission's "never shares a credential across an unrelated ccTLD sibling" literally
// true — an UNLISTED public suffix (e.g. a missing `co.id`) silently over-collapses
// (`alice.co.id` + `bad.co.id` → `co.id`), a password leak that "fall back to exact
// on uncertainty" cannot catch (`co.id` is shape-indistinguishable from a real
// registrable domain). The full PSL is the credential-safe answer. This module must
// NEVER be replaced by trackers.js's `registrableDomain`/`MULTI_SUFFIX` — that matcher
// is tracker-classification and deliberately treats unlisted / bare multi-tenant
// suffixes as registrable, which would LEAK credentials across tenants.
//
// DATA SOURCE (vendored, redistributable):
//   URL:      https://publicsuffix.org/list/public_suffix_list.dat
//   Snapshot: 2026-07-20 (file header VERSION 2026-07-20_19-17-05_UTC)
//   License:  Mozilla Public License v2.0 (MPL-2.0) — bundling the .dat as a DATA
//             asset (not an npm package) preserves goldfinch's zero-runtime-dep ethos.
//   REFRESH:  the list drifts as registries change. Re-fetch periodically from the URL
//             above (and ONLY that URL) and overwrite src/main/vault/public_suffix_list.dat;
//             the parser rebuilds its index (and re-reads the snapshot date) at module load.
//
// STALENESS IS NOT PURELY FAIL-CLOSED (corrected, PR#112 finding 10). An UNLISTED suffix
// resolves to null → exact fill (safe). BUT a NEW PRIVATE SUFFIX introduced beneath an
// already-known TLD is different: while the list predates it, two tenants under that new
// multi-tenant platform (`alice.newplatform.example`, `bob.newplatform.example`) both
// collapse to the same registrable domain (`newplatform.example`), WIDENING a
// `matchMode:'registrable-domain'` credential across unrelated tenants — an OPEN failure a
// stale list CAN cause. It is bounded here by an EXPIRY GATE: once the vendored snapshot is
// older than PSL_MAX_AGE_MS, `registrableDomainSafe` returns null unconditionally, disabling
// ALL registrable-domain widening (every fill degrades to exact origin) until the list is
// refreshed. So staleness within the window is a small, bounded residual; staleness beyond
// it is fail-closed by force. Keep the .dat current (the REFRESH note above).
//
// FAIL-CLOSED DEVIATION FROM THE STANDARD PSL ALGORITHM: the reference algorithm
// applies an implicit `*` default rule when no rule matches (treating an unknown TLD's
// last label as a public suffix). This module does NOT — an unmatched host returns
// null so an unknown / unlisted suffix can never widen a fill. Exception (`!`) rules
// take priority over wildcard (`*`) rules; among the rest, the longest match wins.
//
// BOTH the ICANN and PRIVATE sections are indexed: multi-tenant platform boundaries
// (github.io, s3.amazonaws.com, …) live in the PRIVATE section and MUST be honored so
// distinct tenants resolve to distinct registrable domains (the whole point).
//
// Pure: parses the .dat exactly ONCE at module load into Set indexes; every subsequent
// call is a bounded label walk. Electron-free; unit-tested exhaustively.

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');

const DAT_PATH = path.join(__dirname, 'public_suffix_list.dat');

// Any code unit >= U+0080 marks a non-ASCII (IDN) token needing IDNA ToASCII.
const NON_ASCII = /[\u0080-\uffff]/;

/**
 * IP literals are already their full identity — label-slicing them yields bogus
 * domains that collide across hosts, so they must never resolve to a registrable
 * domain. (The guard IDEA is borrowed from trackers.js:63; the tracker matcher itself
 * is deliberately NOT reused — see the header.)
 * @param {string} host
 * @returns {boolean}
 */
function isIpLiteral(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 dotted-quad
  if (host.startsWith('[') && host.endsWith(']')) return true; // bracketed IPv6 (URL.hostname)
  if (host.includes(':')) return true; // raw colon form (defensive)
  return false;
}

/**
 * ASCII/punycode-normalize a rule label sequence so it can be compared against a host
 * from `URL.hostname` (which is always punycode). Pure-ASCII tokens are only
 * lowercased (the common case — avoids a domainToASCII call for ~15k lines); a token
 * carrying non-ASCII (an IDN suffix in the .dat's Unicode form, e.g. `公司.cn`) is run
 * through IDNA ToASCII. A conversion failure keeps the lowercased original — which,
 * being non-ASCII, cannot match an ASCII host, so it simply fails closed.
 * @param {string} token
 * @returns {string}
 */
function toAscii(token) {
  if (!NON_ASCII.test(token)) return token.toLowerCase();
  const ascii = domainToASCII(token);
  return ascii === '' ? token.toLowerCase() : ascii;
}

/**
 * Parse the .dat text into three Set indexes: normal rules, wildcard PARENTS (the part
 * after `*.`), and exception suffixes (the part after `!`). Comment lines (`//`) and
 * blank lines are skipped; a rule is a single whitespace-delimited token.
 * @param {string} text
 * @returns {{ rules: Set<string>, wildcards: Set<string>, exceptions: Set<string> }}
 */
function buildIndex(text) {
  /** @type {Set<string>} */ const rules = new Set();
  /** @type {Set<string>} */ const wildcards = new Set();
  /** @type {Set<string>} */ const exceptions = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    const token = line.split(/\s+/)[0];
    if (!token) continue;
    if (token.startsWith('!')) {
      exceptions.add(toAscii(token.slice(1)));
    } else if (token.startsWith('*.')) {
      wildcards.add(toAscii(token.slice(2)));
    } else {
      rules.add(toAscii(token));
    }
  }
  return { rules, wildcards, exceptions };
}

const DAT_TEXT = fs.readFileSync(DAT_PATH, 'utf8');
const INDEX = buildIndex(DAT_TEXT);

// Expiry policy (PR#112 finding 10). The vendored .dat carries a `// VERSION:
// YYYY-MM-DD_HH-MM-SS_UTC` header; parse its date so a too-old snapshot can disable
// registrable-domain widening (a stale list can OPEN a cross-tenant leak via a newly
// introduced private suffix — see the header). 365 days is the supported window; past
// it, every widen falls back to exact origin until the .dat is refreshed.
const PSL_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Parse the snapshot epoch (ms) from the .dat's `// VERSION: YYYY-MM-DD_…_UTC` header,
 * or null when absent/unparseable (a list with no readable date is treated as NON-stale
 * — it fails toward today's behavior, not toward disabling fills, since the header is
 * ours to keep well-formed on refresh).
 * @param {string} text
 * @returns {number | null}
 */
function parseSnapshotMs(text) {
  const m = /^\/\/\s*VERSION:\s*(\d{4})-(\d{2})-(\d{2})/m.exec(text);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

const SNAPSHOT_MS = parseSnapshotMs(DAT_TEXT);

/**
 * Is the vendored PSL snapshot older than the supported window as of `now`? An
 * unparseable snapshot date is treated as NOT stale (see parseSnapshotMs). Exported
 * so the fill layer / tests can reason about the expiry gate.
 * @param {number} [now]  epoch ms (default Date.now()).
 * @returns {boolean}
 */
function isPslStale(now = Date.now()) {
  return SNAPSHOT_MS != null && (now - SNAPSHOT_MS) > PSL_MAX_AGE_MS;
}

/**
 * The registrable domain (eTLD+1) for a host, or **null** when it cannot be resolved
 * SAFELY. Returns null on: a non-string / empty / IP-literal / malformed host; a host
 * that IS a public suffix (no registrable label above it); and — the fail-closed
 * deviation — a host whose suffix is not explicitly listed (unknown / unlisted TLD).
 *
 * Algorithm (exception > wildcard > longest-match), then suffix + one more label:
 *   - exception (`!foo.bar`) rules take absolute priority (longest exception wins) and
 *     un-wildcard by dropping their leftmost label (suffix becomes `bar`);
 *   - otherwise the longest matching normal / wildcard (`*` = exactly one label) rule
 *     wins; if NONE match → null (no implicit `*` default — never widen an unknown).
 *
 * EXPIRY GATE (finding 10): when the vendored snapshot is older than the supported
 * window (`isPslStale(now)`), this returns null unconditionally — disabling every
 * registrable-domain widen so an over-stale list cannot open a cross-tenant leak. The
 * `now` is injectable for tests; the fill layer passes none (uses Date.now()).
 * @param {string} host  a hostname (as from URL.hostname — punycode for IDN); lowercased here.
 * @param {{ now?: number }} [opts]
 * @returns {string | null}
 */
function registrableDomainSafe(host, { now } = {}) {
  if (isPslStale(now == null ? Date.now() : now)) return null; // over-stale → no widening (fail-closed)
  if (typeof host !== 'string') return null;
  let h = host.trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1); // absolute-form trailing dot
  if (h === '') return null;
  // Defensive IDN normalization: a caller SHOULD pass punycode (URL.hostname does), but
  // a raw Unicode host is reconciled here so the ASCII rule index still matches.
  if (NON_ASCII.test(h)) {
    const ascii = domainToASCII(h);
    if (ascii === '') return null;
    h = ascii;
  }
  if (isIpLiteral(h)) return null;

  const labels = h.split('.');
  if (labels.some((l) => l.length === 0)) return null; // empty label → malformed (a..b, .a, a.)
  const n = labels.length;

  const { rules, wildcards, exceptions } = INDEX;
  /** @param {number} k @returns {string} the rightmost k labels, joined. */
  const rightmost = (k) => labels.slice(n - k).join('.');

  let suffixLen = -1;

  // (1) Exception rules — absolute priority, longest match first.
  for (let k = n; k >= 1; k--) {
    if (exceptions.has(rightmost(k))) {
      suffixLen = k - 1; // drop the exception rule's leftmost label
      break;
    }
  }

  // (2) Otherwise the longest matching normal / wildcard rule.
  if (suffixLen < 0) {
    let best = 0;
    for (let k = 1; k <= n; k++) {
      if (rules.has(rightmost(k))) best = k;
      // A wildcard `*.<parent>` matches at length k when its parent is the rightmost
      // (k-1) labels — the `*` consumes exactly one more label to the left.
      else if (k >= 2 && wildcards.has(rightmost(k - 1))) best = k;
    }
    // FAIL-CLOSED: no explicit rule matched → do NOT apply the implicit `*` default.
    if (best === 0) return null;
    suffixLen = best;
  }

  // The host is itself a public suffix (or reduces to exactly one via an exception) —
  // there is no registrable label above it.
  if (n <= suffixLen) return null;
  return labels.slice(n - (suffixLen + 1)).join('.');
}

module.exports = { registrableDomainSafe, isPslStale, PSL_MAX_AGE_MS, SNAPSHOT_MS };
