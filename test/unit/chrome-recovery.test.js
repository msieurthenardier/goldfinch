'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createChromeRecovery, adoptInputFor } = require('../../src/main/chrome-recovery');
const { buildAdoptPayload } = require('../../src/main/move-tab-payload');
const { INTERNAL_PARTITION } = require('../../src/shared/internal-page');

function makeWc({ url = 'https://example.com/', title = '', destroyed = false } = {}) {
  return {
    getURL: () => url,
    getTitle: () => title,
    isDestroyed: () => destroyed,
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false
    }
  };
}

function makeEntry(overrides = {}) {
  return {
    view: { webContents: makeWc(overrides.wc || {}) },
    partition: 'persist:container:work',
    trusted: false,
    lastRequestedUrl: null,
    loadFailure: null,
    security: null,
    crash: null,
    hung: false,
    ...overrides
  };
}

function makeRecord(tabViewsEntries = [], activeTabWcId = null) {
  return {
    tabViews: new Map(tabViewsEntries),
    activeTabWcId,
    restoreTabs: null,
    bootConfigServed: true
  };
}

function makeHooks(overrides = {}) {
  const calls = [];
  return {
    calls,
    hooks: {
      windowId: 7,
      closeSheet: (r) => calls.push(['closeSheet', r]),
      hideFind: () => calls.push(['hideFind']),
      hideTearoff: () => calls.push(['hideTearoff']),
      reload: () => calls.push(['reload']),
      setTitle: (t) => calls.push(['setTitle', t]),
      onCrash: (e) => calls.push(['onCrash', e]),
      ...overrides
    }
  };
}

// ---------------------------------------------------------------------------
// onChromeGone
// ---------------------------------------------------------------------------

test('clean-exit is ignored: no record mutation, no hooks called', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const record = makeRecord();
  const { hooks, calls } = makeHooks();
  const outcome = recovery.onChromeGone(record, { reason: 'clean-exit', exitCode: 0 }, hooks);
  assert.equal(outcome, 'ignored');
  assert.deepEqual(calls, []);
  assert.equal(record.chromeCrashTimes, undefined);
});

test('a crash reloads: closes sheet, hides find/tearoff, resets bootConfigServed, sets recoverTabs, records reloaded, calls reload — in order', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const record = makeRecord();
  const { hooks, calls } = makeHooks();
  const outcome = recovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
  assert.equal(outcome, 'reloaded');
  assert.equal(record.bootConfigServed, false);
  assert.equal(record.recoverTabs, true);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['closeSheet', 'hideFind', 'hideTearoff', 'reload', 'onCrash']
  );
  assert.equal(calls[0][1], 'teardown');
  const crashCall = calls.find((c) => c[0] === 'onCrash')[1];
  assert.deepEqual(crashCall, {
    kind: 'chrome',
    reason: 'crashed',
    exitCode: 139,
    url: null,
    partition: null,
    windowId: 7,
    recovery: 'reloaded'
  });
});

test('restoreTabs is left INTACT across a crash reload (never nulled)', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const record = makeRecord();
  record.restoreTabs = [{ url: 'https://a.example/' }];
  const { hooks } = makeHooks();
  recovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
  assert.deepEqual(record.restoreTabs, [{ url: 'https://a.example/' }]);
});

test('a reload() that throws records "ignored" and does not crash main', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const record = makeRecord();
  const { hooks, calls } = makeHooks({
    reload: () => {
      throw new Error('destroyed');
    }
  });
  const outcome = recovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
  assert.equal(outcome, 'ignored');
  const crashCall = calls.find((c) => c[0] === 'onCrash')[1];
  assert.equal(crashCall.recovery, 'ignored');
});

test('the fourth crash within 60s pauses: no reload, title set, recorded paused', () => {
  const recovery = createChromeRecovery({ now: () => 1000, windowMs: 60_000, maxReloads: 3 });
  const record = makeRecord();
  let t = 0;
  const times = [0, 10_000, 20_000, 30_000];
  const allCalls = [];
  for (const ts of times) {
    t = ts;
    const recoveryWithClock = createChromeRecovery({ now: () => t, windowMs: 60_000, maxReloads: 3 });
    // reuse the SAME record across calls (ring state lives on it) but a fresh
    // recovery instance per call is fine since `now` is the only closure state.
    const { hooks, calls } = makeHooks();
    const outcome = recoveryWithClock.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
    allCalls.push({ ts, outcome, calls });
  }
  assert.deepEqual(
    allCalls.map((c) => c.outcome),
    ['reloaded', 'reloaded', 'reloaded', 'paused']
  );
  assert.equal(record.chromeRecoveryPaused, true);
  const fourth = allCalls[3].calls;
  assert.deepEqual(
    fourth.map((c) => c[0]),
    ['setTitle', 'onCrash']
  );
  assert.equal(fourth[0][1], 'Goldfinch — chrome crashed (recovery paused)');
  assert.equal(fourth[1][1].recovery, 'paused');
  void recovery; // silence unused (kept for symmetry with other tests)
});

