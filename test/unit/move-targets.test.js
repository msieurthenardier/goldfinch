'use strict';

// Unit tests for src/main/move-targets.js (M09 F8 DD8).
//
// Electron-free: move-targets.js is duck-typed over the registry's records exactly
// as window-census.js is, so these run under plain `node --test` with fakes and no
// Electron stub. main.js is unit-test-exempt (Electron-bound) — and that is not a
// footnote here, it is WHY this module exists. AC3 asks for a reading taken by
// mutating the registry BETWEEN the menu build and the dispatch; main.js is never
// executed by any test (only read as text, by the synchrony pin), so a builder
// living there could not have been mutated, called, or read at all. Extracting it
// is what makes AC3 expressible rather than assertable-by-inspection.
//
// The registry below is the REAL createWindowRegistry, not a fake of one: AC3's
// claim is about insertion order and id resolution, which are the registry's own
// behavior, and faking them would be proving the fake.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildMoveTargets, FALLBACK_LABEL } = require('../../src/main/move-targets');
const { createWindowRegistry } = require('../../src/main/window-registry');

// ---------------------------------------------------------------------------
// Fakes: the builder reads win.id, activeTabWcId, and the active entry's live
// webContents.getTitle(). Nothing else.
// ---------------------------------------------------------------------------

let nextId = 1;

/** A tab entry as main.js builds it: { view, partition, trusted, active } — NO title. */
const entry = (title, { destroyed = false, noTitleFn = false } = {}) => ({
  view: {
    webContents: {
      id: nextId++,
      isDestroyed: () => destroyed,
      ...(noTitleFn ? {} : { getTitle: () => title }),
    },
  },
  partition: 'persist:jar',
  trusted: false,
  active: true,
});

/**
 * Register a window whose active tab has `title`. Returns the live record.
 * @param {ReturnType<typeof createWindowRegistry>} registry
 */
function addWindow(registry, title, opts = {}) {
  const rec = registry.create({ win: { id: nextId++ }, chromeView: { webContents: { id: nextId++ } } });
  if (title === null) return rec; // a window with no active tab
  const wcId = nextId++;
  rec.tabViews.set(wcId, entry(title, opts));
  rec.activeTabWcId = wcId;
  return rec;
}

// --- AC1: the count is driven by the window count ---------------------------

test('AC1 — ONE window: zero targets (a tab is never offered a move to its own window)', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'GitHub');
  assert.deepEqual(buildMoveTargets(registry.records(), a), []);
});

test('AC1 — THREE windows: TWO targets, the source excluded, captioned from active tab titles', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'GitHub');
  const c = addWindow(registry, 'Wikipedia');
  assert.deepEqual(buildMoveTargets(registry.records(), a), [
    { windowId: b.win.id, label: 'GitHub' },
    { windowId: c.win.id, label: 'Wikipedia' },
  ]);
  // And the exclusion is of the SOURCE, not of "the first record": asked from B,
  // the list is A and C. A builder that dropped records[0] would agree with the
  // reading above and disagree here.
  assert.deepEqual(buildMoveTargets(registry.records(), b), [
    { windowId: a.win.id, label: 'Source' },
    { windowId: c.win.id, label: 'Wikipedia' },
  ]);
});

test('AC1 — the count TRACKS the registry: 0 → 2 → 1 as windows come and go', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  assert.equal(buildMoveTargets(registry.records(), a).length, 0);
  const b = addWindow(registry, 'B');
  const c = addWindow(registry, 'C');
  assert.equal(buildMoveTargets(registry.records(), a).length, 2);
  registry.remove(b.win.id);
  assert.equal(buildMoveTargets(registry.records(), a).length, 1);
  assert.equal(buildMoveTargets(registry.records(), a)[0].windowId, c.win.id);
});

// --- AC3: keyed by windowId, NOT by ordinal ---------------------------------

test('AC3 — mutating the registry between BUILD and DISPATCH still targets the SAME window', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'B');
  const c = addWindow(registry, 'C');

  // BUILD: the menu the user is looking at.
  const built = buildMoveTargets(registry.records(), a);
  assert.deepEqual(built.map((t) => t.windowId), [b.win.id, c.win.id]);
  // The user picks the FIRST item — window B.
  const picked = built[0].windowId;

  // MUTATE between build and dispatch: B closes, so the list the registry would
  // build NOW is shorter and everything after B has shifted up one position.
  registry.remove(b.win.id);

  // DISPATCH, windowId-keyed (what DD8 ships): the id resolves to nothing, so the
  // move REFUSES. It does not silently land in C.
  assert.equal(registry.get(picked), null);

  // DISPATCH, ORDINAL-keyed (the scheme DD8 reversed): resolving "ordinal 0"
  // against a rebuilt list now names C — a DIFFERENT window, moved into silently.
  // Both readings are taken, and they DISAGREE: that disagreement is the entire
  // reason the ordinal scheme was deleted.
  const rebuilt = buildMoveTargets(registry.records(), a);
  assert.equal(rebuilt[0].windowId, c.win.id);
  assert.notEqual(rebuilt[0].windowId, picked);
});

