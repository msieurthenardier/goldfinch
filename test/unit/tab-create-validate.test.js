'use strict';

// Pure unit tests for the main-side `tab-create` / `identity-new` argument validation (Mission 23
// Flight 1, leg `ipc-gate-complete`, finding 22c). The registrar-level matrix (no view
// constructed on a refusal) lives in register-tab-ipc.test.js; `identity-new` in
// register-browser-ipc.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAdmissibleTabPartition,
  validateTabCreate,
  MAX_RESTORE_ENTRIES
} = require('../../src/main/tab-create-validate');
const { isBurnerPartition } = require('../../src/shared/burner');
const { sanitizeFpCounts, FP_KINDS, FP_COUNT_CEILING } = require('../../src/shared/privacy-fp');
const { INTERNAL_PARTITION } = require('../../src/shared/internal-page');

const jarsList = [{ partition: 'persist:goldfinch' }, { partition: 'persist:container:work' }];
const deps = {
  isSafeTabUrl: (u) => typeof u === 'string' && /^(https?:|about:blank)/.test(u),
  isInternalPageUrl: (u) => typeof u === 'string' && /^goldfinch:\/\/(settings|jars)/.test(u),
  jarsList
};

test('the burner shape is exact: burner:<digits> only (the renderer mints burner:<n>)', () => {
  for (const ok of ['burner:0', 'burner:123456789']) assert.equal(isBurnerPartition(ok), true, ok);
  for (const bad of [
    'burner:',
    'burner:abc',
    'burner:1x',
    'burner:-1',
    'burner:1.5',
    ' burner:1',
    'burner:1\n',
    'burnerx:1',
    'persist:burner:1',
    null,
    undefined,
    5,
    {}
  ]) {
    assert.equal(isBurnerPartition(bad), false, String(bad));
  }
});

test('isAdmissibleTabPartition: a registered jar partition or a burner by exact shape; never the internal partition or an unknown one', () => {
  assert.equal(isAdmissibleTabPartition('persist:goldfinch', jarsList), true);
  assert.equal(isAdmissibleTabPartition('persist:container:work', jarsList), true);
  assert.equal(isAdmissibleTabPartition('burner:42', jarsList), true);
  assert.equal(isAdmissibleTabPartition('burner:42', []), true, 'a burner needs no registered jar');
  for (const bad of [
    'persist:nope',
    INTERNAL_PARTITION,
    'burner:x',
    '',
    null,
    undefined,
    5,
    {},
    ['persist:goldfinch']
  ]) {
    assert.equal(isAdmissibleTabPartition(bad, jarsList), false, String(bad));
  }
  assert.equal(
    isAdmissibleTabPartition(INTERNAL_PARTITION, [{ partition: INTERNAL_PARTITION }]),
    false,
    'never the internal partition even if a (corrupt) jar list named it'
  );
  assert.equal(isAdmissibleTabPartition('persist:goldfinch', undefined), false);
  assert.equal(isAdmissibleTabPartition('persist:goldfinch', [null, undefined]), false);
});

test('validateTabCreate: the trusted branch takes an internal URL only; trusted must be exactly true or false', () => {
  const ok = validateTabCreate({ url: 'goldfinch://settings', trusted: true }, deps);
  assert.deepEqual(ok, { url: 'goldfinch://settings', partition: undefined, trusted: true, restoreHistory: null });
  assert.equal(validateTabCreate({ url: 'https://a.test/', trusted: true }, deps), null);
  assert.equal(validateTabCreate({ url: 'goldfinch://settings', trusted: 'true' }, deps), null);
  assert.equal(validateTabCreate({ url: 'goldfinch://settings', trusted: 1 }, deps), null);
  assert.equal(validateTabCreate({ url: 'goldfinch://settings' }, deps), null);
  assert.equal(validateTabCreate({ url: 'goldfinch://evil', trusted: true }, deps), null);
});

