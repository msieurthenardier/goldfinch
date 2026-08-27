'use strict';

// Unit tests for src/main/session-snapshot.js (M09 Flight 9, Leg 2, DD2 / AC3-AC4) —
// the pure builder that turns live window records into the on-disk session manifest.
// Electron-free: webContents handles are minimal fakes (getURL / isDestroyed).
//
// The AC4 matrix pins burner exclusion + the active-source BOTH directions: a burner
// tab produces 0 records and a persist-jar tab produces 1 on the real predicate;
// flipping a burner's partition to a registered jar flips the count; a trusted tab is
// dropped despite a resolving partition; an empty jars list drops every window (the
// purest positive-allowlist pin); active derives from activeTabWcId, so a filtered
// active burner leaves nothing active.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSessionSnapshot } = require('../../src/main/session-snapshot');

const JARS = [
  { id: 'work', partition: 'persist:jar-work' },
  { id: 'play', partition: 'persist:jar-play' }
];

function makeWc({ url = 'https://example.com/', destroyed = false } = {}) {
  return { isDestroyed: () => destroyed, getURL: () => url };
}

function makeEntry({ partition = 'persist:jar-work', trusted = false, wc = makeWc() } = {}) {
  return { view: { webContents: wc }, partition, trusted, active: false };
}

// A window record: tabViews is a Map<wcId, entry> (insertion order) + activeTabWcId.
function makeWindow(entries, activeTabWcId = null) {
  const tabViews = new Map();
  for (const [wcId, entry] of entries) tabViews.set(wcId, entry);
  return { tabViews, activeTabWcId };
}

// --- burner exclusion, both directions ---------------------------------------

test('one persist-jar tab + one burner tab → exactly one (persist) surviving tab (reading 1)', () => {
  const win = makeWindow([
    [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://kept.example/' }) })],
    [2, makeEntry({ partition: 'burner:1', wc: makeWc({ url: 'https://burner.example/' }) })]
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.equal(out.windows[0].tabs.length, 1);
  assert.equal(out.windows[0].tabs[0].url, 'https://kept.example/');
  assert.equal(out.windows[0].tabs[0].jarId, 'work');
});

test('flipping the burner tab to a registered partition → two surviving tabs (reading 2)', () => {
  const win = makeWindow([
    [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://a.example/' }) })],
    [2, makeEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://b.example/' }) })]
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.deepEqual(
    out.windows[0].tabs.map((t) => t.jarId),
    ['work', 'play']
  );
});

test('flipping the persist tab to trusted:true → dropped despite a resolving partition', () => {
  const win = makeWindow([[1, makeEntry({ partition: 'persist:jar-work', trusted: true })]]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.deepEqual(out, { version: 1, windows: [] });
});

// --- destroyed webContents ----------------------------------------------------

test('a persist-jar tab whose webContents isDestroyed() is skipped; a valid sibling is kept', () => {
  const win = makeWindow([
    [1, makeEntry({ wc: makeWc({ url: 'https://gone.example/', destroyed: true }) })],
    [2, makeEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://alive.example/' }) })]
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.deepEqual(
    out.windows[0].tabs.map((t) => t.url),
    ['https://alive.example/']
  );
});

test('a window whose only tab is destroyed is dropped', () => {
  const win = makeWindow([[1, makeEntry({ wc: makeWc({ destroyed: true }) })]]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.deepEqual(out, { version: 1, windows: [] });
});

// --- empty jarsList: the purest positive-allowlist pin ------------------------

test('empty jarsList → every window dropped → { version:1, windows:[] } (no keep-fallback)', () => {
  const win = makeWindow([
    [1, makeEntry({ partition: 'persist:jar-work' })],
    [2, makeEntry({ partition: 'persist:jar-play' })]
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: [] });
  assert.deepEqual(out, { version: 1, windows: [] });
});

// --- active derives from activeTabWcId, not entry.active ----------------------

test('activeTabWcId === null → no surviving tab marked active', () => {
  const win = makeWindow(
    [
      [1, makeEntry({ wc: makeWc({ url: 'https://a.example/' }) })],
      [2, makeEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://b.example/' }) })]
    ],
    null
  );
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(
    out.windows[0].tabs.some((t) => t.active),
    false
  );
});

test('the active tab is a filtered burner → no surviving tab marked active', () => {
  // wcId 2 is the active tab, but it is a burner that gets filtered out. The kept
  // persist tab (wcId 1) is NOT active — active must derive from activeTabWcId, and
  // wcId 1 !== 2, so this is the exact case that makes wcId===activeTabWcId correct
  // over entry.active (were entry.active read, wcId 1's flag would decide instead).
  const win = makeWindow(
    [
      [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://kept.example/' }) })],
      [2, makeEntry({ partition: 'burner:1', wc: makeWc({ url: 'https://burner.example/' }) })]
    ],
    2
  );
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.equal(out.windows[0].tabs.length, 1);
  assert.equal(out.windows[0].tabs[0].active, false);
});

test('the active tab survives → it is the one marked active', () => {
  const win = makeWindow(
    [
      [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://a.example/' }) })],
      [2, makeEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://b.example/' }) })]
    ],
    2
  );
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.deepEqual(
    out.windows[0].tabs.map((t) => t.active),
    [false, true]
  );
});

// --- multi-window drop --------------------------------------------------------

test('two windows, one all-burner (dropped) and one with persist tabs → exactly one window out', () => {
  const allBurner = makeWindow([
    [1, makeEntry({ partition: 'burner:1' })],
    [2, makeEntry({ partition: 'burner:2' })]
  ]);
  const persist = makeWindow([
    [3, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://survivor.example/' }) })]
  ]);
  const out = buildSessionSnapshot({ windows: [allBurner, persist], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.deepEqual(
    out.windows[0].tabs.map((t) => t.url),
    ['https://survivor.example/']
  );
});

// --- version + jarId identity -------------------------------------------------

// --- welcome record exclusion (M16 F2 Leg 1, DD9) — structural, not a new rule ---

// A viewless welcome record never calls tab-create, so main's `tabViews` (this
// module's ONLY input) never gains an entry for it in the first place — there
// is nothing for buildSessionSnapshot to filter. Pinned here by constructing a
// tabViews Map with one fewer entry than the renderer's strip would show (the
// "missing" second tab standing in for the welcome record) and asserting the
// snapshot simply reflects what tabViews actually holds.
test('a window whose strip has an extra (welcome) tab absent from tabViews snapshots only the real entries', () => {
  const win = makeWindow([
    [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://kept.example/' }) })]
    // wcId 2 would be the welcome tab's slot in the renderer's strip — it has
    // no tab-create IPC and therefore no tabViews entry at all, unlike every
    // case above (which all explicitly filter an EXISTING entry).
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.windows.length, 1);
  assert.equal(out.windows[0].tabs.length, 1);
  assert.equal(out.windows[0].tabs[0].url, 'https://kept.example/');
});

test('stamps version:1 and emits jarId === jar.id (the resolved id, not the partition string)', () => {
  const win = makeWindow([
    [1, makeEntry({ partition: 'persist:jar-work', wc: makeWc({ url: 'https://a.example/' }) })]
  ]);
  const out = buildSessionSnapshot({ windows: [win], jarsList: JARS });
  assert.equal(out.version, 1);
  assert.equal(out.windows[0].tabs[0].jarId, 'work');
  assert.notEqual(out.windows[0].tabs[0].jarId, 'persist:jar-work');
});
