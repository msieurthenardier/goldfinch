'use strict';

// Mission 20 Flight 3 Leg 1 (DD11): behaviour pins for the generic overlay
// dispatch switch, extracted verbatim out of renderer.js into
// src/renderer/chrome/overlay-dispatch.js. This is the extraction's OWN
// first-ever test coverage — the switch had none before (the leg's Context
// notes CLAUDE.md's unit-twin inventory only covers the shared MODELS, never
// the switch itself). Every dependency is a hand-rolled call-recording fake
// (this repo's existing convention — see site-security-controller.test.js —
// rather than node:test's `mock` module).
//
// The bounded case-label scan (the sheet-automation-gate-invariant.test.js
// idiom, CLAUDE.md "Grep-AC convention") keeps this file honest against
// drift: if overlay-dispatch.js gains or loses a `case` label in
// dispatchActivation without a matching describe block below, the scan test
// fails loudly instead of the extraction silently losing coverage.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');
const { createOverlayDispatch } = require('../../src/renderer/chrome/overlay-dispatch');

const MODULE_PATH = path.join(__dirname, '..', '..', 'src', 'renderer', 'chrome', 'overlay-dispatch.js');

// The fixed list this test's own describe blocks cover — kept in the same
// order the switch declares them, source of truth for the bounded scan below.
const EXPECTED_CASES = [
  'kebab',
  'container',
  'new-container',
  'auth-basic',
  'cert-picker',
  'bookmark-edit',
  'bookmarks-overflow',
  'page-context',
  'tab-context',
  'suggestions'
];

test('bounded scan: every case label in dispatchActivation has a matching pin in EXPECTED_CASES (and vice versa)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const masked = maskComments(source);
  const anchor = 'function dispatchActivation(';
  const anchorIdx = masked.indexOf(anchor);
  assert.notEqual(anchorIdx, -1, 'dispatchActivation must exist');
  assert.equal(
    masked.indexOf(anchor, anchorIdx + 1),
    -1,
    'dispatchActivation must appear exactly once (vacuity guard)'
  );
  // Skip the parameter destructure's own `{ menuType, id, value }` brace —
  // find the matching ')' for the anchor's '(' first, THEN the function
  // BODY's opening '{' after it.
  const parenOpen = anchorIdx + anchor.length - 1;
  const parenClose = findMatchingBracket(masked, parenOpen, '(', ')');
  assert.notEqual(parenClose, -1, 'dispatchActivation parameter list must be balanced');
  const openBrace = masked.indexOf('{', parenClose);
  const closeBrace = findMatchingBracket(masked, openBrace, '{', '}');
  assert.notEqual(closeBrace, -1, 'dispatchActivation body must be a balanced block');
  const body = masked.slice(openBrace, closeBrace);
  const found = [...body.matchAll(/case\s+'([^']+)':/g)].map((m) => m[1]);
  assert.deepEqual(
    [...found].sort(),
    [...EXPECTED_CASES].sort(),
    "a case label was added or removed in overlay-dispatch.js without updating this test's EXPECTED_CASES list"
  );
});

