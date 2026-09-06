'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function makeHarness() {
  const { createOverlayMenus, fixedTriggerMenu } = await import('../../src/renderer/chrome/overlay-menus.js');
  const callbacks = {};
  const events = [];
  let clock = 1000;
  const trigger = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
      events.push(['aria', value]);
    },
    focus() {
      events.push(['focus']);
    }
  };
  const bridge = {
    menuOverlayOpen: (payload) => events.push(['open', payload]),
    menuOverlayClose: (payload) => events.push(['close', payload]),
    onMenuOverlayActivated: (fn) => {
      callbacks.activated = fn;
    },
    onMenuOverlayClosed: (fn) => {
      callbacks.closed = fn;
    }
  };
  const states = { kebab: fixedTriggerMenu(() => trigger) };
  const client = createOverlayMenus({
    bridge,
    states,
    now: () => clock,
    onActivated: (payload) => events.push(['activated', payload]),
    onClosed: (payload) => events.push(['closed', payload])
  });
  return {
    callbacks,
    events,
    states,
    client,
    trigger,
    tick: (ms) => {
      clock += ms;
    }
  };
}

test('menu open mints monotonic tokens and stale close cannot reset ARIA or refocus', async () => {
  const h = await makeHarness();
  h.client.open('kebab', [{ id: 'settings' }], { x: 1 }, 0);
  const first = h.states.kebab.token;
  h.client.open('kebab', [{ id: 'downloads' }], { x: 2 }, 0);
  const second = h.states.kebab.token;
  assert.ok(second > first);
  h.events.length = 0;
  h.callbacks.closed({ menuType: 'kebab', reason: 'escape', token: first });
  assert.equal(h.states.kebab.open, true);
  assert.deepEqual(h.events, []);
  h.callbacks.closed({ menuType: 'kebab', reason: 'escape', token: second });
  assert.equal(h.states.kebab.open, false);
  assert.deepEqual(
    h.events.map((event) => event[0]),
    ['aria', 'focus', 'closed']
  );
});

test('blur close suppresses only the same trigger for 300ms', async () => {
  const h = await makeHarness();
  h.client.open('kebab', [], {}, 0);
  h.callbacks.closed({ menuType: 'kebab', reason: 'blur', token: h.states.kebab.token });
  h.events.length = 0;
  h.client.trigger('kebab', () => h.events.push(['reopen']));
  assert.deepEqual(h.events, []);
  h.tick(301);
  h.client.trigger('kebab', () => h.events.push(['reopen']));
  assert.deepEqual(h.events, [['reopen']]);
});

test('activation dispatch is allowlisted to registered menu types', async () => {
  const h = await makeHarness();
  h.callbacks.activated({ menuType: 'unknown', id: 'exit' });
  h.callbacks.activated({ menuType: 'kebab', id: 7 });
  assert.deepEqual(h.events, []);
  h.callbacks.activated({ menuType: 'kebab', id: 'exit' });
  assert.deepEqual(h.events, [['activated', { menuType: 'kebab', id: 'exit' }]]);
});

// ---------------------------------------------------------------------------
// M18 F3 L1 (DD8): open() is the SINGLE chrome-side funnel every vault sheet
// open passes through — this is where the shared VAULT_BLUR_SURVIVAL_MENU_TYPES
// allowlist is applied, so every call site (vault-controller.js's ~20 opens,
// including the *ForAudit a11y duplicates) gets it for free.
// ---------------------------------------------------------------------------

async function vaultAwareHarness() {
  const { createOverlayMenus, fixedTriggerMenu } = await import('../../src/renderer/chrome/overlay-menus.js');
  const events = [];
  const bridge = {
    menuOverlayOpen: (payload) => events.push(payload),
    menuOverlayClose: () => {},
    onMenuOverlayActivated: () => {},
    onMenuOverlayClosed: () => {}
  };
  const states = {
    kebab: fixedTriggerMenu(() => ({ setAttribute() {}, focus() {} })),
    'vault-set': fixedTriggerMenu(() => ({ setAttribute() {}, focus() {} })),
    'vault-unlock': fixedTriggerMenu(() => ({ setAttribute() {}, focus() {} }))
  };
  const client = createOverlayMenus({ bridge, states, now: () => 0, onActivated: () => {}, onClosed: () => {} });
  return { events, client };
}

