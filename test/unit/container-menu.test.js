'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildContainerModel } = require('../../src/shared/container-menu');

// slug() is not exported; jars.add exercises it — used below to pin the collision
// premise (slug('New Container') === 'new-container') against the real product code.
// No electron-stub needed: jars.js is Electron-free (M06 Flight 1, Leg 1), and add()
// before load() deliberately never persists (storePath stays null).
const jars = require('../../src/main/jars');

// Source-of-truth pin (M06 Flight 2 Leg 1, DD8): the sentinel's color/name derive
// from the shared BURNER constant, not a duplicated literal.
const { BURNER } = require('../../src/shared/burner');

const DEFAULT = { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' };

// ---------------------------------------------------------------------------
// Shape: jar items (namespaced) + Burner + "+ New container…" + "Manage jars…"
// sentinels, in order
// ---------------------------------------------------------------------------
test('model = namespaced jar items + burner + new-container + manage-jars sentinels', () => {
  const model = buildContainerModel([DEFAULT, { id: 'work', name: 'Work', color: '#2196f3' }]);
  assert.deepEqual(model, [
    { id: 'jar:default', label: 'Default', color: '#9aa0ac' },
    { id: 'jar:work', label: 'Work', color: '#2196f3' },
    { id: 'action:burner', label: `${BURNER.name} tab (evaporates)`, color: BURNER.color },
    { id: 'action:new-container', label: '+ New container…', variant: 'add' },
    { id: 'action:manage-jars', label: 'Manage jars…' }
  ]);
});

// M06 Flight 3 Leg 3 (chrome entry integration): the picker gains a
// "Manage jars…" sentinel AFTER the quick-create row (quick-create stays — operator
// ruling). Pin its position, label, and variant explicitly.
test('manage-jars sentinel follows new-container, with a pinned label and no variant', () => {
  const model = buildContainerModel([DEFAULT]);
  const newContainerIdx = model.findIndex((m) => m.id === 'action:new-container');
  const manageJarsIdx = model.findIndex((m) => m.id === 'action:manage-jars');
  assert.ok(newContainerIdx >= 0 && manageJarsIdx === newContainerIdx + 1, 'manage-jars immediately follows new-container');
  assert.equal(model[manageJarsIdx].label, 'Manage jars…');
  assert.equal(model[manageJarsIdx].variant, undefined);
  assert.equal(model[manageJarsIdx].color, undefined);
});

test('burner sentinel color/label are pinned to the shared BURNER constant', () => {
  const model = buildContainerModel([]);
  const sentinel = model.find((m) => m.id === 'action:burner');
  assert.equal(sentinel.color, BURNER.color);
  assert.equal(sentinel.label, `${BURNER.name} tab (evaporates)`);
});

test('empty container list still yields the three sentinels', () => {
  const model = buildContainerModel([]);
  assert.equal(model.length, 3);
  assert.equal(model[0].id, 'action:burner');
  assert.equal(model[1].id, 'action:new-container');
  assert.equal(model[2].id, 'action:manage-jars');
});

test('malformed entries are skipped; missing color/name degrade to data-safe values', () => {
  const model = buildContainerModel(
    /** @type {any} */ ([null, { name: 'no-id' }, { id: 'x' }, { id: 'y', name: 'Y', color: 42 }])
  );
  assert.deepEqual(model[0], { id: 'jar:x', label: 'x' }); // no name → id as label; no color key
  assert.deepEqual(model[1], { id: 'jar:y', label: 'Y' }); // non-string color dropped (sheet renders default dot)
  assert.equal(model.length, 5); // 2 kept + 3 sentinels
});

// ---------------------------------------------------------------------------
// Sentinel-id collision (round-2 review catch): a jar literally named
// "New Container" gets id `new-container` from jars.slug — the namespaced model id
// `jar:new-container` must stay distinct from the sentinel `action:new-container`
// so channel-6 prefix dispatch opens a tab in THAT jar, not the dialog.
// ---------------------------------------------------------------------------
test("jar named 'New Container' collides with the sentinel id — namespacing keeps them distinct", () => {
  const created = jars.add('New Container');
  assert.equal(created.id, 'new-container'); // the collision premise, pinned on real slug()

  const model = buildContainerModel([created]);
  const jarItem = model.find((m) => m.id === 'jar:new-container');
  const sentinel = model.find((m) => m.id === 'action:new-container');
  assert.ok(jarItem, 'jar item present under the jar: prefix');
  assert.ok(sentinel, 'sentinel still present under the action: prefix');
  assert.notEqual(jarItem.id, sentinel.id);
  assert.equal(jarItem.label, 'New Container');
});

// Flipped for the DD4 reserved namespace (M06 Flight 1, Leg 1): minting a jar named
// "Burner" no longer yields id `burner` — slug() remaps out of the reserved
// `burner`/`burner-*` namespace at mint time (prefix `jar-`).
test("minting a jar named 'Burner' remaps to id jar-burner (reserved namespace)", () => {
  const created = jars.add('Burner');
  assert.equal(created.id, 'jar-burner'); // the DD4 mint remap, pinned on real slug()
  assert.equal(created.name, 'Burner', 'display name untouched by the remap');
  const model = buildContainerModel([created]);
  assert.ok(model.some((m) => m.id === 'jar:jar-burner'));
  assert.ok(model.some((m) => m.id === 'action:burner'));
});

// The original picker-tolerance premise, re-pinned with a HAND-BUILT jar object:
// the namespaced model ids were designed to tolerate a literal `burner`-id jar
// (e.g. from a legacy profile) rendering distinctly from the burner sentinel —
// that tolerance must survive even though add() can no longer mint the id.
test("a literal burner-id jar (hand-built) still renders distinct from action:burner", () => {
  const model = buildContainerModel([
    { id: 'burner', name: 'Burner', color: '#ff8c42', partition: 'persist:container:burner' }
  ]);
  const jarItem = model.find((m) => m.id === 'jar:burner');
  const sentinel = model.find((m) => m.id === 'action:burner');
  assert.ok(jarItem, 'jar item present under the jar: prefix');
  assert.ok(sentinel, 'sentinel still present under the action: prefix');
  assert.notEqual(jarItem.id, sentinel.id);
});
