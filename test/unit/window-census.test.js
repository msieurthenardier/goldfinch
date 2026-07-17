'use strict';

// Unit tests for src/main/window-census.js (M09 F7 DD2).
//
// Electron-free: window-census.js is duck-typed over the registry's records exactly
// as window-registry.js is, so these run under plain `node --test` with fakes and no
// Electron stub. main.js is unit-test-exempt (Electron-bound) — extracting the row
// builder is what makes DD2 provable at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildWindowCensus } = require('../../src/main/window-census');

/** A manager fake exposing ONLY the two members DD2 reads: isVisible() + getView(). */
const mgr = (wcId, visible, { destroyed = false, viewNull = false } = {}) => ({
  isVisible: () => visible,
  getView: () => (viewNull ? null : { webContents: { id: wcId, isDestroyed: () => destroyed } }),
});

/** A registry record fake. */
const rec = ({ id, chromeWcId = id * 10, booted = true, activeTabWcId = null, sheet = null, findOverlay = null } = {}) => ({
  win: { id },
  chromeView: { webContents: { id: chromeWcId } },
  tabViews: new Map(),
  activeTabWcId,
  bootConfigServed: booted,
  sheet,
  findOverlay,
});

test('window-census: one record → one row carrying every AC5 field', () => {
  const r = rec({ id: 1, chromeWcId: 11, booted: true, activeTabWcId: 55, sheet: mgr(77, true), findOverlay: mgr(88, false) });
  const [row] = buildWindowCensus([r], r);
  assert.deepEqual(row, {
    windowId: 1,
    chromeWcId: 11,
    booted: true,
    activeTabWcId: 55,
    lastFocused: true,
    sheetVisible: true,
    findVisible: false,
    sheetWcId: 77,
    findWcId: 88,
  });
});

test('window-census: two records → INSERTION ORDER preserved', () => {
  const a = rec({ id: 1 });
  const b = rec({ id: 2 });
  assert.deepEqual(buildWindowCensus([a, b], a).map((r) => r.windowId), [1, 2]);
  // The census does not sort — a later-created window stays later.
  assert.deepEqual(buildWindowCensus([b, a], a).map((r) => r.windowId), [2, 1]);
});

test('window-census: booted mirrors bootConfigServed BOTH ways', () => {
  const midBoot = rec({ id: 1, booted: false });
  const booted = rec({ id: 2, booted: true });
  const rows = buildWindowCensus([midBoot, booted], booted);
  assert.equal(rows[0].booted, false);
  assert.equal(rows[1].booted, true);
});

test('window-census: sheet:null / findOverlay:null (leg 1 AC8b close-path state) → no throw, visible false, ids ABSENT', () => {
  // Leg 1 nulls both slots in the window's `close` handler while the record stays
  // reachable until registry.remove() at `closed` — so both CAN be null on a LIVE record.
  const r = rec({ id: 1, sheet: null, findOverlay: null });
  const [row] = buildWindowCensus([r], r);
  assert.equal(row.sheetVisible, false);
  assert.equal(row.findVisible, false);
  assert.equal('sheetWcId' in row, false);
  assert.equal('findWcId' in row, false);
});

test('window-census: a manager whose getView() returns null (lazy — never shown) → id ABSENT, not null', () => {
  // "ABSENT ⇒ never created" is DD2's stated contract and leg 4's two-menus variant
  // reads it. A future "normalize to null" refactor must fail HERE, loudly: a caller
  // must be able to tell "no sheet has ever existed" from "the sheet exists, hidden".
  const r = rec({ id: 1, sheet: mgr(77, false, { viewNull: true }) });
  const [row] = buildWindowCensus([r], r);
  assert.equal('sheetWcId' in row, false);
  assert.notEqual(row.sheetWcId, null); // undefined, and the KEY is not present at all
});

test('window-census: a manager whose view webContents isDestroyed() → id absent, no throw', () => {
  const r = rec({ id: 1, sheet: mgr(77, false, { destroyed: true }) });
  const [row] = buildWindowCensus([r], r);
  assert.equal('sheetWcId' in row, false);
});

