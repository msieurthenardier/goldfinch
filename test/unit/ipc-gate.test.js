'use strict';

// Unit tests for src/main/ipc-gate.js (Mission 23 Flight 1, leg `ipc-gate`, DD1). The gate is
// built around a fake ipcMain/registry exactly as the registrar tests do, against the REAL
// classification table.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIpcGate } = require('../../src/main/ipc-gate');
const { CHANNEL_CLASS } = require('../../src/main/ipc-channel-table');
const { eventFrom } = require('../helpers/ipc-gate-fixture');

function setup({ env = {}, owned = [], extraRegistry = {}, isPopupWcId } = {}) {
  const handles = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (c, fn) => handles.set(c, fn),
    on: (c, fn) => listeners.set(c, fn)
  };
  const lines = [];
  const chromeSender = { id: 1 };
  const otherChrome = { id: 2 };
  const recA = { id: 'A', tabViews: new Map() };
  const recB = { id: 'B', tabViews: new Map() };
  const registry = {
    getWindowForChrome: (s) => (s === chromeSender ? recA : s === otherChrome ? recB : null),
    getWindowForGuest: (id) =>
      owned.includes(id) ? recA : id === 900 ? recB : id === 77 ? { id: 'guest-owner' } : null,
    ...extraRegistry
  };
  const gate = createIpcGate({ ipcMain, registry, env, logger: { log: (l) => lines.push(l) }, isPopupWcId });
  return { gate, handles, listeners, lines, chromeSender, otherChrome, recA, recB };
}

const page = (extra = {}) => ({ sender: { id: 77 }, senderFrame: { origin: 'https://evil.test' }, ...extra });

// --- registration-time rules ----------------------------------------------------------

test('registering a channel absent from the table throws', () => {
  const { gate } = setup();
  assert.throws(() => gate.chrome.handle('zz-not-in-table', () => 1, 'throw'), /not in the classification table/);
  assert.throws(() => gate.chrome.on('zz-not-in-table', () => 1), /not in the classification table/);
});

test('registering under a class that differs from the table entry throws (every registrar)', () => {
  assert.equal(CHANNEL_CLASS['settings-get'], 'chrome');
  assert.equal(CHANNEL_CLASS['vault-reachable-items'], 'owning-chrome');
  assert.equal(CHANNEL_CLASS['automation:get-activity'], 'chrome-or-internal');
  const { gate } = setup();
  assert.throws(
    () =>
      gate.owningChrome.handle(
        'settings-get',
        (x) => x,
        () => 1,
        'throw'
      ),
    /classed 'chrome' but registered as 'owning-chrome'/
  );
  assert.throws(() => gate.chromeOrInternal.handle('settings-get', () => 1, 'throw'), /classed 'chrome'/);
  assert.throws(
    () => gate.chrome.handle('vault-reachable-items', () => 1, 'throw'),
    /classed 'owning-chrome' but registered as 'chrome'/
  );
  assert.throws(() => gate.chrome.handle('automation:get-activity', () => 1, 'throw'), /classed 'chrome-or-internal'/);
  assert.throws(() => gate.chrome.on('menu-overlay:activated', () => 1), /classed 'sheet'/);
  assert.throws(() => gate.chrome.handle('internal-jars-list', () => 1, 'throw'), /classed 'internal'/);
});

test('registering the same channel twice throws', () => {
  const { gate } = setup();
  gate.chrome.handle('settings-get', () => 1, 'throw');
  assert.throws(() => gate.chrome.handle('settings-get', () => 1, 'throw'), /already registered/);
});

test('an invoke-form registration must state its refusal; there is no default', () => {
  const { gate } = setup();
  assert.throws(() => gate.chrome.handle('settings-get', () => 1), /must state its refusal/);
  assert.throws(() => gate.chrome.handle('shields-get', () => 1, undefined), /must state its refusal/);
  assert.throws(() => gate.chrome.handle('shields-set', () => 1, 'quiet'), /must state its refusal/);
  assert.throws(() => gate.chrome.handle('shields-pause', () => 1, null), /must state its refusal/);
});

test('an owning-chrome registration must supply a tab-id extractor', () => {
  const { gate } = setup();
  assert.throws(() => gate.owningChrome.handle('vault-reachable-items', undefined, () => 1, 'throw'), /extractor/);
});

// --- chrome class ----------------------------------------------------------------------

test('chrome class: a window chrome passes; a page, an overlay, an unknown sender and a null frame are refused', async () => {
  const { gate, handles, chromeSender } = setup();
  const seen = [];
  gate.chrome.handle('settings-get', (_e, key) => (seen.push(key), 'ok'), 'throw');
  const fn = handles.get('settings-get');
  assert.equal(fn(eventFrom(chromeSender), 'k'), 'ok');
  assert.throws(() => fn(page(), 'k'), /forbidden/);
  assert.throws(() => fn({ sender: {}, senderFrame: {} }, 'k'), /forbidden/);
  assert.throws(() => fn({ sender: chromeSender, senderFrame: null }, 'k'), /forbidden/);
  assert.throws(() => fn({ sender: chromeSender }, 'k'), /forbidden/);
  assert.throws(() => fn(undefined, 'k'), /forbidden/);
  assert.deepEqual(seen, ['k'], 'the body ran exactly once, for the chrome');
});

