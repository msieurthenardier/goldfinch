'use strict';

// Unit tests for src/main/automation/tabs.js
//
// Electron-free: tabs.js does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub.
// Fake executeInRenderer / fromId / chromeContents stand in for the real handles.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  mapEnumeratedTabs,
  enumerateTabs,
  openTab,
  closeTab,
  activateTab,
} = require('../../src/main/automation/tabs');

// ---------------------------------------------------------------------------
// Helpers — build fake wc objects and deps
// ---------------------------------------------------------------------------

function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
  };
}

function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
  };
}

function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; },
  };
}

/**
 * Build a fake fromId lookup backed by a map of id → fake wc.
 */
function makeFakeFromId(map) {
  return (id) => map[id] ?? null;
}

/**
 * Build a fake executeInRenderer that returns a fixed canned value.
 */
function makeFixedExecute(returnValue) {
  return async (_code) => returnValue;
}

/**
 * Build a fake executeInRenderer that records what code strings were dispatched
 * and returns the canned value.
 */
function makeRecordingExecute(returnValue) {
  const calls = [];
  const fn = async (code) => { calls.push(code); return returnValue; };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// mapEnumeratedTabs — filtering and shape
// ---------------------------------------------------------------------------

test('mapEnumeratedTabs: valid guest tab is kept and shaped correctly', () => {
  const wc = makeGuestWc(10);
  const rawTabs = [{ wcId: 10, url: 'https://example.com', title: 'Example', jarId: 'default', active: true }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({ 10: wc }), chromeContents: null });
  assert.equal(result.length, 1);
  const tab = result[0];
  assert.equal(tab.wcId, 10);
  assert.equal(tab.url, 'https://example.com');
  assert.equal(tab.title, 'Example');
  assert.equal(tab.jarId, 'default');
  assert.equal(tab.active, true);
});

test('mapEnumeratedTabs: null wcId (tab not yet at dom-ready) is dropped', () => {
  const rawTabs = [{ wcId: null, url: 'https://example.com', title: 'Loading', jarId: 'default', active: false }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({}), chromeContents: null });
  assert.equal(result.length, 0);
});

test('mapEnumeratedTabs: string wcId (non-number) is dropped', () => {
  const rawTabs = [{ wcId: '10', url: 'https://example.com', title: 'Tab', jarId: 'default', active: false }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({}), chromeContents: null });
  assert.equal(result.length, 0);
});

test('mapEnumeratedTabs: unresolvable wcId (fromId returns null) is dropped', () => {
  const rawTabs = [{ wcId: 42, url: 'https://example.com', title: 'Tab', jarId: 'default', active: false }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({}), chromeContents: null });
  assert.equal(result.length, 0);
});

test('mapEnumeratedTabs: destroyed webContents is dropped', () => {
  const wc = makeDestroyedWc(55);
  const rawTabs = [{ wcId: 55, url: 'https://example.com', title: 'Tab', jarId: 'default', active: false }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({ 55: wc }), chromeContents: null });
  assert.equal(result.length, 0);
});

test('mapEnumeratedTabs: internal-session contents (DD5 filter) is dropped', () => {
  const internalWc = makeInternalWc(99);
  const rawTabs = [{ wcId: 99, url: 'goldfinch://settings', title: 'Settings', jarId: 'internal', active: false }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({ 99: internalWc }), chromeContents: null });
  assert.equal(result.length, 0);
});

test('mapEnumeratedTabs: mixes valid and filtered entries — only valid survive', () => {
  const guestWc1 = makeGuestWc(1);
  const guestWc2 = makeGuestWc(2);
  const internalWc = makeInternalWc(3);
  const fromId = makeFakeFromId({ 1: guestWc1, 2: guestWc2, 3: internalWc });
  const rawTabs = [
    { wcId: 1, url: 'https://a.com', title: 'A', jarId: 'default', active: true },
    { wcId: null, url: 'about:blank', title: 'New tab', jarId: 'default', active: false }, // not-yet-ready
    { wcId: 2, url: 'https://b.com', title: 'B', jarId: 'work', active: false },
    { wcId: 3, url: 'goldfinch://settings', title: 'Settings', jarId: 'internal', active: false }, // internal
    { wcId: 999, url: 'https://gone.com', title: 'Gone', jarId: 'default', active: false }, // unresolvable
  ];
  const result = mapEnumeratedTabs(rawTabs, { fromId, chromeContents: null });
  assert.equal(result.length, 2);
  assert.equal(result[0].wcId, 1);
  assert.equal(result[1].wcId, 2);
});

