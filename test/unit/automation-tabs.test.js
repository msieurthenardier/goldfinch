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
  await openTab('https://example.com', null, { executeInRenderer: exec });
  assert.equal(exec.calls.length, 1);
  const code = exec.calls[0];
  // The code must contain the JSON-encoded URL string
  assert.ok(code.includes('"https://example.com"'), 'URL must be JSON-encoded in the dispatched code');
  assert.ok(code.includes('window.__goldfinchAutomation.openTab('), 'must call openTab on the hook');
});

test('openTab: URL with special characters is JSON-encoded safely (no injection)', async () => {
  const maliciousUrl = 'https://x.com/path?a="); alert(1); ("';
  const exec = makeRecordingExecute(null);
  await openTab(maliciousUrl, null, { executeInRenderer: exec });
  const code = exec.calls[0];
  // The full URL must appear as a JSON-encoded string literal in the code
  assert.ok(code.includes(JSON.stringify(maliciousUrl)), 'special chars must be JSON-encoded');
});

test('openTab: resolves to the wcId returned by the renderer (number)', async () => {
  const exec = makeFixedExecute(42);
  const result = await openTab('https://example.com', null, { executeInRenderer: exec });
  assert.equal(result, 42);
});

test('openTab: resolves to null when renderer returns null (URL rejected)', async () => {
  const exec = makeFixedExecute(null);
  const result = await openTab('about:blank', null, { executeInRenderer: exec });
  assert.equal(result, null);
});

test('openTab: non-string url throws bad-url before any dispatch', async () => {
  const exec = makeRecordingExecute(null);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => openTab(42, null, { executeInRenderer: exec }),
    (err) => err instanceof Error && err.message.includes('bad-url')
  );
  assert.equal(exec.calls.length, 0, 'no dispatch should happen on bad-url');
});

test('openTab: null url throws bad-url before any dispatch', async () => {
  const exec = makeRecordingExecute(null);
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    async () => openTab(null, null, { executeInRenderer: exec }),
    (err) => err instanceof Error && err.message.includes('bad-url')
  );
  assert.equal(exec.calls.length, 0);
});

test('openTab: with no jarId (null), generated call string is single-arg (no undefined literal)', async () => {
  const exec = makeRecordingExecute(1);
  await openTab('https://example.com', null, { executeInRenderer: exec });
  const code = exec.calls[0];
  // Must end after the JSON-encoded URL — no second argument
  assert.ok(code.endsWith('openTab("https://example.com")'), 'no-jarId must produce single-arg call; got: ' + code);
});

test('openTab: with undefined jarId, generated call string is single-arg', async () => {
  const exec = makeRecordingExecute(1);
  await openTab('https://example.com', undefined, { executeInRenderer: exec });
  const code = exec.calls[0];
  assert.ok(code.endsWith('openTab("https://example.com")'), 'undefined jarId must produce single-arg call; got: ' + code);
});

