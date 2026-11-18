'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Kebab update state is module-scope: never leak it between cases.
afterEach(async () => {
  const { resetKebabUpdateState } = await import('../../src/renderer/chrome/overlay-menus.js');
  resetKebabUpdateState();
});

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

// Mission 20 Flight 2 Leg 4 (DD8): siteInfoModel's ONE conditional push —
// the certificate action, before site-settings, iff deriveSiteInfo says
// showCertificate.
test('siteInfoModel pushes a certificate action before site-settings when showCertificate is true', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const actions = createChromePageActions({
    ...h,
    activeTab: () => ({ url: 'https://a.example/' }),
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({
      internal: false,
      host: 'a.example',
      connection: 'Secure (HTTPS)',
      trackers: 0,
      permissions: 0,
      showCertificate: true
    }),
    openNewTab: () => {}
  });
  const model = actions.siteInfoModel();
  const ids = model.filter((i) => i.type === 'action').map((i) => i.id);
  assert.deepEqual(ids, ['certificate', 'site-settings']);
});

test('siteInfoModel omits the certificate action when showCertificate is false', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const actions = createChromePageActions({
    ...h,
    activeTab: () => ({ url: 'http://a.example/' }),
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({
      internal: false,
      host: 'a.example',
      connection: 'Not secure (HTTP)',
      trackers: 0,
      permissions: 0,
      showCertificate: false
    }),
    openNewTab: () => {}
  });
  const model = actions.siteInfoModel();
  const ids = model.filter((i) => i.type === 'action').map((i) => i.id);
  assert.deepEqual(ids, ['site-settings']);
});

test('siteInfoModel: internal tab returns only the secure-page note (unchanged shape)', async () => {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  const actions = createChromePageActions({
    ...h,
    activeTab: () => ({ url: 'goldfinch://settings' }),
    isInternalPageUrl: () => true,
    deriveSiteInfo: () => ({ internal: true, note: "You're viewing a secure Goldfinch page." }),
    openNewTab: () => {}
  });
  assert.deepEqual(actions.siteInfoModel(), [
    { type: 'note', variant: 'secure', text: "You're viewing a secure Goldfinch page." }
  ]);
});

