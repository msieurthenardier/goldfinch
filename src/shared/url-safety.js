'use strict';

/**
 * isSafeTabUrl(url)
 *
 * Returns true iff the URL is safe to load in a Goldfinch tab:
 *   - http:  (any hostname)
 *   - https: (any hostname)
 *   - about:blank  (exact, case-insensitive)
 *
 * Returns false for everything else: file:, data:, javascript:, blob:,
 * chrome:, protocol-relative URLs, non-strings, empties, and malformed input.
 * Never throws.
 */
function isSafeTabUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '') return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  // about:blank must be matched case-insensitively.
  // The WHATWG URL parser does NOT normalise the pathname of about: URLs:
  //   new URL('ABOUT:BLANK').href  === 'about:BLANK'  (not 'about:blank')
  // So compare the full href lowercased.
  if (parsed.href.toLowerCase() === 'about:blank') return true;

  const proto = parsed.protocol; // always lowercased by the URL parser
  return proto === 'http:' || proto === 'https:';
}

/**
 * isSafePosterUrl(url)
 *
 * Returns true iff the URL is safe to use as a CSS backgroundImage poster:
 *   - http:  (any hostname)
 *   - https: (any hostname)
 *   - blob:  (structurally <origin>/<uuid>, no quotes)
 *
 * Additionally rejects any value whose normalized href contains a `"` or `)`
 * character (belt-and-suspenders against url("…") breakout).
 *
 * Returns false for everything else: data:, file:, javascript:, vbscript:,
 * about:, chrome:, non-strings, empties, and malformed input.
 * Never throws.
 *
 * Note: data: is intentionally excluded — the WHATWG URL parser does NOT
 * percent-encode literal `"`/`)` inside an opaque data: path, so a
 * data:image/png,x");… value would pass a scheme-only gate and break out
 * of the url("…") CSS context.
 */
function isSafePosterUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '') return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const proto = parsed.protocol; // always lowercased by the URL parser
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'blob:') return false;

  // Belt-and-suspenders: reject if the normalized href carries any character
  // that could break out of the url("…") CSS context.
  if (parsed.href.includes('"') || parsed.href.includes(')')) return false;

  return true;
}

// Dual export: CommonJS (main process + test runner) and global (renderer,
// which runs with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isSafeTabUrl, isSafePosterUrl };
} else {
  /** @type {any} */ (globalThis).isSafeTabUrl = isSafeTabUrl;
  /** @type {any} */ (globalThis).isSafePosterUrl = isSafePosterUrl;
}