test('DD8: an allowlisted vault menuType gets survivesBlur:true on its open payload', async () => {
  const h = await vaultAwareHarness();
  h.client.open('vault-set', [], null, 0);
  assert.equal(h.events[0].survivesBlur, true);
  h.client.open('vault-unlock', [], null, 0);
  assert.equal(h.events[1].survivesBlur, true, 'vault-unlock is IN the allowlist too');
});

test('DD8: a non-vault menuType (kebab) gets survivesBlur:false explicitly', async () => {
  const h = await vaultAwareHarness();
  h.client.open('kebab', [], null, 0);
  assert.equal(h.events[0].survivesBlur, false, 'the funnel is authoritative in both directions, not just true');
});

test('DD8: a caller-supplied survivesBlur option can never override the shared allowlist verdict, in EITHER direction', async () => {
  const h = await vaultAwareHarness();
  // A caller trying to force it OFF for an allowlisted menuType is overridden (applied
  // after the ...options spread, per the leg's implementation guidance).
  h.client.open('vault-set', [], null, 0, { survivesBlur: false });
  assert.equal(h.events[0].survivesBlur, true, 'the allowlist wins over a false caller-supplied option');
  // A caller trying to force it ON for a NON-allowlisted menuType is also overridden —
  // membership decides, never the caller.
  h.client.open('kebab', [], null, 0, { survivesBlur: true });
  assert.equal(h.events[1].survivesBlur, false, 'the allowlist wins over a true caller-supplied option too');
});

// ---------------------------------------------------------------------------
// openSiteSettingsTab (M16 F2 Leg 1, DD10): reuses ONLY a tab whose URL host
// is 'settings' — fragment- and path-blind on purpose (every real Settings
// tab carries the '#privacy' fragment), never any other internal tab.
// ---------------------------------------------------------------------------

function pageActionsHarness() {
  const tabs = new Map();
  const calls = [];
  let nextId = 0;
  const window = {
    goldfinch: { tabNavigate: (payload) => calls.push(['tabNavigate', payload]) }
  };
  const createTab = (url, container, opts) => {
    const id = `tab-${++nextId}`;
    const tab = { id, url, wcId: opts && opts.trusted ? 500 + nextId : null, trusted: !!(opts && opts.trusted) };
    tabs.set(id, tab);
    calls.push(['createTab', url, container, opts]);
    return tab;
  };
  const activateTab = (id) => calls.push(['activateTab', id]);
  const isInternalTab = (tab) => !!tab && tab.trusted === true;
  return { tabs, calls, window, createTab, activateTab, isInternalTab };
}

test('openSiteSettingsTab: no existing internal tab creates one trusted Settings tab', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const actions = createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  actions.openSiteSettingsTab();
  assert.deepEqual(h.calls, [['createTab', 'goldfinch://settings/#privacy', null, { trusted: true }]]);
});

test('openSiteSettingsTab: reuses an existing Settings tab matched by HOST ONLY (fragment-bearing fixture)', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const existing = { id: 'settings-1', url: 'goldfinch://settings/#privacy', wcId: 42, trusted: true };
  h.tabs.set(existing.id, existing);
  const actions = createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  actions.openSiteSettingsTab();
  assert.deepEqual(h.calls, [
    ['tabNavigate', { wcId: 42, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] }],
    ['activateTab', 'settings-1']
  ]);
});

test('openSiteSettingsTab: never reuses a Downloads tab — creates a new Settings tab instead', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  h.tabs.set('downloads-1', { id: 'downloads-1', url: 'goldfinch://downloads', wcId: 7, trusted: true });
  const actions = createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  actions.openSiteSettingsTab();
  assert.ok(h.calls.some(([name, url]) => name === 'createTab' && url === 'goldfinch://settings/#privacy'));
  assert.ok(!h.calls.some(([name]) => name === 'tabNavigate'));
});