test('refusal by value: the registration may state a literal instead of throwing', () => {
  const { gate, handles, chromeSender } = setup();
  gate.chrome.handle('shields-get', () => 'real', { value: null });
  gate.chrome.handle('shields-set', () => 'real', { value: [] });
  assert.equal(handles.get('shields-get')(page()), null);
  assert.deepEqual(handles.get('shields-set')(page()), []);
  assert.equal(handles.get('shields-get')(eventFrom(chromeSender)), 'real');
});

test('the gate adds no asynchrony: a synchronous handler returns synchronously, an async one returns its promise', async () => {
  const { gate, handles, chromeSender } = setup();
  gate.chrome.handle('shields-get', () => 42, 'throw');
  gate.chrome.handle('shields-set', async () => 43, 'throw');
  const sync = handles.get('shields-get')(eventFrom(chromeSender));
  assert.equal(sync, 42);
  const asyncResult = handles.get('shields-set')(eventFrom(chromeSender));
  assert.ok(asyncResult instanceof Promise);
  assert.equal(await asyncResult, 43);
  // A refusal by throw is also synchronous (not a rejected promise).
  assert.throws(() => handles.get('shields-get')(page()), /forbidden/);
});

test('the handler signature is unchanged: (event, ...args)', () => {
  const { gate, handles, chromeSender } = setup();
  let got;
  gate.chrome.handle('shields-pause', (...a) => (got = a), 'throw');
  const ev = eventFrom(chromeSender);
  handles.get('shields-pause')(ev, 1, { two: 2 }, 'three');
  assert.equal(got[0], ev);
  assert.deepEqual(got.slice(1), [1, { two: 2 }, 'three']);
});

test('one-way form: a refused message is dropped (no throw, no handler); a chrome message is delivered', () => {
  const { gate, listeners, chromeSender } = setup();
  const calls = [];
  gate.chrome.on('toggle-bookmarks-bar', (_e, ...a) => calls.push(a));
  const fn = listeners.get('toggle-bookmarks-bar');
  assert.doesNotThrow(() => fn(page(), 1));
  assert.doesNotThrow(() => fn({ sender: chromeSender, senderFrame: null }, 2));
  fn(eventFrom(chromeSender), 3);
  assert.deepEqual(calls, [[3]]);
});

// --- owning-chrome class ---------------------------------------------------------------

test('owning-chrome: the sender window must own a NAMED tab; an unowned id is refused, never widened', () => {
  const { gate, handles, chromeSender, otherChrome } = setup({ owned: [10] });
  const ran = [];
  gate.owningChrome.handle(
    'vault-reachable-items',
    (wcId) => wcId,
    (_e, wcId) => (ran.push(wcId), 'ok'),
    'throw'
  );
  const fn = handles.get('vault-reachable-items');
  assert.equal(fn(eventFrom(chromeSender), 10), 'ok');
  assert.throws(
    () => fn(eventFrom(otherChrome), 10),
    /forbidden/,
    "another window's chrome cannot name this window's tab"
  );
  assert.throws(() => fn(eventFrom(chromeSender), 900), /forbidden/, 'a tab owned by another window');
  assert.throws(() => fn(eventFrom(chromeSender), 12345), /forbidden/, 'an id that is no tab at all');
  assert.throws(() => fn(eventFrom(chromeSender), '10'), /forbidden/, 'a present, non-numeric id');
  assert.throws(() => fn(page(), 10), /forbidden/, 'a page naming an owned tab');
  assert.deepEqual(ran, [10]);
});

test('owning-chrome: "no tab named" (null / undefined / absent argument) passes as chrome-only, and still refuses a non-chrome', () => {
  const { gate, handles, chromeSender } = setup({ owned: [10] });
  gate.owningChrome.handle(
    'download-media',
    (payload) => (payload && typeof payload === 'object' ? payload.webContentsId : undefined),
    () => 'ok',
    'throw'
  );
  const fn = handles.get('download-media');
  for (const payload of [undefined, null, {}, { webContentsId: null }, { webContentsId: undefined }, 'str']) {
    assert.equal(fn(eventFrom(chromeSender), payload), 'ok', JSON.stringify(payload));
    assert.throws(() => fn(page(), payload), /forbidden/);
  }
  assert.equal(fn(eventFrom(chromeSender), { webContentsId: 10 }), 'ok');
  assert.throws(() => fn(eventFrom(chromeSender), { webContentsId: 900 }), /forbidden/);
});

