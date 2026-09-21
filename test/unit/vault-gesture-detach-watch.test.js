'use strict';

// Unit tests for the extracted per-family gesture-detach watch (M21 F3 L2, DD1's
// amendment / LD1, AC10/AC10b). Driven entirely with an injected fake
// `MutationObserver` constructor and plain `{ isConnected }` stand-ins — no DOM, no
// Electron — the `vault-entry-tracker.js` injected-deps precedent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGestureDetachWatch } = require('../../src/preload/vault-gesture-detach-watch');

/** A fake MutationObserver: `observe()` just records the callback; a test fires
 * mutations manually via `fire()` on the instance the fake constructor returns. */
function makeFakeObserverCtor() {
  const instances = [];
  /** @constructor */
  function FakeMutationObserver(cb) {
    const inst = {
      cb,
      observed: null,
      observe(root, opts) {
        inst.observed = { root, opts };
      },
      fire() {
        cb();
      }
    };
    instances.push(inst);
    return inst;
  }
  return { FakeMutationObserver, instances };
}

function field(connected) {
  return { isConnected: connected };
}

test('arming two kinds keeps BOTH sets armed independently', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const loginFields = [field(true), field(true)];
  const cardFields = [field(true), field(true), field(true)];
  watch.arm('login', loginFields);
  watch.arm('card', cardFields);

  assert.equal(instances.length, 1, 'ONE shared MutationObserver for both kinds — a second arm() call reuses it');
  // Neither set has detached yet — a mutation batch fires nothing.
  instances[0].fire();
  assert.deepEqual(settles, [], 'nothing detached — no settle');
});

test('one set FULLY detaching fires settle exactly once and clears only that set', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const loginFields = [field(true), field(true)];
  const cardFields = [field(true), field(true)];
  watch.arm('login', loginFields);
  watch.arm('card', cardFields);

  // Fully detach the LOGIN set only.
  loginFields[0].isConnected = false;
  loginFields[1].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 1, 'exactly one settle for the login set fully detaching');

  // A second mutation batch with nothing NEWLY detached must not re-fire — the
  // login set was cleared, so checkAll skips it (length 0 / absent from the map).
  instances[0].fire();
  assert.equal(settles.length, 1, 'the cleared set does not re-fire on a later, unrelated mutation');
});

test('the SIBLING set stays armed and fires on its OWN later detachment', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const loginFields = [field(true)];
  const cardFields = [field(true), field(true)];
  watch.arm('login', loginFields);
  watch.arm('card', cardFields);

  loginFields[0].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 1, 'login settles first');

  // The card set is UNTOUCHED so far — a mutation batch with nothing detached
  // must not fire for it.
  instances[0].fire();
  assert.equal(settles.length, 1, 'card set unaffected by the login settle');

  // Now fully detach the card set, independently, later.
  cardFields[0].isConnected = false;
  cardFields[1].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 2, 'the sibling (card) set fires on its own later detachment');
});

test('a PARTIALLY-detached set does not fire', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const cardFields = [field(true), field(true), field(true)];
  watch.arm('card', cardFields);

  // Only ONE of three card fields detaches — not a real form teardown.
  cardFields[0].isConnected = false;
  instances[0].fire();
  assert.deepEqual(settles, [], 'a partially-detached set must not fire');

  // Detach a second (still not all three).
  cardFields[1].isConnected = false;
  instances[0].fire();
  assert.deepEqual(settles, [], 'still partial — still no fire');

  // The THIRD and final field detaches — now fully detached, fires.
  cardFields[2].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 1, 'the set is NOW fully detached — fires exactly once');
});

test('two kinds fully detaching in ONE mutation callback both fire (a whole-page teardown removing both forms at once)', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const loginFields = [field(true)];
  const cardFields = [field(true)];
  watch.arm('login', loginFields);
  watch.arm('card', cardFields);

  loginFields[0].isConnected = false;
  cardFields[0].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 2, 'both kinds settle from the SAME mutation callback');
});

test('re-arming the SAME kind replaces its set wholesale (last-wins) without disturbing a different kind', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const settles = [];
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => settles.push(true)
  });

  const firstLoginFields = [field(true)];
  const cardFields = [field(true)];
  watch.arm('login', firstLoginFields);
  watch.arm('card', cardFields);

  // A second login gesture replaces the FIRST login field set.
  const secondLoginFields = [field(true), field(true)];
  watch.arm('login', secondLoginFields);

  // Fully detaching the FIRST (superseded) login fields must not fire — they are
  // no longer the watched set.
  firstLoginFields[0].isConnected = false;
  instances[0].fire();
  assert.deepEqual(settles, [], 'the superseded field set is no longer watched');

  // The SECOND login field set fully detaching DOES fire.
  secondLoginFields[0].isConnected = false;
  secondLoginFields[1].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 1, 'the CURRENT login field set fires normally');

  // The card set, untouched throughout, still fires on its own later detachment.
  cardFields[0].isConnected = false;
  instances[0].fire();
  assert.equal(settles.length, 2, 'the card set is unaffected by the login re-arm');
});

test('arm() with an empty/all-falsy field list is a no-op — no observer is created for it alone', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => {
      throw new Error('must never fire for an empty arm');
    }
  });
  watch.arm('login', []);
  watch.arm('card', [null, undefined]);
  assert.equal(instances.length, 0, 'no MutationObserver created — nothing was ever armed');
});

test('fails closed: no MutationObserver constructor / no root — arm() never throws and never watches', () => {
  const watch1 = createGestureDetachWatch({
    MutationObserver: /** @type {any} */ (undefined),
    root: () => ({ id: 'root' }),
    onSettle: () => {
      throw new Error('must never fire without a MutationObserver');
    }
  });
  assert.doesNotThrow(() => watch1.arm('login', [field(true)]));

  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const watch2 = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => null, // document root not ready yet
    onSettle: () => {
      throw new Error('must never fire without a root');
    }
  });
  assert.doesNotThrow(() => watch2.arm('login', [field(true)]));
  assert.equal(instances.length, 0, 'no observer created without a root');
});

test('a second arm() call (any kind) reuses the SAME MutationObserver — never a second attach', () => {
  const { FakeMutationObserver, instances } = makeFakeObserverCtor();
  const watch = createGestureDetachWatch({
    MutationObserver: FakeMutationObserver,
    root: () => ({ id: 'root' }),
    onSettle: () => {}
  });
  watch.arm('login', [field(true)]);
  watch.arm('card', [field(true)]);
  watch.arm('login', [field(true)]);
  assert.equal(instances.length, 1, 'exactly one MutationObserver ever constructed');
});
