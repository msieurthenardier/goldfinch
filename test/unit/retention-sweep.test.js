'use strict';

// Unit tests for src/main/retention-sweep.js (M10 Flight 2, Leg 3 / DD4
// VERDICT, DD4b, DD6, DD7, DD10).
//
// retention-sweep.js is Electron-free — every dep is injected — so this
// harness fakes the cookie_seen bookkeeping store (a tiny in-memory map,
// real enough that INSERT-OR-IGNORE semantics and the expiry query fall out
// of actual behavior rather than hardcoded stubs), a fake session (cookies
// get/remove + clearStorageData, recording calls in order), a fake
// historyOrigins reader, and a controllable clock.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createRetentionSweep } = require('../../src/main/retention-sweep');
const { cookieUrl } = require('../../src/main/jar-data-helpers');

const DAY_MS = 86_400_000;

/**
 * A real-enough fake of app-db.js's createCookieSeenStore() — same
 * INSERT-OR-IGNORE / delete-by-identity / delete-by-jar / select-expired
 * contract, backed by an in-memory Map keyed on the identity tuple.
 * Records every call (in order) so ordering pins (stamp-before-expiry) can
 * assert against real call history, not a mocked sequence.
 */
function makeFakeCookieSeen() {
  /** @type {Map<string, { jarId: string, name: string, domain: string, path: string, firstSeenMs: number }>} */
  const rows = new Map();
  /** @type {string[]} */
  const calls = [];

  function key(jarId, name, domain, path) {
    return `${jarId} ${name} ${domain} ${path}`;
  }

  return {
    calls,
    rows,
    insertIfAbsent(jarId, name, domain, path, firstSeenMs) {
      calls.push('insertIfAbsent');
      const k = key(jarId, name, domain, path);
      if (rows.has(k)) return false;
      rows.set(k, { jarId, name, domain, path, firstSeenMs });
      return true;
    },
    deleteByIdentity(jarId, name, domain, path) {
      calls.push('deleteByIdentity');
      return rows.delete(key(jarId, name, domain, path));
    },
    deleteByJar(jarId) {
      calls.push('deleteByJar');
      let n = 0;
      for (const [k, row] of rows) {
        if (row.jarId === jarId) {
          rows.delete(k);
          n++;
        }
      }
      return n;
    },
    selectExpired(jarId, cutoffMs) {
      calls.push('selectExpired');
      return Array.from(rows.values())
        .filter((r) => r.jarId === jarId && r.firstSeenMs < cutoffMs)
        .map((r) => ({ name: r.name, domain: r.domain, path: r.path, firstSeenMs: r.firstSeenMs }));
    }
  };
}

/**
 * A fake Session: cookies.get/remove + clearStorageData, each optionally
 * throwing on demand (per-jar keyed, so a multi-jar sweepAll test can make
 * ONE jar's session misbehave without affecting siblings). Records calls.
 */
function makeFakeSessionFactory({ cookiesByPartition = {}, throwsByPartition = {} } = {}) {
  /** @type {Array<{ fn: string, partition: string, args?: any }>} */
  const events = [];
  function sessionFor(jar) {
    const partition = jar.partition;
    const throwSpec = throwsByPartition[partition] || {};
    return {
      cookies: {
        async get() {
          events.push({ fn: 'cookies.get', partition });
          if (throwSpec.cookiesGet) throw new Error('cookies.get failed');
          return cookiesByPartition[partition] || [];
        },
        async remove(url, name) {
          events.push({ fn: 'cookies.remove', partition, args: { url, name } });
          if (throwSpec.cookiesRemove) throw new Error('cookies.remove failed');
        }
      },
      async clearStorageData(options) {
        events.push({ fn: 'clearStorageData', partition, args: options });
        if (throwSpec.clearStorageData) throw new Error('clearStorageData failed');
      }
    };
  }
  return { sessionFor, events };
}