/** @param {any} [overrides] */
function setup(overrides = {}) {
  const calls = {
    openNewContainerOverlay: [],
    openNewTab: [],
    openJarsPage: [],
    createContainerAndOpenTab: [],
    bookmarksDispatch: [],
    createTab: [],
    toast: [],
    openWelcomeTab: [],
    activateTab: [],
    closeTab: [],
    announceTabStatus: [],
    dispatchChromeAction: [],
    handleBookmarkStarActivate: [],
    dispatchSuggestion: [],
    handleSuggestionsClosed: [],
    lockVaultNow: [],
    vaultHandleClosed: [],
    siteSecurityHandleClosed: [],
    clipboardWriteText: [],
    downloadMedia: [],
    pageContextAction: [],
    correctMisspelling: [],
    toggleDevtools: [],
    unpinToolbarItem: [],
    tabHistorySnapshot: [],
    tabMoveToNewWindow: [],
    tabMoveToWindow: [],
    addressFocus: []
  };

  const jarsClient = {
    makeBurner: () => overrides.burner || { id: 'burner-1', burner: true },
    containers: overrides.jarsContainers || [{ id: 'work' }],
    inheritContainerFrom: (tab) => (tab ? { id: 'inherited-for-' + (tab.id || 'unknown') } : null)
  };

  const tabs = overrides.tabsMap || new Map();
  let orderedIds = overrides.orderedIds || [];
  const ctx = overrides.ctx || { activeTabId: 'the-active-tab' };

  let pageCtxState = overrides.pageCtxState || { wcId: null, params: null, returnFocus: null, toolbarItem: null };
  let tabCtxState = overrides.tabCtxState || { tabId: null, returnFocus: null };

  const bridge = {
    clipboardWriteText: (text) => calls.clipboardWriteText.push(text),
    downloadMedia:
      overrides.downloadMedia ||
      ((payload) => {
        calls.downloadMedia.push(payload);
        return { ok: true };
      }),
    pageContextAction: (payload) => calls.pageContextAction.push(payload),
    correctMisspelling: (payload) => calls.correctMisspelling.push(payload),
    toggleDevtools: (payload) => calls.toggleDevtools.push(payload),
    unpinToolbarItem: (item) => calls.unpinToolbarItem.push(item),
    tabHistorySnapshot:
      overrides.tabHistorySnapshot ||
      ((payload) => {
        calls.tabHistorySnapshot.push(payload);
        return Promise.resolve(null);
      }),
    tabMoveToNewWindow: (payload) => calls.tabMoveToNewWindow.push(payload),
    tabMoveToWindow:
      overrides.tabMoveToWindow ||
      ((payload) => {
        calls.tabMoveToWindow.push(payload);
        return Promise.resolve({ ok: true });
      })
  };

  const els = { address: { focus: () => calls.addressFocus.push(true) } };

  const deps = {
    KEBAB_ACTIONS: overrides.KEBAB_ACTIONS || {},
    openNewContainerOverlay: () => calls.openNewContainerOverlay.push(true),
    openNewTab: (container) => calls.openNewTab.push(container),
    jarsClient,
    openJarsPage: () => calls.openJarsPage.push(true),
    createContainerAndOpenTab: (rawName) => calls.createContainerAndOpenTab.push(rawName),
    bookmarksBarController: { dispatch: (id) => calls.bookmarksDispatch.push(id) },
    findTabByWcId: overrides.findTabByWcId || (() => null),
    createTab: (...args) => calls.createTab.push(args),
    basenameFromUrl: (url) => 'basename-of:' + url,
    toast: (title, body) => calls.toast.push({ title, body }),
    capPendingQuery: overrides.capPendingQuery || ((text) => text),
    toUrl: overrides.toUrl || (() => null),
    openWelcomeTab: (opts) => calls.openWelcomeTab.push(opts),
    orderedTabIds: () => orderedIds,
    ctx,
    activateTab: (id) => calls.activateTab.push(id),
    closeTab: (id) => calls.closeTab.push(id),
    tabs,
    announceTabStatus: (text) => calls.announceTabStatus.push(text),
    moveOutcomeMessage: (result, destination) => ({ result, destination }),
    dispatchChromeAction: (action) => calls.dispatchChromeAction.push(action),
    handleBookmarkStarActivate: (tab) => calls.handleBookmarkStarActivate.push(tab),
    dispatchSuggestion: (id) => calls.dispatchSuggestion.push(id),
    handleSuggestionsClosed: (reason) => calls.handleSuggestionsClosed.push(reason),
    lockVaultNow: () => calls.lockVaultNow.push(true),
    vaultHandleClosed: (payload) => calls.vaultHandleClosed.push(payload),
    siteSecurityHandleClosed: (payload) => calls.siteSecurityHandleClosed.push(payload),
    bridge,
    els,
    pageCtx: () => pageCtxState,
    tabCtx: () => tabCtxState
  };

  const overlay = createOverlayDispatch(deps);
  return {
    overlay,
    calls,
    deps,
    setPageCtx: (v) => {
      pageCtxState = v;
    },
    setTabCtx: (v) => {
      tabCtxState = v;
    },
    setOrderedIds: (ids) => {
      orderedIds = ids;
    }
  };
}

// Asserts every call-recording array is empty — the validated-no-op idiom.
function assertNoCalls(calls) {
  for (const [key, arr] of Object.entries(calls)) {
    assert.deepEqual(arr, [], `expected no calls recorded for ${key}`);
  }
}