test('openSiteSettingsTab: called twice in a row creates no second tab', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const actions = createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  actions.openSiteSettingsTab();
  h.calls.length = 0;
  actions.openSiteSettingsTab();
  assert.equal(h.calls.filter(([name]) => name === 'createTab').length, 0);
  assert.ok(h.calls.some(([name]) => name === 'tabNavigate' || name === 'activateTab'));
});

test('menu models and chrome-to-sheet anchor conversion retain exact shapes', async () => {
  const { buildKebabModel, chromePointToSheet, leftSheetAnchor, rightSheetAnchor } =
    await import('../../src/renderer/chrome/overlay-menus.js');
  const kebab = buildKebabModel();
  // The menuitem ids, in order — separators carry no id and are filtered out here.
  assert.deepEqual(
    kebab.filter((item) => item.id).map((item) => item.id),
    ['new-window', 'settings', 'downloads', 'jars', 'vault', 'print', 'exit']
  );
  // Two separators divide the menu into three bands: after New window and after Passwords.
  assert.deepEqual(
    kebab.map((item) => (item.type === 'separator' ? 'sep' : item.id)),
    ['new-window', 'sep', 'settings', 'downloads', 'jars', 'vault', 'sep', 'print', 'exit']
  );
  const webviews = { left: 100, top: 40 };
  const trigger = { left: 90, right: 250 };
  assert.deepEqual(chromePointToSheet(webviews, 91, 30), { x: -9, y: 0 });
  assert.deepEqual(leftSheetAnchor(webviews, trigger), { alignLeft: 0, y: 0 });
  assert.deepEqual(rightSheetAnchor(webviews, trigger), { alignRight: 150, y: 0 });
});

// ---------------------------------------------------------------------------
// Squawk 0057: every open rides the chrome-measured #webviews slot rect
// (`slotBounds`) when a measurer is injected — main's viewless-welcome-tab
// fallback for placing the sheet (a fresh-install window has no guest view to
// measure, and the sheet otherwise opened at default zero bounds: the dead
// kebab). Without the injection the payload keeps its historical shape.
// ---------------------------------------------------------------------------

test('open rides measureSlot() as slotBounds; absent measurer leaves the payload shape unchanged', async () => {
  const { createOverlayMenus, fixedTriggerMenu } = await import('../../src/renderer/chrome/overlay-menus.js');
  const makeBridge = (events) => ({
    menuOverlayOpen: (payload) => events.push(payload),
    menuOverlayClose: () => {},
    onMenuOverlayActivated: () => {},
    onMenuOverlayClosed: () => {}
  });
  const trigger = { setAttribute() {}, focus() {} };

  const withMeasure = [];
  const slot = { x: 0, y: 80, width: 1280, height: 720 };
  createOverlayMenus({
    bridge: makeBridge(withMeasure),
    states: { kebab: fixedTriggerMenu(() => trigger) },
    now: () => 0,
    onActivated: () => {},
    onClosed: () => {},
    measureSlot: () => slot
  }).open('kebab', [{ id: 'settings' }], { alignRight: 5, y: 0 }, 0);
  assert.equal(withMeasure.length, 1);
  assert.deepEqual(withMeasure[0].slotBounds, slot);
  // The measurement is added AFTER the options spread — an options bag can
  // never smuggle a stale or forged rect past the live measurer.
  const forged = [];
  createOverlayMenus({
    bridge: makeBridge(forged),
    states: { kebab: fixedTriggerMenu(() => trigger) },
    now: () => 0,
    onActivated: () => {},
    onClosed: () => {},
    measureSlot: () => slot
  }).open('kebab', [], {}, 0, { slotBounds: { x: 1, y: 1, width: 1, height: 1 } });
  assert.deepEqual(forged[0].slotBounds, slot);

  const withoutMeasure = [];
  createOverlayMenus({
    bridge: makeBridge(withoutMeasure),
    states: { kebab: fixedTriggerMenu(() => trigger) },
    now: () => 0,
    onActivated: () => {},
    onClosed: () => {}
  }).open('kebab', [{ id: 'settings' }], { alignRight: 5, y: 0 }, 0);
  assert.equal('slotBounds' in withoutMeasure[0], false);
});
