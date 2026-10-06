'use strict';

// Sortie 02 leg 01 AC1/AC2: the pure startup decision and the Set-Cookie parser.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FEATURE,
  decideStartup,
  isValidPartitionedSetCookie,
  refusedThirdPartySetCookie
} = require('../../src/main/third-party-cookies');

const ENABLE_CASES = [
  ['', false],
  [FEATURE, true],
  ['OtherFeature,Another', false],
  [`OtherFeature, ${FEATURE} ,Another`, true],
  [`${FEATURE}:p/v`, true],
  [`${FEATURE}<Trial`, true],
  ['FEATUREX', false],
  [`${FEATURE}X`, false]
];
const DISABLE_CASES = [
  ['', false],
  ['Foo,Bar', false],
  [FEATURE, true],
  [` ,${FEATURE}<T,`, true],
  [`${FEATURE}Y`, false]
];

test('decideStartup matrix: configured x enable-features x disable-features', () => {
  for (const configured of [true, false]) {
    for (const [en, enNames] of ENABLE_CASES) {
      for (const [dis, disNames] of DISABLE_CASES) {
        const r = decideStartup({ configured, enableFeatures: en, disableFeatures: dis });
        const label = JSON.stringify({ configured, en, dis });
        assert.equal(r.isolateEffective, (configured || enNames) && !disNames, label);
        assert.equal(r.operatorOverride, disNames ? 'disabled' : enNames ? 'enabled' : null, label);
        const entries = r.enableFeatures === '' ? [] : r.enableFeatures.split(',');
        assert.ok(
          entries.every((e) => e !== '' && e === e.trim()),
          `no empty/untrimmed entries ${label}`
        );
        assert.equal(new Set(entries).size, entries.length, `deduped ${label}`);
        const featureEntries = entries.filter((e) => /^[^:<]*/.exec(e)[0] === FEATURE);
        assert.equal(
          featureEntries.length > 0,
          configured || enNames,
          `names FEATURE iff configured/operator ${label}`
        );
        assert.equal(featureEntries.length <= 1, true, `FEATURE named once ${label}`);
        // operator entries preserved (trimmed, deduped)
        for (const e of en
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)) {
          assert.ok(entries.includes(e), `operator entry ${e} kept ${label}`);
        }
      }
    }
  }
});

test('decideStartup handles absent switch values and composes in order', () => {
  assert.deepEqual(decideStartup({ configured: false }), {
    isolateEffective: false,
    enableFeatures: '',
    operatorOverride: null
  });
  assert.equal(decideStartup({ configured: true, enableFeatures: '', disableFeatures: '' }).enableFeatures, FEATURE);
  assert.equal(decideStartup({ configured: true, enableFeatures: ' A , ,A,B ' }).enableFeatures, `A,B,${FEATURE}`);
  // a FEATURE entry with params is kept verbatim and not duplicated
  assert.equal(decideStartup({ configured: true, enableFeatures: `${FEATURE}:x/y` }).enableFeatures, `${FEATURE}:x/y`);
  // disable wins even when configured
  const d = decideStartup({ configured: true, disableFeatures: FEATURE });
  assert.equal(d.isolateEffective, false);
  assert.equal(d.operatorOverride, 'disabled');
});

test('isValidPartitionedSetCookie: Partitioned AND Secure, attribute names only', () => {
  assert.equal(isValidPartitionedSetCookie('a=1; Secure; Partitioned'), true);
  assert.equal(isValidPartitionedSetCookie('a=1; partitioned;SECURE'), true);
  assert.equal(isValidPartitionedSetCookie('__Host-a=1;Secure;Path=/;SameSite=None;PARTITIONED'), true);
  assert.equal(isValidPartitionedSetCookie('a=1;   Partitioned  ;   Secure  '), true);
  assert.equal(isValidPartitionedSetCookie('a=1; Partitioned'), false, 'no Secure');
  assert.equal(isValidPartitionedSetCookie('a=1'), false, 'no attributes');
  assert.equal(isValidPartitionedSetCookie('x=Partitioned; Secure'), false, 'value is not an attribute');
  assert.equal(isValidPartitionedSetCookie('Partitioned=1; Secure'), false, 'name is not an attribute');
  assert.equal(isValidPartitionedSetCookie('a=1; Path=/Partitioned; Secure'), false, 'attribute value substring');
  assert.equal(isValidPartitionedSetCookie('a=1; SameSite=None; Secure'), false);
  assert.equal(isValidPartitionedSetCookie(undefined), false);
});

test('refusedThirdPartySetCookie: any invalid line refuses; empty/missing does not', () => {
  const ok = 'a=1; Secure; Partitioned';
  assert.equal(refusedThirdPartySetCookie([ok, ok]), false);
  assert.equal(refusedThirdPartySetCookie([ok, 'b=2; Secure']), true);
  assert.equal(refusedThirdPartySetCookie(['b=2']), true);
  assert.equal(refusedThirdPartySetCookie([]), false);
  assert.equal(refusedThirdPartySetCookie(undefined), false);
  assert.equal(refusedThirdPartySetCookie(null), false);
});