test('validateTabCreate: the untrusted branch takes a safe URL in an admissible partition; the partition is carried through', () => {
  const ok = validateTabCreate({ url: 'https://a.test/', partition: 'persist:goldfinch', trusted: false }, deps);
  assert.deepEqual(ok, {
    url: 'https://a.test/',
    partition: 'persist:goldfinch',
    trusted: false,
    restoreHistory: null
  });
  assert.equal(
    validateTabCreate({ url: 'goldfinch://settings', partition: 'persist:goldfinch', trusted: false }, deps),
    null
  );
  assert.equal(
    validateTabCreate({ url: 'https://a.test/', partition: INTERNAL_PARTITION, trusted: false }, deps),
    null
  );
  assert.equal(validateTabCreate({ url: '', partition: 'persist:goldfinch', trusted: false }, deps), null);
  for (const payload of [undefined, null, 5, 'x', [], () => 1]) assert.equal(validateTabCreate(payload, deps), null);
});

test('validateTabCreate: restore history — entry URLs, index range, count cap', () => {
  const base = { url: 'https://a.test/', partition: 'persist:goldfinch', trusted: false };
  const entries = [{ url: 'https://a.test/' }, { url: 'https://b.test/' }];
  const ok = validateTabCreate({ ...base, restoreHistory: { entries, index: 1, title: 'T' } }, deps);
  assert.deepEqual(ok.restoreHistory, { entries, index: 1 }, 'only entries and index are carried');
  assert.equal(validateTabCreate({ ...base, restoreHistory: null }, deps).restoreHistory, null);
  assert.equal(validateTabCreate({ ...base, restoreHistory: undefined }, deps).restoreHistory, null);
  // Malformed shapes still refuse the whole create (an entry that merely fails the URL check does NOT:
  // see the next test).
  const bad = [
    { entries, index: 2 },
    { entries, index: -1 },
    { entries, index: 0.5 },
    { entries, index: '0' },
    { entries: [], index: 0 },
    { entries: 'x', index: 0 },
    { entries: Array.from({ length: MAX_RESTORE_ENTRIES + 1 }, () => ({ url: 'https://a.test/' })), index: 0 },
    []
  ];
  for (const restoreHistory of bad)
    assert.equal(
      validateTabCreate({ ...base, restoreHistory }, deps),
      null,
      JSON.stringify(restoreHistory)?.slice(0, 60)
    );
  const atCap = Array.from({ length: MAX_RESTORE_ENTRIES }, () => ({ url: 'https://a.test/' }));
  assert.notEqual(
    validateTabCreate({ ...base, restoreHistory: { entries: atCap, index: MAX_RESTORE_ENTRIES - 1 } }, deps),
    null
  );
  assert.equal(
    validateTabCreate({ url: 'goldfinch://settings', trusted: true, restoreHistory: { entries, index: 0 } }, deps),
    null
  );
});