test('owning-chrome one-way form drops an unowned tab id', () => {
  const { gate, listeners, chromeSender } = setup({ owned: [10] });
  const calls = [];
  // `tab-close`-shaped: a real channel with the owning-chrome class in the table.
  gate.owningChrome.on(
    'tab-close',
    (wcId) => wcId,
    (_e, wcId) => calls.push(wcId)
  );
  const fn = listeners.get('tab-close');
  fn(eventFrom(chromeSender), 900);
  fn(eventFrom(chromeSender), 10);
  assert.deepEqual(calls, [10]);
});

// --- chrome-or-internal class -----------------------------------------------------------

test('chrome-or-internal: a chrome and a trusted internal page pass; a web page, a non-internal session and a null frame do not', () => {
  const { gate, handles, chromeSender } = setup();
  gate.chromeOrInternal.handle('automation:get-activity', () => 'ok', 'throw');
  const fn = handles.get('automation:get-activity');
  assert.equal(fn(eventFrom(chromeSender)), 'ok');
  const internal = {
    senderFrame: { origin: 'goldfinch://automation' },
    sender: { id: 5, session: { __goldfinchInternal: true } }
  };
  assert.equal(fn(internal), 'ok');
  assert.throws(() => fn({ ...internal, senderFrame: { origin: 'https://evil.test' } }), /forbidden/);
  assert.throws(() => fn({ ...internal, sender: { id: 5, session: { __goldfinchInternal: false } } }), /forbidden/);
  assert.throws(() => fn({ ...internal, sender: { id: 5, session: { __goldfinchInternal: 1 } } }), /forbidden/);
  assert.throws(() => fn({ ...internal, senderFrame: null }), /forbidden/);
  assert.throws(() => fn(page()), /forbidden/);
});

// --- single-sourced checks --------------------------------------------------------------

test("requireChrome / ownsTab are the gate's own and agree with the registrars' semantics", () => {
  const { gate, chromeSender, otherChrome, recA } = setup({ owned: [10] });
  assert.equal(gate.requireChrome(eventFrom(chromeSender)), recA);
  assert.equal(gate.requireChrome({ sender: chromeSender }), null, 'a missing senderFrame is refused');
  assert.equal(gate.requireChrome(page()), null);
  assert.equal(gate.ownsTab(eventFrom(chromeSender), 10), recA);
  assert.equal(gate.ownsTab(eventFrom(otherChrome), 10), null);
  assert.equal(gate.ownsTab(eventFrom(chromeSender), 999), null);
});

// --- refusal trace ----------------------------------------------------------------------

test('a refusal traces ONE line only under GOLDFINCH_IPC_TRACE=1: channel, class, sender kind — never arguments', () => {
  const off = setup({ env: {} });
  off.gate.chrome.handle('settings-get', () => 1, 'throw');
  assert.throws(() => off.handles.get('settings-get')(page(), 'SECRET-ARG'));
  assert.deepEqual(off.lines, []);
  const offOne = setup({ env: { GOLDFINCH_IPC_TRACE: '0' } });
  offOne.gate.chrome.handle('settings-get', () => 1, 'throw');
  assert.throws(() => offOne.handles.get('settings-get')(page()));
  assert.deepEqual(offOne.lines, []);

  const on = setup({
    env: { GOLDFINCH_IPC_TRACE: '1' },
    extraRegistry: { getWindowForGuest: (id) => (id === 77 ? { id: 'rec' } : null) }
  });
  on.gate.chrome.handle('settings-get', () => 1, 'throw');
  on.gate.chrome.on('toggle-bookmarks-bar', () => 1);
  assert.throws(() =>
    on.handles.get('settings-get')(
      page({ senderFrame: { origin: 'https://secret.example/path?q=1', url: 'https://secret.example/title' } }),
      'SECRET-ARG'
    )
  );
  on.listeners.get('toggle-bookmarks-bar')(page(), 'SECRET-ARG');
  on.handles.get('settings-get')(eventFrom(on.chromeSender));
  assert.equal(on.lines.length, 2, 'one line per refusal, none for the accepted call');
  assert.equal(on.lines[0], '[ipc-gate] refused channel=settings-get required=chrome sender=tab');
  assert.equal(on.lines[1], '[ipc-gate] refused channel=toggle-bookmarks-bar required=chrome sender=tab');
  for (const l of on.lines) assert.doesNotMatch(l, /SECRET|secret|https?:/);
});

