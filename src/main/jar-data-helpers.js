// @ts-check
'use strict';

// Pure, Electron-free helpers for the Cookies + Other-site-data panels (M10
// Flight 2, Leg 2 / flight DD2, DD3 VERDICT). No imports, no Node built-ins —
// every function here is a plain string-in/string-out (or array-in/array-out)
// transform, unit-testable without a live session or filesystem. jar-ipc.js
// and history-store.js both require this module rather than duplicating any
// of it (the leg spec's "the same helper keys both union sides" ruling for
// `origin`).

/**
 * Reconstruct the URL `ses.cookies.remove(url, name)` needs from a listed
 * cookie's identity fields (DD2). Scheme derives from `secure`; the domain's
 * leading dot (present on domain-attribute cookies, absent on host-only ones
 * — Electron's own `Cookie.domain` doc) is unconditionally stripped, which is
 * a no-op for an already-dotless host-only domain (spike-verified safe for
 * both shapes, flight-log Decisions). `path` defaults to `/` when absent/empty.
 * @param {{ domain?: (string|null), path?: (string|null), secure?: boolean }} cookie
 * @returns {string}
 */
function cookieUrl(cookie) {
  const scheme = cookie && cookie.secure ? 'https' : 'http';
  const rawDomain = cookie && typeof cookie.domain === 'string' ? cookie.domain : '';
  const host = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;
  const rawPath = cookie && typeof cookie.path === 'string' ? cookie.path : '';
  const path = rawPath.length > 0 ? rawPath : '/';
  return `${scheme}://${host}${path}`;
}

/**
 * Normalize a URL to its origin (scheme + host + port), or null on a parse
 * failure. The SOLE normalizer for both union sides of the site-data
 * composite list (DD3 VERDICT) — deliberately NOT trackers.js's
 * `hostnameOf`/`registrableDomain`, which drop scheme/port and collapse to
 * eTLD+1 (design review correction: those helpers would merge distinct
 * origins and yield strings `clearStorageData({origin})` can't act on).
 * @param {string} url
 * @returns {string|null}
 */
