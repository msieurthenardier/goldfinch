'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuditHooks } = require('../../src/renderer/chrome/audit-hooks');

function rect() {
  return { left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 };
}

function setup(overrides = {}) {
  const opens = [];
  const openOverlayMenu = (menuType, model, anchor, startIndex, opts) => {
    opens.push({ menuType, model, anchor, startIndex, opts });
  };
  const pageCtx = { wcId: null, params: null, returnFocus: null, toolbarItem: 'stale' };
  const tabCtx = { tabId: 'stale', returnFocus: null };
  const pageContextCalls = [];
  const openPageContextOverlaySheet = (anchor) => pageContextCalls.push(anchor);
  const els = {
    address: { id: 'address' },
    tabs: { id: 'tabs-strip', getBoundingClientRect: rect }
  };
  const tabs = new Map();
  const chromePointToSheet = (cx, cy) => ({ sheet: true, cx, cy });
  const hooks = createAuditHooks({
    openOverlayMenu,
    els,
    tabs,
    orderedTabIds: overrides.orderedTabIds || (() => []),
    activeTab: overrides.activeTab || (() => null),
    chromePointToSheet,
    pageCtx,
    tabCtx,
    openPageContextOverlaySheet
  });
  return { hooks, opens, pageCtx, tabCtx, pageContextCalls, els, tabs };
}

test('openAuthBasicOverlayForAudit opens auth-basic with a synthetic non-secret host/realm model', () => {
  const h = setup();
  h.hooks.openAuthBasicOverlayForAudit();
  assert.deepEqual(h.opens, [
    {
      menuType: 'auth-basic',
      model: { host: '127.0.0.1:8091', realm: 'fixture' },
      anchor: null,
      startIndex: 0,
      opts: undefined
    }
  ]);
});

test('openCertPickerOverlayForAudit opens cert-picker with a synthetic display-string row', () => {
  const h = setup();
  h.hooks.openCertPickerOverlayForAudit();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'cert-picker');
  assert.deepEqual(h.opens[0].model, [{ subject: 'CN=Fixture Client', issuer: 'CN=Goldfinch Fixture Throwaway CA' }]);
  assert.equal(h.opens[0].anchor, null);
});

test('openBookmarkEditOverlayForAudit opens bookmark-edit with a synthetic non-secret row', () => {
  const h = setup();
  h.hooks.openBookmarkEditOverlayForAudit();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'bookmark-edit');
  assert.deepEqual(h.opens[0].model, { id: 'bm-audit', name: 'Fixture Bookmark', url: 'https://example.com/' });
});

test('openBookmarksOverflowOverlayForAudit opens bookmarks-overflow with a synthetic roving row', () => {
  const h = setup();
  h.hooks.openBookmarksOverflowOverlayForAudit();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'bookmarks-overflow');
  assert.deepEqual(h.opens[0].model, [{ id: 'bookmark:0', label: 'Fixture Bookmark' }]);
});

test('openCertOverrideOverlayForAudit opens cert-override with a synthetic non-secret host/error/title/body model (M20 F2 L3)', () => {
  const h = setup();
  h.hooks.openCertOverrideOverlayForAudit();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'cert-override');
  assert.deepEqual(h.opens[0].model, {
    host: '127.0.0.1:8443',
    error: 'ERR_CERT_AUTHORITY_INVALID',
    title: "This connection isn't private",
    body: "This site's security certificate is from an authority Goldfinch doesn't trust."
  });
  assert.equal(h.opens[0].anchor, null);
  assert.equal(h.opens[0].startIndex, 0);
});

test('openCertViewerOverlayForAudit opens cert-viewer with a synthetic non-secret certificate-summary-shaped model (M20 F2 L4)', () => {
  const h = setup();
  h.hooks.openCertViewerOverlayForAudit();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'cert-viewer');
  assert.equal(h.opens[0].model.status, 'trusted');
  assert.equal(h.opens[0].model.subject.commonName, '127.0.0.1');
  assert.equal(h.opens[0].model.issuer.commonName, 'Goldfinch Fixture Trusted CA');
  assert.equal(h.opens[0].anchor, null);
  assert.equal(h.opens[0].startIndex, 0);
});

test('openPageContextMenuForAudit stamps a representative synthetic pageCtx and opens at the translated fixed coord', () => {
  const h = setup({ activeTab: () => ({ wcId: 77 }) });
  h.hooks.openPageContextMenuForAudit();
  assert.equal(h.pageCtx.wcId, 77);
  assert.equal(h.pageCtx.toolbarItem, null);
  assert.equal(h.pageCtx.returnFocus, h.els.address);
  assert.equal(h.pageCtx.params.linkURL, 'https://example.com/');
  assert.equal(h.pageCtx.params.selectionText, 'sample');
  assert.deepEqual(h.pageContextCalls, [{ sheet: true, cx: 80, cy: 80 }]);
});

test('openPageContextMenuForAudit falls back to a null wcId when there is no active tab', () => {
  const h = setup({ activeTab: () => null });
  h.hooks.openPageContextMenuForAudit();
  assert.equal(h.pageCtx.wcId, null);
});

test('openTabContextMenuForAudit builds a representative synthetic model with every item type and anchors at the first tab', () => {
  const btn = { getBoundingClientRect: rect };
  const h = setup({ orderedTabIds: () => ['t1', 't2'] });
  h.tabs.set('t1', { btn });
  h.hooks.openTabContextMenuForAudit();

  assert.equal(h.tabCtx.tabId, 't1');
  assert.equal(h.tabCtx.returnFocus, h.els.address);
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'tab-context');
  assert.deepEqual(h.opens[0].anchor, { sheet: true, cx: 10, cy: 40 });
  // tabContextModel's real shape: every item type renders (isLastTab:false,
  // tabsToRight:1, a non-empty stack, a non-empty moveTargets) — a flat array
  // of { type: 'item'|'separator', id?, label? }.
  assert.ok(Array.isArray(h.opens[0].model));
  const ids = h.opens[0].model.filter((entry) => entry.type === 'item').map((entry) => entry.id);
  assert.ok(ids.includes('tab:close-others'));
  assert.ok(ids.includes('tab:reopen-closed'));
  assert.ok(ids.some((id) => id.startsWith('tab:move-window:')));
});

test('openTabContextMenuForAudit anchors at the tab strip itself when there are no tabs', () => {
  const h = setup({ orderedTabIds: () => [] });
  h.hooks.openTabContextMenuForAudit();
  assert.equal(h.tabCtx.tabId, null);
  assert.deepEqual(h.opens[0].anchor, { sheet: true, cx: 10, cy: 40 }); // els.tabs' own rect() fixture
});
