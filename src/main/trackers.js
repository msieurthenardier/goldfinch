'use strict';

// Lightweight tracker classification: a curated list of well-known tracker
// domains by category, plus a registrable-domain (eTLD+1) heuristic so any
// third-party request can be flagged even if it isn't on the list.

// Common two-level public suffixes so "bbc.co.uk" -> "bbc.co.uk", not "co.uk".
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'co.jp', 'or.jp', 'ne.jp',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.in', 'co.za', 'co.kr',
  'com.br', 'com.cn', 'com.mx', 'com.tr', 'com.tw', 'com.hk', 'com.sg'
]);

function registrableDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
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

  // Exact registrable-domain match, then check fuller hostname for sub-entries.
  let category = TRACKERS[domain] || null;
  if (!category) {
    const host = hostnameOf(requestUrl);
    if (TRACKERS[host]) category = TRACKERS[host];
  }
  return { thirdParty, tracker: thirdParty ? category : null, domain };
}

module.exports = { registrableDomain, hostnameOf, classify, TRACKERS };
