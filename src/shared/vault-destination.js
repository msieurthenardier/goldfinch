// The destination display string of a vault picker (Mission 23 Flight 1, leg `vault-fill-trust`;
// rendered by leg `vault-picker-controls`). Tells the operator WHICH site a fill is going to.
//
// Pure. Takes an origin string (`https://example.com`, `http://host:8080`) and returns the host as the
// URL parser serialises it (punycode for a non-ASCII host, so a look-alike cannot hide behind
// homoglyphs), plus a non-default port. An `http:` origin keeps its scheme so the operator can see the
// page is not encrypted; an `https:` origin shows no scheme. Anything that is not a tuple http(s)
// origin has no destination and yields `''`.
//
// Real ES module: required by main-side code via require(esm) and importable by the chrome.

/**
 * @param {unknown} origin
 * @returns {string}  e.g. `example.com`, `xn--bcher-kva.example:8443`, `http://localhost:3000`; `''` when none.
 */
export function destinationDisplay(origin) {
  if (typeof origin !== 'string' || origin.length === 0) return '';
  let url;
  try {
    url = new URL(origin);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (!url.hostname) return '';
  // `url.port` is '' for the scheme's default port, so only a non-default port is shown.
  const hostPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return url.protocol === 'http:' ? `http://${hostPort}` : hostPort;
}
