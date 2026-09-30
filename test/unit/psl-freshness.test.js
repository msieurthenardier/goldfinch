'use strict';
// Squawk 0117: release-time PSL freshness verdict (pure helper) + refresh-body validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pslFreshness, validatePslBody, PSL_RELEASE_MAX_AGE_DAYS } = require('../../scripts/lib/psl-freshness.mjs');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T00:00:00Z');

test('limit is 90 days', () => assert.equal(PSL_RELEASE_MAX_AGE_DAYS, 90));

test('just inside 90 days is fresh; exactly 90 is fresh; just past is stale', () => {
  assert.deepEqual(pslFreshness(NOW - 89 * DAY, NOW), { stale: false, ageDays: 89 });
  assert.equal(pslFreshness(NOW - 90 * DAY, NOW).stale, false);
  assert.deepEqual(pslFreshness(NOW - 90 * DAY - 1, NOW), { stale: true, ageDays: 90 });
  assert.equal(pslFreshness(NOW - 91 * DAY, NOW).stale, true);
});

test('missing / NaN snapshot or clock fails closed', () => {
  for (const bad of [null, undefined, NaN, Infinity, '2026-07-20']) {
    assert.deepEqual(pslFreshness(bad, NOW), { stale: true, ageDays: null });
  }
  assert.equal(pslFreshness(NOW, NaN).stale, true);
});

test('validatePslBody requires VERSION header and both section markers', () => {
  const ok = '// VERSION: 2026-09-01_00-00-00_UTC\n// ===BEGIN ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\n';
  assert.equal(validatePslBody(ok), '2026-09-01_00-00-00_UTC');
  assert.equal(validatePslBody(ok.replace('VERSION', 'VERSIO')), null);
  assert.equal(validatePslBody(ok.replace('ICANN', 'ICAN')), null);
  assert.equal(validatePslBody(ok.replace('PRIVATE', 'PRIV')), null);
  assert.equal(validatePslBody('<html>404</html>'), null);
  assert.equal(validatePslBody(undefined), null);
});
