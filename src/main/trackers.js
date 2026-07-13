'use strict';

// Lightweight tracker classification: a curated list of well-known tracker
// domains by category, plus a registrable-domain (eTLD+1) heuristic so any
// third-party request can be flagged even if it isn't on the list.

// Common two-level public suffixes so "bbc.co.uk" -> "bbc.co.uk", not "co.uk".
// Also a curated subset of multi-tenant public suffixes (github.io, etc.) so
// distinct tenants (alice.github.io vs bob.github.io) are not collapsed to the
// shared suffix — that collapse would make third-party cookie stripping and
// tracker blocking fail open across tenants.
//
// NOT a full Public Suffix List: residual gap for unlisted multi-tenant /
// multi-level suffixes (and 3+-label PSL entries the last2 walk cannot see,
// e.g. s3.amazonaws.com is a host under amazonaws.com here, not its own
// suffix entry). Dependency-free by design — do not pull in a PSL package.
const MULTI_SUFFIX = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'co.jp',
  'or.jp',
  'ne.jp',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.in',
  'co.za',
  'co.kr',
  'com.br',
  'com.cn',
  'com.mx',
  'com.tr',
  'com.tw',
  'com.hk',
  'com.sg',
  // multi-tenant platforms (curated subset — see note above)
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'appspot.com',
  'amazonaws.com',
  'web.app',
  'firebaseapp.com',
  'pages.dev',
  'workers.dev',
  'vercel.app',
  'netlify.app',
  'netlify.com',
  'azurewebsites.net',
  'cloudfront.net',
  'fly.dev',
  'deno.dev',
  'surge.sh',
  'glitch.me'
]);

// IP literals are already their full identity — label-slicing them yields
// bogus domains (e.g. "192.168.1.10" → "1.10") that collide across hosts.
function isIpLiteral(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // Bracketed IPv6 (URL.hostname) or raw colon form.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  if (hostname.includes(':')) return true;
  return false;
}

function registrableDomain(hostname) {
  if (!hostname) return '';
  if (isIpLiteral(hostname)) return hostname;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.');
  return last2;
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
