// Media proxy URL encode/decode helper (Mission 13 Flight 1 / Leg 2 — DD2/AC1).
//
// Pure, Electron-free ESM module. Consumed renderer-side (disk-relative import,
// see the media-controller.js wiring in Phase B) and main-side via Node >=22
// `require(esm)` — the url-safety.js precedent (src/shared/url-safety.js),
// required directly from src/main/main.js and src/main/app-lifecycle.js today.
//
// Proxy URL shape: goldfinch-media://proxy/<wcId>/<strictly-encoded target url>
//
// Contract (design-review correction on the original DD2 draft):
// `encodeURIComponent` does NOT escape six characters: ) ( ' ! ~ *  — all are
// harmless inside the poster's double-quoted `url("…")` CSS context (only `"`
// and `)` could break out, and `encodeURIComponent` already escapes `"` to
// `%22`), but as defense-in-depth for any future UNQUOTED call site, this
// helper additionally percent-escapes those six characters. The round-trip
// test asserts no raw `"` or `)` survives encoding.
//
// toMediaProxyUrl wraps ONLY http:/https: targets — every other input (blob:,
// data:, goldfinch://, garbage, non-string) is returned UNCHANGED. This is a
// contract of the helper, not call-site judgment: main can never `session.fetch`
// a renderer-local blob: URL, so an unconditional wrap would silently break
// blob-backed media items.
//
// parseMediaProxyUrl is PURE STRING PARSING — it never calls `new URL` on the
// custom `goldfinch-media:` scheme (that scheme's parsing behavior is not
// guaranteed uniform across the Electron runtime and the plain Node test
// runner, mirroring the isInternalPageUrl precedent's root-path note in
// url-safety.js). It does use `new URL` on the DECODED TARGET, which is always
// an ordinary http:/https: string — no special-scheme concern there.

const PROXY_PREFIX = 'goldfinch-media://proxy/';

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
 * toMediaProxyUrl(wcId, url)
 *
 * Returns `goldfinch-media://proxy/<wcId>/<strictly-encoded url>` iff `url` is
 * a string that parses as an absolute URL with protocol http: or https:.
 * Returns `url` UNCHANGED for every other input (blob:, data:, malformed,
 * non-string, null/undefined) — never throws.
 *
 * @param {number} wcId
 * @param {unknown} url
 * @returns {unknown}
 */
export function toMediaProxyUrl(wcId, url) {
  if (typeof url !== 'string') return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;

  return `${PROXY_PREFIX}${wcId}/${strictEncode(url)}`;
}

/**
 * parseMediaProxyUrl(raw)
 *
 * Pure string parsing (no `new URL` on the `goldfinch-media:` scheme). Returns
 * `{ wcId: number, url: string }` only for a well-formed
 * `goldfinch-media://proxy/<wcId>/<encoded target>` string whose decoded
 * target parses as an absolute http:/https: URL. Returns `null` for anything
 * else (missing/garbled prefix, non-numeric wcId segment, undecodable percent
 * escapes, a decoded target that isn't http/https, non-string input). Never
 * throws.
 *
 * @param {unknown} raw
 * @returns {{ wcId: number, url: string } | null}
 */
export function parseMediaProxyUrl(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(PROXY_PREFIX)) return null;

  const rest = raw.slice(PROXY_PREFIX.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;

  const wcIdPart = rest.slice(0, slashIdx);
  const encodedTarget = rest.slice(slashIdx + 1);
  if (!/^\d+$/.test(wcIdPart) || encodedTarget === '') return null;

  const wcId = Number(wcIdPart);
  if (!Number.isSafeInteger(wcId)) return null;

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

  return { wcId, url: target };
}