test('mapEnumeratedTabs: null rawTabs input returns empty array (never throws)', () => {
  const result = mapEnumeratedTabs(null, { fromId: makeFakeFromId({}), chromeContents: null });
  assert.deepEqual(result, []);
});

test('mapEnumeratedTabs: empty rawTabs array returns empty array', () => {
  const result = mapEnumeratedTabs([], { fromId: makeFakeFromId({}), chromeContents: null });
  assert.deepEqual(result, []);
});

test('mapEnumeratedTabs: active flag is coerced to boolean', () => {
  const wc = makeGuestWc(7);
  // Pass a raw truthy non-boolean to verify !! coercion
  const rawTabs = [{ wcId: 7, url: 'https://x.com', title: 'X', jarId: 'default', active: 1 }];
  const result = mapEnumeratedTabs(rawTabs, { fromId: makeFakeFromId({ 7: wc }), chromeContents: null });
  assert.equal(result.length, 1);
  assert.strictEqual(result[0].active, true); // must be boolean true, not 1
});

test('mapEnumeratedTabs: fromId throwing (not returning null) drops that entry and continues', () => {
  const wc2 = makeGuestWc(2);
  const fromId = (id) => {
    if (id === 1) throw new Error('explode');
    return id === 2 ? wc2 : null;
  };
  const rawTabs = [
    { wcId: 1, url: 'https://a.com', title: 'A', jarId: 'default', active: false },
    { wcId: 2, url: 'https://b.com', title: 'B', jarId: 'default', active: true },
  ];
  const result = mapEnumeratedTabs(rawTabs, { fromId, chromeContents: null });
  assert.equal(result.length, 1);
  assert.equal(result[0].wcId, 2);
});

// ---------------------------------------------------------------------------
// enumerateTabs — end-to-end with fake executeInRenderer
// ---------------------------------------------------------------------------

test('enumerateTabs: calls listTabs() and filters through mapEnumeratedTabs', async () => {
  const guestWc = makeGuestWc(10);
  const internalWc = makeInternalWc(99);
  const fromId = makeFakeFromId({ 10: guestWc, 99: internalWc });
  const rawList = [
    { wcId: 10, url: 'https://example.com', title: 'Example', jarId: 'default', active: true },
    { wcId: 99, url: 'goldfinch://settings', title: 'Settings', jarId: 'internal', active: false },
  ];
  const exec = makeFixedExecute(rawList);
  const result = await enumerateTabs({ executeInRenderer: exec, fromId, chromeContents: null });
  // Internal tab is absent from output (DD5)
  assert.equal(result.length, 1);
  assert.equal(result[0].wcId, 10);
});