function makeHistoryOrigins(byJarCutoff) {
  return (jarId, cutoffMs) => (byJarCutoff[jarId] && byJarCutoff[jarId][cutoffMs]) || [];
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

test('createRetentionSweep returns exactly snapshotAgedOutOrigins/sweepJar/sweepAll', () => {
  const engine = createRetentionSweep({
    cookieSeen: makeFakeCookieSeen(),
    historyOrigins: () => [],
    sessionFor: () => ({ cookies: { get: async () => [], remove: async () => {} }, clearStorageData: async () => {} }),
    cookieUrl,
    now: () => 0
  });
  assert.deepEqual(Object.keys(engine).sort(), ['snapshotAgedOutOrigins', 'sweepAll', 'sweepJar']);
});

// ---------------------------------------------------------------------------
// snapshotAgedOutOrigins — the SEQUENCING step (called by the caller BEFORE
// the history prune)
// ---------------------------------------------------------------------------

test('snapshotAgedOutOrigins: computes a per-jar cutoff from retentionDays and reads historyOrigins ONLY (no session calls)', () => {
  const cookieSeen = makeFakeCookieSeen();
  const { sessionFor, events } = makeFakeSessionFactory();
  const nowMs = 100 * DAY_MS;
  const engine = createRetentionSweep({
    cookieSeen,
    historyOrigins: makeHistoryOrigins({
      jarA: { [String(nowMs - 30 * DAY_MS)]: ['https://a.example'] },
      jarB: { [String(nowMs - 7 * DAY_MS)]: ['https://b.example'] }
    }),
    sessionFor,
    cookieUrl,
    now: () => nowMs
  });

  const jars = [
    { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 },
    { id: 'jarB', partition: 'persist:container:b', retentionDays: 7 }
  ];
  const snapshot = engine.snapshotAgedOutOrigins(jars);
  assert.deepEqual(snapshot, { jarA: ['https://a.example'], jarB: ['https://b.example'] });
  assert.equal(events.length, 0, 'snapshotting must never touch the session');
  assert.equal(cookieSeen.calls.length, 0, 'snapshotting must never touch cookie bookkeeping');
});

// ---------------------------------------------------------------------------
// Cookie sweep — stamp-then-expire ORDER (leg AC, unit-pinned)
// ---------------------------------------------------------------------------

test('sweepJar cookies: stamp pass runs BEFORE the expiry-pass query (order pinned via call history)', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:a': [{ name: 'sid', domain: 'x.test', path: '/', secure: true }] }
  });
  const engine = createRetentionSweep({
    cookieSeen,
    historyOrigins: () => [],
    sessionFor,
    cookieUrl,
    now: () => 1000
  });

  await engine.sweepJar(jar, []);
  const firstInsert = cookieSeen.calls.indexOf('insertIfAbsent');
  const firstSelect = cookieSeen.calls.indexOf('selectExpired');
  assert.ok(firstInsert !== -1 && firstSelect !== -1, 'both calls happened');
  assert.ok(firstInsert < firstSelect, 'insertIfAbsent (stamp) must run before selectExpired (expiry query)');
});

test('sweepJar cookies: a live cookie with no bookkeeping row is stamped `now` (cold start) — never expired in the same pass', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 1 }; // 1-day floor
  const { sessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:a': [{ name: 'sid', domain: 'x.test', path: '/', secure: true }] }
  });
  const nowMs = 10_000_000;
  const engine = createRetentionSweep({
    cookieSeen,
    historyOrigins: () => [],
    sessionFor,
    cookieUrl,
    now: () => nowMs
  });

  const result = await engine.sweepJar(jar, []);
  assert.equal(result.cookiesRemoved, 0, 'a just-stamped cookie must never be removed in the same pass');
  assert.equal(cookieSeen.rows.size, 1);
  const [row] = cookieSeen.rows.values();
  assert.equal(row.firstSeenMs, nowMs);
});

