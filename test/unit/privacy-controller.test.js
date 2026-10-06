'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/privacy-controller.js')).href;

// DOM fake with a real child list (parentNode/removeChild/insertBefore/deep contains),
// querySelector for the selector shapes the tests use, dataset, focus() driving
// document.activeElement, multi-listener addEventListener and focusout/keydown dispatch.
class El {
  constructor(doc, tagName = 'div') {
    this.doc = doc;
    this.tagName = tagName;
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.id = '';
    this.classList = {
      values: new Set(),
      add: (x) => this.classList.values.add(x),
      remove: (x) => this.classList.values.delete(x),
      contains: (x) => this.classList.values.has(x),
      toggle: (x, on) => {
        const want = on === undefined ? !this.classList.values.has(x) : !!on;
        if (want) this.classList.values.add(x);
        else this.classList.values.delete(x);
        return want;
      }
    };
  }
  get firstChild() {
    return this.children[0] || null;
  }
  set className(value) {
    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((x) => this.classList.add(x));
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  dispatch(name, event = {}) {
    const e = { type: name, target: this, defaultPrevented: false, stopped: false, ...event };
    e.preventDefault = () => (e.defaultPrevented = true);
    e.stopPropagation = () => (e.stopped = true);
    for (const fn of this.listeners.get(name) || []) fn(e);
    return e;
  }
  detach(child) {
    // A real DOM drops focus when the focused node's subtree is removed.
    if (this.doc.activeElement && child.contains(this.doc.activeElement)) this.doc.activeElement = null;
    if (child.parentNode) child.parentNode.children = child.parentNode.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  appendChild(child) {
    this.detach(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    this.detach(child);
    child.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    if (child.parentNode !== this) throw new Error('not a child');
    this.detach(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  focus() {
    this.doc.activeElement = this;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  walk() {
    return [this, ...this.children.flatMap((c) => c.walk())];
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const parts = sel.split(' ');
    if (parts.length === 2) return this.querySelectorAll(parts[0]).flatMap((n) => n.querySelectorAll(parts[1]));
    const attr = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(sel);
    const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return this.walk().filter((n) => {
      if (n === this) return false;
      if (attr) return n.dataset[camel(attr[1])] === attr[2];
      if (sel.startsWith('#')) return n.id === sel.slice(1);
      if (sel.startsWith('.')) return n.classList.contains(sel.slice(1));
      return false;
    });
  }
}

function harness() {
  const names = [
    'address',
    'automationIndicator',
    'automationIndicatorBadge',
    'privacyBody',
    'privacyClose',
    'privacyCount',
    'privacyPanel',
    'privacyRefresh',
    'toggleDevtools',
    'togglePrivacy'
  ];
  const doc = { activeElement: null };
  const els = Object.fromEntries(names.map((name) => [name, new El(doc)]));
  els.privacyPanel.classList.add('collapsed');
  const document = doc;
  document.createElement = (tag) => new El(doc, tag);
  const ctx = { activeTabId: 'a' };
  const calls = [];
  const toasts = [];
  const callbacks = {};
  let identityResolve;
  const baseShields = { enabled: true, block: true, strip: true, isolate: true, farble: true, pausedSites: [] };
  const ext = {
    cfg: null,
    isolation: { isolateEffective: true, operatorOverride: null },
    restoreSession: true,
    restartResult: { ok: true }
  };
  const bridge = {
    onDevtoolsStateChanged: (fn) => {
      callbacks.devtools = fn;
    },
    onPrivacyNet: (fn) => {
      callbacks.net = fn;
    },
    onPrivacyPermission: (fn) => {
      callbacks.permission = fn;
    },
    shieldsGet: async () => ext.cfg || baseShields,
    shieldsIsolationState: async () => ext.isolation,
    shieldsRestartToApply: async () => {
      calls.push(['shieldsRestartToApply']);
      return ext.restartResult;
    },
    onSettingsChanged: (fn) => {
      callbacks.settings = fn;
    },
    onShieldsChanged: (fn) => {
      callbacks.shields = fn;
    },
    automationGetActivity: async () => ({ sessions: [] }),
    onAutomationActivity: (fn) => {
      callbacks.activity = fn;
    },
    settingsGet: async () => ({ restoreSession: ext.restoreSession }),
    shieldsSet: async (value) => {
      calls.push(['shieldsSet', value]);
      return { ...(ext.cfg || baseShields), ...value };
    },
    shieldsPause: async (value) => {
      calls.push(['shieldsPause', value]);
      return { ...baseShields, pausedSites: value.paused ? [value.site] : [] };
    },
    privacyClearCookies: async (value) => {
      calls.push(['clearCookies', value]);
      return { removed: 2 };
    },
    privacyClearStorage: async (value) => {
      calls.push(['clearStorage', value]);
      return { ok: true, origin: 'https://example.test' };
    },
    privacyCookies: async () => ({ first: 0, third: 0, list: [] }),
    identityNew: (value) => {
      calls.push(['identityNew', value]);
      return new Promise((resolve) => {
        identityResolve = resolve;
      });
    },
    tabNavigate: (value) => calls.push(['navigate', value]),
    toggleDevtools: async () => false
  };
  const window = { goldfinch: bridge };
  const tabA = {
    id: 'a',
    wcId: 10,
    url: 'https://www.example.test/page',
    internal: false,
    container: { id: 'jar-a', name: 'A', color: '#123456', partition: 'persist:a' },
    privacy: {
      net: { firstParty: 'example.test', trackers: { count: 3, blocked: 3 }, stripped: 0, cookiesBlocked: 0 },
      fp: {},
      permissions: [],
      cookies: []
    }
  };
  const tabB = { ...tabA, id: 'b', wcId: 20, container: { ...tabA.container, id: 'jar-b', partition: 'persist:b' } };
  const state = { active: tabA, models: [] };
  const deps = {
    window,
    document,
    ctx,
    els,
    activeTab: () => state.active,
    findTabByWcId: (wcId) => [tabA, tabB].find((t) => t.wcId === wcId) || null,
    isInternalTab: (tab) => !!tab?.internal,
    isWebTab: (tab) => !!tab && !tab.internal,
    togglePanel: () => {},
    sendActiveBounds: () => {},
    openToolbarContextMenu: () => {},
    toast: (...args) => toasts.push(args),
    jarsClient: { containers: [tabA.container, tabB.container] },
    buildAutomationIndicatorModel: (input) => {
      state.models.push(input);
      return {
        visible: true,
        mode: input.adminActive ? 'admin' : 'idle',
        color: null,
        count: input.enabledJarKeyCount
      };
    },
    isSafeColor: () => true,
    escapeHtml: String,
    isInternalPageUrl: (url) => url.startsWith('goldfinch://')
  };
  return {
    deps,
    state,
    tabA,
    tabB,
    ctx,
    els,
    calls,
    toasts,
    callbacks,
    ext,
    baseShields,
    resolveIdentity: (value) => identityResolve(value)
  };
}

async function create(h) {
  const { createPrivacyController } = await import(moduleUrl);
  const controller = createPrivacyController(h.deps);
  // Let shieldsGet / shieldsIsolationState / settingsGet resolve and their renders run.
  for (let i = 0; i < 4; i++) await Promise.resolve();
  return controller;
}

// renderPrivacy() also builds the Trackers/Third-party/Cookies/Fingerprinting
// sections, which need a fuller net/cookies fixture than the other tests in
// this file exercise (they never drive togglePrivacy(true) / renderPrivacy()
// directly — the base tabA fixture's `cookies: []` shape is never read as a
// `{ first, third, list }` object elsewhere).
const fullNet = {
  firstParty: 'example.test',
  trackers: { count: 3, blocked: 3, allowed: 0 },
  thirdPartyCount: 0,
  thirdPartyList: [],
  stripped: 0,
  cookiesBlocked: 0
};
const fullCookies = { first: 0, third: 0, list: [] };

test('an unsafe jar color is gated by isSafeColor before it reaches the pJar() innerHTML sink (squawk 0020)', async () => {
  const h = harness();
  h.tabA.container = { ...h.tabA.container, color: '"><script>alert(1)</script>' };
  h.tabA.privacy = { ...h.tabA.privacy, net: fullNet, cookies: fullCookies };
  h.deps.isSafeColor = (color) => color !== h.tabA.container.color; // reject only the injected value
  const controller = await create(h);

  controller.togglePrivacy(true);

  const jarSection = h.els.privacyBody.children.find((child) => child.innerHTML.includes('ps-title">Jar'));
  assert.ok(jarSection, 'the Jar section rendered');
  assert.doesNotMatch(jarSection.innerHTML, /<script>/);
  assert.doesNotMatch(jarSection.innerHTML, /style="background:"><script>/);
  assert.match(jarSection.innerHTML, /style="background:#9aa0ac"/);
});

test('a safe jar color rides through to the pJar() dot unchanged', async () => {
  const h = harness();
  h.tabA.container = { ...h.tabA.container, color: '#abc123' };
  h.tabA.privacy = { ...h.tabA.privacy, net: fullNet, cookies: fullCookies };
  h.deps.isSafeColor = (color) => typeof color === 'string' && color.startsWith('#');
  const controller = await create(h);

  controller.togglePrivacy(true);

  const jarSection = h.els.privacyBody.children.find((child) => child.innerHTML.includes('ps-title">Jar'));
  assert.match(jarSection.innerHTML, /style="background:#abc123"/);
});

test('Shields changes and site pause persist without implicit reload', async () => {
  const h = harness();
  const controller = await create(h);
  await controller.setShield('block', false);
  await controller.toggleSitePause();
  assert.deepEqual(h.calls.slice(0, 2), [
    ['shieldsSet', { block: false }],
    ['shieldsPause', { site: 'example.test', paused: true }]
  ]);
  assert.equal(
    h.calls.some(([name]) => name === 'navigate'),
    false,
    'Shields apply only after the explicit reload action'
  );
});

test('cookie and storage clearing preserve active tab payloads and user feedback', async () => {
  const h = harness();
  const controller = await create(h);
  await controller.clearCookies('site');
  await controller.clearStorage();
  assert.deepEqual(h.calls.find(([name]) => name === 'clearCookies')[1], {
    webContentsId: 10,
    scope: 'site',
    url: h.tabA.url
  });
  assert.deepEqual(h.calls.find(([name]) => name === 'clearStorage')[1], { url: h.tabA.url, webContentsId: 10 });
  assert.ok(h.toasts.some(([title]) => title === 'Cookies cleared'));
  assert.ok(h.toasts.some(([title]) => title === 'Site storage cleared'));
});

test('new identity captures the initiating tab across await and refuses internal tabs', async () => {
  const h = harness();
  const controller = await create(h);
  const pending = controller.newIdentity();
  h.state.active = h.tabB;
  h.ctx.activeTabId = 'b';
  h.resolveIdentity({ ok: true });
  await pending;
  assert.deepEqual(h.calls.find(([name]) => name === 'identityNew')[1], { partition: 'persist:a' });
  assert.deepEqual(h.calls.find(([name]) => name === 'navigate')[1], { wcId: 10, verb: 'reload', args: [] });
  const before = h.calls.length;
  h.state.active = { ...h.tabB, internal: true };
  await controller.newIdentity();
  assert.equal(h.calls.length, before);
});

test('privacy badge and automation cache reconciliation derive from authoritative snapshots', async () => {
  const h = harness();
  const controller = await create(h);
  controller.updatePrivacyBadge();
  assert.equal(h.els.privacyCount.textContent, '3');
  assert.equal(h.els.togglePrivacy.attributes.get('aria-label'), 'Shields, 3 blocked');

  controller.updateAutomationIndicator({ sessions: [{ jarId: 'jar-a', kind: 'jar' }] });
  controller.updateAutomationKeyState({ automationKeyHashes: ['one'], automationAdminKeyHash: 'admin' });
  const last = h.state.models.at(-1);
  assert.deepEqual(last.activeJarIds, ['jar-a']);
  assert.equal(last.enabledJarKeyCount, 1);
  assert.equal(last.adminKeyEnabled, true);
});

// ---------------------------------------------------------------------------
// Sortie 02 leg 2: restart-to-apply Shields section (persistent node, patched in place)
// ---------------------------------------------------------------------------

async function openPanel(h, { cfg, isolation, restoreSession, net } = {}) {
  if (cfg) h.ext.cfg = { ...h.baseShields, ...cfg };
  if (isolation) h.ext.isolation = isolation;
  if (restoreSession !== undefined) h.ext.restoreSession = restoreSession;
  h.tabA.privacy = { ...h.tabA.privacy, net: { ...fullNet, cookiesBlocked: 2, ...(net || {}) }, cookies: fullCookies };
  const controller = await create(h);
  controller.togglePrivacy(true);
  const body = h.els.privacyBody;
  const node = body.children[0];
  const q = (sel) => node.querySelector(sel);
  return { controller, body, node, q };
}

const ISO_ON = { isolateEffective: true, operatorOverride: null };
const ISO_OFF = { isolateEffective: false, operatorOverride: null };

test('every Shields row carries data-shield, the master head is "enabled"', async () => {
  const h = harness();
  const { node, q } = await openPanel(h);
  for (const key of ['enabled', 'block', 'strip', 'isolate', 'farble', 'pause', 'restart', 'foot']) {
    assert.ok(q(`[data-shield="${key}"]`), key);
  }
  assert.equal(node.querySelectorAll('[data-shield="isolate"]').length, 1);
});

test('isolate row renders count, note and dimming from the model in each state', async () => {
  const cases = [
    // [name, cfg, isolation, paused, expect]
    ['in force', {}, ISO_ON, false, { dim: false, count: '2 isolated', note: '' }],
    [
      'in force, site paused',
      { pausedSites: ['example.test'] },
      ISO_ON,
      true,
      { dim: false, count: '2 isolated', note: 'Applies browser-wide' }
    ],
    [
      'configured off but in force',
      { isolate: false },
      ISO_ON,
      false,
      { dim: false, count: '2 isolated', note: 'Stays on until restart' }
    ],
    ['configured on, not in force', {}, ISO_OFF, false, { dim: true, count: '', note: 'Turns on after restart' }],
    [
      'operator disabled, config on',
      {},
      { isolateEffective: false, operatorOverride: 'disabled' },
      false,
      { dim: true, count: '', note: '' }
    ]
  ];
  for (const [name, cfg, isolation, , expect] of cases) {
    const h = harness();
    const { q } = await openPanel(h, { cfg, isolation });
    const row = q('[data-shield="isolate"]');
    assert.equal(row.classList.contains('dim'), expect.dim, name + ' dim');
    assert.equal(q('[data-shield="isolate"] .shield-count').textContent, expect.count, name + ' count');
    assert.equal(q('[data-shield-note="isolate"]').textContent, expect.note, name + ' note');
    assert.equal(
      q('[data-shield-note="isolate"]').classList.contains('hidden'),
      expect.note === '',
      name + ' note hidden'
    );
  }
});

test('master switch off while isolation is in force shows the master note; footer restart line only while pending', async () => {
  const h = harness();
  const { q } = await openPanel(h, { cfg: { enabled: false }, isolation: ISO_ON });
  assert.equal(q('[data-shield-note="enabled"]').textContent, 'Cookie isolation stays on until restart');
  assert.equal(q('.shield-foot-note').classList.contains('hidden'), false, 'pending -> restart line visible');
  assert.equal(q('.shield-foot-note').textContent, 'Cookie isolation changes need a restart');
  const reload = q('[data-shield="foot"]').children.find((c) => c.textContent === 'Reload to apply');
  assert.ok(reload, 'Reload to apply stays, distinct from the restart line');

  const h2 = harness();
  const { q: q2 } = await openPanel(h2);
  assert.equal(q2('.shield-foot-note').classList.contains('hidden'), true, 'nothing pending -> no restart line');
  assert.equal(q2('[data-shield-note="enabled"]').classList.contains('hidden'), true);
  assert.equal(q2('[data-shield="restart"]').classList.contains('hidden'), true);
});

test('AC3 patch in place: focused isolate switch and Restart now are the SAME nodes after a push and an unrelated shields-changed', async () => {
  const h = harness();
  h.deps.findTabByWcId = (wcId) => (wcId === 10 ? h.tabA : null);
  const { node, q, body } = await openPanel(h, { cfg: { isolate: false }, isolation: ISO_ON });
  const sw = q('[data-shield="isolate"]').children.find((c) => c.tagName === 'button');
  const restart = q('#shields-restart');
  assert.ok(sw && restart);
  sw.focus();
  assert.equal(h.deps.document.activeElement, sw);

  const otherBefore = body.children.slice(1);
  h.callbacks.net({ webContentsId: 10, agg: { ...fullNet, thirdPartyCount: 7, cookiesBlocked: 3 } });
  assert.equal(body.children[0], node, 'Shields node is still body.firstChild');
  assert.equal(
    q('[data-shield="isolate"]').children.find((c) => c.tagName === 'button'),
    sw
  );
  assert.equal(q('#shields-restart'), restart);
  assert.equal(sw.parentNode.parentNode, node, 'still attached');
  assert.equal(h.deps.document.activeElement, sw, 'focus survives the network push');
  assert.equal(q('[data-shield="isolate"] .shield-count').textContent, '3 isolated', 'count patched in place');

  restart.focus();
  h.callbacks.shields({ ...h.ext.cfg, farble: false });
  assert.equal(q('#shields-restart'), restart);
  assert.equal(restart.parentNode.parentNode, node);
  assert.equal(h.deps.document.activeElement, restart, 'focus survives an unrelated shields-changed');
  assert.equal(q('[data-shield="farble"]').children.at(-1).attributes.get('aria-checked'), 'false');

  // Shared-mechanism assertion: every other section still renders and its content updates.
  const others = body.children.slice(1);
  assert.notDeepEqual(others, otherBefore, 'other sections were rebuilt (fresh nodes)');
  for (const title of [
    'Jar',
    'Connection',
    'Trackers',
    'Third-party domains',
    'Cookies',
    'Fingerprinting',
    'Permissions'
  ]) {
    assert.ok(
      others.some((c) => c.innerHTML.includes(`ps-title">${title}<`)),
      title + ' section present'
    );
  }
  const tp = others.find((c) => c.innerHTML.includes('ps-title">Third-party domains<'));
  assert.match(tp.innerHTML, /ps-big hot">7</, 'third-party count updated by the push');
});

test('successive switch clicks read the LIVE config, never a closed-over value', async () => {
  const h = harness();
  const { q } = await openPanel(h);
  const sw = q('[data-shield="block"]').children.find((c) => c.tagName === 'button');
  sw.dispatch('click');
  await Promise.resolve();
  await Promise.resolve();
  sw.dispatch('click');
  await Promise.resolve();
  await Promise.resolve();
  const sets = h.calls.filter(([n]) => n === 'shieldsSet').map(([, v]) => v);
  assert.deepEqual(sets, [{ block: false }, { block: true }]);
});

test('pause row patches in place and the browser-wide note appears on a paused in-force site', async () => {
  const h = harness();
  const { q, controller } = await openPanel(h);
  const pause = q('[data-shield="pause"]');
  assert.equal(pause.classList.contains('hidden'), false);
  assert.equal(pause.children[0].textContent, 'Active on example.test');
  await controller.toggleSitePause();
  assert.equal(q('[data-shield="pause"]'), pause, 'same node');
  assert.equal(pause.children[0].textContent, 'Shields paused on example.test');
  assert.equal(q('[data-shield-note="isolate"]').textContent, 'Applies browser-wide');
  assert.equal(q('[data-shield="isolate"] .shield-count').textContent, '2 isolated');
  assert.equal(q('[data-shield="isolate"]').classList.contains('dim'), false);
  assert.equal(q('[data-shield="block"]').classList.contains('dim'), true, 'other rows still dim on pause');
});

function pendingPanel(opts = {}) {
  const h = harness();
  return openPanel(h, { cfg: { isolate: false }, isolation: ISO_ON, ...opts }).then((p) => ({ h, ...p }));
}

test('AC6 two-step confirm (chrome): first click confirms without invoking, second invokes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, q } = await pendingPanel();
  const btn = q('#shields-restart');
  assert.equal(btn.tagName, 'button');
  assert.equal(btn.textContent, 'Restart now');
  assert.ok(btn.textContent.length > 0);
  btn.dispatch('click');
  assert.equal(
    h.calls.some(([n]) => n === 'shieldsRestartToApply'),
    false
  );
  assert.equal(btn.textContent, 'Restart Goldfinch', 'accessible name differs in confirm state');
  assert.equal(q('#shields-restart'), btn, 'same node');
  assert.equal(q('#shields-restart-note').textContent, 'Goldfinch will close and reopen.');
  assert.equal(btn.attributes.get('aria-describedby'), 'shields-restart-note');
  btn.dispatch('click');
  await Promise.resolve();
  assert.equal(h.calls.filter(([n]) => n === 'shieldsRestartToApply').length, 1);
});

test('confirm copy includes the no-restore line when restoreSession is false (and tracks settings-changed)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, q } = await pendingPanel({ restoreSession: false });
  q('#shields-restart').dispatch('click');
  assert.match(q('#shields-restart-note').textContent, /Open tabs won't be reopened\./);
  h.callbacks.settings({ restoreSession: true });
  assert.doesNotMatch(q('#shields-restart-note').textContent, /Open tabs/);
});

test('confirm reverts on Escape (consumed, panel Escape not fired), 6 s timeout, focus leaving, panel close and tab switch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const drain = () => new Promise((r) => setImmediate(r));
  const { h, q, node, controller } = await pendingPanel();
  const btn = q('#shields-restart');
  const confirming = () => btn.textContent === 'Restart Goldfinch';

  // First Escape: reverts only, consumed. Second (idle) Escape is not consumed -> panel closes as today.
  btn.dispatch('click');
  assert.equal(confirming(), true);
  const esc1 = node.dispatch('keydown', { key: 'Escape' });
  assert.equal(confirming(), false);
  assert.equal(esc1.stopped && esc1.defaultPrevented, true);
  const esc2 = node.dispatch('keydown', { key: 'Escape' });
  assert.equal(esc2.stopped, false);

  // 6 s timeout.
  btn.dispatch('click');
  t.mock.timers.tick(5999);
  await drain();
  assert.equal(confirming(), true);
  t.mock.timers.tick(1);
  await drain();
  assert.equal(confirming(), false);

  // Focus leaving the section reverts; focus moving inside it does not.
  btn.dispatch('click');
  node.dispatch('focusout', { relatedTarget: q('[data-shield="block"]') });
  assert.equal(confirming(), true);
  node.dispatch('focusout', { relatedTarget: h.els.privacyClose });
  assert.equal(confirming(), false);

  // Panel close resets it.
  btn.dispatch('click');
  controller.togglePrivacy(false);
  assert.equal(confirming(), false);
  controller.togglePrivacy(true);
  assert.equal(confirming(), false);

  // Tab switch resets it.
  btn.dispatch('click');
  assert.equal(confirming(), true);
  h.state.active = h.tabB;
  h.ctx.activeTabId = 'b';
  h.tabB.privacy = { ...h.tabA.privacy };
  controller.renderPrivacy();
  assert.equal(confirming(), false);
  // ...but an unrelated re-render on the SAME tab does not.
  btn.dispatch('click');
  controller.renderPrivacy();
  assert.equal(confirming(), true);
});

test('restart failure or not-pending reverts the confirm and toasts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, q } = await pendingPanel();
  h.ext.restartResult = { ok: false, reason: 'not-pending' };
  const btn = q('#shields-restart');
  btn.dispatch('click');
  btn.dispatch('click');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(btn.textContent, 'Restart now');
  assert.ok(h.toasts.some(([title]) => title === 'Restart failed'));
});

test('no restart copy lives in a live region; Restart now is a labeled button in both states', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { node, q } = await pendingPanel();
  const btn = q('#shields-restart');
  btn.dispatch('click');
  for (const n of node.walk()) {
    assert.equal(n.attributes.has('aria-live'), false);
    assert.notEqual(n.attributes.get('role'), 'status');
    assert.notEqual(n.attributes.get('role'), 'alert');
  }
  assert.equal(btn.tagName, 'button');
  assert.ok(btn.textContent.trim().length > 0);
});

test('nothing pending: the restart control stays hidden and the confirm cannot linger', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const { q } = await openPanel(h);
  assert.equal(q('[data-shield="restart"]').classList.contains('hidden'), true);
  h.callbacks.shields({ ...h.baseShields, isolate: false }); // now pending
  assert.equal(q('[data-shield="restart"]').classList.contains('hidden'), false);
  q('#shields-restart').dispatch('click');
  h.callbacks.shields({ ...h.baseShields, isolate: true }); // pending cleared
  assert.equal(q('[data-shield="restart"]').classList.contains('hidden'), true);
  assert.equal(q('#shields-restart').textContent, 'Restart now');
});
