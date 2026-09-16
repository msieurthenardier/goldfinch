'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSiteSecurityController } = require('../../src/renderer/chrome/site-security-controller');

function fakeChip() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    fire(type, event) {
      listeners.get(type)(event);
    }
  };
}

function fakeEvent(key) {
  let prevented = false;
  return {
    key,
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    }
  };
}

function setup(overrides = {}) {
  const opens = [];
  const openOverlayMenu = (menuType, model, anchor, startIndex) => opens.push({ menuType, model, anchor, startIndex });
  const chip = fakeChip();
  const els = { addressChip: chip };
  const triggers = [];
  const overlayTriggerClick = (menuType, open) => {
    triggers.push(menuType);
    open();
  };
  const settingsCalls = [];
  const openSiteSettingsTab = () => settingsCalls.push(true);
  // Mission 20 Flight 2 Leg 2 (DD7): the two new deps this leg's AC10 names.
  const securitySubscribers = [];
  // Mission 20 Flight 2 Leg 3 (DD3): the navigation-away close subscriptions.
  const loadFailureSubscribers = [];
  const didNavigateSubscribers = [];
  // Mission 20 Flight 2 Leg 4 (DD9): tabCertificateGet — default queue-based
  // stub (mirrors the navigation-controller.test.js suggestResolve idiom) so
  // tests can control when the read resolves (the post-await active-tab
  // re-check needs the tab to change WHILE the promise is pending).
  const certGetCalls = [];
  let certGetResolve;
  let certGetReject;
  const tabCertificateGet =
    overrides.tabCertificateGet ||
    ((payload) => {
      certGetCalls.push(payload);
      return new Promise((resolve, reject) => {
        certGetResolve = resolve;
        certGetReject = reject;
      });
    });
  const bridge = {
    onTabSecurity(cb) {
      securitySubscribers.push(cb);
    },
    onTabLoadFailure(cb) {
      loadFailureSubscribers.push(cb);
    },
    onTabDidNavigate(cb) {
      didNavigateSubscribers.push(cb);
    },
    tabCertificateGet
  };
  const tabsByWcId = overrides.tabsByWcId || new Map();
  const findTabByWcId = (wcId) => tabsByWcId.get(wcId) || null;
  const closeOverlayCalls = [];
  const closeOverlayMenu = (reason) => closeOverlayCalls.push(reason);
  // Mutable default active-tab state — overridable per-test via setActiveTab,
  // so the post-await re-check tests can swap the "current" tab mid-flight
  // without a hand-rolled activeTab function per test.
  let activeTabState = overrides.activeTabState || { id: 'active' };
  // Acceptance-run fix pass F3 (tls-trust-surface checkpoint 6): the two new
  // deps that let the tab-security push refresh the chip — mirrors
  // load-failure-controller.test.js's own isActiveTab/updateAddressChip
  // fakes (the `tab.id === activeTabId` shape, an updateAddressChip spy).
  const updateAddressChipCalls = [];
  const updateAddressChip = overrides.updateAddressChip || ((tab) => updateAddressChipCalls.push(tab));
  const isActiveTab = overrides.isActiveTab || ((tab) => tab === activeTabState);
  const controller = createSiteSecurityController({
    els,
    openOverlayMenu,
    siteInfoModel: overrides.siteInfoModel || ((tab) => ({ tab })),
    activeTab: overrides.activeTab || (() => activeTabState),
    overlayTriggerClick,
    leftAnchorOf: (el) => ({ anchorFor: el }),
    openSiteSettingsTab,
    bridge,
    findTabByWcId,
    closeOverlayMenu,
    isActiveTab,
    updateAddressChip
  });
  return {
    controller,
    opens,
    chip,
    triggers,
    settingsCalls,
    els,
    tabsByWcId,
    closeOverlayCalls,
    certGetCalls,
    updateAddressChipCalls,
    resolveCertGet: (value) => certGetResolve(value),
    rejectCertGet: (err) => certGetReject(err),
    setActiveTab: (tab) => {
      activeTabState = tab;
    },
    pushSecurity: (payload) => securitySubscribers.forEach((fn) => fn(payload)),
    pushLoadFailure: (payload) => loadFailureSubscribers.forEach((fn) => fn(payload)),
    pushDidNavigate: (payload) => didNavigateSubscribers.forEach((fn) => fn(payload))
  };
}

