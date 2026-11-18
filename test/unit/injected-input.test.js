'use strict';

// The per-tab counts of input that automation is injecting (Mission 23 Flight 2, leg `automation-input`,
// DD4): two counts (all tiers, jar tier), idempotent release, a trailing allowance on a fake clock, the
// jar-tier key hold on the application menu (`setIgnoreMenuShortcuts`) with its timer, `forget`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createInjectedInput,
  isOperatorInput,
  ALLOWANCE_MS,
  MENU_HOLD_MS
} = require('../../src/main/automation/injected-input');

function make(over = {}) {
  let t = 1000;
  const timers = new Map();
  let nextTimer = 1;
  const cleared = [];
  const store = createInjectedInput({
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => {
      cleared.push(id);
      timers.delete(id);
    },
    ...over
  });
  return {
    store,
    timers,
    cleared,
    advance: (ms) => {
      t += ms;
    },
    fire: () => {
      for (const [id, tm] of [...timers]) {
        timers.delete(id);
        tm.fn();
      }
    }
  };
}

function menuTarget() {
  const calls = [];
  return {
    calls,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    setIgnoreMenuShortcuts(v) {
      calls.push(v);
    }
  };
}

test('a tab that was never injected into reads false on both counts', () => {
  const m = make();
  assert.equal(m.store.isInjecting(1), false);
  assert.equal(m.store.isJarInjecting(1), false);
});

test('an all-tier injection raises isInjecting only; a jar-tier one raises both', () => {
  const m = make();
  const r1 = m.store.begin(1, { jar: false });
  assert.equal(m.store.isInjecting(1), true);
  assert.equal(m.store.isJarInjecting(1), false, 'an admin injection is not a jar one');
  r1();
  const r2 = m.store.begin(2, { jar: true });
  assert.equal(m.store.isInjecting(2), true);
  assert.equal(m.store.isJarInjecting(2), true);
  r2();
});

test('counts are per tab', () => {
  const m = make();
  m.store.begin(1, { jar: true });
  assert.equal(m.store.isInjecting(2), false);
  assert.equal(m.store.isJarInjecting(2), false);
});

test('after the last release the tab still reads as injecting for the trailing allowance, then clears', () => {
  const m = make();
  const r = m.store.begin(1, { jar: true });
  m.advance(5000);
  assert.equal(m.store.isInjecting(1), true, 'held for as long as the injection runs');
  r();
  assert.equal(m.store.isInjecting(1), true);
  assert.equal(m.store.isJarInjecting(1), true);
  m.advance(ALLOWANCE_MS - 1);
  assert.equal(m.store.isInjecting(1), true);
  assert.equal(m.store.isJarInjecting(1), true);
  m.advance(1);
  assert.equal(m.store.isInjecting(1), false);
  assert.equal(m.store.isJarInjecting(1), false);
});

test('the allowance is the stated figure (sized from the live measurement: 0.33 ms worst lag)', () => {
  assert.equal(ALLOWANCE_MS, 50);
  assert.equal(MENU_HOLD_MS, 500);
});

test('release is idempotent and counts never go negative', () => {
  const m = make();
  const r = m.store.begin(1, { jar: true });
  r();
  r();
  r();
  m.advance(ALLOWANCE_MS + 1);
  assert.equal(m.store.isInjecting(1), false);
  const again = m.store.begin(1, { jar: true });
  assert.equal(m.store.isJarInjecting(1), true, 'a double release did not leave a negative count to absorb a begin');
  again();
});

test('overlapping injections are COUNTS: the tab reads injecting until the last release plus the allowance', () => {
  const m = make();
  const a = m.store.begin(1, { jar: false });
  const b = m.store.begin(1, { jar: false });
  a();
  m.advance(ALLOWANCE_MS + 10);
  assert.equal(m.store.isInjecting(1), true, 'one injection is still running');
  b();
  assert.equal(m.store.isInjecting(1), true);
  m.advance(ALLOWANCE_MS);
  assert.equal(m.store.isInjecting(1), false);
});

test('a jar and an admin injection overlapping: the jar count stays up while the jar one runs; the admin count outlives it', () => {
  const m = make();
  const admin = m.store.begin(1, { jar: false });
  const jar = m.store.begin(1, { jar: true });
  assert.equal(m.store.isJarInjecting(1), true);
  jar();
  m.advance(ALLOWANCE_MS + 1);
  assert.equal(m.store.isJarInjecting(1), false, 'the jar count is its own');
  assert.equal(m.store.isInjecting(1), true, 'the admin injection is still running');
  admin();
});

test('forget drops the tab, including a pending menu restore', () => {
  const m = make();
  const wc = menuTarget();
  const r = m.store.begin(1, { jar: true, menuTarget: wc });
  r();
  assert.equal(m.timers.size, 1);
  m.store.forget(1);
  assert.equal(m.timers.size, 0, 'the restore timer was cleared');
  assert.equal(m.store.isInjecting(1), false);
  assert.equal(m.store.isJarInjecting(1), false);
  m.store.forget(99); // unknown tab: no throw
});