test('trace sender kinds: chrome / tab (incl. a popup) / overlay / other', () => {
  const overlaySender = { id: 31 };
  const { gate, handles, lines, chromeSender } = setup({
    env: { GOLDFINCH_IPC_TRACE: '1' },
    extraRegistry: {
      getWindowForGuest: (id) => (id === 77 ? { id: 'rec' } : null),
      recordForOverlaySender: (s, key) => (s === overlaySender && key === 'sheet' ? { id: 'rec' } : null)
    },
    isPopupWcId: (id) => id === 88
  });
  // A chrome sender reaching an owning-chrome channel with an unowned id is refused with kind=chrome.
  gate.owningChrome.handle(
    'vault-reachable-items',
    (x) => x,
    () => 1,
    'throw'
  );
  gate.chrome.handle('settings-get', () => 1, 'throw');
  assert.throws(() => handles.get('vault-reachable-items')(eventFrom(chromeSender), 999));
  assert.throws(() => handles.get('settings-get')({ sender: { id: 88 }, senderFrame: {} }));
  assert.throws(() => handles.get('settings-get')({ sender: overlaySender, senderFrame: {} }));
  assert.throws(() => handles.get('settings-get')({ sender: { id: 5 }, senderFrame: {} }));
  assert.throws(() => handles.get('settings-get')({ sender: undefined, senderFrame: {} }));
  assert.deepEqual(
    lines.map((l) => l.match(/sender=(\w+)/)[1]),
    ['chrome', 'tab', 'overlay', 'other', 'other']
  );
});

test('a throwing logger or registry on the trace path never changes the refusal', () => {
  const { gate, handles } = setup({
    env: { GOLDFINCH_IPC_TRACE: '1' },
    extraRegistry: {
      getWindowForGuest: () => {
        throw new Error('boom');
      }
    }
  });
  gate.chrome.handle('settings-get', () => 1, 'throw');
  assert.throws(() => handles.get('settings-get')(page()), /forbidden: chrome sender required/);
});

// ===========================================================================================
// Leg `ipc-gate-complete`: the tab-guest, sheet, find, save-prompt and find-or-owning-chrome
// classes, the extractor hardening, and the refusal trace for each.
// ===========================================================================================

const { SHEET_MENU_TYPES } = require('../../src/main/ipc-channel-table');

/** A tab guest's event from its MAIN frame (frame-tree node id compared with the sender's mainFrame). */
function guestFrom(id, { frameId = 1, mainFrameId = 1, frame = undefined } = {}) {
  return {
    sender: { id, mainFrame: { frameTreeNodeId: mainFrameId } },
    senderFrame: frame === undefined ? { frameTreeNodeId: frameId } : frame
  };
}

/** A registry with window A owning tabs 10 (web, active), 11 (web, background) and 12 (internal). */
function guestSetup({ env = {}, popups = [] } = {}) {
  const recA = {
    id: 'A',
    activeTabWcId: 10,
    tabViews: new Map([
      [10, { trusted: false }],
      [11, { trusted: false }],
      [12, { trusted: true }]
    ])
  };
  const s = setup({
    env,
    isPopupWcId: (id) => popups.includes(id),
    extraRegistry: { getWindowForGuest: (id) => (recA.tabViews.has(id) ? recA : null) }
  });
  return { ...s, recA };
}

test('tab-guest (one-way): a web tab main frame passes; a subframe, a null frame, a missing mainFrame and a non-tab are refused', () => {
  const { gate, listeners } = guestSetup();
  const calls = [];
  gate.tabGuest.on('guest-vault-gesture', {}, (e, p) => calls.push([e.sender.id, p]));
  const fn = listeners.get('guest-vault-gesture');
  fn(guestFrom(10), 'ok');
  fn(guestFrom(11), 'ok-background'); // no activeOnly switch: a background tab is a tab
  assert.doesNotThrow(() => fn(guestFrom(10, { frameId: 2 }), 'subframe'));
  fn(guestFrom(10, { frame: null }), 'null-frame');
  fn({ sender: { id: 10 }, senderFrame: { frameTreeNodeId: 1 } }, 'no-mainFrame');
  fn({ sender: { id: 10, mainFrame: {} }, senderFrame: {} }, 'ids-absent-on-both-sides');
  fn(guestFrom(99), 'not-a-tab');
  fn({ sender: undefined, senderFrame: {} }, 'no-sender');
  fn(undefined, 'no-event');
  assert.deepEqual(calls, [
    [10, 'ok'],
    [11, 'ok-background']
  ]);
});

test('tab-guest: the main-frame test compares frame-tree node ids inside a try — a disposed frame is a refusal, never an escape', () => {
  const { gate, listeners } = guestSetup();
  const calls = [];
  gate.tabGuest.on('guest-vault-gesture', {}, () => calls.push(1));
  const disposed = {
    sender: { id: 10, mainFrame: { frameTreeNodeId: 1 } },
    get senderFrame() {
      return {
        get frameTreeNodeId() {
          throw new Error('Render frame was disposed before WebFrameMain could be accessed');
        }
      };
    }
  };
  assert.doesNotThrow(() => listeners.get('guest-vault-gesture')(disposed));
  // `parent === null` would be true for a frame no longer in the tree; it must NOT admit it.
  const detached = { sender: { id: 10, mainFrame: { frameTreeNodeId: 1 } }, senderFrame: { parent: null } };
  listeners.get('guest-vault-gesture')(detached);
  assert.deepEqual(calls, []);
});