test('enumerateTabs: internal settings tab absent even when present in renderer raw list (DD5 enumerate filter)', async () => {
  const internalWc = makeInternalWc(50);
  const fromId = makeFakeFromId({ 50: internalWc });
  const rawList = [
    { wcId: 50, url: 'goldfinch://settings', title: 'Settings', jarId: 'internal', active: true },
  ];
  const exec = makeFixedExecute(rawList);
  const result = await enumerateTabs({ executeInRenderer: exec, fromId, chromeContents: null });
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// openTab — JSON encoding and string-safety
// ---------------------------------------------------------------------------

test('openTab: dispatches the URL via JSON.stringify (injection-safe encoding)', async () => {
  const exec = makeRecordingExecute(42);
  await openTab('https://example.com', { executeInRenderer: exec });
  assert.equal(exec.calls.length, 1);
  const code = exec.calls[0];
  // The code must contain the JSON-encoded URL string
  assert.ok(code.includes('"https://example.com"'), 'URL must be JSON-encoded in the dispatched code');
  assert.ok(code.includes('window.__goldfinchAutomation.openTab('), 'must call openTab on the hook');
});

test('openTab: URL with special characters is JSON-encoded safely (no injection)', async () => {
  const maliciousUrl = 'https://x.com/path?a="); alert(1); ("';
  const exec = makeRecordingExecute(null);
  await openTab(maliciousUrl, { executeInRenderer: exec });
  const code = exec.calls[0];
  // The full URL must appear as a JSON-encoded string literal in the code
  assert.ok(code.includes(JSON.stringify(maliciousUrl)), 'special chars must be JSON-encoded');
});

test('openTab: resolves to the wcId returned by the renderer (number)', async () => {
  const exec = makeFixedExecute(42);
  const result = await openTab('https://example.com', { executeInRenderer: exec });
  assert.equal(result, 42);
});

test('openTab: resolves to null when renderer returns null (URL rejected)', async () => {
  const exec = makeFixedExecute(null);
  const result = await openTab('about:blank', { executeInRenderer: exec });
  assert.equal(result, null);
});

test('openTab: non-string url throws bad-url before any dispatch', async () => {
  const exec = makeRecordingExecute(null);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => openTab(42, { executeInRenderer: exec }),
    (err) => err instanceof Error && err.message.includes('bad-url')
  );
  assert.equal(exec.calls.length, 0, 'no dispatch should happen on bad-url');
});

test('openTab: null url throws bad-url before any dispatch', async () => {
  const exec = makeRecordingExecute(null);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => openTab(null, { executeInRenderer: exec }),
    (err) => err instanceof Error && err.message.includes('bad-url')
  );
  assert.equal(exec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// closeTab — validation and dispatch
// ---------------------------------------------------------------------------

test('closeTab: dispatches closeTabByWcId with validated numeric wcId', async () => {
  const wc = makeGuestWc(10);
  const exec = makeRecordingExecute(true);
  await closeTab(10, { executeInRenderer: exec, fromId: makeFakeFromId({ 10: wc }), chromeContents: null });
  assert.equal(exec.calls.length, 1);
  const code = exec.calls[0];
  assert.ok(code.includes('window.__goldfinchAutomation.closeTabByWcId('), 'must call closeTabByWcId');
  assert.ok(code.includes('10'), 'must include the wcId');
});

test('closeTab: internal-session wcId throws before dispatching (DD5 targeted-op guard)', async () => {
  const internalWc = makeInternalWc(99);
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => closeTab(99, { executeInRenderer: exec, fromId: makeFakeFromId({ 99: internalWc }), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('internal-session')
  );
  assert.equal(exec.calls.length, 0, 'no dispatch for internal target');
});

test('closeTab: non-existent wcId throws no-such-contents', async () => {
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => closeTab(999, { executeInRenderer: exec, fromId: makeFakeFromId({}), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('no-such-contents')
  );
  assert.equal(exec.calls.length, 0);
});

test('closeTab: non-number wcId throws bad-handle', async () => {
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => closeTab('10', { executeInRenderer: exec, fromId: makeFakeFromId({}), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('bad-handle')
  );
  assert.equal(exec.calls.length, 0);
});

test('closeTab: destroyed webContents throws no-such-contents', async () => {
  const wc = makeDestroyedWc(55);
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => closeTab(55, { executeInRenderer: exec, fromId: makeFakeFromId({ 55: wc }), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('no-such-contents')
  );
  assert.equal(exec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// activateTab — validation and dispatch
// ---------------------------------------------------------------------------

test('activateTab: dispatches activateTabByWcId with validated numeric wcId', async () => {
  const wc = makeGuestWc(10);
  const exec = makeRecordingExecute(true);
  await activateTab(10, { executeInRenderer: exec, fromId: makeFakeFromId({ 10: wc }), chromeContents: null });
  assert.equal(exec.calls.length, 1);
  const code = exec.calls[0];
  assert.ok(code.includes('window.__goldfinchAutomation.activateTabByWcId('), 'must call activateTabByWcId');
  assert.ok(code.includes('10'), 'must include the wcId');
});

test('activateTab: internal-session wcId throws before dispatching (DD5 targeted-op guard)', async () => {
  const internalWc = makeInternalWc(99);
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => activateTab(99, { executeInRenderer: exec, fromId: makeFakeFromId({ 99: internalWc }), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('internal-session')
  );
  assert.equal(exec.calls.length, 0, 'no dispatch for internal target');
});

test('activateTab: non-existent wcId throws no-such-contents', async () => {
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => activateTab(999, { executeInRenderer: exec, fromId: makeFakeFromId({}), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('no-such-contents')
  );
  assert.equal(exec.calls.length, 0);
});

test('activateTab: non-number wcId throws bad-handle', async () => {
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => activateTab('10', { executeInRenderer: exec, fromId: makeFakeFromId({}), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('bad-handle')
  );
  assert.equal(exec.calls.length, 0);
});

test('activateTab: destroyed webContents throws no-such-contents', async () => {
  const wc = makeDestroyedWc(55);
  const exec = makeRecordingExecute(true);
  await assert.rejects(
    async () => activateTab(55, { executeInRenderer: exec, fromId: makeFakeFromId({ 55: wc }), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('no-such-contents')
  );
  assert.equal(exec.calls.length, 0);
});
