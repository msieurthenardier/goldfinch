// @ts-check
// Mission 20 Flight 1 (DD2/DD3): the pure classification model for a failed
// top-frame navigation. DOM-free, side-effect-free, `require(esm)`-testable —
// the `page-context-model.js` / `tab-context-model.js` precedent. Copy is
// app-authored: engine strings (`name`) never become prose, they render as a
// separate line the caller composes.
//
// `LOAD_STATES` is the single source for the census `loadState` field's enum;
// Flights 2 and 3 append `cert-blocked` / `crashed` / `hung` here, one place.

/** @type {{ OK: 'ok', FAILED: 'failed' }} */
export const LOAD_STATES = Object.freeze({ OK: 'ok', FAILED: 'failed' });

/**
 * Match on `name` first (stable across Chromium releases) — any `ERR_CERT_*`
 * name maps to `cert` regardless of its code. Plain lookups otherwise.
 * @type {Record<string, string>}
 */
const NAME_KIND = Object.freeze({
  ERR_NAME_NOT_RESOLVED: 'dns',
  ERR_CONNECTION_REFUSED: 'refused',
  ERR_CONNECTION_TIMED_OUT: 'timeout',
  ERR_TIMED_OUT: 'timeout',
  ERR_INTERNET_DISCONNECTED: 'offline',
  ERR_ADDRESS_UNREACHABLE: 'unreachable',
  ERR_CONNECTION_CLOSED: 'dropped',
  ERR_CONNECTION_RESET: 'dropped',
  ERR_CONNECTION_FAILED: 'dropped',
  ERR_EMPTY_RESPONSE: 'dropped',
  ERR_SSL_PROTOCOL_ERROR: 'tls',
  ERR_SSL_VERSION_OR_CIPHER_MISMATCH: 'tls',
  ERR_BLOCKED_BY_CLIENT: 'blocked',
  ERR_BLOCKED_BY_RESPONSE: 'blocked',
  ERR_TOO_MANY_REDIRECTS: 'redirect-loop',
  ERR_UNKNOWN_URL_SCHEME: 'scheme',
  // Leg 2 addition (the leg-1 spike's incidental finding): Chromium's
  // restricted-port list — the flight's designated "refused" fixture
  // (`http://127.0.0.1:1/`) actually fails this way, not ERR_CONNECTION_REFUSED.
  ERR_UNSAFE_PORT: 'unsafe-port'
});

/**
 * Code fallback, used only when `name` is missing/unrecognized — a numeric
 * net-error-code table for the same kinds (Chromium's `net_error_list.h`
 * values). Secondary by design (DD3): a code alone is less legible than the
 * name, but some engine paths may omit the description string.
 * @type {Record<string, string>}
 */
const CODE_KIND = Object.freeze({
  '-100': 'dropped', // ERR_CONNECTION_CLOSED
  '-101': 'dropped', // ERR_CONNECTION_RESET
  '-102': 'refused', // ERR_CONNECTION_REFUSED
  '-104': 'dropped', // ERR_CONNECTION_FAILED
  '-105': 'dns', // ERR_NAME_NOT_RESOLVED
  '-106': 'offline', // ERR_INTERNET_DISCONNECTED
  '-107': 'tls', // ERR_SSL_PROTOCOL_ERROR
  '-109': 'unreachable', // ERR_ADDRESS_UNREACHABLE
  '-113': 'tls', // ERR_SSL_VERSION_OR_CIPHER_MISMATCH
  '-118': 'timeout', // ERR_CONNECTION_TIMED_OUT
  '-7': 'timeout', // ERR_TIMED_OUT
  '-20': 'blocked', // ERR_BLOCKED_BY_CLIENT
  '-27': 'blocked', // ERR_BLOCKED_BY_RESPONSE
  '-310': 'redirect-loop', // ERR_TOO_MANY_REDIRECTS
  '-312': 'unsafe-port', // ERR_UNSAFE_PORT
  '-324': 'dropped' // ERR_EMPTY_RESPONSE
});

/**
 * App-authored title/body/retryable per kind. `retryable: true` for every
 * kind except `scheme` and `blocked` (DD3) — a deliberate block or an
 * unsupported address is not something a bare retry can fix.
 * @type {Record<string, { title: string, body: string, retryable: boolean }>}
 */