test('menu models and chrome-to-sheet anchor conversion retain exact shapes', async () => {
  const { buildKebabModel, chromePointToSheet, leftSheetAnchor, rightSheetAnchor } =
    await import('../../src/renderer/chrome/overlay-menus.js');
  const kebab = buildKebabModel();
  // The menuitem ids, in order — separators carry no id and are filtered out here.
  assert.deepEqual(
    kebab.filter((item) => item.id).map((item) => item.id),
    ['new-window', 'settings', 'downloads', 'jars', 'automation', 'vault', 'print', 'exit']
  );
  // Two separators divide the menu into three bands: after New window and after Vault.
  assert.deepEqual(
    kebab.map((item) => (item.type === 'separator' ? 'sep' : item.id)),
    ['new-window', 'sep', 'settings', 'downloads', 'jars', 'automation', 'vault', 'sep', 'print', 'exit']
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

// ---------------------------------------------------------------------------
// Kebab actions (sortie 05): the action table lives in createChromePageActions.
// ---------------------------------------------------------------------------

async function kebabHarness({ active = null } = {}) {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  h.window.goldfinch.windowCreate = () => h.calls.push(['windowCreate']);
  h.window.goldfinch.appQuit = () => h.calls.push(['appQuit']);
  h.window.goldfinch.print = (payload) => h.calls.push(['print', payload]);
  const actions = createChromePageActions({
    ...h,
    activeTab: () => active,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  return { h, actions };
}

const DEFAULT_KEBAB = [
  { id: 'new-window', label: 'New window' },
  { type: 'separator' },
  { id: 'settings', label: 'Settings' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'jars', label: 'Cookie jars' },
  { id: 'automation', label: 'Automation' },
  { id: 'vault', label: 'Vault' },
  { type: 'separator' },
  { id: 'print', label: 'Print…' },
  { id: 'exit', label: 'Exit' }
];
const NEWER = {
  current: '0.19.15',
  available: '0.19.16',
  releaseUrl: 'https://github.com/msieurthenardier/goldfinch/releases/tag/v0.19.16',
  checkEnabled: true
};
const idsOf = (model) => model.filter((item) => item.type !== 'separator').map((item) => item.id);

test('kebabActions: keys equal the default model ids plus update; with a notice the model equals the keys (drift guard)', async () => {
  const { buildKebabModel, setKebabUpdateState } = await import('../../src/renderer/chrome/overlay-menus.js');
  const { actions } = await kebabHarness();
  const ids = idsOf(buildKebabModel()).sort();
  assert.ok(ids.length > 0);
  assert.deepEqual(Object.keys(actions.kebabActions).sort(), [...ids, 'update'].sort());
  setKebabUpdateState(NEWER);
  assert.deepEqual(idsOf(buildKebabModel()).sort(), Object.keys(actions.kebabActions).sort());
  for (const id of Object.keys(actions.kebabActions)) assert.equal(typeof actions.kebabActions[id], 'function', id);
});

test("buildKebabModel: with no notice the list is exactly today's", async () => {
  const { buildKebabModel } = await import('../../src/renderer/chrome/overlay-menus.js');
  assert.deepEqual(buildKebabModel(), DEFAULT_KEBAB);
});

test('buildKebabModel: a notice adds the item and a separator first, the rest unchanged; clearing removes it', async () => {
  const { buildKebabModel, setKebabUpdateState } = await import('../../src/renderer/chrome/overlay-menus.js');
  setKebabUpdateState(NEWER);
  const m = buildKebabModel();
  assert.deepEqual(m.slice(0, 2), [{ id: 'update', label: 'Update available — 0.19.16' }, { type: 'separator' }]);
  assert.deepEqual(m.slice(2), DEFAULT_KEBAB);
  setKebabUpdateState(null);
  assert.deepEqual(buildKebabModel(), DEFAULT_KEBAB);
});

test('setKebabUpdateState ignores a state the model rejects', async () => {
  const { buildKebabModel, setKebabUpdateState } = await import('../../src/renderer/chrome/overlay-menus.js');
  setKebabUpdateState(NEWER);
  setKebabUpdateState({ ...NEWER, available: '<b>x' });
  assert.deepEqual(buildKebabModel(), DEFAULT_KEBAB);
  setKebabUpdateState({ ...NEWER, releaseUrl: null });
  assert.deepEqual(buildKebabModel(), DEFAULT_KEBAB);
});

test('kebabActions.update: calls the bridge with no arguments', async () => {
  const { h, actions } = await kebabHarness();
  h.window.goldfinch.updateOpenReleasePage = (...args) => h.calls.push(['updateOpenReleasePage', args]);
  actions.kebabActions.update();
  assert.deepEqual(h.calls, [['updateOpenReleasePage', []]]);
});

test('boot wiring: a push is applied; a boot read that resolves later is dropped', async () => {
  const { createChromePageActions, buildKebabModel } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  let push;
  let resolveRead;
  h.window.goldfinch.onUpdateStateChanged = (cb) => {
    push = cb;
  };
  h.window.goldfinch.updateGetState = () =>
    new Promise((r) => {
      resolveRead = r;
    });
  createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  push(NEWER);
  assert.equal(buildKebabModel()[0].id, 'update');
  resolveRead({ current: '0.19.15', available: null, releaseUrl: null, checkEnabled: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(buildKebabModel()[0].id, 'update');
});

test('boot wiring: a boot read alone sets the state; a rejecting read is no notice', async () => {
  const { createChromePageActions, buildKebabModel } = await import('../../src/renderer/chrome/overlay-menus.js');
  const mk = (read) => {
    const h = pageActionsHarness();
    h.window.goldfinch.updateGetState = read;
    createChromePageActions({
      ...h,
      activeTab: () => null,
      isInternalPageUrl: () => false,
      deriveSiteInfo: () => ({}),
      openNewTab: () => {}
    });
  };
  mk(() => Promise.reject(new Error('gone')));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(buildKebabModel(), DEFAULT_KEBAB);
  mk(() => Promise.resolve(NEWER));
  await new Promise((r) => setImmediate(r));
  assert.equal(buildKebabModel()[0].id, 'update');
});

test('buildKebabModel: Automation sits directly above Vault, labelled Automation', async () => {
  const { buildKebabModel } = await import('../../src/renderer/chrome/overlay-menus.js');
  const model = buildKebabModel();
  const i = model.findIndex((item) => item.id === 'automation');
  assert.ok(i > 0);
  assert.equal(model[i].label, 'Automation');
  assert.equal(model[i + 1].id, 'vault');
});

for (const [id, url] of [
  ['settings', 'goldfinch://settings'],
  ['downloads', 'goldfinch://downloads'],
  ['jars', 'goldfinch://jars'],
  ['automation', 'goldfinch://automation'],
  ['vault', 'goldfinch://vault']
]) {
  test(`kebabActions.${id}: opens ${url} as a trusted tab`, async () => {
    const { h, actions } = await kebabHarness();
    actions.kebabActions[id]();
    assert.deepEqual(h.calls, [['createTab', url, null, { trusted: true }]]);
  });
}

test('kebabActions.print: prints the active web tab', async () => {
  const { h, actions } = await kebabHarness({ active: { id: 'w', wcId: 7, trusted: false } });
  actions.kebabActions.print();
  assert.deepEqual(h.calls, [['print', { webContentsId: 7 }]]);
});

test('kebabActions.print: no-ops on an internal tab and on a viewless tab', async () => {
  let r = await kebabHarness({ active: { id: 'i', wcId: 9, trusted: true } });
  r.actions.kebabActions.print();
  assert.deepEqual(r.h.calls, []);
  r = await kebabHarness({ active: { id: 'v', wcId: null, trusted: false } });
  r.actions.kebabActions.print();
  assert.deepEqual(r.h.calls, []);
});

test('kebabActions.new-window / exit call the window.goldfinch bridge', async () => {
  const { h, actions } = await kebabHarness();
  actions.kebabActions['new-window']();
  actions.kebabActions.exit();
  assert.deepEqual(h.calls, [['windowCreate'], ['appQuit']]);
});

// ---------------------------------------------------------------------------
// Kebab dot (sortie 09 leg `about-controller-and-dot`): the button's class / title / description,
// driven through createChromePageActions' push and boot-read closures with a fake document.
// ---------------------------------------------------------------------------

function fakeKebabDocument({ withKebab = true, withNote = true } = {}) {
  const classes = new Set();
  const writes = { title: 0, note: 0 };
  let title = 'More';
  let noteText = '';
  const kebab = {
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    attrs: new Map([['aria-label', 'More']]),
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
    get title() {
      return title;
    },
    set title(v) {
      writes.title++;
      title = v;
    }
  };
  const note = {
    get textContent() {
      return noteText;
    },
    set textContent(v) {
      writes.note++;
      noteText = v;
    }
  };
  const doc = {
    getElementById: (id) => (id === 'kebab' && withKebab ? kebab : id === 'kebab-update-note' && withNote ? note : null)
  };
  return { doc, kebab, note, writes, classes };
}

async function dotHarness(doc, { read } = {}) {
  const { createChromePageActions } = await import('../../src/renderer/chrome/overlay-menus.js');
  const h = pageActionsHarness();
  let push = null;
  h.window.document = doc;
  h.window.goldfinch.onUpdateStateChanged = (cb) => {
    push = cb;
  };
  h.window.goldfinch.updateGetState = read || (() => Promise.resolve(null));
  createChromePageActions({
    ...h,
    activeTab: () => null,
    isInternalPageUrl: () => false,
    deriveSiteInfo: () => ({}),
    openNewTab: () => {}
  });
  return { push: (s) => push(s) };
}

const settle = () => new Promise((r) => setImmediate(r));

test('kebab dot: on for a valid notice, off for cleared / null / rejected states', async () => {
  const f = fakeKebabDocument();
  const d = await dotHarness(f.doc);
  d.push(NEWER);
  assert.equal(f.classes.has('update-waiting'), true);
  assert.equal(f.kebab.title, 'More — update available');
  assert.equal(f.note.textContent, 'Update available');
  assert.equal(f.kebab.attrs.get('aria-describedby'), 'kebab-update-note');
  assert.equal(f.kebab.attrs.get('aria-label'), 'More');
  for (const off of [{ ...NEWER, available: null }, null, { available: '1.0.0-evil', releaseUrl: 'x' }, 'junk']) {
    d.push(NEWER);
    d.push(off);
    assert.equal(f.classes.has('update-waiting'), false);
    assert.equal(f.kebab.title, 'More');
    assert.equal(f.note.textContent, '');
    assert.equal(f.kebab.attrs.get('aria-label'), 'More');
  }
});

test('kebab dot: title and note are written only when they change', async () => {
  const f = fakeKebabDocument();
  const d = await dotHarness(f.doc);
  d.push(NEWER);
  d.push({ ...NEWER, lastCheck: { at: 1, outcome: 'newer' } });
  d.push({ ...NEWER, lastCheck: { at: 2, outcome: 'newer' } });
  assert.equal(f.writes.title, 1);
  assert.equal(f.writes.note, 1);
});

test('kebab dot: the boot read applies it, and is dropped after a push', async () => {
  const f = fakeKebabDocument();
  await dotHarness(f.doc, { read: () => Promise.resolve(NEWER) });
  await settle();
  assert.equal(f.classes.has('update-waiting'), true);
  const g = fakeKebabDocument();
  let resolve;
  const d = await dotHarness(g.doc, { read: () => new Promise((r) => (resolve = r)) });
  d.push({ ...NEWER, available: null });
  resolve(NEWER); // older than the push
  await settle();
  assert.equal(g.classes.has('update-waiting'), false);
  assert.equal(g.kebab.title, 'More');
});

test('kebab dot: a missing #kebab, a missing note and a window with no document are tolerated', async () => {
  const none = fakeKebabDocument({ withKebab: false });
  const d = await dotHarness(none.doc);
  assert.doesNotThrow(() => d.push(NEWER));
  const noNote = fakeKebabDocument({ withNote: false });
  const e = await dotHarness(noNote.doc);
  e.push(NEWER);
  assert.equal(noNote.classes.has('update-waiting'), true);
  const { applyKebabDot } = await import('../../src/renderer/chrome/overlay-menus.js');
  assert.doesNotThrow(() => applyKebabDot({}, NEWER));
  assert.doesNotThrow(() => applyKebabDot(undefined, NEWER));
});

test('kebab dot: the menu item still follows the same state', async () => {
  const { buildKebabModel } = await import('../../src/renderer/chrome/overlay-menus.js');
  const f = fakeKebabDocument();
  const d = await dotHarness(f.doc);
  d.push(NEWER);
  assert.equal(buildKebabModel()[0].id, 'update');
  d.push(null);
  assert.equal(buildKebabModel()[0].id, 'new-window');
});

test('kebab dot: styles.css carries the dot as top-level, class-qualified rules (no stray text in a neighbouring selector)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/styles.css'), 'utf8');
  assert.match(css, /\n#kebab\.update-waiting\s*\{\s*position:\s*relative;\s*\}/);
  assert.match(css, /\n#kebab\.update-waiting::after\s*\{[^}]*position:\s*absolute;[^}]*var\(--accent\)[^}]*\}/);
  // The rules sit between complete rules: the text before the first one ends a rule, not a selector.
  const before = css.slice(0, css.indexOf('/* Update-waiting dot on the kebab')).trimEnd();
  assert.ok(before.endsWith('}'));
  assert.ok(!/#newtab-pill\s*\/\*/.test(css));
});