test('a jar-tier KEY injection ignores application-menu shortcuts and restores them after the hold', () => {
  const m = make();
  const wc = menuTarget();
  const r = m.store.begin(7, { jar: true, menuTarget: wc });
  assert.deepEqual(wc.calls, [true]);
  r();
  assert.deepEqual(
    wc.calls,
    [true],
    'not restored at the release: the menu path runs after the renderer hands the key back'
  );
  assert.equal(m.timers.size, 1);
  assert.equal([...m.timers.values()][0].ms, MENU_HOLD_MS);
  m.fire();
  assert.deepEqual(wc.calls, [true, false]);
});

test('menu ignore: a second injection during the hold cancels the restore; overlapping holds restore once, at the end', () => {
  const m = make();
  const wc = menuTarget();
  const a = m.store.begin(7, { jar: true, menuTarget: wc });
  const b = m.store.begin(7, { jar: true, menuTarget: wc });
  assert.deepEqual(wc.calls, [true], 'ignored once, not twice');
  a();
  assert.equal(m.timers.size, 0, 'a hold is still active: no restore scheduled');
  b();
  assert.equal(m.timers.size, 1);
  const c = m.store.begin(7, { jar: true, menuTarget: wc });
  assert.equal(m.timers.size, 0, 'the pending restore was cancelled');
  assert.deepEqual(wc.calls, [true]);
  c();
  m.fire();
  assert.deepEqual(wc.calls, [true, false]);
});

test('menu ignore is jar-tier only and key-only: an admin key, a jar mouse injection, or no target never touch it', () => {
  const m = make();
  const wc = menuTarget();
  m.store.begin(1, { jar: false, menuTarget: wc })();
  m.store.begin(2, { jar: true })();
  m.store.begin(3, { jar: true, menuTarget: null })();
  assert.deepEqual(wc.calls, []);
  assert.equal(m.timers.size, 0);
});

test('menu ignore: a contents destroyed before the restore, or one that throws, is tolerated', () => {
  const m = make();
  const gone = menuTarget();
  m.store.begin(1, { jar: true, menuTarget: gone })();
  gone.destroyed = true;
  m.fire();
  assert.deepEqual(gone.calls, [true], 'no restore is sent to a destroyed contents');
  const thrower = {
    setIgnoreMenuShortcuts() {
      throw new Error('torn down');
    }
  };
  assert.doesNotThrow(() => m.store.begin(2, { jar: true, menuTarget: thrower })());
  assert.doesNotThrow(() => m.fire());
  const noMethod = {};
  assert.doesNotThrow(() => m.store.begin(3, { jar: true, menuTarget: noMethod })());
});

test('the default clock and timer work (smoke)', () => {
  const store = createInjectedInput();
  const r = store.begin(1, { jar: true });
  assert.equal(store.isJarInjecting(1), true);
  r();
  store.forget(1);
  assert.equal(store.isInjecting(1), false);
});

test('menu ignore: an admin injection into the same tab during a jar hold neither cancels nor extends the restore', () => {
  const m = make();
  const wc = menuTarget();
  m.store.begin(7, { jar: true, menuTarget: wc })();
  assert.equal(m.timers.size, 1);
  const admin = m.store.begin(7, { jar: false, menuTarget: wc });
  assert.equal(m.timers.size, 1, 'the jar restore timer is still pending');
  assert.deepEqual(wc.calls, [true]);
  admin();
  m.fire();
  assert.deepEqual(wc.calls, [true, false], 'restored after the last jar key, whatever the admin did meanwhile');
});

test('menu ignore: an opener and its popup hold and restore independently, each on its own contents', () => {
  const m = make();
  const opener = menuTarget();
  const popup = menuTarget();
  m.store.begin(7, { jar: true, menuTarget: opener })();
  m.store.begin(9, { jar: true, menuTarget: popup })();
  assert.equal(m.timers.size, 2);
  m.fire();
  assert.deepEqual(opener.calls, [true, false]);
  assert.deepEqual(popup.calls, [true, false]);
  // forgetting one (popup destroyed mid-hold) leaves the other's restore intact
  m.store.begin(7, { jar: true, menuTarget: opener })();
  m.store.begin(9, { jar: true, menuTarget: popup })();
  m.store.forget(9);
  m.fire();
  assert.deepEqual(opener.calls, [true, false, true, false]);
  assert.deepEqual(popup.calls, [true, false, true], 'a forgotten tab is never sent a restore');
});

test('isOperatorInput: true only for no store or a store that answers exactly false; never throws', () => {
  assert.equal(isOperatorInput(null, 1), true);
  assert.equal(isOperatorInput(undefined, 1), true);
  assert.equal(isOperatorInput({}, 1), false, 'no isInjecting function');
  assert.equal(
    isOperatorInput(
      {
        isInjecting: () => {
          throw new Error('boom');
        }
      },
      1
    ),
    false
  );
  assert.equal(isOperatorInput({ isInjecting: () => 1 }, 1), false, 'a truthy non-boolean');
  assert.equal(isOperatorInput({ isInjecting: () => undefined }, 1), false, 'a non-boolean falsy');
  assert.equal(isOperatorInput({ isInjecting: () => true }, 1), false);
  assert.equal(isOperatorInput({ isInjecting: () => false }, 1), true);
});
