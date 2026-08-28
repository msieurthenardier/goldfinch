'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/shortcut-controller.js')).href;

function harness() {
  const calls = [];
  const listeners = {};
  const forwarded = {};
  const tab = { id: 'b', wcId: 22, internal: false };
  const state = { active: tab };
  const els = {
    address: { focus: () => calls.push('focus'), select: () => calls.push('select') },
    lightbox: { classList: { contains: () => true } }
  };
  const window = {
    // Real getClientRects() stays non-empty for a `visibility: hidden`
    // element (only display:none zeroes it) — lastVisibleChromeTabbable
    // needs computed visibility too. Fake elements below default to
    // 'visible' via an own `style` object.
    getComputedStyle: (el) => ({ visibility: el.style?.visibility ?? 'visible' }),
    goldfinch: {
      toggleDevtools: (x) => calls.push(['devtools', x]),
      zoomApply: (x) => calls.push(['zoom', x]),
      windowCreate: () => calls.push('window'),
      tabReopen: async () => null,
      tabNavigate: (x) => calls.push(['reload', x]),
      onChromeShortcutAction: (fn) => {
        forwarded.fn = fn;
      },
      toggleBookmarksBar: () => calls.push('toggle-bookmarks-bar'),
      // M17 F1 L1 (DD2/DD4): F6 focus-entry + the guest tab-boundary push.
      focusActiveGuest: () => {
        calls.push('focus-active-guest');
        return Promise.resolve(true);
      },
      onTabBoundary: (fn) => {
        forwarded.tabBoundaryFn = fn;
      }
    }
  };
  // Fake chrome-document tabbables for the backward-boundary target
  // (lastVisibleChromeTabbable). Order matters — the LAST one is the expected
  // Shift+Tab landing spot.
  const chromeFakeButton1 = {
    focus: () => calls.push('focus-fake-1'),
    attrs: {},
    style: {},
    hasAttribute: () => false,
    getAttribute: () => null,
    getClientRects: () => [{}]
  };
  const chromeFakeButton2 = {
    focus: () => calls.push('focus-fake-2'),
    attrs: {},
    style: {},
    hasAttribute: () => false,
    getAttribute: () => null,
    getClientRects: () => [{}]
  };
  const deps = {
    window,
    document: {
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      querySelectorAll: () => [chromeFakeButton1, chromeFakeButton2],
      // M17 F1 L2 (DD9): the backward-boundary walk now runs through the
      // shared tabSequence(document) helper, which reads
      // doc.defaultView.getComputedStyle for the visibility:hidden filter —
      // the real-DOM relationship (document.defaultView === window) mirrored
      // here so the fake exercises the exact same code path.
      defaultView: window
    },
    ctx: { activeTabId: 'b' },
    els,
    activeTab: () => state.active,
    isInternalTab: (t) => !!t?.internal,
    isWebTab: (t) => !!t && !t.internal,
    openFind: (t) => calls.push(['find', t.id]),
    createTab: (...x) => calls.push(['create', ...x]),
    openNewTab: () => calls.push('new-tab'), // M16 F2 Leg 1 (DD4)
    closeTab: (id) => calls.push(['close', id]),
    jarsClient: { inheritContainerFromPartition: () => ({ id: 'jar' }) },
    announceTabStatus: (x) => calls.push(['announce', x]),
    togglePanel: () => calls.push('panel'),
    togglePrivacy: () => calls.push('privacy'),
    openDownloads: () => calls.push('downloads'),
    orderedTabIds: () => ['a', 'b', 'c'],
    activateTab: (id) => {
      calls.push(['activate', id]);
      deps.ctx.activeTabId = id;
    },
    keydownToAction: ({ key }) => (key === 'F12' ? 'devtools' : key === 'j' ? 'downloads' : null),
    handleBookmarkStarActivate: (t) => calls.push(['bookmark-star', t && t.id])
  };
  return { deps, state, tab, calls, listeners, forwarded, chromeFakeButton2 };
}

async function create(h) {
  const { createShortcutController } = await import(moduleUrl);
  return createShortcutController(h.deps);
}

test('guarded actions refuse internal tabs without claiming prevent-default', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { ...h.tab, internal: true };
  for (const action of ['devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'find']) {
    assert.equal(controller.dispatchChromeAction(action), false, action);
  }
  assert.deepEqual(h.calls, []);
  assert.equal(controller.dispatchChromeAction('reload'), true);
  assert.equal(controller.dispatchChromeAction('downloads'), true);
  assert.deepEqual(h.calls, [], 'reload and downloads are swallowed but remain inert on internal tabs');
});