test('chip click opens the site-info popup via overlayTriggerClick, anchored left of the chip', () => {
  const h = setup();
  h.chip.fire('click');
  assert.deepEqual(h.triggers, ['site-info']);
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'site-info');
  assert.deepEqual(h.opens[0].model, { tab: { id: 'active' } });
  assert.deepEqual(h.opens[0].anchor, { anchorFor: h.els.addressChip });
  assert.equal(h.opens[0].startIndex, 0);
});

for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
  test(`chip keydown ${JSON.stringify(key)} opens the site-info popup directly (no trigger suppress-window)`, () => {
    const h = setup();
    const e = fakeEvent(key);
    h.chip.fire('keydown', e);
    assert.equal(e.defaultPrevented, true);
    assert.equal(h.opens.length, 1);
    assert.equal(h.opens[0].menuType, 'site-info');
    assert.deepEqual(h.triggers, [], 'keydown bypasses overlayTriggerClick — only the click path uses it');
  });
}

test('chip keydown on an unrelated key is a no-op', () => {
  const h = setup();
  const e = fakeEvent('Tab');
  h.chip.fire('keydown', e);
  assert.equal(e.defaultPrevented, false);
  assert.equal(h.opens.length, 0);
});

test('openSiteInfoOverlay is exposed directly (the seam-tail republish path)', () => {
  const h = setup();
  h.controller.openSiteInfoOverlay();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'site-info');
});

test("handleActivation consumes 'site-settings' for menuType 'site-info' and calls openSiteSettingsTab", () => {
  const h = setup();
  const consumed = h.controller.handleActivation({ menuType: 'site-info', id: 'site-settings' });
  assert.equal(consumed, true);
  assert.deepEqual(h.settingsCalls, [true]);
});

test('handleActivation consumes site-info activations with an unrelated id (no-op body, still consumed)', () => {
  const h = setup();
  const consumed = h.controller.handleActivation({ menuType: 'site-info', id: 'something-else' });
  assert.equal(consumed, true);
  assert.deepEqual(h.settingsCalls, []);
});

test('handleActivation ignores every foreign menuType (returns false, never calls openSiteSettingsTab)', () => {
  const h = setup();
  for (const menuType of ['kebab', 'bookmark-edit']) {
    const consumed = h.controller.handleActivation({ menuType, id: 'site-settings' });
    assert.equal(consumed, false, `menuType ${menuType} must not be consumed`);
  }
  assert.deepEqual(h.settingsCalls, []);
});

