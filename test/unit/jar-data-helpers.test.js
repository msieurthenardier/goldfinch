'use strict';

// Unit tests for src/main/jar-data-helpers.js — pure, Electron-free helpers
// backing the Cookies + Other-site-data panels (M10 Flight 2, Leg 2 / flight
// DD2, DD3 VERDICT).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  cookieUrl,
  origin,
  originFromIndexedDbDirname,
  mergeOriginTiers,
  partitionFromStoragePath,
  cookieChangeAction
} = require('../../src/main/jar-data-helpers');

// ---------------------------------------------------------------------------
// cookieUrl (DD2 dot-strip reconstruction — spike-verified shapes)
// ---------------------------------------------------------------------------

test('cookieUrl: host-only cookie (no leading dot) — scheme from secure, path defaults to /', () => {
  assert.equal(cookieUrl({ domain: 'host-only.test', secure: true }), 'https://host-only.test/');
  assert.equal(cookieUrl({ domain: 'host-only.test', secure: false }), 'http://host-only.test/');
});

test('cookieUrl: domain-attribute cookie — leading dot unconditionally stripped', () => {
  assert.equal(cookieUrl({ domain: '.domain-cookie.test', secure: true }), 'https://domain-cookie.test/');
});

test('cookieUrl: an explicit path is preserved verbatim', () => {
  assert.equal(cookieUrl({ domain: 'x.test', path: '/a/b', secure: false }), 'http://x.test/a/b');
});

test('cookieUrl: missing/empty domain or path degrades gracefully, never throws', () => {
  assert.doesNotThrow(() => cookieUrl({}));
  assert.equal(cookieUrl({}), 'http:///');
  assert.equal(cookieUrl({ domain: 'x.test', path: '', secure: true }), 'https://x.test/');
});

// ---------------------------------------------------------------------------
// origin (the SOLE union-side normalizer — DD3 VERDICT, deliberately NOT
// trackers.js's hostnameOf/registrableDomain)
// ---------------------------------------------------------------------------

test('origin: keeps scheme AND port (distinct from trackers.js registrableDomain)', () => {
  assert.equal(origin('https://example.com:8443/a/b?q=1'), 'https://example.com:8443');
  assert.equal(origin('http://example.com/'), 'http://example.com');
  assert.equal(origin('https://example.com/'), 'https://example.com'); // distinct scheme -> distinct origin
});

test('origin: subdomains stay distinct origins (no eTLD+1 collapse)', () => {
  assert.notEqual(origin('https://a.example.com/'), origin('https://b.example.com/'));
});

test('origin: malformed URL returns null, never throws', () => {
  assert.equal(origin('not a url'), null);
  assert.equal(origin(''), null);
});

// ---------------------------------------------------------------------------
// originFromIndexedDbDirname (Spike B measured format, DD3's "defensive,
// degrade to unknown" bar)
// ---------------------------------------------------------------------------

test('originFromIndexedDbDirname: spike-measured format with an explicit port', () => {
  assert.equal(
    originFromIndexedDbDirname('http_127.0.0.1_54321.indexeddb.leveldb'),
    'http://127.0.0.1:54321'
  );
  assert.equal(originFromIndexedDbDirname('https_example.com_443.indexeddb.leveldb'), 'https://example.com:443');
});

test('originFromIndexedDbDirname: no port segment yields a portless origin', () => {
  assert.equal(originFromIndexedDbDirname('https_example.com.indexeddb.leveldb'), 'https://example.com');
});

test('originFromIndexedDbDirname: a "0" port segment (Chromium\'s default-port sentinel, smoke-check-measured) normalizes to portless — matches origin()\'s own default-port omission', () => {
  // Live-measured on the dev rig (M10 Flight 2, Leg 2 smoke check): a real
  // https://example.com/ IndexedDB write produced the on-disk dirname
  // "https_example.com_0.indexeddb.leveldb" — NOT ..._443... and NOT
  // portless. Without this normalization, originFromIndexedDbDirname would
  // return "https://example.com:0", which would never merge with
  // origin('https://example.com/') === 'https://example.com' under
  // mergeOriginTiers — silently splitting one default-port origin into two
  // rows (a "stored" one at :0 and a "visited" one without).
  assert.equal(originFromIndexedDbDirname('https_example.com_0.indexeddb.leveldb'), 'https://example.com');
  assert.equal(
    originFromIndexedDbDirname('https_example.com_0.indexeddb.leveldb'),
    origin('https://example.com/'),
    'the default-port dirname origin must key identically to origin() for the merge to work'
  );
});

test('originFromIndexedDbDirname: unrelated / malformed names degrade to null, never throw', () => {
  for (const bad of [
    'Local Storage', // a completely different leveldb dir
    'http_.indexeddb.leveldb', // empty host
    'notasuffix',
    '',
    '.indexeddb.leveldb', // no scheme/host at all
    '_missing-scheme_80.indexeddb.leveldb'
  ]) {
    assert.doesNotThrow(() => originFromIndexedDbDirname(bad));
    assert.equal(originFromIndexedDbDirname(bad), null, `expected null for "${bad}"`);
  }
  // @ts-expect-error deliberate non-string input — defensive by construction
  assert.doesNotThrow(() => originFromIndexedDbDirname(undefined));
  // @ts-expect-error deliberate non-string input
  assert.equal(originFromIndexedDbDirname(undefined), null);
});

