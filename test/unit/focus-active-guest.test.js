'use strict';

// Sortie 06 Leg 3 (R5): the shared focus-active-guest predicate (tab-focus-guest semantics).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { focusActiveGuest } = require('../../src/main/focus-active-guest');

function rec({ active = 5, destroyed = false, entry = {} } = {}) {
  const calls = [];
  const tabViews = new Map();
  if (active != null) {
    tabViews.set(active, {
      view: { webContents: { isDestroyed: () => destroyed, focus: () => calls.push('focus') } },
      ...entry
    });
  }
  return { rec: { activeTabWcId: active, tabViews }, calls };
}

test('focuses the active guest and returns true', () => {
  const { rec: r, calls } = rec();
  assert.equal(focusActiveGuest(r), true);
  assert.deepEqual(calls, ['focus']);
});

test('refuses (false, no focus, no throw): null record, no active tab, stale tab, destroyed view', () => {
  assert.equal(focusActiveGuest(null), false);
  assert.equal(focusActiveGuest({ activeTabWcId: null, tabViews: new Map() }), false);
  assert.equal(focusActiveGuest({ activeTabWcId: 9, tabViews: new Map() }), false);
  const { rec: r, calls } = rec({ destroyed: true });
  assert.equal(focusActiveGuest(r), false);
  assert.deepEqual(calls, []);
});

test('refuses a taken-over guest (load failure / crash)', () => {
  const { rec: lf, calls: c1 } = rec({ entry: { loadFailure: { code: -105 } } });
  assert.equal(focusActiveGuest(lf), false);
  assert.deepEqual(c1, []);
  const { rec: cr, calls: c2 } = rec({ entry: { crash: { reason: 'crashed' } } });
  assert.equal(focusActiveGuest(cr), false);
  assert.deepEqual(c2, []);
});