// ---------------------------------------------------------------------------
describe("case 'kebab'", () => {
  test('a known id runs the injected action from KEBAB_ACTIONS', () => {
    const ranWith = [];
    const h = setup({ KEBAB_ACTIONS: { settings: () => ranWith.push('settings') } });
    h.overlay.dispatchActivation({ menuType: 'kebab', id: 'settings' });
    assert.deepEqual(ranWith, ['settings']);
  });

  test('an unknown id is a no-op, never throws', () => {
    const h = setup({ KEBAB_ACTIONS: { settings: () => {} } });
    assert.doesNotThrow(() => h.overlay.dispatchActivation({ menuType: 'kebab', id: 'no-such-action' }));
  });
});

// ---------------------------------------------------------------------------
describe("case 'container'", () => {
  test("'action:new-container' opens the new-container dialog", () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'container', id: 'action:new-container' });
    assert.deepEqual(h.calls.openNewContainerOverlay, [true]);
    assert.deepEqual(h.calls.openNewTab, []);
  });

  test("'action:burner' calls jarsClient.makeBurner() then openNewTab with its result", () => {
    const burner = { id: 'burner-9', burner: true };
    const h = setup({ burner });
    h.overlay.dispatchActivation({ menuType: 'container', id: 'action:burner' });
    assert.deepEqual(h.calls.openNewTab, [burner]);
  });

  test("'action:manage-jars' opens the jars page", () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'container', id: 'action:manage-jars' });
    assert.deepEqual(h.calls.openJarsPage, [true]);
  });

  test("'jar:<jarId>' opens the matching container", () => {
    const c = { id: 'work' };
    const h = setup({ jarsContainers: [c] });
    h.overlay.dispatchActivation({ menuType: 'container', id: 'jar:work' });
    assert.deepEqual(h.calls.openNewTab, [c]);
  });

  test("'jar:<unknown>' is a no-op", () => {
    const h = setup({ jarsContainers: [{ id: 'work' }] });
    h.overlay.dispatchActivation({ menuType: 'container', id: 'jar:nope' });
    assert.deepEqual(h.calls.openNewTab, []);
  });
});

// ---------------------------------------------------------------------------
describe("case 'new-container'", () => {
  test("'create' calls createContainerAndOpenTab with the activation value", () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'new-container', id: 'create', value: 'My Jar' });
    assert.deepEqual(h.calls.createContainerAndOpenTab, ['My Jar']);
  });

  test('any other id is a no-op', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'new-container', id: 'cancel' });
    assert.deepEqual(h.calls.createContainerAndOpenTab, []);
  });
});

// ---------------------------------------------------------------------------
describe("case 'auth-basic' — validated no-op (credential rides a dedicated invoke, never this dispatch)", () => {
  test('every id calls nothing', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'auth-basic', id: 'cancel' });
    assertNoCalls(h.calls);
  });
});

// ---------------------------------------------------------------------------
describe("case 'cert-picker' — validated no-op (selection resolved main-side)", () => {
  test('every id calls nothing', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'cert-picker', id: 'cert:0' });
    h.overlay.dispatchActivation({ menuType: 'cert-picker', id: 'cancel' });
    assertNoCalls(h.calls);
  });
});

// ---------------------------------------------------------------------------
describe("case 'bookmark-edit' — validated no-op (submit rides a dedicated invoke, never this dispatch)", () => {
  test('every id calls nothing', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'bookmark-edit', id: 'anything' });
    assertNoCalls(h.calls);
  });
});

// ---------------------------------------------------------------------------
describe("case 'bookmarks-overflow'", () => {
  test('the id is forwarded verbatim to bookmarksBarController.dispatch', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'bookmarks-overflow', id: 'bookmark:2' });
    assert.deepEqual(h.calls.bookmarksDispatch, ['bookmark:2']);
  });
});