test('tab-guest switches: popups, internalTabs and activeOnly each admit exactly what they say, each off by default', () => {
  const { gate, listeners, recA } = guestSetup({ popups: [50] });
  const seen = { plain: [], popups: [], internal: [], active: [], activeAndPopups: [] };
  gate.tabGuest.on('guest-vault-gesture', {}, (e) => seen.plain.push(e.sender.id));
  gate.tabGuest.on('guest-window-close', { popups: true }, (e) => seen.popups.push(e.sender.id));
  gate.tabGuest.on('guest-vault-icon-menu', { internalTabs: true }, (e) => seen.internal.push(e.sender.id));
  gate.tabGuest.on('guest-tab-boundary', { internalTabs: true, activeOnly: true }, (e) =>
    seen.active.push(e.sender.id)
  );
  gate.tabGuest.on('guest-media-list', { popups: true, activeOnly: true }, (e) =>
    seen.activeAndPopups.push(e.sender.id)
  );
  for (const id of [10, 11, 12, 50, 99]) {
    listeners.get('guest-vault-gesture')(guestFrom(id));
    listeners.get('guest-window-close')(guestFrom(id));
    listeners.get('guest-vault-icon-menu')(guestFrom(id));
    listeners.get('guest-tab-boundary')(guestFrom(id));
    listeners.get('guest-media-list')(guestFrom(id));
  }
  assert.deepEqual(seen.plain, [10, 11], 'no switch: web tabs only — not an internal tab, not a popup');
  assert.deepEqual(seen.popups, [10, 11, 50], 'popups: a popup is admitted too; an internal tab is not');
  assert.deepEqual(seen.internal, [10, 11, 12], 'internalTabs: a trusted internal tab is admitted; a popup is not');
  assert.deepEqual(
    seen.active,
    [10],
    'activeOnly: only the window ACTIVE tab — a background web tab and an inactive internal tab are refused'
  );
  // An internal tab that IS the active tab is admitted (internalTabs + activeOnly together).
  recA.activeTabWcId = 12;
  listeners.get('guest-tab-boundary')(guestFrom(12));
  listeners.get('guest-tab-boundary')(guestFrom(10));
  assert.deepEqual(seen.active, [10, 12]);
  assert.deepEqual(seen.activeAndPopups, [10], 'a popup is never "the active tab"');
});

test('tab-guest registration: the switches must be stated, known and boolean', () => {
  const { gate } = guestSetup();
  assert.throws(() => gate.tabGuest.on('guest-vault-gesture', undefined, () => 1), /must state its tab-guest switches/);
  assert.throws(() => gate.tabGuest.on('guest-vault-gesture', { popup: true }, () => 1), /unknown tab-guest switch/);
  assert.throws(() => gate.tabGuest.on('guest-vault-gesture', { popups: 'yes' }, () => 1), /must be a boolean/);
  assert.throws(() => gate.chrome.on('guest-vault-gesture', () => 1), /classed 'tab-guest' but registered as 'chrome'/);
  assert.throws(() => gate.tabGuest.on('settings-get', {}, () => 1), /classed 'chrome' but registered as 'tab-guest'/);
});

test('tab-guest (synchronous): EVERY path sets event.returnValue — allowed, refused, and a handler throw', () => {
  const { gate, listeners } = guestSetup({ popups: [50] });
  gate.tabGuest.sync('vault-eligible', { popups: true }, () => ({ eligible: true }), {
    value: { eligible: false, unlocked: false }
  });
  const fn = listeners.get('vault-eligible');
  const allowed = { ...guestFrom(10) };
  fn(allowed);
  assert.deepEqual(allowed.returnValue, { eligible: true }, 'allowed: the handler value');
  const popup = { ...guestFrom(50) };
  fn(popup);
  assert.deepEqual(popup.returnValue, { eligible: true }, 'a popup is admitted when the switch is on');
  const refused = { ...guestFrom(99) };
  fn(refused);
  assert.deepEqual(refused.returnValue, { eligible: false, unlocked: false }, 'refused: the refusal value');
  const subframe = { ...guestFrom(10, { frameId: 5 }) };
  fn(subframe);
  assert.deepEqual(
    subframe.returnValue,
    { eligible: false, unlocked: false },
    'a subframe is refused but still answered'
  );
  assert.ok('returnValue' in refused);
});

test('tab-guest (synchronous): a handler THROW answers with the refusal value and escapes nowhere', () => {
  const { gate, listeners } = guestSetup();
  gate.tabGuest.sync(
    'shields-farble',
    {},
    () => {
      throw new Error('boom');
    },
    { value: { farble: true, seed: 7 } }
  );
  const ev = guestFrom(10);
  assert.doesNotThrow(() => listeners.get('shields-farble')(ev));
  assert.deepEqual(ev.returnValue, { farble: true, seed: 7 });
});

test('tab-guest (synchronous): the refusal may be produced per call (a fresh value each time)', () => {
  const { gate, listeners } = guestSetup();
  let n = 0;
  gate.tabGuest.sync('shields-farble', {}, () => 'real', { produce: () => ({ farble: true, seed: ++n }) });
  const a = guestFrom(99);
  const b = guestFrom(99);
  listeners.get('shields-farble')(a);
  listeners.get('shields-farble')(b);
  assert.deepEqual([a.returnValue.seed, b.returnValue.seed], [1, 2]);
  assert.throws(() => gate.tabGuest.sync('vault-eligible', {}, () => 1), /must state its refusal value/);
  assert.throws(() => gate.tabGuest.sync('vault-eligible', {}, () => 1, {}), /must state its refusal value/);
});

