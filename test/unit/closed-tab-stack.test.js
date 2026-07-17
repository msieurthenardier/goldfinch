'use strict';

// Unit tests for src/shared/closed-tab-stack.js (M09 Flight 4, Leg 1, DD1).
//
// Pure, Electron-free module — real ES module, loaded here via Node's
// synchronous require(esm) support (precedented by sheet-accelerator.test.js).
// Covers: bound/evict order, LIFO, empty-pop, peek non-mutating, toJSON/
// fromJSON round-trip, entry-shape passthrough.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createClosedTabStack, MAX_ENTRIES } = require('../../src/shared/closed-tab-stack.js');

/** @param {Partial<import('../../src/shared/closed-tab-stack.js').ClosedTabEntry>} [overrides] */
function makeEntry(overrides = {}) {
  return {
    url: 'https://example.com/',
    title: 'Example',
    jarId: 'work',
    stripIndex: 0,
    navEntries: [{ url: 'https://example.com/', title: 'Example' }],
    navIndex: 0,
    closedAt: 1700000000000,
    ...overrides,
  };
}

test('MAX_ENTRIES constant is 25 (the flight-ruled bound)', () => {
  assert.equal(MAX_ENTRIES, 25);
});

test('size() is 0 on a fresh stack', () => {
  const stack = createClosedTabStack();
  assert.equal(stack.size(), 0);
});

test('push/pop is LIFO — most-recently-closed pops first', () => {
  const stack = createClosedTabStack();
  stack.push(makeEntry({ url: 'https://a.example/' }));
  stack.push(makeEntry({ url: 'https://b.example/' }));
  stack.push(makeEntry({ url: 'https://c.example/' }));
  assert.equal(stack.pop()?.url, 'https://c.example/');
  assert.equal(stack.pop()?.url, 'https://b.example/');
  assert.equal(stack.pop()?.url, 'https://a.example/');
  assert.equal(stack.size(), 0);
});

test('pop() on an empty stack returns null (no throw)', () => {
  const stack = createClosedTabStack();
  assert.equal(stack.pop(), null);
  // Still empty and well-behaved after the empty-pop.
  assert.equal(stack.pop(), null);
  assert.equal(stack.size(), 0);
});

test('peek() returns the most-recent entry WITHOUT removing it (non-mutating)', () => {
  const stack = createClosedTabStack();
  stack.push(makeEntry({ url: 'https://a.example/' }));
  stack.push(makeEntry({ url: 'https://b.example/' }));
  assert.equal(stack.peek()?.url, 'https://b.example/');
  assert.equal(stack.size(), 2); // unchanged
  assert.equal(stack.peek()?.url, 'https://b.example/'); // repeatable
  assert.equal(stack.size(), 2);
  // The stack still pops the same top entry after peeking.
  assert.equal(stack.pop()?.url, 'https://b.example/');
});

test('peek() on an empty stack returns null', () => {
  const stack = createClosedTabStack();
  assert.equal(stack.peek(), null);
});

test('bound/evict order — pushing past MAX_ENTRIES evicts the OLDEST entry first', () => {
  const stack = createClosedTabStack({ maxEntries: 3 });
  stack.push(makeEntry({ url: 'https://1.example/' }));
  stack.push(makeEntry({ url: 'https://2.example/' }));
  stack.push(makeEntry({ url: 'https://3.example/' }));
  assert.equal(stack.size(), 3);
  // Pushing a 4th evicts entry 1 (oldest), keeping 2/3/4.
  stack.push(makeEntry({ url: 'https://4.example/' }));
  assert.equal(stack.size(), 3);
  assert.equal(stack.pop()?.url, 'https://4.example/');
  assert.equal(stack.pop()?.url, 'https://3.example/');
  assert.equal(stack.pop()?.url, 'https://2.example/');
  assert.equal(stack.size(), 0);
});

test('default bound is MAX_ENTRIES (25) — the 26th push evicts the 1st', () => {
  const stack = createClosedTabStack();
  for (let i = 0; i < 25; i++) stack.push(makeEntry({ url: `https://${i}.example/` }));
  assert.equal(stack.size(), 25);
  stack.push(makeEntry({ url: 'https://25.example/' }));
  assert.equal(stack.size(), 25);
  // Drain and confirm the oldest (0) is gone, newest (25) is present, in LIFO order.
  const popped = [];
  let e;
  while ((e = stack.pop())) popped.push(e.url);
  assert.equal(popped.length, 25);
  assert.equal(popped[0], 'https://25.example/'); // newest pops first
  assert.equal(popped[popped.length - 1], 'https://1.example/'); // https://0 was evicted
  assert.ok(!popped.includes('https://0.example/'));
});

test('entry-shape passthrough — push/pop preserves every field unchanged', () => {
  const stack = createClosedTabStack();
  const entry = makeEntry({
    url: 'https://example.com/deep/path?x=1',
    title: 'Deep Page',
    jarId: 'personal',
    stripIndex: 4,
    navEntries: [
      { url: 'https://example.com/', title: 'Home' },
      { url: 'https://example.com/deep/path?x=1', title: 'Deep Page' },
    ],
    navIndex: 1,
    closedAt: 1234567890,
  });
  stack.push(entry);
  const popped = stack.pop();
  assert.deepEqual(popped, entry);
});

test('toJSON()/fromJSON() round-trip — a fresh stack restored from a snapshot pops identically', () => {
  const stack = createClosedTabStack();
  stack.push(makeEntry({ url: 'https://a.example/' }));
  stack.push(makeEntry({ url: 'https://b.example/' }));
  stack.push(makeEntry({ url: 'https://c.example/' }));

  const snapshot = stack.toJSON();
  assert.equal(snapshot.length, 3);
  // toJSON is a snapshot, not a live view — further pushes must not affect it.
  stack.push(makeEntry({ url: 'https://d.example/' }));
  assert.equal(snapshot.length, 3);

  const restored = createClosedTabStack();
  restored.fromJSON(snapshot);
  assert.equal(restored.size(), 3);
  assert.equal(restored.pop()?.url, 'https://c.example/');
  assert.equal(restored.pop()?.url, 'https://b.example/');
  assert.equal(restored.pop()?.url, 'https://a.example/');
});

test('fromJSON() bounds an over-capacity snapshot to maxEntries, keeping the NEWEST entries', () => {
  const snapshot = [];
  for (let i = 0; i < 30; i++) snapshot.push(makeEntry({ url: `https://${i}.example/` }));
  const stack = createClosedTabStack({ maxEntries: 5 });
  stack.fromJSON(snapshot);
  assert.equal(stack.size(), 5);
  const popped = [];
  let e;
  while ((e = stack.pop())) popped.push(e.url);
  // Newest 5 (25..29), LIFO order (29 first).
  assert.deepEqual(popped, [
    'https://29.example/',
    'https://28.example/',
    'https://27.example/',
    'https://26.example/',
    'https://25.example/',
  ]);
});

test('fromJSON() replaces prior contents rather than appending', () => {
  const stack = createClosedTabStack();
  stack.push(makeEntry({ url: 'https://stale.example/' }));
  stack.fromJSON([makeEntry({ url: 'https://fresh.example/' })]);
  assert.equal(stack.size(), 1);
  assert.equal(stack.pop()?.url, 'https://fresh.example/');
});

test('fromJSON() tolerates a non-array snapshot (defensive empty)', () => {
  const stack = createClosedTabStack();
  stack.push(makeEntry());
  // @ts-expect-error deliberate malformed input for the defensive branch
  stack.fromJSON(null);
  assert.equal(stack.size(), 0);
});
