// Pure launch-URL intake filter (sortie 01 / DD2). OS-handed URLs — cold-launch argv,
// `second-instance` argv, macOS `open-url` — are HOSTILE input: this is the one decision
// that admits them. Only `http:`/`https:` URLs that also pass `isSafeTabUrl` survive, in
// their normalized `new URL().href` form. Never throws.
import { isSafeTabUrl } from './url-safety.js';

export const MAX_LAUNCH_URLS = 20;

/**
 * Filters candidate strings to normalized, de-duplicated, capped http(s) URLs.
 * @param {unknown} candidates
 * @returns {string[]}
 */
export function filterLaunchUrls(candidates) {
  const out = [];
  if (!Array.isArray(candidates)) return out;
  const seen = new Set();
  for (const candidate of candidates) {
    if (out.length >= MAX_LAUNCH_URLS) break;
    try {
      if (typeof candidate !== 'string') continue;
      const token = candidate.trim();
      if (token === '' || token.startsWith('-')) continue;
      const parsed = new URL(token);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') continue;
      const href = parsed.href;
      if (!isSafeTabUrl(href) || seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    } catch {
      /* unparsable token — dropped */
    }
  }
  return out;
}

/**
 * Extracts launch URLs from a process argv. argv[0] (the executable) is ignored;
 * everything else goes through the same filter (flags, `.`, relative paths, and
 * non-http(s) schemes all fall out of it).
 * @param {unknown} argv
 * @returns {string[]}
 */
export function extractLaunchUrls(argv) {
  if (!Array.isArray(argv)) return [];
  return filterLaunchUrls(argv.slice(1));
}