test('validateTabCreate: restore history drops entries that fail the URL check and re-points the index', () => {
  const base = { url: 'https://a.test/', partition: 'persist:goldfinch', trusted: false };
  const good = (n) => ({ url: `https://${n}.test/`, title: n });
  const bad = (url) => ({ url, title: 'bad' });
  const restoreOf = (entries, index) => validateTabCreate({ ...base, restoreHistory: { entries, index } }, deps);

  // One file: entry among good ones: the good ones restore, the create is not refused.
  const mixed = [good('a'), bad('file:///x'), good('c')];
  assert.deepEqual(
    restoreOf(mixed, 2).restoreHistory,
    { entries: [good('a'), good('c')], index: 1 },
    'same entry survives, re-indexed'
  );
  assert.deepEqual(restoreOf(mixed, 0).restoreHistory, { entries: [good('a'), good('c')], index: 0 });
  // The index points AT a dropped entry: the nearest survivor (tie: the earlier one).
  assert.deepEqual(
    restoreOf(mixed, 1).restoreHistory,
    { entries: [good('a'), good('c')], index: 0 },
    'tie goes to the earlier'
  );
  const lopsided = [good('a'), good('b'), bad('goldfinch://settings'), bad('javascript:1'), good('e')];
  assert.deepEqual(
    restoreOf(lopsided, 3).restoreHistory,
    { entries: [good('a'), good('b'), good('e')], index: 2 },
    'nearer on the right'
  );
  assert.deepEqual(
    restoreOf(lopsided, 2).restoreHistory,
    { entries: [good('a'), good('b'), good('e')], index: 1 },
    'nearer on the left'
  );
  // Start, middle and end positions.
  const startBad = [bad('file:///s'), good('b'), good('c')];
  assert.deepEqual(
    restoreOf(startBad, 0).restoreHistory,
    { entries: [good('b'), good('c')], index: 0 },
    'start dropped'
  );
  const endBad = [good('a'), good('b'), bad('file:///e')];
  assert.deepEqual(restoreOf(endBad, 2).restoreHistory, { entries: [good('a'), good('b')], index: 1 }, 'end dropped');
  // Non-object entries (null, a bare string) are dropped the same way.
  assert.deepEqual(restoreOf([null, good('b'), 'https://a.test/'], 2).restoreHistory, {
    entries: [good('b')],
    index: 0
  });
  // All bad: a plain create of the tab's url with no restore.
  const allBad = validateTabCreate(
    { ...base, restoreHistory: { entries: [bad('file:///x'), bad('javascript:1')], index: 1 } },
    deps
  );
  assert.notEqual(allBad, null);
  assert.equal(allBad.restoreHistory, null);
  assert.equal(allBad.url, 'https://a.test/');
  assert.equal(allBad.partition, 'persist:goldfinch');
  // What stays strict: the index is validated against the ORIGINAL list (a malformed index refuses even
  // when the entry it would point at is being dropped), the url, the partition, trusted, and trusted+restore.
  assert.equal(restoreOf([bad('file:///x'), good('b')], 2), null, 'out of range against the ORIGINAL list');
  assert.equal(restoreOf(mixed, 1.5), null);
  assert.equal(
    validateTabCreate({ ...base, url: 'file:///x', restoreHistory: { entries: mixed, index: 0 } }, deps),
    null
  );
  assert.equal(
    validateTabCreate({ ...base, partition: 'persist:nope', restoreHistory: { entries: mixed, index: 0 } }, deps),
    null
  );
  assert.equal(
    validateTabCreate({ ...base, trusted: 'yes', restoreHistory: { entries: mixed, index: 0 } }, deps),
    null
  );
  assert.equal(
    validateTabCreate(
      { url: 'goldfinch://settings', trusted: true, restoreHistory: { entries: mixed, index: 0 } },
      deps
    ),
    null
  );
});

test('sanitizeFpCounts (NF8): fixed key set, non-negative integers, clamped to the ceiling; anything else is dropped whole', () => {
  assert.deepEqual([...FP_KINDS], ['canvas', 'webgl', 'audio']);
  assert.deepEqual(sanitizeFpCounts({ canvas: 1, webgl: 2, audio: 3 }), { canvas: 1, webgl: 2, audio: 3 });
  assert.deepEqual(sanitizeFpCounts({ canvas: 4 }), { canvas: 4, webgl: 0, audio: 0 });
  assert.deepEqual(sanitizeFpCounts({ canvas: FP_COUNT_CEILING + 5, webgl: 0, audio: 0 }), {
    canvas: FP_COUNT_CEILING,
    webgl: 0,
    audio: 0
  });
  assert.deepEqual(sanitizeFpCounts(Object.assign(Object.create(null), { audio: 2 })), {
    canvas: 0,
    webgl: 0,
    audio: 2
  });
  for (const bad of [
    undefined,
    null,
    1,
    'x',
    [],
    {},
    { canvas: -1 },
    { canvas: 0.1 },
    { canvas: NaN },
    { canvas: '1' },
    { canvas: 1, x: 1 },
    { toString: 1 },
    new (class X {
      canvas = 1;
    })(),
    Object.create({ canvas: 1 })
  ]) {
    assert.equal(sanitizeFpCounts(bad), null, typeof bad);
  }
  // the preload's own counter object is built from the same single-sourced key set
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload/webview-preload.js'), 'utf8');
  assert.match(src, /require\('\.\.\/shared\/privacy-fp'\)/);
  assert.match(src, /Object\.fromEntries\(FP_KINDS\.map/);
  assert.doesNotMatch(
    src,
    /\{ canvas: 0, webgl: 0, audio: 0 \}/,
    'no second literal copy of the key set in the preload'
  );
});