test('AC3 — reordering the records does NOT re-point a built id', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'B');
  const c = addWindow(registry, 'C');
  const picked = buildMoveTargets(registry.records(), a)[0].windowId;
  assert.equal(picked, b.win.id);

  // Insertion order flipped (the shape a close+reopen produces).
  const reordered = [a, c, b];
  assert.equal(buildMoveTargets(reordered, a)[0].windowId, c.win.id, 'ordinal 0 now names C');
  // But the id built into the menu item still resolves to B, through the registry
  // — the authority, not the position.
  assert.equal(registry.get(picked), b);
});

test('AC3 — the source is excluded by RECORD IDENTITY, not by id equality', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'A');
  addWindow(registry, 'B');
  // A record from a DIFFERENT registry that happens to share an id excludes nothing.
  const impostor = { win: { id: a.win.id }, tabViews: new Map(), activeTabWcId: null };
  assert.equal(buildMoveTargets(registry.records(), impostor).length, 2);
  assert.equal(buildMoveTargets(registry.records(), a).length, 1);
});

// --- labels: derived, total, never throwing ---------------------------------

test('the label is the ACTIVE tab title — not the first tab, not a stale one', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'Active');
  const backgroundWcId = nextId++;
  b.tabViews.set(backgroundWcId, entry('Background'));
  assert.deepEqual(buildMoveTargets(registry.records(), a), [{ windowId: b.win.id, label: 'Active' }]);
  // Re-point the active tab: the caption follows it. ZERO STATE — nothing cached.
  b.activeTabWcId = backgroundWcId;
  assert.deepEqual(buildMoveTargets(registry.records(), a), [{ windowId: b.win.id, label: 'Background' }]);
});

test('the label falls back rather than throwing: no active tab, destroyed wc, blank title', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const noActive = addWindow(registry, null);
  const destroyed = addWindow(registry, 'Gone', { destroyed: true });
  const blank = addWindow(registry, '   ');
  const noFn = addWindow(registry, 'x', { noTitleFn: true });
  assert.deepEqual(buildMoveTargets(registry.records(), a).map((t) => t.label), [
    FALLBACK_LABEL, FALLBACK_LABEL, FALLBACK_LABEL, FALLBACK_LABEL,
  ]);
  assert.equal(noActive.activeTabWcId, null);
  assert.ok(destroyed && blank && noFn);
});

test('a stale activeTabWcId whose entry is gone falls back — the last-tab-close shape', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'B');
  b.tabViews.clear(); // the tab closed; activeTabWcId still points at it
  assert.deepEqual(buildMoveTargets(registry.records(), a), [{ windowId: b.win.id, label: FALLBACK_LABEL }]);
});

test('a getTitle that THROWS falls back rather than taking the menu down with it', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'B');
  b.tabViews.get(b.activeTabWcId).view.webContents.getTitle = () => {
    throw new Error('Object has been destroyed');
  };
  assert.deepEqual(buildMoveTargets(registry.records(), a), [{ windowId: b.win.id, label: FALLBACK_LABEL }]);
});

test('a long title is elided — a menu item is not a place for a 200-char <title>', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  addWindow(registry, 'x'.repeat(200));
  const [t] = buildMoveTargets(registry.records(), a);
  assert.equal(t.label.length, 40);
  assert.ok(t.label.endsWith('…'));
  // A title AT the limit is not elided — the boundary is not off by one.
  const registry2 = createWindowRegistry();
  const a2 = addWindow(registry2, 'Source');
  addWindow(registry2, 'y'.repeat(40));
  assert.equal(buildMoveTargets(registry2.records(), a2)[0].label, 'y'.repeat(40));
});

// --- totality ---------------------------------------------------------------

test('null/garbage records are skipped, never emitted as half-rows', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'B');
  assert.deepEqual(buildMoveTargets([null, undefined, {}, ...registry.records()], a), [
    { windowId: b.win.id, label: 'B' },
  ]);
  assert.deepEqual(buildMoveTargets(null, a), []);
  assert.deepEqual(buildMoveTargets(undefined, a), []);
});

test('a null source excludes nothing — every window is a target', () => {
  const registry = createWindowRegistry();
  addWindow(registry, 'A');
  addWindow(registry, 'B');
  assert.equal(buildMoveTargets(registry.records(), null).length, 2);
});

test('ZERO STATE: two calls either side of a mutation disagree — nothing is cached', () => {
  const registry = createWindowRegistry();
  const a = addWindow(registry, 'Source');
  const b = addWindow(registry, 'Before');
  assert.equal(buildMoveTargets(registry.records(), a)[0].label, 'Before');
  b.tabViews.get(b.activeTabWcId).view.webContents.getTitle = () => 'After';
  assert.equal(buildMoveTargets(registry.records(), a)[0].label, 'After');
});