function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Parse an on-disk IndexedDB leveldb directory name into its origin (format:
 * `<scheme>_<host>_<port>.indexeddb.leveldb`, e.g.
 * `http_127.0.0.1_54321.indexeddb.leveldb` — Spike B); a default-port origin
 * (e.g. `https://example.com/`) carries the port segment TOO, but as the
 * literal sentinel `0` rather than 443/80 or an omitted segment (M10 Flight
 * 2, Leg 2 smoke check, live-measured against a real `https://example.com/`
 * IndexedDB write on the dev rig: dirname
 * `https_example.com_0.indexeddb.leveldb`) — Spike B measured only an
 * explicit non-default port, so this is new information this leg's smoke
 * check was scoped to gather. `0` is normalized to "no port" (matching
 * `origin()`'s own `new URL().origin` default-port omission), which is what
 * makes both union sides key identically for a default-port origin instead
 * of silently splitting it into two rows. Defensive by construction (DD3):
 * anything that doesn't fit degrades to `null`, never throws.
 * Parsing strategy: split off the FIRST underscore-delimited segment as the
 * scheme (schemes are alpha-numeric-plus-dot-hyphen, never underscore —
 * RFC 3986), then check whether the tail's LAST underscore-delimited segment
 * is all-digits (a port) — if so it's peeled off, otherwise the whole tail is
 * the host. This ambiguity (a host could itself end in a numeric label) is
 * accepted as a known, named limitation — never a crash either way.
 * @param {string} dirname
 * @returns {string|null}
 */
function originFromIndexedDbDirname(dirname) {
  const SUFFIX = '.indexeddb.leveldb';
  if (typeof dirname !== 'string' || !dirname.endsWith(SUFFIX)) return null;
  const base = dirname.slice(0, -SUFFIX.length);

  const firstUnderscore = base.indexOf('_');
  if (firstUnderscore <= 0) return null;
  const scheme = base.slice(0, firstUnderscore);
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;

  const rest = base.slice(firstUnderscore + 1);
  if (rest.length === 0) return null;

  let host = rest;
  let port = null;
  const lastUnderscore = rest.lastIndexOf('_');
  if (lastUnderscore >= 0) {
    const maybePort = rest.slice(lastUnderscore + 1);
    if (/^\d+$/.test(maybePort) && maybePort.length > 0) {
      // M10 Flight 2, Leg 2 smoke check (live-measured, 2026-07-17): a
      // DEFAULT-port origin's dirname carries the literal port segment "0"
      // (e.g. `https_example.com_0.indexeddb.leveldb` for a real
      // https://example.com/ IndexedDB write on the dev rig) — Spike B only
      // measured an explicit non-default port, so this is new information.
      // "0" is Chromium's default-port sentinel here, not a real port
      // number; treating it as portless is what makes this origin string
      // match `origin()`'s OWN default-port-omission (`new URL().origin`
      // never includes :443/:80), so the two union sides key identically
      // (the leg's "same helper keys both union sides" requirement) instead
      // of silently splitting one origin into two rows.
      port = maybePort === '0' ? null : maybePort;
      host = rest.slice(0, lastUnderscore);
    }
  }
  if (host.length === 0) return null;

  return port ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
}

/**
 * Merge the two site-data union sides into a sorted, deduped tier list
 * (DD3 VERDICT): every origin in `storedOrigins` (IndexedDB-confirmed) is
 * tagged `stored`; every origin in `visitedOrigins` (history-derived) not
 * already `stored` is tagged `visited`. `stored` wins on overlap. Sorted by
 * origin string, ascending, for a stable render order.
 * @param {readonly string[]} storedOrigins
 * @param {readonly string[]} visitedOrigins
 * @returns {Array<{ origin: string, tier: ('stored'|'visited') }>}
 */
function mergeOriginTiers(storedOrigins, visitedOrigins) {
  /** @type {Map<string, ('stored'|'visited')>} */
  const byOrigin = new Map();
  for (const o of visitedOrigins || []) {
    if (typeof o === 'string' && o.length > 0) byOrigin.set(o, 'visited');
  }
  for (const o of storedOrigins || []) {
    if (typeof o === 'string' && o.length > 0) byOrigin.set(o, 'stored');
  }
  return Array.from(byOrigin, ([o, tier]) => ({ origin: o, tier })).sort((a, b) =>
    a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0
  );
}

/**
 * Recover a jar's session partition string from `ses.storagePath` (M10
 * Flight 2, Leg 3 / leg-3 design review, SEQUENCING context note): the
 * `session-created` hook receives only the `Session` object — no partition
 * field — but Electron lays out a persist-partition session's on-disk root
 * at `<userData>/Partitions/<partition-without-persist-prefix>` (the same
 * on-disk convention `jars.js`'s legacy-seed probe, `userData/Partitions/
 * goldfinch`, and this flight's own IndexedDB directory scrape
 * (`jar-ipc.js`'s `ses.storagePath` read) both already rely on). The path
 * SEGMENT immediately after the LAST `Partitions` segment is the bare
 * partition name; re-prefixing it with `persist:` reconstructs the exact
 * string `jars.list()` entries carry, so the caller (main.js's
 * `session-created` hook) can positive-match it against the live registry —
 * never an eager `fromPartition` warm, never a guess. A non-persist
 * (in-memory, e.g. burner) session has no on-disk storage root at all
 * (`storagePath` is null/undefined), so it naturally falls through to
 * `null` here rather than needing a separate exclusion.
 * Pure string parsing — no `path` module (this file stays Node-built-in-
 * free) — splits on either `/` or `\` so it degrades safely regardless of
 * platform.
 * @param {string|null|undefined} storagePath
 * @returns {string|null}
 */
function partitionFromStoragePath(storagePath) {
  if (typeof storagePath !== 'string' || storagePath.length === 0) return null;
  const segments = storagePath.split(/[\\/]/).filter((s) => s.length > 0);
  const idx = segments.lastIndexOf('Partitions');
  if (idx === -1 || idx === segments.length - 1) return null;
  const name = segments[idx + 1];
  if (!name) return null;
  return `persist:${name}`;
}

/**
 * Decide what a `cookies.on('changed')` event should do to the
 * `cookie_seen` bookkeeping row (M10 Flight 2, Leg 3 / DD4 VERDICT cause
 * ruling — Spike A, MEASURED against the live rig). Extracted as a pure
 * function (main.js's listener is otherwise untestable — no Electron stub
 * in this suite) so the cause-branch logic itself is unit-pinned against
 * the FULL measured `cause` enum
 * (electron.d.ts: `inserted` | `inserted-no-change-overwrite` |
 * `inserted-no-value-change-overwrite` | `explicit` | `overwrite` |
 * `expired` | `evicted` | `expired-overwrite`), not just exercised
 * incidentally through main.js.
 * - `removed === false` (any insertion cause) → `'insert'` — `INSERT OR
 *   IGNORE`, never clobbers a surviving row's `first_seen_ms`.
 * - `removed === true` with `cause === 'overwrite'` → `'skip'` — the
 *   MEASURED same-identity value-refresh pairing (`overwrite`/
 *   `removed:true` immediately followed by `inserted`/`removed:false` for
 *   the SAME identity): the row must survive with its ORIGINAL
 *   `first_seen_ms`, or every value-refreshed cookie's aging clock would
 *   reset on each revisit.
 * - `removed === true` with any OTHER cause (`explicit` / `expired` /
 *   `expired-overwrite` / `evicted`) → `'delete'` — a real removal; the
 *   bookkeeping row must not outlive the cookie it describes (DD7).
 * @param {string} cause
 * @param {boolean} removed
 * @returns {'insert'|'delete'|'skip'}
 */
function cookieChangeAction(cause, removed) {
  if (!removed) return 'insert';
  if (cause === 'overwrite') return 'skip';
  return 'delete';
}

module.exports = {
  cookieUrl,
  origin,
  originFromIndexedDbDirname,
  mergeOriginTiers,
  partitionFromStoragePath,
  cookieChangeAction
};