// ---------------------------------------------------------------------------
// mergeOriginTiers (DD3 VERDICT two-tier union)
// ---------------------------------------------------------------------------

test('mergeOriginTiers: stored wins on overlap', () => {
  const merged = mergeOriginTiers(['https://a.example'], ['https://a.example', 'https://b.example']);
  assert.deepEqual(merged, [
    { origin: 'https://a.example', tier: 'stored' },
    { origin: 'https://b.example', tier: 'visited' }
  ]);
});

test('mergeOriginTiers: sorted by origin string ascending', () => {
  const merged = mergeOriginTiers(['https://z.example'], ['https://a.example']);
  assert.deepEqual(merged.map((r) => r.origin), ['https://a.example', 'https://z.example']);
});

test('mergeOriginTiers: both sides empty yields an empty array', () => {
  assert.deepEqual(mergeOriginTiers([], []), []);
});

test('mergeOriginTiers: never throws on undefined/null inputs', () => {
  assert.doesNotThrow(() => mergeOriginTiers(/** @type {any} */ (undefined), /** @type {any} */ (undefined)));
  assert.deepEqual(mergeOriginTiers(/** @type {any} */ (undefined), /** @type {any} */ (undefined)), []);
});

// ---------------------------------------------------------------------------
// partitionFromStoragePath (M10 Flight 2, Leg 3 / leg-3 design review — the
// session-created cookies-listener's partition-recovery mechanism: the hook
// receives only the Session object, no partition field)
// ---------------------------------------------------------------------------

test('partitionFromStoragePath: POSIX layout recovers the persist:-prefixed partition string', () => {
  assert.equal(
    partitionFromStoragePath('/home/user/.config/goldfinch/Partitions/container:work'),
    'persist:container:work'
  );
});

test('partitionFromStoragePath: Windows layout (backslash separators)', () => {
  assert.equal(
    partitionFromStoragePath('C:\\Users\\x\\AppData\\Roaming\\goldfinch\\Partitions\\container:work'),
    'persist:container:work'
  );
});

test('partitionFromStoragePath: the legacy default jar partition round-trips too', () => {
  assert.equal(partitionFromStoragePath('/home/user/.config/goldfinch/Partitions/goldfinch'), 'persist:goldfinch');
});

test('partitionFromStoragePath: no Partitions segment at all (e.g. the default session root) returns null', () => {
  assert.equal(partitionFromStoragePath('/home/user/.config/goldfinch'), null);
});

test('partitionFromStoragePath: Partitions as the FINAL segment (no name after it) returns null, never throws', () => {
  assert.equal(partitionFromStoragePath('/home/user/.config/goldfinch/Partitions'), null);
  assert.equal(partitionFromStoragePath('/home/user/.config/goldfinch/Partitions/'), null);
});

test('partitionFromStoragePath: null/undefined/empty/non-string degrade to null, never throw (in-memory sessions have no storagePath)', () => {
  assert.doesNotThrow(() => partitionFromStoragePath(null));
  assert.equal(partitionFromStoragePath(null), null);
  assert.equal(partitionFromStoragePath(undefined), null);
  assert.equal(partitionFromStoragePath(''), null);
  // @ts-expect-error deliberate non-string input — defensive by construction
  assert.equal(partitionFromStoragePath(42), null);
});

// ---------------------------------------------------------------------------
// cookieChangeAction (M10 Flight 2, Leg 3 / DD4 VERDICT cause ruling,
// MEASURED) — pinned against the FULL cause enum
// (node_modules/electron/electron.d.ts:7261).
// ---------------------------------------------------------------------------

test('cookieChangeAction: every insertion cause (removed===false) is "insert", regardless of the specific cause string', () => {
  for (const cause of ['inserted', 'inserted-no-change-overwrite', 'inserted-no-value-change-overwrite']) {
    assert.equal(cookieChangeAction(cause, false), 'insert', cause);
  }
});

test('cookieChangeAction: cause "overwrite" with removed===true is "skip" (the measured same-identity value-refresh pairing — the row must survive with its ORIGINAL first_seen_ms)', () => {
  assert.equal(cookieChangeAction('overwrite', true), 'skip');
});

test('cookieChangeAction: every OTHER removal cause is "delete" (explicit / expired / expired-overwrite / evicted)', () => {
  for (const cause of ['explicit', 'expired', 'expired-overwrite', 'evicted']) {
    assert.equal(cookieChangeAction(cause, true), 'delete', cause);
  }
});

test('cookieChangeAction: removed===false always wins to "insert" even for an unexpected/unknown cause string (defensive)', () => {
  assert.equal(cookieChangeAction('some-future-cause', false), 'insert');
});
