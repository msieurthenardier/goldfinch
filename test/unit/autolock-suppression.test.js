'use strict';

// Unit tests for src/main/vault/autolock-suppression.js (M18 F2 L4, flight DD5) —
// the ONE refcounted idle-autolock suppression holder replacing the two flows'
// independent `size === 0` boolean discipline. The pinned contract:
//   - the store flag IS `holders > 0` (a holder = a distinct (chromeId, reason) pair);
//   - release is by EXACT (chromeId, reason) pair — never "any hold for this window"
//     (design-review H1);
//   - cross-flow interleaving: an adopt reveal and a compromise reveal pending
//     concurrently in different windows — neither release un-suppresses the other;
//   - window-close (`releaseWindow`) releases that window's holds ONLY;
//   - the injected setSuspended fires ONLY on 0↔>0 transitions (so an unrelated
//     window close never touches — or force-constructs — the store).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSuppressionHolder } = require('../../src/main/vault/autolock-suppression');

function makeHolder() {
  const calls = [];
  const holder = createSuppressionHolder({ setSuspended: (on) => calls.push(on) });
  return { holder, calls };
}

test('refcount semantics: the flag is holders > 0 — first acquire suspends, last release un-suspends', () => {
  const { holder, calls } = makeHolder();
  holder.acquire(1, 'adopt');
  assert.deepEqual(calls, [true], 'first hold → suspended');
  holder.acquire(2, 'compromise');
  assert.deepEqual(calls, [true], 'a second hold is NOT a second store push (transition-only)');
  holder.release(1, 'adopt');
  assert.deepEqual(calls, [true], 'one hold still live → still suspended, no push');
  holder.release(2, 'compromise');
  assert.deepEqual(calls, [true, false], 'last hold released → un-suspended');
  assert.equal(holder.count(), 0);
});

test('acquire is idempotent per (chromeId, reason) pair — a pair models ONE pending reveal', () => {
  const { holder, calls } = makeHolder();
  holder.acquire(1, 'compromise');
  holder.acquire(1, 'compromise');
  assert.equal(holder.count(), 1, 'double-acquire of the same pair is one hold');
  holder.release(1, 'compromise');
  assert.deepEqual(calls, [true, false], 'ONE release fully clears it');
});

test('release is by EXACT (chromeId, reason) pair — a foreign reason or window is a no-op (H1)', () => {
  const { holder, calls } = makeHolder();
  holder.acquire(1, 'compromise');
  holder.release(1, 'adopt'); // right window, wrong reason
  holder.release(2, 'compromise'); // right reason, wrong window
  assert.equal(holder.isHeld(1, 'compromise'), true, 'the hold survives both near-miss releases');
  assert.deepEqual(calls, [true], 'no store push for the no-op releases');
  holder.release(1, 'compromise');
  assert.deepEqual(calls, [true, false]);
});

test('cross-flow interleaving: adopt + compromise reveals in different windows — neither release un-suppresses the other', () => {
  const { holder, calls } = makeHolder();
  holder.acquire(10, 'adopt');
  holder.acquire(20, 'compromise');
  assert.deepEqual(calls, [true]);

  // The adopt flow finishes first (its ack releases): the compromise reveal must
  // STAY suppressed — the exact lockout the retired two-boolean discipline allowed.
  holder.release(10, 'adopt');
  assert.deepEqual(calls, [true], 'compromise reveal still pending → still suspended');
  assert.equal(holder.isHeld(20, 'compromise'), true);

  holder.release(20, 'compromise');
  assert.deepEqual(calls, [true, false]);

  // And in the OTHER order, from scratch: compromise releases first.
  const second = makeHolder();
  second.holder.acquire(10, 'adopt');
  second.holder.acquire(20, 'compromise');
  second.holder.release(20, 'compromise');
  assert.deepEqual(second.calls, [true], 'adopt reveal still pending → still suspended');
  second.holder.release(10, 'adopt');
  assert.deepEqual(second.calls, [true, false]);
});

test("releaseWindow releases that window's holds ONLY (the window-close teardown hook)", () => {
  const { holder, calls } = makeHolder();
  holder.acquire(1, 'adopt');
  holder.acquire(1, 'compromise');
  holder.acquire(2, 'compromise');

  holder.releaseWindow(1);
  assert.equal(holder.isHeld(1, 'adopt'), false);
  assert.equal(holder.isHeld(1, 'compromise'), false);
  assert.equal(holder.isHeld(2, 'compromise'), true, "another window's hold survives");
  assert.deepEqual(calls, [true], 'still suspended — window 2 still holds');

  holder.releaseWindow(2);
  assert.deepEqual(calls, [true, false]);
});

test('releaseWindow for a window holding nothing never touches the store (no force-construction on an unrelated close)', () => {
  const { holder, calls } = makeHolder();
  holder.releaseWindow(99);
  holder.releaseWindow(null);
  holder.releaseWindow(undefined);
  assert.deepEqual(calls, [], 'zero setSuspended pushes');

  holder.acquire(1, 'adopt');
  holder.releaseWindow(99); // unrelated close while something else is held
  assert.deepEqual(calls, [true], 'no push for the unrelated close');
  assert.equal(holder.isHeld(1, 'adopt'), true);
});

test('null/invalid inputs are inert: no hold, no store push', () => {
  const { holder, calls } = makeHolder();
  holder.acquire(null, 'adopt');
  holder.acquire(undefined, 'compromise');
  holder.acquire(1, '');
  holder.acquire(1, /** @type {any} */ (42));
  holder.release(null, 'adopt');
  assert.equal(holder.count(), 0);
  assert.deepEqual(calls, []);
});