test('a crash on an already-paused record is ignored and records ignored (never re-arms)', () => {
  const record = makeRecord();
  record.chromeRecoveryPaused = true;
  const recovery = createChromeRecovery({ now: () => 999999 });
  const { hooks, calls } = makeHooks();
  const outcome = recovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
  assert.equal(outcome, 'ignored');
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['onCrash']
  );
  assert.equal(calls[0][1].recovery, 'ignored');
});

test('crashes older than the window fall out of the ring (a long-later 4th crash still reloads)', () => {
  const record = makeRecord();
  const times = [0, 1000, 2000];
  for (const ts of times) {
    const recovery = createChromeRecovery({ now: () => ts, windowMs: 60_000, maxReloads: 3 });
    recovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, makeHooks().hooks);
  }
  assert.equal(record.chromeCrashTimes.length, 3);
  // A 4th crash well outside the 60s window from the first three.
  const laterRecovery = createChromeRecovery({ now: () => 999_999, windowMs: 60_000, maxReloads: 3 });
  const { hooks } = makeHooks();
  const outcome = laterRecovery.onChromeGone(record, { reason: 'crashed', exitCode: 139 }, hooks);
  assert.equal(outcome, 'reloaded');
  assert.equal(record.chromeCrashTimes.length, 1);
});

test('two windows crash independently — one reload each, separate rings', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const recordA = makeRecord();
  const recordB = makeRecord();
  const outcomeA = recovery.onChromeGone(recordA, { reason: 'crashed', exitCode: 139 }, makeHooks().hooks);
  const outcomeB = recovery.onChromeGone(recordB, { reason: 'crashed', exitCode: 139 }, makeHooks().hooks);
  assert.equal(outcomeA, 'reloaded');
  assert.equal(outcomeB, 'reloaded');
  assert.equal(recordA.chromeCrashTimes.length, 1);
  assert.equal(recordB.chromeCrashTimes.length, 1);
});

// ---------------------------------------------------------------------------
// adoptInputFor — container derivation table
// ---------------------------------------------------------------------------

test('adoptInputFor: internal entry (trusted) derives the id:"internal" container from the page host', () => {
  const entry = makeEntry({
    trusted: true,
    partition: INTERNAL_PARTITION,
    wc: { url: 'goldfinch://settings/#privacy' }
  });
  const c = adoptInputFor(entry, [], { id: 'default', name: 'Default', color: '#000' }, undefined);
  assert.deepEqual(c, { id: 'internal', name: 'settings', color: '#9aa0ac', partition: INTERNAL_PARTITION });
});

test('adoptInputFor: internal by partition identity alone (not .trusted)', () => {
  const entry = makeEntry({
    trusted: false,
    partition: INTERNAL_PARTITION,
    wc: { url: 'goldfinch://jars/' }
  });
  const c = adoptInputFor(entry, [], { id: 'default', name: 'Default', color: '#000' }, undefined);
  assert.equal(c.id, 'internal');
  assert.equal(c.name, 'jars');
});

test('adoptInputFor: burner partition → burner-<n> id, BURNER name/color, burner:true', () => {
  const entry = makeEntry({ partition: 'burner:42' });
  const c = adoptInputFor(entry, [], { id: 'default', name: 'Default', color: '#000' }, undefined);
  assert.equal(c.id, 'burner-42');
  assert.equal(c.partition, 'burner:42');
  assert.equal(c.burner, true);
});

test('adoptInputFor: persistent partition matches the live jars list entry', () => {
  const entry = makeEntry({ partition: 'persist:container:work' });
  const jarsList = [{ id: 'work', name: 'Work', color: '#f00', partition: 'persist:container:work' }];
  const c = adoptInputFor(entry, jarsList, { id: 'default', name: 'Default', color: '#000' }, undefined);
  assert.deepEqual(c, { id: 'work', name: 'Work', color: '#f00', partition: 'persist:container:work' });
});