// ---------------------------------------------------------------------------
describe("case 'page-context'", () => {
  test("'link:open' opens the link URL in the source tab's inherited container", () => {
    const srcTab = { id: 'src' };
    const h = setup({ findTabByWcId: () => srcTab, pageCtxState: { wcId: 7, params: { linkURL: 'https://x/' } } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'link:open' });
    assert.deepEqual(h.calls.createTab, [['https://x/', { id: 'inherited-for-src' }]]);
  });

  test("'link:copy' writes the link URL to the clipboard", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: { linkURL: 'https://x/' } } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'link:copy' });
    assert.deepEqual(h.calls.clipboardWriteText, ['https://x/']);
  });

  test("'image:open' opens the image URL (srcURL preferred over imageURL)", () => {
    const h = setup({
      pageCtxState: {
        wcId: 7,
        params: { mediaType: 'image', srcURL: 'https://img/a.png', imageURL: 'https://img/b.png' }
      }
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'image:open' });
    assert.deepEqual(h.calls.createTab, [['https://img/a.png', null]]);
  });

  test("'image:copy' writes the image URL to the clipboard", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: { mediaType: 'image', srcURL: 'https://img/a.png' } } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'image:copy' });
    assert.deepEqual(h.calls.clipboardWriteText, ['https://img/a.png']);
  });

  test("'image:save' downloads the image via bridge.downloadMedia with a basename suggestion", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: { mediaType: 'image', srcURL: 'https://img/a.png' } } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'image:save' });
    assert.deepEqual(h.calls.downloadMedia, [
      { webContentsId: 7, url: 'https://img/a.png', suggestedName: 'basename-of:https://img/a.png' }
    ]);
  });

  test("'image:save' toasts on a failed download", async () => {
    const h = setup({
      pageCtxState: { wcId: 7, params: { mediaType: 'image', srcURL: 'https://img/a.png' } },
      downloadMedia: () => ({ ok: false, error: 'disk full' })
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'image:save' });
    await Promise.resolve().then().then(); // let the download's .then chain settle
    assert.deepEqual(h.calls.toast, [{ title: 'Download failed', body: 'disk full' }]);
  });

  test("'sel:copy' writes the selection text to the clipboard", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: { selectionText: 'hello world' } } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'sel:copy' });
    assert.deepEqual(h.calls.clipboardWriteText, ['hello world']);
  });

  test("'sel:search' creates a tab when toUrl resolves (an engine is chosen)", () => {
    const h = setup({
      pageCtxState: { wcId: 7, params: { selectionText: 'cats' } },
      toUrl: (q) => 'https://search/?q=' + q
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'sel:search' });
    assert.deepEqual(h.calls.createTab, [['https://search/?q=cats', null]]);
    assert.deepEqual(h.calls.openWelcomeTab, []);
  });

  test("'sel:search' opens a welcome tab with the pending query when toUrl resolves null (no engine chosen)", () => {
    const srcTab = { id: 'src' };
    const h = setup({
      findTabByWcId: () => srcTab,
      pageCtxState: { wcId: 7, params: { selectionText: 'cats' } },
      toUrl: () => null
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'sel:search' });
    assert.deepEqual(h.calls.openWelcomeTab, [
      { container: { id: 'inherited-for-src' }, reasons: ['search'], pendingQuery: 'cats' }
    ]);
    assert.deepEqual(h.calls.createTab, []);
  });

  test("'edit:copy' dispatches pageContextAction when isEditable and the flag is allowed", () => {
    const h = setup({
      pageCtxState: {
        wcId: 7,
        params: { isEditable: true, editFlags: { canCopy: true } }
      }
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'edit:copy' });
    assert.deepEqual(h.calls.pageContextAction, [{ webContentsId: 7, action: 'copy' }]);
  });

  test("'edit:copy' is a no-op when the captured editFlags disallow it", () => {
    const h = setup({
      pageCtxState: { wcId: 7, params: { isEditable: true, editFlags: { canCopy: false } } }
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'edit:copy' });
    assert.deepEqual(h.calls.pageContextAction, []);
  });

  test("'spell:<i>' corrects the misspelling at the captured index", () => {
    const h = setup({
      pageCtxState: { wcId: 7, params: { dictionarySuggestions: ['foo', 'bar'] } }
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'spell:1' });
    assert.deepEqual(h.calls.correctMisspelling, [{ webContentsId: 7, word: 'bar' }]);
  });

  test("'spell:<i>' out of range is a validated no-op", () => {
    const h = setup({
      pageCtxState: { wcId: 7, params: { dictionarySuggestions: ['foo'] } }
    });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'spell:9' });
    assert.deepEqual(h.calls.correctMisspelling, []);
  });

  test("'action:inspect' toggles devtools for the captured wcId", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:inspect' });
    assert.deepEqual(h.calls.toggleDevtools, [{ webContentsId: 7 }]);
  });

  test("'action:bookmark-page' re-resolves the tab from the captured wcId and runs the star handler", () => {
    const srcTab = { id: 'src', wcId: 7 };
    const h = setup({ findTabByWcId: (wcId) => (wcId === 7 ? srcTab : null), pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:bookmark-page' });
    assert.deepEqual(h.calls.handleBookmarkStarActivate, [srcTab]);
  });

  test("'action:bookmark-page' is a no-op when the captured tab has vanished", () => {
    const h = setup({ findTabByWcId: () => null, pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:bookmark-page' });
    assert.deepEqual(h.calls.handleBookmarkStarActivate, []);
  });

  test("'action:unpin:<item>' unpins the toolbar item and refocuses the address bar", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:unpin:media' });
    assert.deepEqual(h.calls.unpinToolbarItem, ['media']);
    assert.deepEqual(h.calls.addressFocus, [true]);
  });

  test("'action:unpin:<item>' with an unrecognized item is a no-op", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:unpin:not-a-real-item' });
    assert.deepEqual(h.calls.unpinToolbarItem, []);
    assert.deepEqual(h.calls.addressFocus, []);
  });

  test("'action:vault-lock' locks the vault now", () => {
    const h = setup({ pageCtxState: { wcId: 7, params: {} } });
    h.overlay.dispatchActivation({ menuType: 'page-context', id: 'action:vault-lock' });
    assert.deepEqual(h.calls.lockVaultNow, [true]);
  });
});

