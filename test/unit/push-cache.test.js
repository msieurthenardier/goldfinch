'use strict';

// Unit tests for src/shared/push-cache.js (M09 Flight 6, Leg 3, DD6) — the
// seed/push race rule for the renderer's closed-tab-stack size cache: a
// received push ALWAYS wins; the boot-seed invoke's resolve applies only if no
// push has arrived (monotonic by ARRIVAL, not by value). Real ES module, loaded
// via require(esm) (the closed-tab-stack.test.js precedent).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPushCache } = require('../../src/shared/push-cache.js');

test('starts at the initial value before either seed or push', () => {
  assert.equal(createPushCache(0).get(), 0);
  assert.equal(createPushCache(7).get(), 7);
});

test('seed applies when no push has arrived (the boot path)', () => {
  const cache = createPushCache(0);
  cache.seed(4);
  assert.equal(cache.get(), 4);
});

test('push updates the value (the mutation broadcast path)', () => {
  const cache = createPushCache(0);
  cache.push(2);
  assert.equal(cache.get(), 2);
  cache.push(1);
  assert.equal(cache.get(), 1);
});

test('race rule: a push that arrives BEFORE the seed resolves wins — the seed is discarded', () => {
  const cache = createPushCache(0);
  cache.push(3); // a stack mutation broadcast lands first…
  cache.seed(2); // …then the (older) boot invoke snapshot resolves
  assert.equal(cache.get(), 3);
});

test('race rule is by arrival, not by value — a LOWER push still beats a later seed', () => {
  const cache = createPushCache(0);
  cache.push(0); // e.g. a pop drained the stack
  cache.seed(5); // stale boot snapshot from before the pop
  assert.equal(cache.get(), 0);
});

test('pushes after the seed keep winning (seed applies at most once, pushes forever)', () => {
  const cache = createPushCache(0);
  cache.seed(1);
  cache.push(2);
  cache.seed(9); // a second seed (not expected in practice) must not clobber the push
  assert.equal(cache.get(), 2);
  cache.push(6);
  assert.equal(cache.get(), 6);
});