test('handleClosed is a no-op for menuTypes other than cert-override (cert-viewer has no close-side state yet)', () => {
  const h = setup();
  assert.doesNotThrow(() => h.controller.handleClosed({ menuType: 'site-info', reason: 'escape' }));
  assert.doesNotThrow(() => h.controller.handleClosed({ menuType: 'cert-viewer', reason: 'escape' }));
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 3 (DD3): the cert-override sheet card.
// ---------------------------------------------------------------------------

test("DD3: handleActivation consumes 'cert-override' as a validated no-op (channel 4 never carries a proceed)", () => {
  const h = setup();
  const consumed = h.controller.handleActivation({ menuType: 'cert-override', id: 'anything' });
  assert.equal(consumed, true);
  assert.deepEqual(h.settingsCalls, []);
});

test('DD3: openCertOverrideOverlay opens the cert-override menuType with {host, error, title, body} from classifyCertError', () => {
  const h = setup();
  const tab = {
    loadFailure: {
      cert: { host: '127.0.0.1:8443', port: 8443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true }
    }
  };
  h.controller.openCertOverrideOverlay(tab);
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

test('DD3: openCertOverrideOverlay is a no-op for a tab with no folded cert failure', () => {
  const h = setup();
  h.controller.openCertOverrideOverlay({ loadFailure: null });
  h.controller.openCertOverrideOverlay(null);
  h.controller.openCertOverrideOverlay({ loadFailure: { code: -105 } });
  assert.deepEqual(h.opens, []);
});

test('DD3/AC6: navigation-away — a tab-load-failure NULL push for the ACTIVE tab closes an open cert-override card', () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.controller.openCertOverrideOverlay({ loadFailure: { cert: { host: 'x', error: 'ERR_CERT_AUTHORITY_INVALID' } } });
  h.pushLoadFailure({ wcId: 10, failure: null });
  assert.deepEqual(h.closeOverlayCalls, ['navigation']);
});

test('DD3/AC6: navigation-away — a tab-did-navigate for the ACTIVE tab closes an open cert-override card', () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.controller.openCertOverrideOverlay({ loadFailure: { cert: { host: 'x', error: 'ERR_CERT_AUTHORITY_INVALID' } } });
  h.pushDidNavigate({ wcId: 10, url: 'https://x/' });
  assert.deepEqual(h.closeOverlayCalls, ['navigation']);
});

test('DD3/AC6: a NEW failure push (non-null) is not navigation-away and does not close the card', () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.controller.openCertOverrideOverlay({ loadFailure: { cert: { host: 'x', error: 'ERR_CERT_AUTHORITY_INVALID' } } });
  h.pushLoadFailure({ wcId: 10, failure: { code: -202, name: 'ERR_CERT_AUTHORITY_INVALID' } });
  assert.deepEqual(h.closeOverlayCalls, []);
});

test("DD3/AC6: a BACKGROUND tab's push does not close a card open for the active tab", () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.controller.openCertOverrideOverlay({ loadFailure: { cert: { host: 'x', error: 'ERR_CERT_AUTHORITY_INVALID' } } });
  h.pushLoadFailure({ wcId: 99, failure: null });
  h.pushDidNavigate({ wcId: 99, url: 'https://other/' });
  assert.deepEqual(h.closeOverlayCalls, []);
});

test('DD3/AC6: with no card open, neither push fires a close', () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.pushLoadFailure({ wcId: 10, failure: null });
  h.pushDidNavigate({ wcId: 10, url: 'https://x/' });
  assert.deepEqual(h.closeOverlayCalls, []);
});

