'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWindowRegistry } = require('../../src/main/window-registry');

// ---------------------------------------------------------------------------
// Fakes: the registry only reads win.id and compares chromeView.webContents by
// identity, so minimal objects suffice (Electron-free by design).
// ---------------------------------------------------------------------------

let nextId = 1;
function makeWin() {
  return { id: nextId++ };
}
function makeChromeView() {
  return { webContents: { id: nextId++ } };
}
function makeRegistryWith(n) {
  const registry = createWindowRegistry();
  const recs = [];
  for (let i = 0; i < n; i++) {
    recs.push(registry.create({ win: makeWin(), chromeView: makeChromeView() }));
  }
  return { registry, recs };
}

// --- record shape + create/get/remove/iterate --------------------------------

test('create returns a record with the DD2 shape and registers it', () => {
  const registry = createWindowRegistry();
  const win = makeWin();
  const chromeView = makeChromeView();
  const rec = registry.create({ win, chromeView });

  assert.equal(rec.win, win);
  assert.equal(rec.chromeView, chromeView);
  assert.ok(rec.tabViews instanceof Map);
  assert.equal(rec.tabViews.size, 0);
  assert.equal(rec.activeTabWcId, null);
  assert.equal(registry.get(win.id), rec);
  assert.equal(registry.size(), 1);
});

// M09 F6 Leg 4 (DD5 create-chain + review H1): boot-tab suppression is a flag on
// the registry record, set at create — never a renderer guess — and the record
// carries the H1 readiness-barrier state (bootConfigServed + the pending-send
// thunk queue) that main.js drains when window-boot-config is served.
test('create defaults noBootTab false and seeds the H1 barrier fields', () => {
  const registry = createWindowRegistry();
  const rec = registry.create({ win: makeWin(), chromeView: makeChromeView() });
  assert.equal(rec.noBootTab, false);
  assert.equal(rec.bootConfigServed, false);
  assert.deepEqual(rec.pendingChromeSends, []);
});

test('create({ noBootTab: true }) records the suppression flag (move-created windows)', () => {
  const registry = createWindowRegistry();
  const rec = registry.create({ win: makeWin(), chromeView: makeChromeView(), noBootTab: true });
  assert.equal(rec.noBootTab, true);
  assert.equal(rec.bootConfigServed, false);
});

test('get returns null for an unknown id; remove deletes the record', () => {
  const { registry, recs } = makeRegistryWith(2);
  assert.equal(registry.get(999999), null);
  registry.remove(recs[0].win.id);
  assert.equal(registry.get(recs[0].win.id), null);
  assert.equal(registry.size(), 1);
  assert.deepEqual(registry.records(), [recs[1]]);
});

test('records() iterates in insertion order', () => {
  const { registry, recs } = makeRegistryWith(3);
  assert.deepEqual(registry.records(), recs);
});

// --- reverse lookups ----------------------------------------------------------

test('getWindowForChrome resolves by webContents identity, not shape', () => {
  const { registry, recs } = makeRegistryWith(2);
  assert.equal(registry.getWindowForChrome(recs[0].chromeView.webContents), recs[0]);
  assert.equal(registry.getWindowForChrome(recs[1].chromeView.webContents), recs[1]);
  // A structurally-identical but distinct object never matches (identity compare).
  assert.equal(registry.getWindowForChrome({ id: recs[0].chromeView.webContents.id }), null);
  assert.equal(registry.getWindowForChrome(null), null);
});

test('getWindowForGuest / getChromeForTab resolve the owning record across windows', () => {
  const { registry, recs } = makeRegistryWith(2);
  recs[0].tabViews.set(101, { view: {} });
  recs[1].tabViews.set(202, { view: {} });

  assert.equal(registry.getWindowForGuest(101), recs[0]);
  assert.equal(registry.getWindowForGuest(202), recs[1]);
  assert.equal(registry.getWindowForGuest(303), null);
  assert.equal(registry.getWindowForGuest(null), null);
  assert.equal(registry.getWindowForGuest(undefined), null);

  assert.equal(registry.getChromeForTab(101), recs[0].chromeView.webContents);
  assert.equal(registry.getChromeForTab(202), recs[1].chromeView.webContents);
  assert.equal(registry.getChromeForTab(303), null);
});

test('getChromeForTab resolves at call time — a moved tab re-binds automatically', () => {
  // DD5's adopt re-bind premise: event-time resolution means moving the tabViews
  // entry between records re-routes the next send with no re-wiring.
  const { registry, recs } = makeRegistryWith(2);
  const entry = { view: {} };
  recs[0].tabViews.set(101, entry);
  assert.equal(registry.getChromeForTab(101), recs[0].chromeView.webContents);

  recs[0].tabViews.delete(101);
  recs[1].tabViews.set(101, entry);
  assert.equal(registry.getChromeForTab(101), recs[1].chromeView.webContents);
});

test('isTabViewWcId is all-windows membership; isChromeContents is any-registered-chrome', () => {
  const { registry, recs } = makeRegistryWith(2);
  recs[0].tabViews.set(101, { view: {} });
  recs[1].tabViews.set(202, { view: {} });

  assert.equal(registry.isTabViewWcId(101), true);
  assert.equal(registry.isTabViewWcId(202), true);
  assert.equal(registry.isTabViewWcId(303), false);

  assert.equal(registry.isChromeContents(recs[0].chromeView.webContents), true);
  assert.equal(registry.isChromeContents(recs[1].chromeView.webContents), true);
  assert.equal(registry.isChromeContents({ id: -1 }), false);
  assert.equal(registry.isChromeContents(null), false);
});

// --- last-focused tracking (DD8) ----------------------------------------------

test('last-focused seeds at create — the newest window wins with no focus event', () => {
  const { registry, recs } = makeRegistryWith(2);
  // No noteFocus calls at all (WSLg: programmatic focus fires no event) — the
  // seed at create makes the second window the accessor target.
  assert.equal(registry.getLastFocused(), recs[1]);
});

test('noteFocus is latest-event-wins (idle focus/blur flapping tolerated)', () => {
  const { registry, recs } = makeRegistryWith(2);
  registry.noteFocus(recs[0].win.id);
  assert.equal(registry.getLastFocused(), recs[0]);
  registry.noteFocus(recs[1].win.id);
  registry.noteFocus(recs[0].win.id);
  registry.noteFocus(recs[1].win.id);
  assert.equal(registry.getLastFocused(), recs[1]);
});

test('noteFocus ignores unregistered ids', () => {
  const { registry, recs } = makeRegistryWith(1);
  registry.noteFocus(999999);
  assert.equal(registry.getLastFocused(), recs[0]);
});

test('getLastFocused is membership-validated: a removed last-focused falls back to the first record', () => {
  const { registry, recs } = makeRegistryWith(3);
  registry.noteFocus(recs[2].win.id);
  registry.remove(recs[2].win.id);
  // Stale id → first record in insertion order (pass-2 L-c).
  assert.equal(registry.getLastFocused(), recs[0]);
});

test('getLastFocused returns null when no windows exist', () => {
  const { registry, recs } = makeRegistryWith(1);
  registry.remove(recs[0].win.id);
  assert.equal(registry.getLastFocused(), null);
  assert.equal(registry.size(), 0);
});

test('a re-created window (same flow as app activate) re-seeds last-focused', () => {
  const { registry, recs } = makeRegistryWith(1);
  registry.remove(recs[0].win.id);
  const rec2 = registry.create({ win: makeWin(), chromeView: makeChromeView() });
  assert.equal(registry.getLastFocused(), rec2);
});
