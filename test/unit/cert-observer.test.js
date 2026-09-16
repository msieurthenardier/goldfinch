'use strict';

// Mission 20 Flight 2 Leg 2 (DD6): cert-observer.js — the session-level
// verification observer. LRU behavior + the AC5/AC7 source-scan pins.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan');
const { createCertObserver } = require('../../src/main/cert-observer');

const MODULE_PATH = path.join(__dirname, '../../src/main/cert-observer.js');

function makeCallback() {
  const calls = [];
  return { calls, fn: (v) => calls.push(v) };
}

test('the proc always answers callback(-3), recording the verification first', () => {
  const observer = createCertObserver({ summarize: () => ({ ok: true }), logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  const cb = makeCallback();
  proc(
    { hostname: 'ok.test', verificationResult: 'net::OK', errorCode: 0, isIssuedByKnownRoot: true, certificate: {} },
    cb.fn
  );
  assert.deepEqual(cb.calls, [-3]);
  assert.deepEqual(observer.lookup('persist:jar-a', 'ok.test'), {
    verificationResult: 'net::OK',
    errorCode: 0,
    isIssuedByKnownRoot: true,
    summary: { ok: true }
  });
});

test('a throwing summarize is caught and logged; callback(-3) still fires and the record is skipped', () => {
  const errors = [];
  const observer = createCertObserver({
    summarize: () => {
      throw new Error('boom');
    },
    logger: { error: (...args) => errors.push(args) }
  });
  const proc = observer.procFor('persist:jar-a');
  const cb = makeCallback();
  assert.doesNotThrow(() => proc({ hostname: 'ok.test', verificationResult: 'net::OK' }, cb.fn));
  assert.deepEqual(cb.calls, [-3]);
  assert.equal(observer.lookup('persist:jar-a', 'ok.test').summary, null);
  assert.ok(errors.length > 0);
});

test('a request with no summarize dependency still records and answers -3', () => {
  const observer = createCertObserver({ logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  const cb = makeCallback();
  proc({ hostname: 'ok.test', verificationResult: 'net::OK' }, cb.fn);
  assert.deepEqual(cb.calls, [-3]);
  assert.equal(observer.lookup('persist:jar-a', 'ok.test').summary, null);
});

test('a malformed/missing hostname never throws and answers -3, recording nothing', () => {
  const observer = createCertObserver({ logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  const cb = makeCallback();
  assert.doesNotThrow(() => proc({}, cb.fn));
  assert.doesNotThrow(() => proc(null, cb.fn));
  assert.deepEqual(cb.calls, [-3, -3]);
});

test('lookup misses (no partition, no hostname) resolve null, never throw', () => {
  const observer = createCertObserver({ logger: { error() {} } });
  assert.equal(observer.lookup('persist:jar-a', 'nope.test'), null);
  assert.equal(observer.lookup('unknown-partition', 'x'), null);
});

test('partitions are isolated from each other', () => {
  const observer = createCertObserver({ logger: { error() {} } });
  observer.procFor('persist:jar-a')({ hostname: 'x.test', verificationResult: 'net::OK' }, () => {});
  assert.equal(observer.lookup('persist:jar-b', 'x.test'), null);
  assert.ok(observer.lookup('persist:jar-a', 'x.test'));
});

test('clearPartition drops the whole partition', () => {
  const observer = createCertObserver({ logger: { error() {} } });
  observer.procFor('persist:jar-a')({ hostname: 'x.test', verificationResult: 'net::OK' }, () => {});
  observer.clearPartition('persist:jar-a');
  assert.equal(observer.lookup('persist:jar-a', 'x.test'), null);
});

// ---------------------------------------------------------------------------
// AC5 — LRU cap, eviction, hit-refresh
// ---------------------------------------------------------------------------

test('LRU: eviction at cap, oldest-first', () => {
  const observer = createCertObserver({ cap: 2, logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  proc({ hostname: 'a.test', verificationResult: 'net::OK' }, () => {});
  proc({ hostname: 'b.test', verificationResult: 'net::OK' }, () => {});
  proc({ hostname: 'c.test', verificationResult: 'net::OK' }, () => {});
  assert.equal(observer.lookup('persist:jar-a', 'a.test'), null, 'a.test was the oldest — evicted');
  assert.ok(observer.lookup('persist:jar-a', 'b.test'));
  assert.ok(observer.lookup('persist:jar-a', 'c.test'));
});

test('LRU: a lookup HIT refreshes recency, so re-recording the OTHER entry evicts the one NOT hit', () => {
  const observer = createCertObserver({ cap: 2, logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  proc({ hostname: 'a.test', verificationResult: 'net::OK' }, () => {});
  proc({ hostname: 'b.test', verificationResult: 'net::OK' }, () => {});
  observer.lookup('persist:jar-a', 'a.test'); // a.test is now most-recently-used
  proc({ hostname: 'c.test', verificationResult: 'net::OK' }, () => {});
  assert.equal(observer.lookup('persist:jar-a', 'b.test'), null, 'b.test was least-recently-used — evicted');
  assert.ok(observer.lookup('persist:jar-a', 'a.test'));
  assert.ok(observer.lookup('persist:jar-a', 'c.test'));
});

test('LRU: re-recording an existing hostname refreshes it too (delete + re-set on write)', () => {
  const observer = createCertObserver({ cap: 2, logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  proc({ hostname: 'a.test', verificationResult: 'net::OK' }, () => {});
  proc({ hostname: 'b.test', verificationResult: 'net::OK' }, () => {});
  proc({ hostname: 'a.test', verificationResult: 'net::ERR_X' }, () => {}); // re-write a.test
  proc({ hostname: 'c.test', verificationResult: 'net::OK' }, () => {});
  assert.equal(observer.lookup('persist:jar-a', 'b.test'), null, 'b.test is now least-recently-used — evicted');
  assert.equal(observer.lookup('persist:jar-a', 'a.test').verificationResult, 'net::ERR_X');
});

test('default cap is 256', () => {
  // NOTE: `lookup` itself is a hit-refresh (by design — see the LRU tests
  // above), so this test avoids any intermediate lookup between the fill and
  // the eviction-triggering insert — a probe there would move h0 to
  // most-recently-used and falsify the very eviction this test checks.
  const observer = createCertObserver({ logger: { error() {} } });
  const proc = observer.procFor('persist:jar-a');
  for (let i = 0; i < 257; i++) {
    proc({ hostname: `h${i}.test`, verificationResult: 'net::OK' }, () => {});
  }
  assert.equal(
    observer.lookup('persist:jar-a', 'h0.test'),
    null,
    'evicted once the 257th entry lands (default cap 256)'
  );
  assert.ok(observer.lookup('persist:jar-a', 'h1.test'), 'h1 (the new oldest) survives');
  assert.ok(observer.lookup('persist:jar-a', 'h256.test'), 'the newest entry survives');
});

// ---------------------------------------------------------------------------
// AC5 / AC7 — source-scan: the only `callback(` literal is `-3`
// ---------------------------------------------------------------------------

test('source-scan: the only `callback(` literal in cert-observer.js is -3', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const masked = maskComments(source);
  const matches = [...masked.matchAll(/callback\s*\(\s*([^)]*)\)/g)];
  assert.equal(matches.length, 1, 'exactly one callback( call site');
  assert.equal(matches[0][1].trim(), '-3');
});

test('source-scan: cert-observer.js imports no fs/app-db/settings-store', () => {
  const source = maskComments(fs.readFileSync(MODULE_PATH, 'utf8'));
  assert.ok(!/require\(['"]fs['"]\)/.test(source));
  assert.ok(!/app-db/.test(source));
  assert.ok(!/settings-store/.test(source));
});

// Mission 20 Flight 2 Leg 4 (design review, HIGH): the summary's `error` is
// the stripped ENGINE NAME, never the numeric errorCode — the same name
// cert-trust.js's summary speaks, so both sources read alike in the viewer.
test('summarize is called with the stripped engine error name, never the numeric errorCode', () => {
  const seen = [];
  const observer = createCertObserver({
    summarize: (cert, ctx) => {
      seen.push(ctx);
      return { ok: true };
    },
    logger: { error() {} }
  });
  const proc = observer.procFor('persist:jar-a');
  proc(
    { hostname: 'bad.test', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID', errorCode: -202, certificate: {} },
    () => {}
  );
  assert.equal(seen[0].error, 'ERR_CERT_AUTHORITY_INVALID');
});

test('summarize is called with error: undefined on an OK verdict (net::OK and bare OK)', () => {
  const seen = [];
  const observer = createCertObserver({
    summarize: (cert, ctx) => {
      seen.push(ctx);
      return { ok: true };
    },
    logger: { error() {} }
  });
  const proc = observer.procFor('persist:jar-a');
  proc({ hostname: 'a.test', verificationResult: 'net::OK', errorCode: 0, certificate: {} }, () => {});
  proc({ hostname: 'b.test', verificationResult: 'OK', errorCode: 0, certificate: {} }, () => {});
  assert.equal(seen[0].error, undefined);
  assert.equal(seen[1].error, undefined);
});
