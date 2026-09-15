'use strict';

// Mission 20 F1 Leg 2 (AC2/AC4/AC6): behavioral coverage for
// load-failure-controller.js on a minimal fake-DOM harness. tab-controller.js's
// FakeElement/FakeDocument classes are NOT exported (no module.exports in
// tab-controller.test.js), so this is a LIFTED minimal copy of just the bits
// this controller needs (createElement, classList, dataset, querySelector,
// setAttribute/getAttribute, addEventListener/dispatch) — noted per the leg's
// AC2 instruction (see the flight log's leg-2 entry).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/load-failure-controller.js')).href;

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(name = 'div') {
    this.name = name;
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this._text = '';
    this.focused = false;
  }
  set className(value) {
    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((n) => this.classList.add(n));
  }
  set textContent(value) {
    this._text = value;
  }
  get textContent() {
    return this._text;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(name, fn) {
    this.listeners.set(name, fn);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  querySelector(selector) {
    return this._parts ? this._parts.get(selector) || null : null;
  }
  click() {
    const fn = this.listeners.get('click');
    if (fn) fn();
  }
  focus() {
    this.focused = true;
  }
}

// Minimal strip-button double: only the pieces applyStripState touches
// (.tab-title / .tab-status / .tab-close via querySelector, dataset, title,
// setAttribute) — mirrors tab-controller.test.js's real FakeElement shape for
// these same members.
function makeBtn() {
  const btn = new FakeElement('div');
  const parts = new Map([
    ['.tab-title', new FakeElement('span')],
    ['.tab-status', new FakeElement('span')],
    ['.tab-close', new FakeElement('button')]
  ]);
  btn._parts = parts;
  btn.title = '';
  return btn;
}

function createHarness() {
  const root = new FakeElement('section');
  root.classList.add('hidden'); // mirrors index.html's initial `class="hidden"`
  const address = new FakeElement('input');
  address.value = '';
  const els = { loadFailureSurface: root, address };
  const addressChipCalls = [];
  const updateAddressChip = (tab) => addressChipCalls.push(tab);
  const created = [];
  const document = {
    createElement: (name) => {
      const el = new FakeElement(name);
      created.push(el);
      return el;
    },
    activeElement: null,
    body: { isBody: true },
    __created: created
  };
  const tabsByWcId = new Map();
  const findTabByWcId = (wcId) => tabsByWcId.get(wcId) || null;
  let activeTabId = null;
  const isActiveTab = (tab) => !!tab && tab.id === activeTabId;
  const subscribers = [];
  const calls = [];
  const bridge = {
    onTabLoadFailure(cb) {
      subscribers.push(cb);
    },
    tabNavigate(payload) {
      calls.push(['tabNavigate', payload]);
    }
  };
  const classifyLoadFailure = (failure) => {
    if (!failure) return { kind: 'ok', title: '', body: '', retryable: false };
    if (failure.name === 'ERR_BLOCKED_BY_CLIENT') {
      return { kind: 'blocked', title: 'Request blocked', body: 'blocked body', retryable: false };
    }
    return { kind: 'unknown', title: 'Failed', body: 'generic body', retryable: true };
  };
  return {
    els,
    document,
    bridge,
    findTabByWcId,
    isActiveTab,
    classifyLoadFailure,
    updateAddressChip,
    addressChipCalls,
    calls,
    addTab(tab) {
      tabsByWcId.set(tab.wcId, tab);
    },
    setActive(id) {
      activeTabId = id;
    },
    pushFailure(payload) {
      subscribers.forEach((fn) => fn(payload));
    }
  };
}

async function loadController(h) {
  const { createLoadFailureController } = await import(moduleUrl);
  return createLoadFailureController({
    document: h.document,
    els: h.els,
    bridge: h.bridge,
    findTabByWcId: h.findTabByWcId,
    isActiveTab: h.isActiveTab,
    classifyLoadFailure: h.classifyLoadFailure,
    updateAddressChip: h.updateAddressChip
  });
}

test('a failure push on the ACTIVE tab shows the panel, marks the strip, and focuses the heading when body holds focus', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'http://127.0.0.1:1/',
    title: 'New tab',
    btn: makeBtn(),
    loadFailure: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  h.document.activeElement = h.document.body; // no chrome control holds focus
  const controller = await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: -312, name: 'ERR_UNSAFE_PORT', url: 'http://127.0.0.1:1/' } });

  assert.deepEqual(tab.loadFailure, { code: -312, name: 'ERR_UNSAFE_PORT', url: 'http://127.0.0.1:1/' });
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), false, 'the panel must be shown');
  assert.equal(tab.btn.dataset.loadState, 'failed');
  const status = tab.btn.querySelector('.tab-status');
  assert.equal(status.textContent, '⚠');
  // The heading is the last element created inside the column before body/url/code/retry;
  // find it by id instead of assuming creation order fragility.
  const heading = findById(h, 'load-failure-heading');
  assert.equal(heading.focused, true, 'the heading must receive focus (no control held it)');
  controller.hide(); // sanity: hide() is callable and clears currentTab without throwing
});

