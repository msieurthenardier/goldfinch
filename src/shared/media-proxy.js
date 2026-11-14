// Media proxy URL encode/decode helper (Mission 13 Flight 1 / Leg 2 — DD2/AC1; token addressing: Mission 23
// Flight 1, leg `jar-isolation`).
//
// Pure, Electron-free ESM module. Consumed renderer-side (disk-relative import,
// see the media-controller.js wiring in Phase B) and main-side via Node >=22
// `require(esm)` — the url-safety.js precedent (src/shared/url-safety.js),
// required directly from src/main/main.js and src/main/app-lifecycle.js today.
//
// Proxy URL shape: goldfinch-media://proxy/<token>/<strictly-encoded target url>
//
// <token> is an unguessable per-tab, per-document capability minted in main (`media-proxy-tokens.js`) and
// delivered beside each media list - NEVER a tab number (a page could name another tab's number and the
// proxy would fetch through that tab's session). This module only shapes and splits the address; whether a
// token is live is decided by main's token store, the single authority (the handler asks it).
//
// Contract (design-review correction on the original DD2 draft):
// `encodeURIComponent` does NOT escape six characters: ) ( ' ! ~ *  — all are
// harmless inside the poster's double-quoted `url("…")` CSS context (only `"`
// and `)` could break out, and `encodeURIComponent` already escapes `"` to
// `%22`), but as defense-in-depth for any future UNQUOTED call site, this
// helper additionally percent-escapes those six characters. The round-trip
// test asserts no raw `"` or `)` survives encoding.
//
// toMediaProxyUrl wraps ONLY http:/https: targets and answers `null` for everything else (blob:, data:,
// goldfinch-media:, file:, garbage, non-string) and for a missing token. There is no pass-through: a
// page-supplied non-web address must never reach an element's `src` via this helper. Callers handle `null`
// explicitly (an inline `data:` image is assigned directly at the two image sinks, nowhere else).
//
// parseMediaProxyUrl is PURE STRING PARSING — it never calls `new URL` on the
// custom `goldfinch-media:` scheme (that scheme's parsing behavior is not
// guaranteed uniform across the Electron runtime and the plain Node test
// runner, mirroring the isInternalPageUrl precedent's root-path note in
// url-safety.js). It does use `new URL` on the DECODED TARGET, which is always
// an ordinary http:/https: string — no special-scheme concern there.

const PROXY_PREFIX = 'goldfinch-media://proxy/';

// The parser is lenient: any base64url-alphabet token up to this many characters parses (a decimal tab
// number included). Whether it is a live token is the store's decision, so an old-shape address answers 404.
const MAX_TOKEN_LENGTH = 64;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

// The six characters encodeURIComponent leaves unescaped, mapped to their
// percent-encoded form.
const EXTRA_UNSAFE_RE = /[)('!~*]/g;
const EXTRA_ESCAPES = {
  ')': '%29',
  '(': '%28',
  "'": '%27',
  '!': '%21',
  '~': '%7E',
  '*': '%2A'
};

function strictEncode(value) {
  return encodeURIComponent(value).replace(EXTRA_UNSAFE_RE, (ch) => EXTRA_ESCAPES[ch]);
}

/**
 * toMediaProxyUrl(token, url)
 *
 * Returns `goldfinch-media://proxy/<token>/<strictly-encoded url>` iff `token` is a non-empty base64url
 * string (within the parser's length bound) and `url` is a string that parses as an absolute URL with
 * protocol http: or https:. Returns `null` for every other input - never throws.
 *
 * @param {unknown} token
 * @param {unknown} url
 * @returns {string | null}
 */
export function toMediaProxyUrl(token, url) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_RE.test(token)) {
    return null;
  }
  if (typeof url !== 'string') return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  return `${PROXY_PREFIX}${token}/${strictEncode(url)}`;
}

/**
 * parseMediaProxyUrl(raw)
 *
 * Pure string parsing (no `new URL` on the `goldfinch-media:` scheme). Returns
 * `{ token: string, url: string }` only for a well-formed
 * `goldfinch-media://proxy/<token>/<encoded target>` string whose token is of the base64url alphabet
 * (at most 64 characters) and whose decoded target parses as an absolute http:/https: URL. Returns `null`
 * for anything else. Never throws. It does NOT judge the token: the store does.
 *
 * @param {unknown} raw
 * @returns {{ token: string, url: string } | null}
 */
export function parseMediaProxyUrl(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(PROXY_PREFIX)) return null;

  const rest = raw.slice(PROXY_PREFIX.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;

  const token = rest.slice(0, slashIdx);
  const encodedTarget = rest.slice(slashIdx + 1);
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_RE.test(token) || encodedTarget === '') {
    return null;
  }

  let target;
  try {
    target = decodeURIComponent(encodedTarget);
  } catch {
    return null;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(target);
  } catch {
    return null;
  }
  if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') return null;

  return { token, url: target };
}