test('openTab: with jarId, generated call string is two-arg (JSON url, JSON jarId)', async () => {
  const exec = makeRecordingExecute(5);
  await openTab('https://example.com', 'personal', { executeInRenderer: exec });
  const code = exec.calls[0];
  const expected = 'window.__goldfinchAutomation.openTab("https://example.com", "personal")';
  assert.equal(code, expected, 'jarId must be appended as a JSON-encoded second arg with ", " separator');
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

// ---------------------------------------------------------------------------
// activateTab — M09 F7 DD6: OWNING-WINDOW routing, the raise, and the SCOPED refusal
// (recon S1).
//
// Pre-F7, dispatch went through executeInRenderer → the LAST-FOCUSED chrome, whose
// activateTabByWcId searches its OWN document's tabs Map (renderer.js:3603-3608),
// missed a window-B tab, and returned false — which every caller DISCARDED. So acts on
// another window's tab proceeded against an unraised background guest and reported
// success.
//
// The three-way rule:
//   chromeForTab → null                    ⇒ return false. No raise, no throw.
//   chromeForTab → chrome, dispatch true   ⇒ raise, return true
//   chromeForTab → chrome, dispatch false  ⇒ throw the named refusal (desync)
//
// NOTE the five tests ABOVE pass UNMODIFIED: they supply no chromeForTab, so they take
// the "Absent → no behavior change" fallback. That fallback is SILENT, which is exactly
// why the leg grep-pins BOTH live injection sites in main.js — a forgotten injection
// restores S1 with no test failure anywhere.
// ---------------------------------------------------------------------------

// A fake chrome webContents that records what was dispatched INTO it. The point of the
// S1 fix is WHICH chrome receives the code, so the fake must be identifiable.
function makeFakeChrome(label, result = true) {
  return { label, calls: [], async executeJavaScript(code) { this.calls.push(code); return result; } };
}

// The engine's executeInChrome seam (engine.js deps()): dispatch onto a SPECIFIC chrome.
const executeInChrome = (chrome, code) => chrome.executeJavaScript(code);

test('[F7 DD6/AC2] activateTab: chromeForTab → null ⇒ returns false, NO raise, NO throw, NO dispatch (the overlay / probe-walk branch)', async () => {
  // THE LOAD-BEARING NULL BRANCH. classifyContents (resolve.js:56-60) calls anything that
  // is not a registered chrome a 'guest', so the menu-overlay sheet and the find overlay
  // classify as guests that no window's tabViews contains. Pre-F7 these dispatched, missed,
  // and returned a DISCARDED false — which is precisely why the probe walk works. A blanket
  // "false ⇒ throw" would break `npm run a11y` (a flight checkpoint, whose own catch would
  // swallow the throw and then fail), all 10 probe-walk specs, find-overlay-geometry's
  // readDom probe, and per-wcId captureScreenshot on overlay ids. PIN IT HARD.
  const overlayWc = makeGuestWc(42);
  const exec = makeRecordingExecute(true);
  const raises = [];

  const result = await activateTab(42, {
    executeInRenderer: exec,
    executeInChrome,
    fromId: makeFakeFromId({ 42: overlayWc }),
    chromeContents: null,
    chromeForTab: () => null,                    // not a registry-owned tab
    raiseWindowForTab: (id) => raises.push(id),
  });

  assert.equal(result, false, 'the honest answer: "this wcId is not a registry-owned tab" — the same false as pre-F7');
  assert.deepEqual(raises, [], 'a non-tab must NEVER raise a window');
  assert.equal(exec.calls.length, 0, 'and it does NOT fall back to the last-focused dispatch either');
});

test('[F7 DD6/AC2] activateTab: dispatch goes to the OWNING window\'s chrome, NOT executeInRenderer\'s last-focused one (the S1 fix)', async () => {
  // The heart of S1: inject a chromeForTab returning a DIFFERENT fake than the
  // last-focused executeInRenderer, and assert WHICH one received the code.
  const tabWc = makeGuestWc(77);
  const lastFocused = makeRecordingExecute(true);          // window A's chrome (WRONG target)
  const owningChrome = makeFakeChrome('window-B-chrome');  // window B's chrome (RIGHT target)
  const raises = [];

  const result = await activateTab(77, {
    executeInRenderer: lastFocused,
    executeInChrome,
    fromId: makeFakeFromId({ 77: tabWc }),
    chromeContents: null,
    chromeForTab: (id) => (id === 77 ? owningChrome : null),
    raiseWindowForTab: (id) => raises.push(id),
  });

  assert.equal(result, true);
  assert.equal(owningChrome.calls.length, 1, 'the OWNING window\'s chrome must receive the dispatch');
  assert.ok(owningChrome.calls[0].includes('activateTabByWcId(77)'), 'with the right wcId');
  assert.equal(lastFocused.calls.length, 0,
    'the LAST-FOCUSED chrome must NOT be dispatched to — that is the whole of S1');
});

test('[F7 DD6/AC4] activateTab: dispatch true ⇒ raiseWindowForTab called EXACTLY once, AFTER the dispatch, returns true', async () => {
  const tabWc = makeGuestWc(78);
  const order = [];
  const owningChrome = { calls: [], async executeJavaScript(code) { order.push('dispatch'); this.calls.push(code); return true; } };

  const result = await activateTab(78, {
    executeInRenderer: makeRecordingExecute(true),
    executeInChrome,
    fromId: makeFakeFromId({ 78: tabWc }),
    chromeContents: null,
    chromeForTab: () => owningChrome,
    raiseWindowForTab: (id) => order.push('raise:' + id),
  });

  assert.equal(result, true);
  assert.deepEqual(order, ['dispatch', 'raise:78'],
    'the raise happens AFTER the dispatch, so the window comes forward already showing the right tab');
});

test('[F7 DD6/AC3] activateTab: dispatch false on an OWNED tab ⇒ THROWS the named refusal, and raiseWindowForTab is called ZERO times', async () => {
  // The registry says this window owns the tab, but its chrome's tabs Map disagrees — a
  // real desync. A THROW, not a returned refusal object: a returned object would still be
  // DISCARDED at all seven raise sites, re-creating the exact silent no-op S1 is.
  const tabWc = makeGuestWc(79);
  const owningChrome = makeFakeChrome('desynced-chrome', false);  // dispatch returns false
  const raises = [];

  await assert.rejects(
    () => activateTab(79, {
      executeInRenderer: makeRecordingExecute(true),
      executeInChrome,
      fromId: makeFakeFromId({ 79: tabWc }),
      chromeContents: null,
      chromeForTab: () => owningChrome,
      raiseWindowForTab: (id) => raises.push(id),
    }),
    (err) => err instanceof Error && /^automation: activate-refused — /.test(err.message),
  );

  assert.equal(owningChrome.calls.length, 1, 'the dispatch was attempted');
  assert.deepEqual(raises, [], 'a refusal raises NOTHING — we threw first');
});

test('[F7 DD6/AC6] activateTab: ABSENT chromeForTab ⇒ pre-F7 executeInRenderer dispatch, no raise, no refusal (the silent fallback)', async () => {
  // The house "Absent → no behavior change" idiom (engine.js:33-41). This is what lets the
  // five pre-F7 tests above pass unmodified — and it is SILENT, hence AC6's grep-pin on
  // both live injection sites.
  const tabWc = makeGuestWc(80);
  const exec = makeRecordingExecute(true);
  const raises = [];

  const result = await activateTab(80, {
    executeInRenderer: exec,
    fromId: makeFakeFromId({ 80: tabWc }),
    chromeContents: null,
    raiseWindowForTab: (id) => raises.push(id),   // present, but must not fire
  });

  assert.equal(result, true, 'the executeInRenderer result passes through as pre-F7');
  assert.equal(exec.calls.length, 1, 'the pre-F7 last-focused dispatch is the fallback');
  assert.deepEqual(raises, [], 'no raise without owner routing — no behavior change');
});

test('[F7 DD6] activateTab: resolve-time refusals still throw BEFORE any owner lookup, dispatch, or raise', async () => {
  // resolveContents runs first and unchanged: bad-handle / no-such-contents /
  // internal-session all throw before DD6's machinery is reached.
  const lookups = [];
  const raises = [];
  const mkDeps = (map) => ({
    executeInRenderer: makeRecordingExecute(true),
    executeInChrome,
    fromId: makeFakeFromId(map),
    chromeContents: null,
    chromeForTab: (i) => { lookups.push(i); return makeFakeChrome('c'); },
    raiseWindowForTab: (i) => raises.push(i),
  });

  await assert.rejects(
    () => activateTab(99, mkDeps({ 99: makeInternalWc(99) })),
    (err) => err.message.includes('internal-session'));
  await assert.rejects(
    () => activateTab(998, mkDeps({})),
    (err) => err.message.includes('no-such-contents'));
  await assert.rejects(
    () => activateTab(55, mkDeps({ 55: makeDestroyedWc(55) })),
    (err) => err.message.includes('no-such-contents'));
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => activateTab('10', mkDeps({})),
    (err) => err.message.includes('bad-handle'));

  assert.deepEqual(lookups, [], 'chromeForTab must not even be consulted for a target that fails resolve');
  assert.deepEqual(raises, [], 'and nothing is raised');
});

// ---------------------------------------------------------------------------
// enumerateTabs — the ALL-WINDOWS census (M09 F7 DD1)
//
// The REGISTRY is the ownership authority: each window's rows are filtered to that
// record's own tabViews membership and stamped with windowId FROM THE REGISTRY. The
// renderer is authoritative only for url/title/jarId and never learns windowId.
// ---------------------------------------------------------------------------

/**
 * A listWindows() fake. `tabs` is what THIS window's chrome reports from listTabs();
 * `owns` is the registry's ownership set for the record (deliberately independent, so
 * a test can make the renderer and the registry disagree — which is the whole point).
 */
function makeWindow({ windowId, tabs = [], owns = null, booted = true }) {
  return {
    windowId,
    chrome: { __chromeFor: windowId },   // an opaque handle; only executeInChrome sees it
    booted,
    ownsTab: (wcId) => (owns ?? tabs.map((t) => t.wcId)).includes(wcId),
    __tabs: tabs,
  };
}

/**
 * A fake executeInChrome that dispatches on the chrome handle and RECORDS every call,
 * so a test can assert a round-trip did NOT happen (the mid-boot absence).
 */
function makeChromeExecute(windows, { throwFor = [] } = {}) {
  const calls = [];
  const exec = async (chrome, _code) => {
    calls.push(chrome.__chromeFor);
    if (throwFor.includes(chrome.__chromeFor)) throw new Error('window closing mid-census');
    const w = windows.find((x) => x.chrome === chrome);
    return w ? w.__tabs : [];
  };
  return { exec, calls };
}

test('enumerateTabs (DD1): two booted windows → rows from BOTH, insertion order, each stamped with its OWN windowId', async () => {
  const fromId = makeFakeFromId({ 10: makeGuestWc(10), 11: makeGuestWc(11), 20: makeGuestWc(20) });
  const windows = [
    makeWindow({ windowId: 1, tabs: [
      { wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true },
      { wcId: 11, url: 'https://b.example', title: 'B', jarId: 'default', active: false },
    ] }),
    makeWindow({ windowId: 2, tabs: [
      { wcId: 20, url: 'https://c.example', title: 'C', jarId: 'default', active: true },
    ] }),
  ];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(result.map((t) => [t.wcId, t.windowId]), [[10, 1], [11, 1], [20, 2]]);
});

test('enumerateTabs (DD1): a row the renderer reports but the registry does NOT own is DROPPED', async () => {
  // The heart of DD1: registry-authoritative ownership. The renderer reporting a tab
  // is not evidence the window owns it.
  const fromId = makeFakeFromId({ 10: makeGuestWc(10), 66: makeGuestWc(66) });
  const windows = [
    makeWindow({
      windowId: 1,
      tabs: [
        { wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true },
        { wcId: 66, url: 'https://ghost.example', title: 'Ghost', jarId: 'default', active: false },
      ],
      owns: [10],   // the registry owns 10 only
    }),
  ];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(result.map((t) => t.wcId), [10]);
});

test('enumerateTabs (DD1): a tab owned by B but REPORTED by A appears ONCE, under B — the anti-double-count pin', async () => {
  // Registry-authoritative ownership makes a duplicate STRUCTURALLY IMPOSSIBLE across
  // N non-atomic round-trips: a tab moving A→B mid-census can be reported by BOTH
  // chromes, but only the record that OWNS it stamps a row.
  const fromId = makeFakeFromId({ 30: makeGuestWc(30) });
  const roamer = { wcId: 30, url: 'https://moved.example', title: 'Moved', jarId: 'default', active: true };
  const windows = [
    makeWindow({ windowId: 1, tabs: [roamer], owns: [] }),      // A still reports it; A no longer owns it
    makeWindow({ windowId: 2, tabs: [roamer], owns: [30] }),    // B owns it
  ];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.equal(result.length, 1, 'reported twice, stamped once');
  assert.deepEqual([result[0].wcId, result[0].windowId], [30, 2]);
});

test('enumerateTabs (DD1): booted:false ⇒ ZERO rows AND no round-trip attempted — with its positive control', async () => {
  // An absence with its POSITIVE CONTROL IN THE SAME TEST: the same window, same fake,
  // flipped to booted:true, contributes its rows and records its round-trip. Without
  // that control this asserts nothing — an instrument never shown able to report
  // presence cannot certify an absence.
  const fromId = makeFakeFromId({ 40: makeGuestWc(40) });
  const tabs = [{ wcId: 40, url: 'https://mid.example', title: 'Adopted', jarId: 'default', active: true }];

  const midBoot = [makeWindow({ windowId: 9, tabs, booted: false })];
  const midExec = makeChromeExecute(midBoot);
  const absent = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: midExec.exec,
    listWindows: () => midBoot,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(absent, [], 'a mid-boot window contributes zero rows');
  assert.deepEqual(midExec.calls, [], 'and NO round-trip was attempted against it');

  // POSITIVE CONTROL — same window, same tabs, same fake, booted:true.
  const booted = [makeWindow({ windowId: 9, tabs, booted: true })];
  const bootedExec = makeChromeExecute(booted);
  const present = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: bootedExec.exec,
    listWindows: () => booted,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(present.map((t) => [t.wcId, t.windowId]), [[40, 9]], 'the SAME fixture DOES yield rows when booted');
  assert.deepEqual(bootedExec.calls, [9], 'and the round-trip DID happen');
});

test('enumerateTabs (DD1): a window whose round-trip THROWS contributes zero rows; the census still returns the others', async () => {
  const fromId = makeFakeFromId({ 10: makeGuestWc(10), 20: makeGuestWc(20) });
  const windows = [
    makeWindow({ windowId: 1, tabs: [{ wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true }] }),
    makeWindow({ windowId: 2, tabs: [{ wcId: 20, url: 'https://b.example', title: 'B', jarId: 'default', active: true }] }),
  ];
  const { exec } = makeChromeExecute(windows, { throwFor: [1] });   // window 1 closes mid-census
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(result.map((t) => [t.wcId, t.windowId]), [[20, 2]]);
});

test('enumerateTabs (DD1/AC2): the return is a PLAIN ARRAY with no own properties beyond indices', async () => {
  // The DD1 pass-2 HIGH: scope.js's jar facade does tabs.filter(...), which THROWS on a
  // wrapper and SILENTLY DROPS an own property (Array.prototype.filter does not copy
  // own props) — so a jar caller would under-read with no signal.
  const fromId = makeFakeFromId({ 10: makeGuestWc(10) });
  const windows = [makeWindow({ windowId: 1, tabs: [{ wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true }] })];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });

  const isPlainArray = (v) => Array.isArray(v) && Object.keys(v).every((k) => String(Number(k)) === k);
  assert.equal(isPlainArray(result), true);

  // POSITIVE CONTROL — the same check REJECTS an array carrying an own property, so
  // the pin above is demonstrably able to fail rather than passing vacuously.
  const marked = [{ wcId: 10 }];
  marked.incomplete = [2];
  assert.equal(Array.isArray(marked), true, 'the control IS still an array — Array.isArray alone cannot catch this');
  assert.equal(isPlainArray(marked), false, 'and the pin rejects it');
});