test('a failure push while a chrome control holds focus does NOT steal focus', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  const addressInput = new FakeElement('input');
  h.document.activeElement = addressInput; // the operator is mid-interaction elsewhere
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x/' } });

  const heading = findById(h, 'load-failure-heading');
  assert.equal(heading.focused, false, 'focus must never be stolen from an active chrome control');
});

test('a re-navigate failure on an EXISTING tab updates tab.url to the intended address (DD4/DD6/DD7)', async () => {
  // did-navigate never fires for the error commit (leg-1 spike finding b), so
  // without this, a second failed navigate on an already-created tab would
  // leave tab.url stale — wrong for the address bar on the next activation
  // and for the census (behavior spec step 3).
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://old.test/', title: 'Old', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://nonexistent-host-abc123xyz.invalid/' }
  });

  assert.equal(tab.url, 'http://nonexistent-host-abc123xyz.invalid/');
});

test('a null push on the active tab clears loadFailure, restores the strip, and hides the panel', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://example.test/',
    title: 'Example',
    btn: makeBtn(),
    loadFailure: { code: -312, name: 'ERR_UNSAFE_PORT', url: 'http://127.0.0.1:1/' }
  };
  tab.btn.dataset.loadState = 'failed';
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.els.loadFailureSurface.classList.remove('hidden'); // simulate it was showing

  h.pushFailure({ wcId: 10, failure: null });

  assert.equal(tab.loadFailure, null);
  assert.equal(tab.btn.dataset.loadState, undefined, 'the failed attribute must be removed on recovery');
  const status = tab.btn.querySelector('.tab-status');
  assert.equal(status.hidden, true);
  assert.equal(
    tab.btn.querySelector('.tab-title').textContent,
    'Example',
    'the title re-derives from tab.title || tab.url'
  );
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), true, 'the panel must be hidden');
});

test('F1: a failure push on the ACTIVE tab syncs the address bar and chip to the intended URL', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'http://old.test/',
    title: 'Old',
    btn: makeBtn(),
    loadFailure: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  h.els.address.value = 'http://old.test/';
  h.document.activeElement = h.document.body; // no chrome control holds focus
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://nonexistent-host-abc123xyz.invalid/' }
  });

  assert.equal(
    h.els.address.value,
    'http://nonexistent-host-abc123xyz.invalid/',
    'the address bar must sync to the intended (failed) URL, mirroring activateTab'
  );
  assert.equal(h.addressChipCalls.length, 1);
  assert.equal(h.addressChipCalls[0], tab);
});

test('F1: a failure push on a BACKGROUND tab never touches the address bar', async () => {
  const h = createHarness();
  const bg = { id: 'tab-2', wcId: 20, url: 'http://bg/', title: 'BG', btn: makeBtn(), loadFailure: null };
  const active = { id: 'tab-1', wcId: 10, url: 'http://active/', title: 'Active', btn: makeBtn(), loadFailure: null };
  h.addTab(bg);
  h.addTab(active);
  h.setActive('tab-1');
  h.els.address.value = 'http://active/';
  await loadController(h);

  h.pushFailure({ wcId: 20, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://bg/' } });

  assert.equal(h.els.address.value, 'http://active/', 'a background failure must never touch the address bar');
  assert.equal(h.addressChipCalls.length, 0);
});

test('F1: a failure push on the active tab skips the address sync while the operator is typing there', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'http://old.test/',
    title: 'Old',
    btn: makeBtn(),
    loadFailure: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  h.els.address.value = 'still typing this';
  h.document.activeElement = h.els.address; // the operator is mid-edit in the address bar
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://nonexistent-host-abc123xyz.invalid/' }
  });

  assert.equal(h.els.address.value, 'still typing this', 'in-progress typing must never be clobbered');
  assert.equal(h.addressChipCalls.length, 0);
});