test('every shortcut action maps to its existing tab, window, panel, and navigation body', async () => {
  const h = harness();
  const controller = await create(h);
  const actions = [
    'devtools',
    'zoom-in',
    'zoom-out',
    'zoom-reset',
    'find',
    'new-tab',
    'close-tab',
    'new-window',
    'reopen-closed-tab',
    'focus-address',
    'toggle-panel',
    'toggle-privacy',
    'reload',
    'downloads',
    'tab-next',
    'tab-prev',
    'tab-jump-1',
    'tab-jump-8',
    'tab-jump-last',
    'bookmark-page',
    'toggle-bookmarks-bar',
    'focus-content',
    'focus-chrome',
    'focus-chrome-end'
  ];
  for (const action of actions) assert.equal(controller.dispatchChromeAction(action), true, action);
  assert.ok(h.calls.some(([name]) => name === 'devtools'));
  assert.equal(h.calls.filter((item) => Array.isArray(item) && item[0] === 'zoom').length, 3);
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'find'));
  assert.ok(
    h.calls.includes('window') &&
      h.calls.includes('panel') &&
      h.calls.includes('privacy') &&
      h.calls.includes('downloads')
  );
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'activate' && item[1] === 'c'));
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'bookmark-star' && item[1] === 'b'));
  assert.ok(h.calls.includes('toggle-bookmarks-bar'));
  // M16 F2 Leg 1 (DD4): Ctrl+T routes through openNewTab, never a bare createTab().
  assert.ok(h.calls.includes('new-tab'));
  assert.ok(!h.calls.some((item) => Array.isArray(item) && item[0] === 'create'));
  assert.equal(controller.dispatchChromeAction('unknown'), false);
});

test('toggle-bookmarks-bar (Ctrl+Shift+B) calls the main-side toggle channel exactly', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.dispatchChromeAction('toggle-bookmarks-bar'), true);
  assert.deepEqual(h.calls, ['toggle-bookmarks-bar']);
});

test('bookmark-page (Ctrl+D) behaves EXACTLY like a star click — routes the active tab through the one shared handler', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.dispatchChromeAction('bookmark-page'), true);
  assert.deepEqual(h.calls, [['bookmark-star', 'b']]);
});

test('classifier dispatch prevents default only for handled actions and forwarded actions reuse it', async () => {
  const h = harness();
  await create(h);
  let prevented = false;
  h.listeners.keydown({
    key: 'F12',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  h.state.active = { ...h.tab, internal: true };
  prevented = false;
  h.listeners.keydown({
    key: 'F12',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {
      prevented = true;
    }
  });
  assert.equal(prevented, false);
  h.state.active = h.tab;
  h.forwarded.fn({ action: 'new-window' });
  assert.ok(h.calls.includes('window'));
});

// ---------------------------------------------------------------------------
// F6 / Shift+F6 + the guest tab-boundary push (M17 F1 L1, DD1/DD2/DD4)
// ---------------------------------------------------------------------------

test('focus-content (F6) calls the focusActiveGuest bridge with no wcId argument', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.dispatchChromeAction('focus-content'), true);
  assert.ok(h.calls.includes('focus-active-guest'));
});

test('focus-chrome (Shift+F6, from the chrome) is a handled no-op — no side effect', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.dispatchChromeAction('focus-chrome'), true);
  assert.deepEqual(h.calls, []);
});

// M17 F1 L2 (DD6/AC2): Shift+F6 FROM the guest — 'focus-chrome-end' focuses
// the chrome's last visible tabbable, the SAME target the backward boundary
// picks (DD9's shared tabSequence walk), with a visibility:hidden control
// present at the true end of DOM order so a naive getClientRects()-only walk
// would land on the wrong element.
test("focus-chrome-end (Shift+F6, from the guest) focuses the chrome's last visible tabbable, skipping a visibility:hidden control", async () => {
  const h = harness();
  const calls = [];
  const fakeDoc = realisticChromeFakeDocument(calls);
  h.deps.document = {
    addEventListener: h.deps.document.addEventListener,
    querySelectorAll: fakeDoc.querySelectorAll,
    defaultView: h.deps.window
  };
  const controller = await create(h);
  assert.equal(controller.dispatchChromeAction('focus-chrome-end'), true);
  assert.deepEqual(calls, ['focus-kebab'], 'must land on #kebab, not the invisible #privacy-close');
});