test('DD3/AC6: after handleClosed, a later push fires nothing (the flag is cleared exactly once)', () => {
  const active = { wcId: 10 };
  const h = setup({ activeTab: () => active });
  h.controller.openCertOverrideOverlay({ loadFailure: { cert: { host: 'x', error: 'ERR_CERT_AUTHORITY_INVALID' } } });
  h.controller.handleClosed({ menuType: 'cert-override', reason: 'activated' });
  h.pushLoadFailure({ wcId: 10, failure: null });
  h.pushDidNavigate({ wcId: 10, url: 'https://x/' });
  assert.deepEqual(h.closeOverlayCalls, []);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD7): the owner-routed tab-security subscription.
// ---------------------------------------------------------------------------

test('DD7: a tab-security push stores tab.security via findTabByWcId', () => {
  const tabsByWcId = new Map([[10, { wcId: 10, security: null }]]);
  const h = setup({ tabsByWcId });
  h.pushSecurity({ wcId: 10, security: 'secure' });
  assert.equal(tabsByWcId.get(10).security, 'secure');
});

test('DD7: a push for an unknown wcId is a no-op', () => {
  const h = setup();
  assert.doesNotThrow(() => h.pushSecurity({ wcId: 999, security: 'secure' }));
});

// ---------------------------------------------------------------------------
// Acceptance-run fix pass F3 (tls-trust-surface checkpoint 6): the
// tab-did-navigate push lands BEFORE tab-security (guest-wiring.js), so the
// chip drawn by tab-did-navigate's own updateAddressChip call is stale by
// the time the real security state arrives — this controller must refresh
// the chip itself once tab.security is up to date.
// ---------------------------------------------------------------------------

test('chip refreshes on the tab-security push (tls-trust-surface checkpoint 6)', () => {
  const active = { wcId: 10, security: 'none' };
  const tabsByWcId = new Map([[10, active]]);
  const h = setup({ tabsByWcId, activeTabState: active });
  h.pushSecurity({ wcId: 10, security: 'overridden' });
  // tab.security is stored BEFORE updateAddressChip is called, so the chip
  // reads the new state, not the stale one.
  assert.equal(active.security, 'overridden');
  assert.deepEqual(h.updateAddressChipCalls, [active]);
});

test("a BACKGROUND tab's tab-security push stores tab.security but does not refresh the chip", () => {
  const active = { id: 'active', wcId: 10, security: 'none' };
  const background = { id: 'background', wcId: 20, security: 'none' };
  const tabsByWcId = new Map([
    [10, active],
    [20, background]
  ]);
  const h = setup({ tabsByWcId, activeTabState: active });
  h.pushSecurity({ wcId: 20, security: 'overridden' });
  assert.equal(background.security, 'overridden', 'the background tab still records its own security state');
  assert.deepEqual(h.updateAddressChipCalls, [], 'a background tab push must never touch the visible chip');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 4 (DD9): the read-only cert-viewer sheet card.
// ---------------------------------------------------------------------------

test("handleActivation consumes 'cert-viewer' as a validated no-op (read-only, no action items)", () => {
  const h = setup();
  const consumed = h.controller.handleActivation({ menuType: 'cert-viewer', id: 'anything' });
  assert.equal(consumed, true);
  assert.deepEqual(h.settingsCalls, []);
  assert.deepEqual(h.opens, []);
});

test("handleActivation routes site-info's 'certificate' action to openCertificateViewer", () => {
  const activeTab = { id: 'a', wcId: 10 };
  const h = setup({ activeTab: () => activeTab });
  const consumed = h.controller.handleActivation({ menuType: 'site-info', id: 'certificate' });
  assert.equal(consumed, true);
  assert.deepEqual(h.certGetCalls, [{ wcId: 10 }]);
});

test('openCertificateViewer: no tab / no live wcId opens the cert-viewer menuType with a null (unavailable) model, no bridge read', () => {
  const h = setup();
  h.controller.openCertificateViewer(null);
  h.controller.openCertificateViewer({ id: 'internal', wcId: null });
  assert.deepEqual(h.certGetCalls, []);
  assert.equal(h.opens.length, 2);
  assert.equal(h.opens[0].menuType, 'cert-viewer');
  assert.equal(h.opens[0].model, null);
  assert.deepEqual(h.opens[0].anchor, { anchorFor: h.els.addressChip }); // siteInfoAnchor()
  assert.equal(h.opens[0].startIndex, 0);
  assert.equal(h.opens[1].model, null);
});

test('openCertificateViewer(tab): reads tabCertificateGet for the wcId and opens cert-viewer with the resolved summary', async () => {
  const activeTab = { id: 'a', wcId: 10 };
  const h = setup({ activeTab: () => activeTab });
  const pending = h.controller.openCertificateViewer(activeTab);
  assert.deepEqual(h.certGetCalls, [{ wcId: 10 }]);
  const summary = { status: 'trusted', subject: { commonName: 'a.example' } };
  h.resolveCertGet(summary);
  await pending;
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'cert-viewer');
  assert.equal(h.opens[0].model, summary);
  assert.equal(h.opens[0].startIndex, 0);
});

test('openCertificateViewer: a rejected tabCertificateGet degrades to the null (unavailable) model, never throws', async () => {
  const activeTab = { id: 'a', wcId: 10 };
  const h = setup({ activeTab: () => activeTab });
  const pending = h.controller.openCertificateViewer(activeTab);
  h.rejectCertGet(new Error('ipc gone'));
  await assert.doesNotReject(pending);
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].model, null);
});

test('openCertificateViewer: post-await active-tab re-check — a tab switch mid-fetch drops the result (never opens for an off-screen tab)', async () => {
  const tabA = { id: 'a', wcId: 10 };
  const tabB = { id: 'b', wcId: 20 };
  const h = setup({ activeTabState: tabA });
  const pending = h.controller.openCertificateViewer(tabA);
  // The operator switches tabs WHILE the read is in flight.
  h.setActiveTab(tabB);
  h.resolveCertGet({ status: 'trusted' });
  await pending;
  assert.deepEqual(h.opens, [], 'a late resolution for a no-longer-active tab must never open a card');
});

test('openCertificateViewer: the SAME active tab across the await opens normally', async () => {
  const tabA = { id: 'a', wcId: 10 };
  const h = setup({ activeTabState: tabA });
  const pending = h.controller.openCertificateViewer(tabA);
  h.resolveCertGet({ status: 'trusted' });
  await pending;
  assert.equal(h.opens.length, 1);
});