test('a push for an unknown wcId is a no-op', async () => {
  const h = createHarness();
  await loadController(h);
  assert.doesNotThrow(() => h.pushFailure({ wcId: 999, failure: { code: -1, name: 'ERR_X', url: 'x' } }));
});

test('a failure push on a BACKGROUND tab marks the strip but never shows the panel', async () => {
  const h = createHarness();
  const bg = { id: 'tab-2', wcId: 20, url: 'http://bg/', title: 'BG', btn: makeBtn(), loadFailure: null };
  const active = { id: 'tab-1', wcId: 10, url: 'http://active/', title: 'Active', btn: makeBtn(), loadFailure: null };
  h.addTab(bg);
  h.addTab(active);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 20, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://bg/' } });

  assert.deepEqual(bg.loadFailure, { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://bg/' });
  assert.equal(bg.btn.dataset.loadState, 'failed');
  assert.equal(
    h.els.loadFailureSurface.classList.contains('hidden'),
    true,
    'the panel must stay hidden for a background failure'
  );
});

test('Retry navigates the shown tab with the recorded intended address', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'http://127.0.0.1:1/',
    title: 'New tab',
    btn: makeBtn(),
    loadFailure: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.pushFailure({ wcId: 10, failure: { code: -312, name: 'ERR_UNSAFE_PORT', url: 'http://127.0.0.1:1/' } });

  const retry = findById(h, 'load-failure-retry');
  retry.click();

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], ['tabNavigate', { wcId: 10, verb: 'loadURL', args: ['http://127.0.0.1:1/'] }]);
});

test('HAT H1 fix 1: the code line renders "<name> (<code>)" when both are present', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'http://x/' } });

  const codeLine = findById(h, 'load-failure-code');
  assert.equal(codeLine.textContent, 'ERR_CONNECTION_REFUSED (-102)');
});

test('HAT H1 fix 1: the code line renders just "(<code>)" when `name` is missing', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: -102, url: 'http://x/' } });

  const codeLine = findById(h, 'load-failure-code');
  assert.equal(codeLine.textContent, '(-102)');
});

test('HAT H1 fix 1: the code line renders just the name when `code` is not a finite number', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: NaN, name: 'ERR_CONNECTION_REFUSED', url: 'http://x/' } });

  const codeLine = findById(h, 'load-failure-code');
  assert.equal(codeLine.textContent, 'ERR_CONNECTION_REFUSED');
});

test('HAT H1 fix 1: the code line renders nothing when both `name` and `code` are missing', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { url: 'http://x/' } });

  const codeLine = findById(h, 'load-failure-code');
  assert.equal(codeLine.textContent, '');
});

test('a non-retryable classification hides the Retry button', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.pushFailure({ wcId: 10, failure: { code: -20, name: 'ERR_BLOCKED_BY_CLIENT', url: 'http://x/' } });

  const retry = findById(h, 'load-failure-retry');
  assert.equal(retry.classList.contains('hidden'), true, 'Retry must be hidden for a non-retryable classification');
});

// Helper: the controller assigns ids via `.id = '...'` on elements created
// through document.createElement — walk every element document.createElement
// returned and match by its recorded id attribute-equivalent (the FakeElement
// has a plain `.id` field set directly, not via setAttribute).
function findById(h, id) {
  // Re-invoke createElement's tracking: createHarness's document.createElement
  // pushes every created element into `created`; expose it via closure.
  for (const el of h.document.__created || []) {
    if (el.id === id) return el;
  }
  return null;
}