// ---------------------------------------------------------------------------
describe("case 'tab-context'", () => {
  test("'tab:close' closes the captured tab when it still exists", () => {
    const target = { id: 't1' };
    const h = setup({ tabsMap: new Map([['t1', target]]), tabCtxState: { tabId: 't1' } });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:close' });
    assert.deepEqual(h.calls.closeTab, ['t1']);
  });

  test("'tab:close' is a no-op when the captured tab has vanished", () => {
    const h = setup({ tabsMap: new Map(), tabCtxState: { tabId: 'gone' } });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:close' });
    assert.deepEqual(h.calls.closeTab, []);
  });

  test("'tab:close-others' activates the anchor first when it is the active tab, then closes every other tab", () => {
    const t1 = { id: 't1' };
    const tabsMap = new Map([
      ['t1', t1],
      ['t2', {}],
      ['t3', {}]
    ]);
    const h = setup({
      tabsMap,
      orderedIds: ['t1', 't2', 't3'],
      tabCtxState: { tabId: 't1' },
      ctx: { activeTabId: 't2' } // an active tab OTHER than the anchor is among the targets
    });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:close-others' });
    assert.deepEqual(h.calls.activateTab, ['t1']);
    assert.deepEqual(h.calls.closeTab, ['t2', 't3']);
  });

  test("'tab:close-right' closes only the tabs to the right of the anchor", () => {
    const tabsMap = new Map([
      ['t1', {}],
      ['t2', {}],
      ['t3', {}]
    ]);
    const h = setup({
      tabsMap,
      orderedIds: ['t1', 't2', 't3'],
      tabCtxState: { tabId: 't1' },
      ctx: { activeTabId: 'unrelated' }
    });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:close-right' });
    assert.deepEqual(h.calls.activateTab, []);
    assert.deepEqual(h.calls.closeTab, ['t2', 't3']);
  });

  test("'tab:duplicate' creates a tab with the restored history at sourceIndex + 1 once the snapshot resolves", async () => {
    const target = { id: 't1', wcId: 5, container: { id: 'work' }, title: 'Title', url: 'https://x/' };
    const tabsMap = new Map([['t1', target]]);
    const snap = { entries: ['e1', 'e2'], index: 1 };
    const snapshotCalls = [];
    const h = setup({
      tabsMap,
      orderedIds: ['t1', 't2'],
      tabCtxState: { tabId: 't1' },
      tabHistorySnapshot: (payload) => {
        snapshotCalls.push(payload);
        return Promise.resolve(snap);
      }
    });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:duplicate' });
    assert.deepEqual(snapshotCalls, [{ webContentsId: 5 }]);
    await Promise.resolve().then().then();
    assert.deepEqual(h.calls.createTab, [
      [
        'https://x/',
        { id: 'work' },
        { restoreHistory: { entries: ['e1', 'e2'], index: 1, title: 'Title' }, insertAt: 1 }
      ]
    ]);
  });

  test("'tab:duplicate' is a no-op for a target with no live wcId", () => {
    const tabsMap = new Map([['t1', { id: 't1', wcId: null }]]);
    const h = setup({ tabsMap, tabCtxState: { tabId: 't1' } });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:duplicate' });
    assert.deepEqual(h.calls.tabHistorySnapshot, []);
  });

  test("'tab:move-new-window' forwards the strip snapshot for the target", () => {
    const target = { id: 't1', wcId: 5, url: 'https://x/', title: 'T', favicon: null, container: { id: 'work' } };
    const tabsMap = new Map([['t1', target]]);
    const h = setup({ tabsMap, tabCtxState: { tabId: 't1' } });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:move-new-window' });
    assert.deepEqual(h.calls.tabMoveToNewWindow, [
      { wcId: 5, url: 'https://x/', title: 'T', favicon: null, container: { id: 'work' } }
    ]);
  });

  test("'tab:move-window:<windowId>' forwards the destination and announces the outcome", async () => {
    const target = { id: 't1', wcId: 5, url: 'https://x/', title: 'T', favicon: null, container: { id: 'work' } };
    const tabsMap = new Map([['t1', target]]);
    const result = { ok: true };
    const h = setup({
      tabsMap,
      tabCtxState: { tabId: 't1' },
      tabMoveToWindow: (payload) => {
        h.calls.tabMoveToWindow.push(payload);
        return Promise.resolve(result);
      }
    });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:move-window:42' });
    assert.deepEqual(h.calls.tabMoveToWindow, [
      { wcId: 5, url: 'https://x/', title: 'T', favicon: null, container: { id: 'work' }, windowId: 42 }
    ]);
    await Promise.resolve().then().then();
    assert.deepEqual(h.calls.announceTabStatus, [{ result, destination: 'another window' }]);
  });

  test("'tab:reopen-closed' dispatches the reopen-closed-tab chrome action, ungated on the target", () => {
    const h = setup({ tabsMap: new Map(), tabCtxState: { tabId: 'gone' } });
    h.overlay.dispatchActivation({ menuType: 'tab-context', id: 'tab:reopen-closed' });
    assert.deepEqual(h.calls.dispatchChromeAction, ['reopen-closed-tab']);
  });
});