test('onTabBoundary forward: focuses and selects the address bar', async () => {
  const h = harness();
  await create(h);
  assert.equal(typeof h.forwarded.tabBoundaryFn, 'function');
  h.forwarded.tabBoundaryFn({ direction: 'forward' });
  assert.deepEqual(h.calls, ['focus', 'select']);
});

test("onTabBoundary backward: focuses the chrome's LAST visible tabbable", async () => {
  const h = harness();
  await create(h);
  h.forwarded.tabBoundaryFn({ direction: 'backward' });
  assert.deepEqual(h.calls, ['focus-fake-2'], 'the LAST entry in the fake tabbable list, not the first');
});

test('onTabBoundary: an unrecognized direction is a no-op', async () => {
  const h = harness();
  await create(h);
  h.forwarded.tabBoundaryFn({ direction: 'sideways' });
  assert.deepEqual(h.calls, []);
});

// ---------------------------------------------------------------------------
// Regression (behavior-test run 2026-08-27-23-14-02, checkpoint 8 / diag-8):
// Shift+Tab at the guest's first tabbable delivered `{direction:'backward'}`
// to the chrome (proven end to end by diag-8's collector) but the chrome's
// DOM focus never moved off BODY. Root cause: isFocusableChromeEl's
// visibility test was `getClientRects().length > 0` alone — that only
// detects display:none. A `visibility: hidden` element (exactly what the
// collapsed media/privacy panels use, DD4, since width:0/overflow:hidden
// alone leaves non-empty client rects) STILL reports non-empty
// getClientRects(): the layout box is preserved, only painting/focusability
// is suppressed. So the querySelectorAll walk's last MATCHING node could be
// a real, but invisible-and-unfocusable, panel button — .focus() on it is a
// silent no-op in a real browser (an element that "is not being rendered"
// per the HTML focusable-area algorithm), reproducing activeElement staying
// BODY with no thrown error. This harness models that precisely: a
// visibility:hidden control (mimicking the collapsed privacy-panel's
// #privacy-close) sits AFTER the real last toolbar control in DOM order,
// with getClientRects() still non-empty — exactly like the live app.
function realisticChromeFakeDocument(calls) {
  function makeEl(id, { visibility = 'visible', displayNone = false } = {}) {
    return {
      id,
      style: { visibility },
      hasAttribute: () => false,
      getAttribute: () => null,
      getClientRects: () => (displayNone ? [] : [{}]),
      focus: () => calls.push(`focus-${id}`)
    };
  }
  // DOM order mirrors src/renderer/index.html: toolbar controls, then a
  // tab-strip button, then #address, then (later in the document) the
  // collapsed privacy panel's close button — visible per getClientRects()
  // (visibility:hidden preserves layout) but NOT actually focusable.
  const back = makeEl('back');
  const toggleDevtools = makeEl('toggle-devtools');
  const kebab = makeEl('kebab'); // the real last VISIBLE chrome tabbable
  const address = makeEl('address');
  const newTabStripButton = makeEl('new-tab');
  const lightboxCloseWhenHidden = makeEl('lightbox-close', { displayNone: true }); // display:none — already correctly excluded today
  const privacyClose = makeEl('privacy-close', { visibility: 'hidden' }); // the bug: last DOM match, but unfocusable
  const nodes = [back, toggleDevtools, newTabStripButton, address, kebab, lightboxCloseWhenHidden, privacyClose];
  return { querySelectorAll: () => nodes, addressEl: address, kebabEl: kebab, privacyCloseEl: privacyClose };
}

test('onTabBoundary backward: skips a visibility:hidden control that still has non-empty getClientRects() and focuses the real last VISIBLE chrome tabbable', async () => {
  const h = harness();
  const calls = [];
  const fakeDoc = realisticChromeFakeDocument(calls);
  h.deps.document = {
    addEventListener: h.deps.document.addEventListener,
    querySelectorAll: fakeDoc.querySelectorAll,
    defaultView: h.deps.window
  };
  const controller = await create(h);
  h.forwarded.tabBoundaryFn({ direction: 'backward' });
  assert.deepEqual(calls, ['focus-kebab'], 'must land on #kebab, not the invisible #privacy-close');

  // Forward direction is unaffected by this fix — still #address, still selected.
  h.calls.length = 0;
  h.forwarded.tabBoundaryFn({ direction: 'forward' });
  assert.deepEqual(h.calls, ['focus', 'select']);
  void controller;
});