test('sweepJar cookies: removes cookies whose bookkeeping age exceeds the window, deletes the row, reconstructs the URL (secure recovered from the live cookie)', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const nowMs = 100 * DAY_MS;
  cookieSeen.insertIfAbsent('jarA', 'sid', 'x.test', '/', nowMs - 40 * DAY_MS); // aged out (30-day window)
  cookieSeen.insertIfAbsent('jarA', 'fresh', 'x.test', '/', nowMs - 5 * DAY_MS); // within window
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor, events } = makeFakeSessionFactory({
    cookiesByPartition: {
      'persist:container:a': [
        { name: 'sid', domain: 'x.test', path: '/', secure: true },
        { name: 'fresh', domain: 'x.test', path: '/', secure: false }
      ]
    }
  });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => nowMs });

  const result = await engine.sweepJar(jar, []);
  assert.equal(result.cookiesRemoved, 1);
  assert.deepEqual(result.classes, ['cookies']);
  assert.equal(cookieSeen.rows.size, 1, 'only the expired row was deleted');
  const removeCall = events.find((e) => e.fn === 'cookies.remove');
  assert.ok(removeCall, 'cookies.remove was called');
  assert.equal(removeCall.args.name, 'sid');
  assert.equal(removeCall.args.url, cookieUrl({ domain: 'x.test', path: '/', secure: true }), 'secure recovered from the live cookie, not defaulted');
});

test('sweepJar cookies: a removal failure leaves the bookkeeping row in place (retry-next-sweep), never aborts the pass', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const nowMs = 100 * DAY_MS;
  cookieSeen.insertIfAbsent('jarA', 'sid', 'x.test', '/', nowMs - 40 * DAY_MS);
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:a': [{ name: 'sid', domain: 'x.test', path: '/', secure: true }] },
    throwsByPartition: { 'persist:container:a': { cookiesRemove: true } }
  });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => nowMs });

  const result = await engine.sweepJar(jar, []);
  assert.equal(result.cookiesRemoved, 0);
  assert.equal(cookieSeen.rows.size, 1, 'the row survives a failed removal for the next sweep to retry');
});

test('sweepJar cookies: a bookkeeping row with no matching live cookie removes with secure defaulted false (never throws)', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const nowMs = 100 * DAY_MS;
  cookieSeen.insertIfAbsent('jarA', 'gone', 'x.test', '/', nowMs - 40 * DAY_MS);
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor, events } = makeFakeSessionFactory({ cookiesByPartition: { 'persist:container:a': [] } });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => nowMs });

  const result = await engine.sweepJar(jar, []);
  assert.equal(result.cookiesRemoved, 1);
  const removeCall = events.find((e) => e.fn === 'cookies.remove');
  assert.equal(removeCall.args.url, cookieUrl({ domain: 'x.test', path: '/', secure: false }));
});

// ---------------------------------------------------------------------------
// Storage sweep — acts ONLY on the caller-supplied snapshot (SEQUENCING)
// ---------------------------------------------------------------------------

test('sweepJar storage: clears exactly the origins in the supplied snapshot, storages set excludes cookies', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor, events } = makeFakeSessionFactory({ cookiesByPartition: { 'persist:container:a': [] } });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const result = await engine.sweepJar(jar, ['https://old.example', 'https://ancient.example']);
  assert.equal(result.originsCleared, 2);
  assert.deepEqual(result.classes, ['storage']);
  const clears = events.filter((e) => e.fn === 'clearStorageData');
  assert.equal(clears.length, 2);
  assert.deepEqual(
    clears.map((c) => c.args.origin).sort(),
    ['https://ancient.example', 'https://old.example']
  );
  for (const c of clears) {
    assert.ok(!c.args.storages.includes('cookies'), 'the storage class must exclude cookies');
  }
});

test('sweepJar storage: no-signal origins (absent from the snapshot) are never touched — an empty snapshot clears nothing', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor, events } = makeFakeSessionFactory({ cookiesByPartition: { 'persist:container:a': [] } });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const result = await engine.sweepJar(jar, []);
  assert.equal(result.originsCleared, 0);
  assert.deepEqual(result.classes, []);
  assert.equal(events.filter((e) => e.fn === 'clearStorageData').length, 0);
});

test('sweepJar storage: one bad origin does not block its siblings (per-origin isolation)', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:a': [] },
    throwsByPartition: {} // clearStorageData throws are per-call below via a custom sessionFor
  });
  // Override clearStorageData to fail for exactly one origin.
  const customSessionFor = (j) => {
    const base = sessionFor(j);
    return {
      ...base,
      async clearStorageData(options) {
        if (options.origin === 'https://bad.example') throw new Error('nope');
        return base.clearStorageData(options);
      }
    };
  };
  const engine = createRetentionSweep({
    cookieSeen,
    historyOrigins: () => [],
    sessionFor: customSessionFor,
    cookieUrl,
    now: () => 1000
  });

  const result = await engine.sweepJar(jar, ['https://bad.example', 'https://good.example']);
  assert.equal(result.originsCleared, 1, 'the good origin still clears despite the bad one throwing');
});