test('window-census: sheetVisible TRUE with sheetWcId present, and FALSE with the id STILL present (instantiated-but-hidden)', () => {
  // The distinction the separate field exists for. A present id conflates "visible"
  // with "instantiated but hidden"; without this, leg 4's two-menus variant has no
  // observable at all.
  const shown = rec({ id: 1, sheet: mgr(77, true) });
  const hidden = rec({ id: 2, sheet: mgr(88, false) });
  const rows = buildWindowCensus([shown, hidden], shown);
  assert.equal(rows[0].sheetVisible, true);
  assert.equal(rows[0].sheetWcId, 77);
  assert.equal(rows[1].sheetVisible, false);
  assert.equal(rows[1].sheetWcId, 88); // present — hidden is NOT "never created"
});

test('window-census: TWO windows can report sheetVisible true simultaneously (the roaming singleton is retired)', () => {
  const a = rec({ id: 1, sheet: mgr(77, true) });
  const b = rec({ id: 2, sheet: mgr(88, true) });
  const rows = buildWindowCensus([a, b], a);
  assert.deepEqual(rows.map((r) => r.sheetVisible), [true, true]);
  assert.notEqual(rows[0].sheetWcId, rows[1].sheetWcId); // two DISTINCT sheets
});

test('window-census: lastFocused is true for EXACTLY one row', () => {
  const a = rec({ id: 1 });
  const b = rec({ id: 2 });
  const c = rec({ id: 3 });
  const rows = buildWindowCensus([a, b, c], b);
  assert.deepEqual(rows.map((r) => r.lastFocused), [false, true, false]);
});

test('window-census: ZERO rows are lastFocused when the record matches none — the census NEVER invents a fallback', () => {
  // The membership-validated first-record fallback is the REGISTRY's
  // (getLastFocused, window-registry.js:130-135), not the census's. If the census
  // invented one, a stale/absent focus record would silently read as a real focus claim.
  const a = rec({ id: 1 });
  const b = rec({ id: 2 });
  const stranger = rec({ id: 99 });
  assert.deepEqual(buildWindowCensus([a, b], stranger).map((r) => r.lastFocused), [false, false]);
  assert.deepEqual(buildWindowCensus([a, b], null).map((r) => r.lastFocused), [false, false]);
  assert.deepEqual(buildWindowCensus([a, b], undefined).map((r) => r.lastFocused), [false, false]);
});

test('window-census: lastFocused compares by IDENTITY, not by window id', () => {
  // A same-id-but-different-object record must not read as focused: identity is the
  // contract (main.js passes registry.getLastFocused()'s actual record).
  const a = rec({ id: 1 });
  const twin = rec({ id: 1 });
  assert.deepEqual(buildWindowCensus([a], twin).map((r) => r.lastFocused), [false]);
});

test('window-census: ZERO NEW STATE — mutating a record between two calls is reflected in the second', () => {
  // The strongest argument for the op, so it is pinned: nothing is cached, there is
  // no rebuild trigger, and there is nothing to invalidate. A future memoization
  // must fail HERE.
  const r = rec({ id: 1, booted: false, activeTabWcId: null, sheet: null });
  const first = buildWindowCensus([r], r);
  assert.equal(first[0].booted, false);
  assert.equal(first[0].activeTabWcId, null);
  assert.equal('sheetWcId' in first[0], false);

  r.bootConfigServed = true;
  r.activeTabWcId = 42;
  r.sheet = mgr(77, true);

  const second = buildWindowCensus([r], r);
  assert.equal(second[0].booted, true);
  assert.equal(second[0].activeTabWcId, 42);
  assert.equal(second[0].sheetWcId, 77);
  assert.equal(second[0].sheetVisible, true);
});

test('window-census: activeTabWcId null-normalizes (undefined → null), unlike the lazy overlay ids', () => {
  // activeTabWcId is ALWAYS present on the row: "no active tab" is a real state of an
  // existing window, not a "never created" one. Contrast sheetWcId/findWcId.
  const r = rec({ id: 1, activeTabWcId: undefined });
  const [row] = buildWindowCensus([r], r);
  assert.equal(row.activeTabWcId, null);
  assert.equal('activeTabWcId' in row, true);
});

test('window-census: empty / null records → empty array', () => {
  assert.deepEqual(buildWindowCensus([], null), []);
  assert.deepEqual(buildWindowCensus(null, null), []);
  assert.deepEqual(buildWindowCensus(undefined, undefined), []);
});

test('window-census: a manager whose isVisible() throws → visible false, no throw (mid-teardown tolerance)', () => {
  const r = rec({ id: 1 });
  r.sheet = { isVisible: () => { throw new Error('destroyed'); }, getView: () => null };
  const [row] = buildWindowCensus([r], r);
  assert.equal(row.sheetVisible, false);
});