test('a refusal on a new class traces ONE line with the class required and the sender kind', () => {
  const overlay = { id: 31 };
  const { gate, listeners, lines } = guestSetup({ env: { GOLDFINCH_IPC_TRACE: '1' } });
  gate.tabGuest.on('guest-vault-gesture', {}, () => 1);
  listeners.get('guest-vault-gesture')(guestFrom(99));
  gate.find.on('find-overlay:query', () => 1);
  listeners.get('find-overlay:query')(guestFrom(10));
  assert.equal(lines[0], '[ipc-gate] refused channel=guest-vault-gesture required=tab-guest sender=other');
  assert.equal(lines[1], '[ipc-gate] refused channel=find-overlay:query required=find sender=tab');
  assert.equal(lines.length, 2);
  void overlay;
});

// --- sheet class ------------------------------------------------------------------------

function sheetSetup({ current = { menuType: 'vault-unlock', token: 7 }, env = {} } = {}) {
  const sheetSender = { id: 31 };
  const state = { current };
  const sheet = {
    getCurrentMenu: () => state.current,
    getView: () => ({ webContents: { ...sheetSender, isDestroyed: () => false } })
  };
  const rec = { id: 'A', sheet };
  const s = setup({
    env,
    extraRegistry: {
      recordForOverlaySender: (sender, key) => (sender === sheetSender && key === 'sheet' ? rec : null),
      getWindowForGuest: (id) => (id === 77 ? { id: 'guest-owner' } : null)
    }
  });
  return { ...s, sheetSender, state, rec };
}
const sheetEvent = (sender) => ({ sender, senderFrame: {} });

test('sheet registration: the menu-type argument is mandatory, well-formed and equal to the table row', () => {
  const { gate } = sheetSetup();
  assert.throws(() => gate.sheet.on('menu-overlay:activated', undefined, () => 1), /must state its sheet menu types/);
  assert.throws(() => gate.sheet.on('menu-overlay:activated', [], () => 1), /must state its sheet menu types/);
  assert.throws(
    () => gate.sheet.on('menu-overlay:activated', ['vault-unlock', ''], () => 1),
    /must state its sheet menu types/
  );
  assert.throws(() => gate.sheet.on('menu-overlay:activated', 'any', () => 1), /must state its sheet menu types/);
  assert.throws(() => gate.sheet.on('menu-overlay:activated', 'sender-only', () => 1), /differ from the table row/);
  assert.throws(
    () => gate.sheet.handle('menu-overlay:vault-unlock', ['vault-set'], () => 1, 'throw'),
    /differ from the table row/
  );
  assert.throws(() => gate.chrome.on('menu-overlay:activated', () => 1), /classed 'sheet' but registered as 'chrome'/);
  assert.throws(
    () => gate.sheet.on('settings-get', 'any-open-menu', () => 1),
    /classed 'chrome' but registered as 'sheet'/
  );
});

test('sheet registration: an emptied table row makes registration throw (the table is the single source)', () => {
  const emptied = { ...SHEET_MENU_TYPES, 'menu-overlay:vault-unlock': [] };
  const handles = new Map();
  const gate = createIpcGate({
    ipcMain: { handle: (c, f) => handles.set(c, f), on() {} },
    registry: {},
    sheetMenuTypes: emptied,
    env: {},
    logger: { log() {} }
  });
  assert.throws(
    () => gate.sheet.handle('menu-overlay:vault-unlock', emptied['menu-overlay:vault-unlock'], () => 1, 'throw'),
    /must state its sheet menu types/
  );
});

test('sheet (one-way): valid under a listed type, refused under an unlisted type, with no menu open, and from a non-sheet sender', () => {
  const { gate, listeners, sheetSender, state } = sheetSetup();
  const calls = [];
  gate.sheet.on('menu-overlay:overflow-drop', ['bookmarks-overflow'], (_e, p) => calls.push(p));
  const fn = listeners.get('menu-overlay:overflow-drop');
  state.current = { menuType: 'bookmarks-overflow', token: 1 };
  fn(sheetEvent(sheetSender), 'listed');
  state.current = { menuType: 'vault-unlock', token: 1 };
  fn(sheetEvent(sheetSender), 'unlisted');
  state.current = null;
  fn(sheetEvent(sheetSender), 'no-menu');
  state.current = { menuType: 'bookmarks-overflow', token: 1 };
  fn(sheetEvent({ id: 5 }), 'not-the-sheet');
  fn({ sender: sheetSender, senderFrame: null }, 'null-frame');
  assert.deepEqual(calls, ['listed']);
});