// ---------------------------------------------------------------------------
// sweepJar: per-half isolation (a cookie failure never blocks storage, and
// vice versa)
// ---------------------------------------------------------------------------

test('sweepJar: a cookies.get throw isolates to the cookies half — storage sweep still runs', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor, events } = makeFakeSessionFactory({
    throwsByPartition: { 'persist:container:a': { cookiesGet: true } }
  });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const result = await engine.sweepJar(jar, ['https://old.example']);
  assert.equal(result.cookiesRemoved, 0);
  assert.ok(result.error && result.error.includes('cookies'));
  assert.equal(result.originsCleared, 1, 'storage half still completed');
  assert.deepEqual(result.classes, ['storage']);
  assert.ok(events.some((e) => e.fn === 'clearStorageData'));
});

test('sweepJar: classes reports only classes with a nonzero effect', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jar = { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 };
  const { sessionFor } = makeFakeSessionFactory({ cookiesByPartition: { 'persist:container:a': [] } });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const result = await engine.sweepJar(jar, []);
  assert.deepEqual(result.classes, []);
});

// ---------------------------------------------------------------------------
// sweepAll — per-jar isolation (DD6)
// ---------------------------------------------------------------------------

test('sweepAll: one jar throwing (sessionFor itself throws) never blocks a sibling jar\'s sweep', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jars = [
    { id: 'jarBad', partition: 'persist:container:bad', retentionDays: 30 },
    { id: 'jarGood', partition: 'persist:container:good', retentionDays: 30 }
  ];
  const { sessionFor: goodSessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:good': [] }
  });
  const sessionFor = (jar) => {
    if (jar.id === 'jarBad') throw new Error('session unavailable');
    return goodSessionFor(jar);
  };
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const results = await engine.sweepAll(jars, { jarGood: ['https://old.example'] });
  assert.ok(results.jarBad.error);
  assert.equal(results.jarGood.originsCleared, 1, 'jarGood is unaffected by jarBad throwing');
});

test('sweepAll: missing snapshot entries default to an empty origin set, never throw', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jars = [{ id: 'jarA', partition: 'persist:container:a', retentionDays: 30 }];
  const { sessionFor } = makeFakeSessionFactory({ cookiesByPartition: { 'persist:container:a': [] } });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const results = await engine.sweepAll(jars, {});
  assert.equal(results.jarA.originsCleared, 0);
});

test('sweepAll: aggregates a per-jar result keyed by jarId, covering every jar passed in', async () => {
  const cookieSeen = makeFakeCookieSeen();
  const jars = [
    { id: 'jarA', partition: 'persist:container:a', retentionDays: 30 },
    { id: 'jarB', partition: 'persist:container:b', retentionDays: 30 }
  ];
  const { sessionFor } = makeFakeSessionFactory({
    cookiesByPartition: { 'persist:container:a': [], 'persist:container:b': [] }
  });
  const engine = createRetentionSweep({ cookieSeen, historyOrigins: () => [], sessionFor, cookieUrl, now: () => 1000 });

  const results = await engine.sweepAll(jars, { jarA: ['https://a.example'], jarB: [] });
  assert.deepEqual(Object.keys(results).sort(), ['jarA', 'jarB']);
  assert.equal(results.jarA.originsCleared, 1);
  assert.equal(results.jarB.originsCleared, 0);
});

// ---------------------------------------------------------------------------
// DD7: no cookie VALUE anywhere in the module's source
// ---------------------------------------------------------------------------

test('retention-sweep.js never references a cookie "value" field (DD7 metadata-only boundary)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/retention-sweep.js'), 'utf8');
  assert.ok(!/\.value\b/.test(src), 'no `.value` property access should appear anywhere in the sweep engine');
});

test('is Electron-free', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/retention-sweep.js'), 'utf8');
  const codeLines = src.split('\n').filter((line) => !line.trim().startsWith('//'));
  assert.equal((codeLines.join('\n').match(/require\('electron'\)/g) || []).length, 0);
});
