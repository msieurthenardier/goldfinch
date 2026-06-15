// @ts-check
'use strict';

// Automation MCP transport — SC7 loopback Origin/Host allow-list (DD3).
//
// This module is deliberately ELECTRON-FREE and dependency-free (no require of
// anything at the top) so the predicate is unit-testable offline with plain
// objects. It performs NO I/O and has NO side effects.
//
// Why this exists: binding the MCP server to 127.0.0.1 is necessary but NOT
// sufficient. *This very browser renders hostile pages*, and a rendered page can
// reach a loopback server via DNS-rebinding. The defense is to pin Origin/Host:
// a real hostile page ALWAYS sends an Origin header, and a rebinding attack
// rewrites Host to a public name that resolves to 127.0.0.1. So we reject any
// request whose Host is non-loopback, whose Origin is present-and-non-loopback,
// or whose peer socket is non-loopback. We allow a request with NO Origin header
// only when its Host is loopback — a missing Origin means a non-browser local
// tool (the MCP client, curl), not a page.
//
// The guard runs FIRST on every request in mcp-server.js, before any MCP/SDK
// processing; a denied request gets a 403 and never reaches the SDK.

/**
 * The loopback host names/addresses we treat as local, in their bare
 * (port-stripped, bracket-stripped) form.
 * - 127.0.0.1            IPv4 loopback
 * - ::1                  IPv6 loopback
 * - ::ffff:127.0.0.1     IPv6-mapped IPv4 loopback (e.g. req.socket.remoteAddress
 *                        on a dual-stack listener)
 * - localhost            the loopback name
 *
 * NOTE: the entire 127.0.0.0/8 block is loopback, but in practice only 127.0.0.1
 * is used; we match it exactly rather than range-checking. If a future need
 * arises for 127.0.0.2 etc., extend isLoopbackHostname — do not loosen callers.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/**
 * Normalize a raw host/authority token to its bare hostname for loopback testing.
 *
 * Handles:
 *   - a trailing `:port`            → stripped ('127.0.0.1:7777' → '127.0.0.1')
 *   - a bracketed IPv6 authority    → unwrapped ('[::1]:7777' → '::1', '[::1]' → '::1')
 *   - surrounding whitespace        → trimmed
 *   - case (for the 'localhost' name) → lowercased
 *
 * Port stripping is deliberate: DD3 keys on the *loopback-ness of the host*, not
 * the port. A `Host: 127.0.0.1:9999` against a server bound to 7777 is therefore
 * ALLOWED — loopback is loopback. This is a decision, not an oversight (Edge
 * Cases: Host-header port mismatch).
 *
 * Bare-IPv6 detection: an unbracketed token containing 2+ colons is treated as a
 * full IPv6 literal (no port to strip — a bare IPv6 authority cannot carry a
 * port without brackets per RFC 3986). A token with exactly one colon is
 * host:port and gets the port stripped.
 *
 * @param {unknown} raw  a Host header value, an Origin's host, or a peer address
 * @returns {string|null} the bare lowercased hostname, or null if unparseable
 */
function bareHost(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s === '') return null;

  // Bracketed IPv6 authority: [::1] or [::1]:7777
  if (s[0] === '[') {
    const close = s.indexOf(']');
    if (close === -1) return null; // malformed
    return s.slice(1, close).trim().toLowerCase();
  }

  // Unbracketed: distinguish a bare IPv6 literal (>=2 colons) from host:port.
  const colonCount = (s.match(/:/g) || []).length;
  if (colonCount >= 2) {
    // bare IPv6 literal, no port to strip
    return s.toLowerCase();
  }
  if (colonCount === 1) {
    // host:port — strip the port
    s = s.slice(0, s.indexOf(':'));
  }
  return s.toLowerCase();
}

/**
 * Returns true iff the given raw host/authority/address resolves to a loopback
 * hostname after normalization. Never throws.
 *
 * @param {unknown} raw  a Host header, an Origin host, or a peer address
 * @returns {boolean}
 */
function isLoopbackHostname(raw) {
  const h = bareHost(raw);
  return h !== null && LOOPBACK_HOSTS.has(h);
}

/**
 * Extract the host (authority minus scheme/path) from an Origin header value.
 *
 * An Origin is a serialized origin: `scheme://host[:port]` (no path, no
 * trailing slash per the Fetch spec), e.g. `http://127.0.0.1:7777` or
 * `https://evil.example`. We parse with the WHATWG URL parser and return its
 * `host` (which includes the port, fine — bareHost strips it). The literal
 * `"null"` opaque origin (sandboxed/file/data documents) is NOT loopback and is
 * returned as-is so it fails the loopback test → deny.
 *
 * @param {string} origin  a non-empty Origin header value
 * @returns {string|null} the origin's host authority, or null if unparseable
 */
function originHost(origin) {
  if (origin === 'null') return 'null'; // opaque origin — explicitly not loopback
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

/**
 * The SC7 / DD3 loopback Origin/Host allow-list predicate.
 *
 * Maps (host, origin, peerAddress) → allow | deny. PURE: no I/O, no Electron, no
 * side effects. Fail-closed: any ambiguity denies.
 *
 * Policy:
 *   DENY (→ 403) if ANY of:
 *     - Host header is missing/unparseable, OR non-loopback  (fail-closed on
 *       missing Host — HTTP/1.0 / malformed requests are rejected)
 *     - Origin header is PRESENT and non-loopback (a rendered hostile page
 *       always sends an Origin; the `"null"` opaque origin counts as non-loopback)
 *     - the peer socket address is missing/unparseable, OR non-loopback
 *   ALLOW otherwise — notably a request with NO Origin header is allowed IFF its
 *   Host is loopback (a missing Origin means a local non-browser tool).
 *
 * Inputs are taken raw from the request:
 *   host        = req.headers.host
 *   origin      = req.headers.origin       (undefined when absent)
 *   peerAddress = req.socket.remoteAddress
 *
 * @param {{ host?: unknown, origin?: unknown, peerAddress?: unknown }} req
 * @returns {boolean} true = allow, false = deny (403)
 */
function isAllowed({ host, origin, peerAddress } = {}) {
  // 1. Host must be present and loopback (fail-closed on missing/malformed).
  if (!isLoopbackHostname(host)) return false;

  // 2. Peer socket must be loopback (fail-closed on missing/malformed).
  if (!isLoopbackHostname(peerAddress)) return false;

  // 3. Origin, IF present, must be loopback. Absent Origin is allowed (the
  //    no-Origin + loopback-Host pass rule). An empty-string Origin is treated
  //    as absent (some clients send no meaningful Origin); the `"null"` opaque
  //    origin is treated as PRESENT-and-non-loopback → deny.
  if (typeof origin === 'string' && origin !== '') {
    if (!isLoopbackHostname(originHost(origin))) return false;
  }

  return true;
}

module.exports = { isAllowed, isLoopbackHostname, bareHost, originHost };
