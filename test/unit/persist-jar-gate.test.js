'use strict';

// Unit tests for src/main/persist-jar-gate.js (M09 Flight 9, Leg 2, AC0) — the
// single-sourced persist-jar allowlist gate shared by closed-tab-capture.js and
// session-snapshot.js. Pins the security-critical burner boundary BOTH directions:
// a registered-partition non-trusted tab resolves to its jar; a burner partition, a
// trusted tab, and an empty jars list all resolve to null. No require('electron') —
// the module reads only the injected tab entry + jars snapshot.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolvePersistJar } = require('../../src/main/persist-jar-gate');

const JARS = [
  { id: 'work', partition: 'persist:jar-work' },
  { id: 'play', partition: 'persist:jar-play' },
];

test('resolves a registered-partition non-trusted tab to its jar (the positive direction)', () => {
  const jar = resolvePersistJar({ partition: 'persist:jar-play', trusted: false }, JARS);
  assert.ok(jar);
  assert.equal(jar.id, 'play');
  assert.equal(jar.partition, 'persist:jar-play');
});

test('resolves a burner:<n> partition to null (matches no registered jar — no negative check)', () => {
  assert.equal(resolvePersistJar({ partition: 'burner:1', trusted: false }, JARS), null);
});

test('resolves a trusted tab to null even when its partition IS registered (belt-and-suspenders !trusted)', () => {
  assert.equal(resolvePersistJar({ partition: 'persist:jar-work', trusted: true }, JARS), null);
});

test('resolves to null against an empty jars list (nothing registered ⇒ nothing persisted)', () => {
  assert.equal(resolvePersistJar({ partition: 'persist:jar-work', trusted: false }, []), null);
});