test("sheet 'any-open-menu': valid under EVERY menu type, refused when no menu is open", () => {
  const { gate, listeners, sheetSender, state } = sheetSetup();
  const calls = [];
  gate.sheet.on('menu-overlay:activated', 'any-open-menu', (_e, p) => calls.push(p));
  const fn = listeners.get('menu-overlay:activated');
  const types = [
    'kebab',
    'vault-unlock',
    'vault-set',
    'vault-stepup',
    'vault-import-unlock',
    'vault-change-master',
    'vault-recover',
    'vault-recovery-show',
    'vault-accesskey-show',
    'vault-adminkey-show',
    'vault-compromise',
    'vault-compromise-recover',
    'vault-picker',
    'auth-basic',
    'cert-picker',
    'bookmark-edit',
    'bookmarks-overflow',
    'cert-override',
    'cert-viewer',
    'site-info',
    'suggestions',
    'downloads',
    'input-dialog'
  ];
  for (const menuType of types) {
    state.current = { menuType, token: 1 };
    fn(sheetEvent(sheetSender), menuType);
  }
  state.current = null;
  fn(sheetEvent(sheetSender), 'no-menu');
  assert.deepEqual(calls, types);
});

test("sheet 'sender-only': the drag channel's `end` still reaches the handler with NO menu open", () => {
  const { gate, listeners, sheetSender, state } = sheetSetup({ current: null });
  const calls = [];
  gate.sheet.on('menu-overlay:sheet-drag', 'sender-only', (_e, p) => calls.push(p));
  const fn = listeners.get('menu-overlay:sheet-drag');
  fn(sheetEvent(sheetSender), { phase: 'end', token: 3 });
  fn(sheetEvent({ id: 5 }), { phase: 'end', token: 3 });
  state.current = { menuType: 'kebab', token: 3 };
  fn(sheetEvent(sheetSender), { phase: 'start' });
  assert.deepEqual(calls, [{ phase: 'end', token: 3 }, { phase: 'start' }]);
});

test('sheet (invoke): a refusal returns the stated value, never runs the handler, and ZEROES every byte array the payload carried', async () => {
  const { gate, handles, sheetSender, state } = sheetSetup({ current: { menuType: 'kebab', token: 7 } });
  let ran = false;
  gate.sheet.handle(
    'menu-overlay:vault-change-master',
    ['vault-change-master'],
    async () => {
      ran = true;
      return { ok: true };
    },
    { value: { ok: false } }
  );
  const fn = handles.get('menu-overlay:vault-change-master');
  const oldSecret = Uint8Array.from([1, 2, 3]);
  const newSecret = Uint8Array.from([4, 5, 6]);
  const res = await fn(sheetEvent(sheetSender), { token: 7, oldSecret, newSecret });
  assert.deepEqual(res, { ok: false });
  assert.equal(ran, false, 'the handler never ran');
  assert.deepEqual([...oldSecret], [0, 0, 0], 'old secret zeroed on refusal');
  assert.deepEqual([...newSecret], [0, 0, 0], 'new secret zeroed on refusal');
  // A bare array argument is zeroed too; a refused WRONG-SENDER call zeroes as well.
  const bare = Uint8Array.from([9, 9]);
  await fn(sheetEvent({ id: 5 }), bare);
  assert.deepEqual([...bare], [0, 0]);
  // The allowed path does not touch the arrays (the handler's own `finally` owns them).
  state.current = { menuType: 'vault-change-master', token: 7 };
  const kept = Uint8Array.from([7, 7]);
  assert.deepEqual(await fn(sheetEvent(sheetSender), { token: 7, oldSecret: kept, newSecret: kept }), { ok: true });
  assert.deepEqual([...kept], [7, 7]);
  assert.equal(ran, true);
});

test('sheet: a getCurrentMenu that throws is a refusal', () => {
  const { gate, listeners, sheetSender, rec } = sheetSetup();
  rec.sheet.getCurrentMenu = () => {
    throw new Error('boom');
  };
  const calls = [];
  gate.sheet.on('menu-overlay:activated', 'any-open-menu', () => calls.push(1));
  assert.doesNotThrow(() => listeners.get('menu-overlay:activated')(sheetEvent(sheetSender)));
  assert.deepEqual(calls, []);
});

test('sheet: a refusal traces the class and the sender kind (a tab page is `tab`)', () => {
  const { gate, handles, lines } = sheetSetup({ env: { GOLDFINCH_IPC_TRACE: '1' } });
  gate.sheet.handle('menu-overlay:vault-unlock', ['vault-unlock'], () => 1, { value: { ok: false } });
  handles.get('menu-overlay:vault-unlock')({ sender: { id: 77 }, senderFrame: {} }, { token: 1 });
  assert.deepEqual(lines, ['[ipc-gate] refused channel=menu-overlay:vault-unlock required=sheet sender=tab']);
});

// --- find / save-prompt / find-or-owning-chrome -------------------------------------------