// ---------------------------------------------------------------------------
describe("case 'suggestions'", () => {
  test('the id is forwarded verbatim to dispatchSuggestion', () => {
    const h = setup();
    h.overlay.dispatchActivation({ menuType: 'suggestions', id: 'sug:2' });
    assert.deepEqual(h.calls.dispatchSuggestion, ['sug:2']);
  });
});

// ---------------------------------------------------------------------------
describe('an unrecognized menuType', () => {
  test('is a no-op, never throws', () => {
    const h = setup();
    assert.doesNotThrow(() => h.overlay.dispatchActivation({ menuType: 'not-a-real-menu', id: 'x' }));
    assertNoCalls(h.calls);
  });
});

// ---------------------------------------------------------------------------
// AC3 — handleClosed ordering.
// ---------------------------------------------------------------------------
describe('handleClosed', () => {
  test("resets suggestions state ONLY for menuType 'suggestions'", () => {
    const h = setup();
    h.overlay.handleClosed({ menuType: 'kebab', reason: 'escape' });
    assert.deepEqual(h.calls.handleSuggestionsClosed, []);
    h.overlay.handleClosed({ menuType: 'suggestions', reason: 'escape' });
    assert.deepEqual(h.calls.handleSuggestionsClosed, ['escape']);
  });

  test('calls vaultHandleClosed then siteSecurityHandleClosed, in that order, for every payload', () => {
    const order = [];
    const h = setup();
    // Re-wrap the two closed hooks to observe call ORDER (not just occurrence) —
    // the base fakes already record args; this test also needs sequencing.
    const orderedOverlay = createOverlayDispatch({
      ...h.deps,
      vaultHandleClosed: (p) => order.push(['vault', p]),
      siteSecurityHandleClosed: (p) => order.push(['site-security', p])
    });
    const payload = { menuType: 'kebab', reason: 'escape' };
    orderedOverlay.handleClosed(payload);
    assert.deepEqual(order, [
      ['vault', payload],
      ['site-security', payload]
    ]);
  });

  test('every close is forwarded to vault and site-security regardless of menuType', () => {
    const h = setup();
    h.overlay.handleClosed({ menuType: 'page-context', reason: 'escape' });
    assert.deepEqual(h.calls.vaultHandleClosed, [{ menuType: 'page-context', reason: 'escape' }]);
    assert.deepEqual(h.calls.siteSecurityHandleClosed, [{ menuType: 'page-context', reason: 'escape' }]);
  });
});
