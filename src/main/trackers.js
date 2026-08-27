'use strict';

// Lightweight tracker classification: a curated list of well-known tracker
// domains by category, plus a registrable-domain (eTLD+1) resolver so any
// third-party request can be flagged even if it isn't on the list.

const { registrableDomainSafe } = require('./psl');

// registrableDomain is PSL-backed (squawk 0035 / GitHub #81, security audit
// finding F5). It previously walked a hand-maintained MULTI_SUFFIX set of
// "common two-level suffixes" (bbc.co.uk, etc.) and curated multi-tenant
// platforms (github.io, etc.); that set was necessarily incomplete, so an
// unlisted multi-tenant suffix (e.g. an S3 bucket host, an unlisted
// *.github.io-style platform) silently collapsed distinct tenants onto the
// same "site", making third-party cookie stripping and tracker blocking fail
// OPEN across tenants.
//
// Delegating to src/main/psl.js (the same vendored, fail-closed Public Suffix
// List parser the vault's registrable-domain credential match uses — moved
// out of vault/ to share here) fixes that: multi-tenant PSL entries
// (github.io, s3.amazonaws.com, vercel.app, …) resolve tenants to distinct
// registrable domains. Per operator ruling 2026-08-27, an UNLISTED suffix is
// acceptable to fail closed here too: rather than guessing at a split, an
// unresolvable host is treated as its own whole-hostname identity (below),
// which never merges two distinct hosts into one "site" incorrectly.
//
// CAUGHT IN REVIEW (2026-08-27): "unlisted suffix" only fails closed when PSL
// returns null. Four of the old MULTI_SUFFIX platform entries — amazonaws.com,
// netlify.com, surge.sh, glitch.me — sit directly under a real ICANN TLD
// (.com, .sh, .me) with no matching PRIVATE-section rule in the vendored
// .dat, so PSL resolves them via the ICANN TLD rule alone and returns a
// non-null but WRONG registrable domain that drops the tenant label (e.g.
// tenant-a.netlify.com -> netlify.com) — re-opening the exact cross-tenant
// merge this squawk fixes, for those four. SUPPLEMENT_SUFFIX below restores
// the old curated split for exactly this confirmed-absent set; see its
// comment for the check and the PSL-wins condition.

// IP literals are already their full identity — label-slicing them yields
// bogus domains (e.g. "192.168.1.10" → "1.10") that collide across hosts.
function isIpLiteral(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // Bracketed IPv6 (URL.hostname) or raw colon form.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  if (hostname.includes(':')) return true;
  return false;
}

// Curated supplement to the PSL, NOT a replacement for it. Checked 2026-08-27
// against the vendored public_suffix_list.dat (snapshot 2026-07-20): these
// are exactly the pre-squawk-0035 MULTI_SUFFIX entries confirmed absent from
// the .dat's PRIVATE section (verified by calling registrableDomainSafe on a
// synthetic tenant host for every old MULTI_SUFFIX entry and diffing against
// the expected split — the other entries, e.g. github.io, s3.amazonaws.com,
// vercel.app, all resolve correctly via the PSL alone). Each of these sits
// under a real ICANN TLD (.com, .sh, .me), so PSL doesn't fail closed for
// them — it returns the bare TLD-level split, silently merging tenants. If
// the .dat later gains a matching PRIVATE-section rule, PSL's own answer will
// stop being the bare suffix (see the `safe === suffix` guard in
// registrableDomain below) and this supplement stops firing on its own —
// PSL always wins once it has a more specific answer.
const SUPPLEMENT_SUFFIX = new Set(['amazonaws.com', 'netlify.com', 'surge.sh', 'glitch.me']);

function registrableDomain(hostname) {
  if (!hostname) return '';
  if (isIpLiteral(hostname)) return hostname;
  const safe = registrableDomainSafe(hostname);
  if (safe != null) {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length >= 3) {
      const suffix = parts.slice(-2).join('.');
      // Override only when PSL's answer IS the bare supplement suffix (no
      // deeper PSL rule fired) — a tenant label is being dropped. A more
      // specific PSL match (e.g. s3.amazonaws.com's own PRIVATE rule) never
      // equals the bare 2-label suffix here, so it's left untouched.
      if (SUPPLEMENT_SUFFIX.has(suffix) && safe === suffix) {
        return parts.slice(-3).join('.');
      }
    }
    return safe;
  }
  // PSL couldn't resolve it (unlisted TLD, the host IS a public suffix, a
  // single label like "localhost", or an over-stale snapshot) — fail closed
  // by treating the whole hostname as its own identity rather than guessing
  // at a split. Never merges two distinct hosts; may under-strip a
  // legitimate subdomain on an unlisted suffix, which is the accepted
  // tradeoff (operator ruling 2026-08-27).
  return hostname.split('.').filter(Boolean).join('.');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Registrable domain -> category. Categories: ads, analytics, social, other.