function overlaySetup({ env = {} } = {}) {
  const findSender = { id: 41 };
  const promptSender = { id: 51 };
  const rec = { id: 'A' };
  const s = setup({
    env,
    extraRegistry: {
      recordForOverlaySender: (sender, key) =>
        (sender === findSender && key === 'findOverlay') || (sender === promptSender && key === 'savePrompt')
          ? rec
          : null,
      getWindowForGuest: (id) => (id === 77 ? { id: 'guest-owner' } : null)
    }
  });
  return { ...s, findSender, promptSender };
}

test('find: only the window find overlay; save-prompt: only the window save-prompt view — in invoke and one-way forms', async () => {
  const { gate, handles, listeners, findSender, promptSender, chromeSender } = overlaySetup();
  const calls = [];
  gate.find.on('find-overlay:query', (_e, p) => calls.push(['find', p]));
  gate.savePrompt.on('save-prompt:dismiss', (_e, p) => calls.push(['dismiss', p]));
  gate.savePrompt.handle('save-prompt:save', () => 'saved', { value: { saved: false, reason: 'refused' } });
  listeners.get('find-overlay:query')(sheetEvent(findSender), 1);
  listeners.get('find-overlay:query')(sheetEvent(promptSender), 2);
  listeners.get('find-overlay:query')(eventFrom(chromeSender), 3);
  listeners.get('find-overlay:query')({ sender: { id: 77 }, senderFrame: {} }, 4);
  listeners.get('save-prompt:dismiss')(sheetEvent(promptSender), 5);
  listeners.get('save-prompt:dismiss')(sheetEvent(findSender), 6);
  assert.deepEqual(calls, [
    ['find', 1],
    ['dismiss', 5]
  ]);
  assert.equal(handles.get('save-prompt:save')(sheetEvent(promptSender)), 'saved');
  assert.deepEqual(handles.get('save-prompt:save')(sheetEvent(findSender)), { saved: false, reason: 'refused' });
  assert.deepEqual(handles.get('save-prompt:save')({ sender: { id: 77 }, senderFrame: {} }), {
    saved: false,
    reason: 'refused'
  });
  assert.deepEqual(handles.get('save-prompt:save')({ sender: promptSender, senderFrame: null }), {
    saved: false,
    reason: 'refused'
  });
});

test('find-or-owning-chrome: the find overlay OR a window chrome; nothing else', () => {
  const { gate, listeners, findSender, promptSender, chromeSender } = overlaySetup();
  const calls = [];
  gate.findOrOwningChrome.on('find-overlay:close', (e) => calls.push(e.sender.id));
  const fn = listeners.get('find-overlay:close');
  fn(sheetEvent(findSender));
  fn(eventFrom(chromeSender));
  fn(sheetEvent(promptSender));
  fn({ sender: { id: 77 }, senderFrame: {} });
  fn({ sender: findSender, senderFrame: null });
  assert.deepEqual(calls, [41, 1]);
  assert.throws(
    () => gate.find.on('find-overlay:close', () => 1),
    /classed 'find-or-owning-chrome' but registered as 'find'/
  );
});

// --- extractor hardening ------------------------------------------------------------------

test('an extractor that THROWS is a refusal in the one-way form (it must not escape the listener) and the invoke form', () => {
  const { gate, listeners, handles, chromeSender } = setup({ owned: [10] });
  const ran = [];
  gate.owningChrome.on(
    'tab-close',
    () => {
      throw new Error('extractor boom');
    },
    () => ran.push('on')
  );
  gate.owningChrome.handle(
    'vault-reachable-items',
    () => {
      throw new Error('extractor boom');
    },
    () => ran.push('handle'),
    'throw'
  );
  assert.doesNotThrow(() => listeners.get('tab-close')(eventFrom(chromeSender), 10));
  assert.throws(() => handles.get('vault-reachable-items')(eventFrom(chromeSender), 10), /forbidden/);
  assert.deepEqual(ran, []);
});

test('an extractor tolerates a missing or non-object payload (the download-media form): no tab named passes as chrome-only', () => {
  const { gate, handles, chromeSender } = setup({ owned: [10] });
  gate.owningChrome.handle(
    'vault-reachable-items',
    (payload) => (payload && typeof payload === 'object' ? payload.webContentsId : undefined),
    () => 'ok',
    'throw'
  );
  const fn = handles.get('vault-reachable-items');
  for (const payload of [undefined, null, 5, 'x', [], {}]) assert.equal(fn(eventFrom(chromeSender), payload), 'ok');
  assert.equal(fn(eventFrom(chromeSender), { webContentsId: 10 }), 'ok');
  assert.throws(() => fn(eventFrom(chromeSender), { webContentsId: '10' }), /forbidden/, 'non-numeric id');
  assert.throws(() => fn(eventFrom(chromeSender), { webContentsId: 900 }), /forbidden/, "another window's tab");
  assert.throws(
    () => fn(eventFrom(chromeSender), { webContentsId: 1 }),
    /forbidden/,
    'an id that is the chrome itself'
  );
});
