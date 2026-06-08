'use strict';

const path = require('path');

/**
 * Return the Content-Type header value for a given file path, keyed by
 * the resolved file's extension. Only extensions that can appear in the
 * internal-page allowlist are handled; everything else gets a conservative
 * default that triggers a download rather than execution.
 *
 * Policy: content-type is derived from the MAP ENTRY's resolved file path,
 * NEVER from the raw URL pathname (which is traversal-controlled input).
 *
 * @param {string} file - Absolute path to the file as stored in the map.
 * @returns {string}
 */
function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Build a bound resolver from a per-host path map.
 *
 * The map shape is:
 *   { [host: string]: { [normalizedPathname: string]: string } }
 * where each value is an absolute file path on disk.
 *
 * `main.js` owns all path.join(__dirname, ...) resolution; this module
 * is __dirname-free and Electron-free so unit tests can inject a synthetic
 * map directly.
 *
 * @param {{ [host: string]: { [pathname: string]: string } }} map
 * @returns {(host: string, pathname: string) => { file: string, contentType: string } | null}
 */
function createResolver(map) {
  /**
   * Resolve a (host, pathname) pair against the fixed allowlist.
   *
   * Traversal-proof guarantee: the resolved `file` is taken DIRECTLY from
   * the map value — no path arithmetic is performed on `pathname`. A path
   * not literally present as a map key returns null.
   *
   * @param {string} host
   * @param {string} pathname - As produced by `new URL(...).pathname`.
   * @returns {{ file: string, contentType: string } | null}
   */
  function resolve(host, pathname) {
    // Normalize '' → '/' (WHATWG URL parser yields '' for "goldfinch://settings"
    // in Node while Electron yields '/'; same duality documented in isInternalPageUrl).
    const normalizedPathname = pathname === '' ? '/' : pathname;

    const hostMap = map[host];
    if (!hostMap) return null;

    // Exact-match only — case-sensitive. A mismatch (e.g. /SETTINGS.CSS) 404s.
    // Path is NEVER built from normalizedPathname; the map value is an absolute
    // pre-resolved path supplied by main.js.
    const file = hostMap[normalizedPathname];
    if (!file) return null;

    return { file, contentType: contentTypeFor(file) };
  }

  return resolve;
}

module.exports = { contentTypeFor, createResolver };
