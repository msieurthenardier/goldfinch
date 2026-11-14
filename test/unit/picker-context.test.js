'use strict';

// The per-open picker context store (Mission 23 Flight 1, leg `vault-fill-trust`): mint, replace, the
// missing / stale distinction, the shared 120 s time limit (checked lazily), per-tab drops.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPickerContexts } = require('../../src/main/vault/picker-context');
const { PICKER_TTL_MS } = require('../../src/shared/vault-picker-limits');

function make() {
  let t = 1000;
  let n = 0;
  const c = createPickerContexts({ now: () => t, randomId: () => `id-${++n}` });
  return { c, advance: (ms) => (t += ms) };
}

test('the time limit is the ONE shared 120 s constant', () => {
  assert.equal(PICKER_TTL_MS, 120000);
});

test('mint carries the tab, the committed origin and the certificate flag; the default id is unguessable', () => {
  const real = createPickerContexts();
  const a = real.mint({ wcId: 5, origin: 'https://a.test', certOverride: false });
  const b = real.mint({ wcId: 6, origin: 'https://a.test', certOverride: true });
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(a.wcId, 5);
  assert.equal(a.origin, 'https://a.test');
  assert.equal(a.certOverride, false);
  assert.equal(b.certOverride, true);
  assert.equal(
    real.mint({ wcId: 7, origin: 'https://a.test', certOverride: 'yes' }).certOverride,
    false,
    'exactly true only'
  );
});

test('lookup: the live id resolves; a missing tab or a never-minted tab is `missing`; another id is `stale`', () => {
  const { c } = make();
  const ctx = c.mint({ wcId: 5, origin: 'https://a.test', certOverride: false });
  assert.deepEqual(c.lookup(5, ctx.id), { ok: true, context: ctx });
  assert.deepEqual(c.lookup(6, ctx.id), { ok: false, reason: 'missing' }, 'another tab has none');
  assert.deepEqual(c.lookup(5, 'guess'), { ok: false, reason: 'stale' });
  assert.deepEqual(c.lookup(5, undefined), { ok: false, reason: 'stale' });
  assert.deepEqual(c.lookup(5, 42), { ok: false, reason: 'stale' });
  assert.deepEqual(c.lookup('5', ctx.id), { ok: false, reason: 'missing' });
  assert.deepEqual(c.lookup(undefined, ctx.id), { ok: false, reason: 'missing' });
});

test('one live context per tab: a new mint replaces the old (the old id becomes stale)', () => {
  const { c } = make();
  const first = c.mint({ wcId: 5, origin: 'https://a.test', certOverride: false });
  const second = c.mint({ wcId: 5, origin: 'https://b.test', certOverride: false });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(c.lookup(5, first.id), { ok: false, reason: 'stale' });
  assert.equal(c.lookup(5, second.id).ok, true);
  assert.equal(c._size(), 1);
});

test('the time limit: live until 120 s, then missing (and removed); a later mint sweeps expired contexts', () => {
  const { c, advance } = make();
  const ctx = c.mint({ wcId: 5, origin: 'https://a.test', certOverride: false });
  advance(PICKER_TTL_MS - 1);
  assert.equal(c.lookup(5, ctx.id).ok, true, 'one millisecond inside the limit');
  advance(1);
  assert.deepEqual(c.lookup(5, ctx.id), { ok: false, reason: 'missing' }, 'at the limit');
  assert.equal(c._size(), 0, 'removed on lookup');
  const other = c.mint({ wcId: 6, origin: 'https://a.test', certOverride: false });
  advance(PICKER_TTL_MS);
  c.mint({ wcId: 7, origin: 'https://a.test', certOverride: false });
  assert.equal(c._size(), 1, 'mint swept the expired one');
  assert.deepEqual(c.lookup(6, other.id), { ok: false, reason: 'missing' });
});

test('drop and dropMany remove by tab and report what they removed', () => {
  const { c } = make();
  c.mint({ wcId: 5, origin: 'https://a.test', certOverride: false });
  c.mint({ wcId: 6, origin: 'https://a.test', certOverride: false });
  c.mint({ wcId: 7, origin: 'https://a.test', certOverride: false });
  assert.equal(c.drop(5), true);
  assert.equal(c.drop(5), false);
  assert.equal(c.dropMany([6, 99]), 1);
  assert.equal(c._size(), 1);
  assert.equal(c.dropMany([]), 0);
});

test('a minted context starts unacknowledged with nothing pending (leg vault-picker-controls)', () => {
  const ctxs = createPickerContexts({ now: () => 1000, randomId: () => 'id-1' });
  const c = ctxs.mint({ wcId: 3, origin: 'https://a.example', certOverride: true });
  assert.equal(c.acknowledged, false);
  assert.equal(c.pending, null);
  const found = ctxs.lookup(3, 'id-1');
  assert.equal(found.ok, true);
  found.context.acknowledged = true;
  assert.equal(ctxs.lookup(3, 'id-1').context.acknowledged, true, 'the stored object is the one mutated');
  assert.equal(
    ctxs.mint({ wcId: 3, origin: 'https://a.example', certOverride: true }).acknowledged,
    false,
    'a new mint is unacknowledged again'
  );
});