const TRACKERS = {
  // analytics / product analytics
  'google-analytics.com': 'analytics',
  'googletagmanager.com': 'analytics',
  'analytics.google.com': 'analytics',
  'scorecardresearch.com': 'analytics',
  'hotjar.com': 'analytics',
  'mixpanel.com': 'analytics',
  'amplitude.com': 'analytics',
  'segment.com': 'analytics',
  'segment.io': 'analytics',
  'fullstory.com': 'analytics',
  'mouseflow.com': 'analytics',
  'cloudflareinsights.com': 'analytics',
  'nr-data.net': 'analytics',
  'newrelic.com': 'analytics',
  'quantserve.com': 'analytics',
  'chartbeat.com': 'analytics',
  'parsely.com': 'analytics',
  'heap.io': 'analytics',
  'mathtag.com': 'analytics',
  // ads / ad tech
  'doubleclick.net': 'ads',
  'googlesyndication.com': 'ads',
  'googleadservices.com': 'ads',
  'adservice.google.com': 'ads',
  'g.doubleclick.net': 'ads',
  'criteo.com': 'ads',
  'criteo.net': 'ads',
  'taboola.com': 'ads',
  'outbrain.com': 'ads',
  'adnxs.com': 'ads',
  'pubmatic.com': 'ads',
  'rubiconproject.com': 'ads',
  'openx.net': 'ads',
  'adsrvr.org': 'ads',
  'moatads.com': 'ads',
  'doubleverify.com': 'ads',
  'amazon-adsystem.com': 'ads',
  'casalemedia.com': 'ads',
  'bidswitch.net': 'ads',
  'sharethrough.com': 'ads',
  'smartadserver.com': 'ads',
  'teads.tv': 'ads',
  'yieldmo.com': 'ads',
  '3lift.com': 'ads',
  'bing.com': 'ads',
  'ads.linkedin.com': 'ads',
  'ads.yahoo.com': 'ads',
  // social widgets / pixels
  'facebook.net': 'social',
  'connect.facebook.net': 'social',
  'facebook.com': 'social',
  'platform.twitter.com': 'social',
  'ads-twitter.com': 'social',
  't.co': 'social',
  'platform.linkedin.com': 'social',
  'snap.licdn.com': 'social',
  'analytics.tiktok.com': 'social',
  'tiktok.com': 'social',
  'pinterest.com': 'social',
  'reddit.com': 'social',
  'redditstatic.com': 'social',
  'disqus.com': 'social',
  'addthis.com': 'social',
  'sharethis.com': 'social',
  // error/session tracking, tag managers, misc beacons
  'sentry.io': 'other',
  'bugsnag.com': 'other',
  'optimizely.com': 'other',
  'onetrust.com': 'other',
  'cookielaw.org': 'other',
  'branch.io': 'other',
  'appsflyer.com': 'other'
};

// Classify a request URL relative to the page's first-party domain.
// Returns { thirdParty, tracker: category|null, domain }.
function classify(requestUrl, firstPartyDomain) {
  const domain = registrableDomain(hostnameOf(requestUrl));
  if (!domain) return { thirdParty: false, tracker: null, domain: '' };
  const thirdParty = !!firstPartyDomain && domain !== firstPartyDomain;

  // Exact registrable-domain match first (fast path), then host-keyed entries:
  // exact full host, then each parent label boundary down toward eTLD+1 so a
  // listed host like analytics.google.com still matches www.analytics.google.com.
  // Tracker category is only returned when thirdParty (gate below) — first-party
  // hits on a listed domain stay tracker:null.
  let category = TRACKERS[domain] || null;
  if (!category) {
    const host = hostnameOf(requestUrl);
    if (host) {
      let h = host;
      while (h) {
        if (TRACKERS[h]) {
          category = TRACKERS[h];
          break;
        }
        // Stop once we reach the registrable domain (already checked above).
        if (h === domain) break;
        const i = h.indexOf('.');
        if (i < 0) break;
        h = h.slice(i + 1);
      }
    }
  }
  return { thirdParty, tracker: thirdParty ? category : null, domain };
}

module.exports = { registrableDomain, hostnameOf, classify, TRACKERS };