test('adoptInputFor: a deleted jar falls back to the default jar snapshot', () => {
  const entry = makeEntry({ partition: 'persist:container:gone' });
  const defaultJar = { id: 'default', name: 'Default', color: '#000', partition: 'persist:container:default' };
  const warns = [];
  const c = adoptInputFor(entry, [], defaultJar, { warn: (...a) => warns.push(a) });
  assert.deepEqual(c, { id: 'default', name: 'Default', color: '#000', partition: 'persist:container:default' });
  assert.equal(warns.length, 1);
});

test('adoptInputFor: default jar fallback with no partition (Burner sentinel while default) still returns the entry partition', () => {
  const entry = makeEntry({ partition: 'persist:container:gone' });
  const burnerDefault = { id: 'burner', name: 'Burner', color: '#ff8c42' }; // no partition key
  const c = adoptInputFor(entry, [], burnerDefault, undefined);
  assert.equal(c.partition, 'persist:container:gone');
});

// ---------------------------------------------------------------------------
// buildRecoveryAdopts
// ---------------------------------------------------------------------------

test('buildRecoveryAdopts: one adopt-tab per entry in insertion order, active/trusted flags, then the re-push set', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const entryA = makeEntry({ partition: 'persist:container:work', wc: { url: 'https://a.example/', title: 'A' } });
  const entryB = makeEntry({
    partition: 'persist:container:work',
    trusted: false,
    security: 'secure',
    wc: { url: 'https://b.example/', title: 'B' }
  });
  const record = makeRecord([
    [1, entryA],
    [2, entryB]
  ]);
  record.activeTabWcId = 2;
  const jarsList = [{ id: 'work', name: 'Work', color: '#f00', partition: 'persist:container:work' }];
  const out = recovery.buildRecoveryAdopts(record, {
    jarsList,
    defaultJar: { id: 'work', name: 'Work', color: '#f00', partition: 'persist:container:work' },
    buildAdoptPayload
  });
  const channels = out.map((o) => o[0]);
  // entry 1 (not active): adopt-tab, tab-nav-state; entry 2 (active, has security): adopt-tab, tab-security, tab-nav-state
  assert.deepEqual(channels, ['adopt-tab', 'tab-nav-state', 'adopt-tab', 'tab-security', 'tab-nav-state']);
  const adoptA = out[0][1];
  const adoptB = out[2][1];
  assert.equal(adoptA.active, false);
  assert.equal(adoptA.trusted, false);
  assert.equal(adoptA.wcId, 1);
  assert.equal(adoptB.active, true);
  assert.equal(adoptB.wcId, 2);
});

test('buildRecoveryAdopts: a trusted internal entry adopts with trusted:true', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const entry = makeEntry({
    trusted: true,
    partition: INTERNAL_PARTITION,
    wc: { url: 'goldfinch://settings/' }
  });
  const record = makeRecord([[3, entry]], 3);
  const out = recovery.buildRecoveryAdopts(record, {
    jarsList: [],
    defaultJar: { id: 'default', name: 'Default', color: '#000' },
    buildAdoptPayload
  });
  const adopt = out.find((o) => o[0] === 'adopt-tab')[1];
  assert.equal(adopt.trusted, true);
  assert.deepEqual(adopt.container, {
    id: 'internal',
    name: 'settings',
    color: '#9aa0ac',
    partition: INTERNAL_PARTITION
  });
});

test('buildRecoveryAdopts: crash/hung entries re-push tab-crash/tab-hung', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const entry = makeEntry({ crash: { reason: 'crashed', exitCode: 139, url: 'https://a.example/' } });
  const record = makeRecord([[1, entry]], 1);
  const out = recovery.buildRecoveryAdopts(record, {
    jarsList: [],
    defaultJar: { id: 'default', name: 'Default', color: '#000' },
    buildAdoptPayload
  });
  assert.deepEqual(
    out.map((o) => o[0]),
    ['adopt-tab', 'tab-crash', 'tab-nav-state']
  );
});

test('buildRecoveryAdopts: zero tabs returns an empty array', () => {
  const recovery = createChromeRecovery({ now: () => 1000 });
  const record = makeRecord([], null);
  const out = recovery.buildRecoveryAdopts(record, {
    jarsList: [],
    defaultJar: { id: 'default', name: 'Default', color: '#000' },
    buildAdoptPayload
  });
  assert.deepEqual(out, []);
});
