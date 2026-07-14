'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CLOSED_TABS,
  moveItem,
  normalizeTabRecord,
  normalizeTabTransferRecord,
  normalizeTabSession,
  pushClosedTab,
  tabContextModel,
} = require('../../src/shared/tab-management');

const jar = { id: 'work', name: 'Work', color: '#336699', partition: 'persist:work' };
const tab = (url = 'https://example.com/') => ({ url, title: 'Example', favicon: null, trusted: false, container: jar });

test('moveItem reorders without mutating and clamps the destination', () => {
  const source = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(source, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(source, 2, -4), ['c', 'a', 'b']);
  assert.deepEqual(source, ['a', 'b', 'c']);
});

test('tab context menu exposes every Issue #82 action with stateful disabled rows', () => {
  const model = tabContextModel({ index: 1, count: 3, canReopen: false });
  assert.deepEqual(model.filter((x) => x.type === 'item').map((x) => x.id), [
    'tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate',
    'tab:move-new-window', 'tab:reopen-closed',
  ]);
  assert.equal(model.find((x) => x.id === 'tab:reopen-closed').disabled, true);
  assert.equal(model.find((x) => x.id === 'tab:close-right').disabled, false);
});

test('normalization accepts safe web/internal tabs and excludes burners', () => {
  assert.deepEqual(normalizeTabRecord(tab()), tab());
  assert.equal(normalizeTabRecord({ ...tab(), container: { ...jar, burner: true } }), null);
  assert.equal(normalizeTabRecord({ ...tab('javascript:alert(1)') }), null);
  assert.ok(normalizeTabRecord({
    url: 'goldfinch://settings', title: 'Settings', trusted: true,
    container: { id: 'internal', name: 'Settings', color: '#9aa0ac', partition: 'goldfinch-internal' },
  }));
});

test('live transfer normalization preserves burners without making them durable', () => {
  const burner = { ...tab(), container: { ...jar, burner: true } };
  assert.deepEqual(normalizeTabTransferRecord(burner), burner);
  assert.equal(normalizeTabRecord(burner), null);
});

test('session normalization repairs windows and clamps active indexes', () => {
  const state = normalizeTabSession({
    version: 99,
    windows: [{ tabs: [tab(), { nope: true }], activeIndex: 8 }, { tabs: [] }],
    closedTabs: [tab('https://closed.example/'), { nope: true }],
  });
  assert.equal(state.version, 1);
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].activeIndex, 0);
  assert.equal(state.closedTabs.length, 1);
});

test('closed-tab stack is newest-first, bounded, and burner-safe', () => {
  let stack = [];
  for (let i = 0; i < MAX_CLOSED_TABS + 4; i++) stack = pushClosedTab(stack, tab(`https://example.com/${i}`));
  assert.equal(stack.length, MAX_CLOSED_TABS);
  assert.equal(stack[0].url, `https://example.com/${MAX_CLOSED_TABS + 3}`);
  const unchanged = pushClosedTab(stack, { ...tab(), container: { ...jar, burner: true } });
  assert.deepEqual(unchanged, stack);
});