test('enumerateTabs (DD1): windowId is stamped from the REGISTRY — a bogus renderer-reported windowId is OVERWRITTEN', async () => {
  // The renderer never learns windowId. If it invents one, the registry's stamp wins.
  const fromId = makeFakeFromId({ 10: makeGuestWc(10) });
  const windows = [
    makeWindow({ windowId: 7, tabs: [
      { wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true, windowId: 999 },
    ] }),
  ];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.equal(result[0].windowId, 7);
});

test('enumerateTabs (DD1): mapEnumeratedTabs still runs PER WINDOW — the internal-session drop and dom-ready filter survive', async () => {
  const fromId = makeFakeFromId({ 10: makeGuestWc(10), 99: makeInternalWc(99), 12: makeGuestWc(12) });
  const windows = [
    makeWindow({
      windowId: 1,
      tabs: [
        { wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true },
        { wcId: 99, url: 'goldfinch://settings', title: 'Settings', jarId: 'internal', active: false },
        { wcId: null, url: 'https://booting.example', title: '', jarId: 'default', active: false },
        { wcId: 12, url: 'https://d.example', title: 'D', jarId: 'default', active: false },
      ],
      owns: [10, 99, 12],
    }),
  ];
  const { exec } = makeChromeExecute(windows);
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([]),
    executeInChrome: exec,
    listWindows: () => windows,
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(result.map((t) => t.wcId), [10, 12], 'internal dropped (DD5), pre-dom-ready dropped');
});

test('enumerateTabs (AC4): absent listWindows → the pre-F7 single-window path, and NO windowId is emitted', async () => {
  // The house "Absent → no behavior change" idiom. This fallback is SILENT, which is
  // exactly why both live injection sites are grep-pinned.
  const fromId = makeFakeFromId({ 10: makeGuestWc(10) });
  const result = await enumerateTabs({
    executeInRenderer: makeFixedExecute([
      { wcId: 10, url: 'https://a.example', title: 'A', jarId: 'default', active: true },
    ]),
    fromId,
    chromeContents: null,
  });
  assert.deepEqual(result.map((t) => t.wcId), [10]);
  assert.equal('windowId' in result[0], false, 'no windowId on the pre-F7 path');
});

test('enumerateTabs (DD1): zero registered windows → empty array, and executeInRenderer is never called', async () => {
  let rendererCalls = 0;
  const result = await enumerateTabs({
    executeInRenderer: async () => { rendererCalls++; return []; },
    executeInChrome: async () => [],
    listWindows: () => [],
    fromId: makeFakeFromId({}),
    chromeContents: null,
  });
  assert.deepEqual(result, []);
  assert.equal(rendererCalls, 0, 'the census path never falls back to the last-focused chrome');
});