const KIND_COPY = Object.freeze({
  dns: {
    title: "This site can't be found",
    body: "Goldfinch couldn't find the server for this address.",
    retryable: true
  },
  refused: {
    title: 'Connection refused',
    body: 'The server refused the connection.',
    retryable: true
  },
  timeout: {
    title: 'Connection timed out',
    body: 'The connection took too long to respond.',
    retryable: true
  },
  offline: {
    title: "You're offline",
    body: 'Check your internet connection and try again.',
    retryable: true
  },
  unreachable: {
    title: 'Address unreachable',
    body: "Goldfinch couldn't reach this address.",
    retryable: true
  },
  dropped: {
    title: 'Connection was interrupted',
    body: 'The connection was closed before the page finished loading.',
    retryable: true
  },
  cert: {
    title: "This connection isn't private",
    body: "This site's security certificate isn't trusted.",
    retryable: true
  },
  tls: {
    title: 'Secure connection failed',
    body: "Goldfinch couldn't establish a secure connection to this site.",
    retryable: true
  },
  blocked: {
    title: 'Request blocked',
    body: 'This request was blocked and cannot be retried automatically.',
    retryable: false
  },
  'redirect-loop': {
    title: 'Too many redirects',
    body: "This page isn't redirecting properly.",
    retryable: true
  },
  scheme: {
    title: 'Address not supported',
    body: "Goldfinch doesn't support this type of address.",
    retryable: false
  },
  'unsafe-port': {
    title: 'Port not allowed',
    body: "This address uses a network port Goldfinch doesn't allow for safety.",
    retryable: false
  },
  unknown: {
    title: "This page didn't load",
    body: 'Something went wrong while loading this page.',
    retryable: true
  }
});

/**
 * Classify a failed navigation into an app-authored `{ kind, title, body,
 * retryable }`. Never throws — `undefined`/non-string input resolves
 * `unknown` (the fallback's own copy).
 * @param {{ code?: number, name?: string } | undefined | null} failure
 * @returns {{ kind: string, title: string, body: string, retryable: boolean }}
 */
export function classifyLoadFailure(failure) {
  const code = failure && typeof failure === 'object' ? failure.code : undefined;
  const name = failure && typeof failure === 'object' ? failure.name : undefined;
  let kind = 'unknown';
  if (typeof name === 'string' && name.startsWith('ERR_CERT_')) {
    kind = 'cert';
  } else if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(NAME_KIND, name)) {
    kind = NAME_KIND[name];
  } else if (typeof code === 'number' && Object.prototype.hasOwnProperty.call(CODE_KIND, String(code))) {
    kind = CODE_KIND[String(code)];
  }
  const copy = KIND_COPY[kind] || KIND_COPY.unknown;
  return { kind, title: copy.title, body: copy.body, retryable: copy.retryable };
}

/**
 * A `did-fail-load` event is a recordable navigation failure iff it is the
 * MAIN frame and its code is not `ERR_ABORTED` (-3) — Electron fires -3 for
 * ordinary user-cancelled navigations and downloads, never a real failure
 * (DD2).
 * @param {{ errorCode?: number, isMainFrame?: boolean } | undefined | null} args
 * @returns {boolean}
 */
export function shouldRecordLoadFailure(args) {
  if (!args || typeof args !== 'object') return false;
  return args.isMainFrame === true && args.errorCode !== -3;
}

/**
 * `true` for any string beginning with `chrome-error:` — Chromium's failed-
 * navigation error document scheme (`chrome-error://chromewebdata/`).
 * @param {unknown} url
 * @returns {boolean}
 */
export function isChromeErrorUrl(url) {
  return typeof url === 'string' && url.startsWith('chrome-error:');
}

/**
 * The host-derived label a failed tab shows — shared by the strip's
 * `.tab-title` (`load-failure-controller.js`'s `applyStripState`) and the
 * `enumerateTabs` census `title` field (`tab-controller.js`'s `listTabs`) so
 * the two can never drift (post-acceptance fix pass F2). Mirrors the strip's
 * own derivation exactly: `new URL(...).host` off the intended address,
 * falling back to the raw string when it doesn't parse.
 * @param {{ loadFailure?: { url?: string } | null, url?: string } | null | undefined} tab
 * @returns {string}
 */
export function failedTabTitle(tab) {
  const raw = (tab && tab.loadFailure && tab.loadFailure.url) || (tab && tab.url) || '';
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}
