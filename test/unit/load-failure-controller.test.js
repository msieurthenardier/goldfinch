'use strict';

// Mission 20 F1 Leg 2 (AC2/AC4/AC6): behavioral coverage for
// load-failure-controller.js on the shared fake-DOM harness
// (test/unit/helpers/fake-dom.js, squawk 0077 — this file's local
// FakeClassList/FakeElement copies are gone).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { FakeElement, createFakeDocument } = require('./helpers/fake-dom');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/load-failure-controller.js')).href;

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
  const refreshTabIndicatorsOpts = [];
  // Mission 20 F3 Leg 1 (DD11): the controller's dep is now the unified
  // refreshTabIndicators(tab, opts) owner (site-security-controller.js) —
  // addressChipCalls keeps its pre-existing tab-only shape (every prior
  // assertion below reads it by identity); refreshTabIndicatorsOpts records
  // the opts bag separately (the real call site always passes { force: true }).
  const refreshTabIndicators = (tab, opts) => {
    addressChipCalls.push(tab);
    refreshTabIndicatorsOpts.push(opts);
  };
  const document = createFakeDocument();
  const tabsByWcId = new Map();
  const findTabByWcId = (wcId) => tabsByWcId.get(wcId) || null;
  let activeTabId = null;
  const isActiveTab = (tab) => !!tab && tab.id === activeTabId;
  const subscribers = [];
  const calls = [];
  const advancedCalls = [];
  const viewCertificateCalls = [];
  const crashSubscribers = [];
  const bridge = {
    onTabLoadFailure(cb) {
      subscribers.push(cb);
    },
    // Mission 20 Flight 3 Leg 2 (DD1): the crash push — the onTabLoadFailure
    // shape, its own independent subscriber list.
    onTabCrash(cb) {
      crashSubscribers.push(cb);
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
    refreshTabIndicators,
    addressChipCalls,
    refreshTabIndicatorsOpts,
    calls,
    advancedCalls,
    viewCertificateCalls,
    onAdvanced: (tab) => advancedCalls.push(tab),
    onViewCertificate: (tab) => viewCertificateCalls.push(tab),
    addTab(tab) {
      tabsByWcId.set(tab.wcId, tab);
    },
    setActive(id) {
      activeTabId = id;
    },
    pushFailure(payload) {
      subscribers.forEach((fn) => fn(payload));
    },
    pushCrash(payload) {
      crashSubscribers.forEach((fn) => fn(payload));
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
    refreshTabIndicators: h.refreshTabIndicators,
    onAdvanced: h.onAdvanced,
    onViewCertificate: h.onViewCertificate
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

test('F1: a failure push on the active tab skips the address VALUE sync while the operator is typing there, but still updates the chip', async () => {
  // Acceptance-run fix pass (tls-trust-surface checkpoint 2): only the value
  // write is guarded by activeElement — the security chip must never lag
  // behind a real load-failure state, focus or no.
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
  assert.equal(h.addressChipCalls.length, 1, 'the chip must still be refreshed even while the address bar has focus');
  assert.equal(h.addressChipCalls[0], tab);
});

test('chip updates even while the address bar has focus (tls-trust-surface checkpoint 2)', async () => {
  // Root cause: a new tab autofocuses #address, so document.activeElement is
  // ALREADY els.address the moment the tab-load-failure push for a
  // cert-blocked navigation arrives — the exact scenario where the chip must
  // not be allowed to lag and show a stale green lock over the interstitial.
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://bad.test/',
    title: 'New tab',
    btn: makeBtn(),
    loadFailure: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  h.els.address.value = 'https://bad.test/';
  h.document.activeElement = h.els.address; // address bar holds focus (new-tab autofocus)
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });

  assert.equal(h.addressChipCalls.length, 1, 'refreshTabIndicators must run even while the address bar has focus');
  assert.equal(h.addressChipCalls[0], tab);
  assert.deepEqual(
    h.refreshTabIndicatorsOpts[0],
    { force: true },
    "Mission 20 F3 Leg 1 (DD11): the load-failure push forces the refresh — CLAUDE.md 'Chrome indicators' rule (c)"
  );
  assert.equal(h.els.address.value, 'https://bad.test/', 'the value write stays guarded and must not be overwritten');

  // Sanity check on the other side of the guard: with focus elsewhere, both
  // the value and the chip update (pre-existing behaviour, unchanged).
  const h2 = createHarness();
  const tab2 = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://old.test/',
    title: 'Old',
    btn: makeBtn(),
    loadFailure: null
  };
  h2.addTab(tab2);
  h2.setActive('tab-1');
  h2.els.address.value = 'https://old.test/';
  h2.document.activeElement = h2.document.body; // no chrome control holds focus
  await loadController(h2);

  h2.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });

  assert.equal(h2.addressChipCalls.length, 1);
  assert.equal(h2.addressChipCalls[0], tab2);
  assert.equal(
    h2.els.address.value,
    'https://bad.test/',
    'with focus elsewhere the value syncs too (unchanged behaviour)'
  );
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

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD4/AC3): the cert branch — classifyCertError's
// title/body, Retry always shown, data-failure-kind="cert" on the root.
// ---------------------------------------------------------------------------

test('DD4: a folded cert failure renders classifyCertError copy, keeps the unchanged code line, always shows Retry, and stamps data-failure-kind', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'https://bad.test/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });

  const heading = findById(h, 'load-failure-heading');
  const body = findById(h, 'load-failure-body');
  const codeLine = findById(h, 'load-failure-code');
  const retry = findById(h, 'load-failure-retry');
  assert.equal(heading.textContent, "This connection isn't private");
  assert.ok(body.textContent.length > 0);
  assert.equal(codeLine.textContent, 'ERR_CERT_AUTHORITY_INVALID (-202)');
  assert.equal(retry.classList.contains('hidden'), false, 'Retry is always shown for a cert failure');
  assert.equal(h.els.loadFailureSurface.dataset.failureKind, 'cert');
});

test('DD4: data-failure-kind is absent for a non-cert failure and cleared again on recovery', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });
  assert.equal(h.els.loadFailureSurface.dataset.failureKind, 'cert');

  h.pushFailure({ wcId: 10, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x/' } });
  assert.equal(h.els.loadFailureSurface.dataset.failureKind, undefined);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 3 (DD3/DD4/AC5): the Advanced hook — shown ONLY for
// an overridable cert failure; click → onAdvanced(tab).
// ---------------------------------------------------------------------------

test('AC5: Advanced is HIDDEN by default and for a non-cert failure', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const advanced = findById(h, 'load-failure-advanced');
  assert.equal(advanced.classList.contains('hidden'), true, 'hidden before any failure renders');

  h.pushFailure({ wcId: 10, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x/' } });
  assert.equal(advanced.classList.contains('hidden'), true, 'hidden for a non-cert failure');
});

test('AC5: Advanced is SHOWN for every overridable cert kind (authority/name/date/weak/other)', async () => {
  const overridableErrors = [
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID',
    'ERR_CERT_DATE_INVALID',
    'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
    'ERR_CERT_SOME_FUTURE_NAME' // unrecognized ERR_CERT_* → 'other', overridable
  ];
  for (const error of overridableErrors) {
    const h = createHarness();
    const tab = {
      id: 'tab-1',
      wcId: 10,
      url: 'https://bad.test/',
      title: 'New tab',
      btn: makeBtn(),
      loadFailure: null
    };
    h.addTab(tab);
    h.setActive('tab-1');
    await loadController(h);
    h.pushFailure({
      wcId: 10,
      failure: {
        code: -202,
        name: error,
        url: 'https://bad.test/',
        cert: { host: 'bad.test', port: 443, error, overridable: true, fingerprint: 'AA', summary: {} }
      }
    });
    const advanced = findById(h, 'load-failure-advanced');
    assert.equal(advanced.classList.contains('hidden'), false, error + ' must show Advanced');
  }
});

test('AC5: Advanced is HIDDEN for every non-overridable cert kind (revoked/pinned/invalid) — the body already says it cannot be bypassed', async () => {
  const nonOverridableErrors = [
    'ERR_CERT_REVOKED',
    'ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN',
    'ERR_CERT_KNOWN_INTERCEPTION_BLOCKED',
    'ERR_CERT_INVALID',
    'ERR_CERT_CONTAINS_ERRORS'
  ];
  for (const error of nonOverridableErrors) {
    const h = createHarness();
    const tab = {
      id: 'tab-1',
      wcId: 10,
      url: 'https://bad.test/',
      title: 'New tab',
      btn: makeBtn(),
      loadFailure: null
    };
    h.addTab(tab);
    h.setActive('tab-1');
    await loadController(h);
    h.pushFailure({
      wcId: 10,
      failure: {
        code: -202,
        name: error,
        url: 'https://bad.test/',
        cert: { host: 'bad.test', port: 443, error, overridable: false, summary: {} }
      }
    });
    const advanced = findById(h, 'load-failure-advanced');
    assert.equal(advanced.classList.contains('hidden'), true, error + ' must hide Advanced');
  }
});

test("AC5/DD3: clicking Advanced calls onAdvanced with the panel's current tab", async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'https://bad.test/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });

  const advanced = findById(h, 'load-failure-advanced');
  advanced.click();
  assert.equal(h.advancedCalls.length, 1);
  assert.equal(h.advancedCalls[0], tab);
});

test('clicking Advanced while no cert failure is current is a no-op', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const advanced = findById(h, 'load-failure-advanced');
  advanced.click();
  assert.equal(h.advancedCalls.length, 0);
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

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 4 (DD9): View certificate — shown for ANY cert
// failure (overridable or not, unlike Advanced); click → onViewCertificate.
// DOM order: heading → Retry → View certificate → Advanced.
// ---------------------------------------------------------------------------

test('DD9: View certificate is HIDDEN by default and for a non-cert failure', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const viewCert = findById(h, 'load-failure-view-cert');
  assert.equal(viewCert.classList.contains('hidden'), true, 'hidden before any failure renders');

  h.pushFailure({ wcId: 10, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x/' } });
  assert.equal(viewCert.classList.contains('hidden'), true, 'hidden for a non-cert failure');
});

test('DD9: View certificate is SHOWN for both overridable AND non-overridable cert failures', async () => {
  for (const overridable of [true, false]) {
    const h = createHarness();
    const tab = {
      id: 'tab-1',
      wcId: 10,
      url: 'https://bad.test/',
      title: 'New tab',
      btn: makeBtn(),
      loadFailure: null
    };
    h.addTab(tab);
    h.setActive('tab-1');
    await loadController(h);
    h.pushFailure({
      wcId: 10,
      failure: {
        code: -202,
        name: 'ERR_CERT_AUTHORITY_INVALID',
        url: 'https://bad.test/',
        cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable, summary: {} }
      }
    });
    const viewCert = findById(h, 'load-failure-view-cert');
    assert.equal(viewCert.classList.contains('hidden'), false, `overridable=${overridable} must show View certificate`);
  }
});

test("DD9: clicking View certificate calls onViewCertificate with the panel's current tab", async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'https://bad.test/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.pushFailure({
    wcId: 10,
    failure: {
      code: -202,
      name: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://bad.test/',
      cert: { host: 'bad.test', port: 443, error: 'ERR_CERT_AUTHORITY_INVALID', overridable: true, summary: {} }
    }
  });

  const viewCert = findById(h, 'load-failure-view-cert');
  viewCert.click();
  assert.equal(h.viewCertificateCalls.length, 1);
  assert.equal(h.viewCertificateCalls[0], tab);
});

test('clicking View certificate while no cert failure is current is a no-op', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const viewCert = findById(h, 'load-failure-view-cert');
  viewCert.click();
  assert.equal(h.viewCertificateCalls.length, 0);
});

test('DD9: DOM order is heading-column children Retry → View certificate → Advanced', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'New tab', btn: makeBtn(), loadFailure: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const retry = findById(h, 'load-failure-retry');
  const viewCert = findById(h, 'load-failure-view-cert');
  const advanced = findById(h, 'load-failure-advanced');
  const column = retry.parent;
  const order = column.children.map((c) => c.id);
  assert.ok(order.indexOf(retry.id) < order.indexOf(viewCert.id), 'Retry precedes View certificate');
  assert.ok(order.indexOf(viewCert.id) < order.indexOf(advanced.id), 'View certificate precedes Advanced');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD1): the crash branch — classifyCrash copy,
// the `<reason> (<exitCode>)` code line, #load-failure-reload, Retry/View
// certificate/Advanced all hidden, strip crashed state, onTabLoadFailure
// clearing tab.crash, and the Reload button's tabNavigate reload.
// ---------------------------------------------------------------------------

test('AC5: a crash push on the ACTIVE tab shows the panel with classifyCrash copy, the reason (exitCode) code line, and Reload only', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushCrash({ wcId: 10, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } });

  assert.deepEqual(tab.crash, { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' });
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), false, 'the panel must be shown');
  const heading = findById(h, 'load-failure-heading');
  assert.equal(heading.textContent, 'This page crashed');
  const codeLine = findById(h, 'load-failure-code');
  assert.equal(codeLine.textContent, 'crashed (139)');
  assert.equal(findById(h, 'load-failure-retry').classList.contains('hidden'), true, 'Retry hidden for a crash');
  assert.equal(
    findById(h, 'load-failure-view-cert').classList.contains('hidden'),
    true,
    'View certificate hidden for a crash'
  );
  assert.equal(findById(h, 'load-failure-advanced').classList.contains('hidden'), true, 'Advanced hidden for a crash');
  assert.equal(findById(h, 'load-failure-reload').classList.contains('hidden'), false, 'Reload shown for a crash');
  assert.equal(h.els.loadFailureSurface.dataset.failureKind, 'crash');
});

test('AC1: classifyCrash killed/oom copy renders through the panel', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'https://x/', title: 'X', btn: makeBtn(), loadFailure: null, crash: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushCrash({ wcId: 10, crash: { reason: 'killed', exitCode: 9, url: 'https://x/' } });
  assert.equal(findById(h, 'load-failure-heading').textContent, 'This page was closed by the system');

  h.pushCrash({ wcId: 10, crash: { reason: 'oom', exitCode: 1, url: 'https://x/' } });
  assert.equal(findById(h, 'load-failure-heading').textContent, 'This page ran out of memory');
});

test('AC5: Reload sends tabNavigate reload for the panel’s tab', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.pushCrash({ wcId: 10, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } });

  const reload = findById(h, 'load-failure-reload');
  reload.click();

  assert.deepEqual(h.calls, [['tabNavigate', { wcId: 10, verb: 'reload' }]]);
});

test('clicking Reload while no crash is current is a no-op', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, url: 'http://x/', title: 'X', btn: makeBtn(), loadFailure: null, crash: null };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  const reload = findById(h, 'load-failure-reload');
  reload.click();
  assert.equal(h.calls.length, 0);
});

test('AC5/DD1: applyStripState marks a crashed tab with data-load-state="crashed" and the crashed suffix', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushCrash({ wcId: 10, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } });

  assert.equal(tab.btn.dataset.loadState, 'crashed');
  const status = tab.btn.querySelector('.tab-status');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, '⚠');
  assert.ok(tab.btn.getAttribute('aria-label').endsWith('— crashed'));
});

test('DD1: crash precedence — crash beats a stale loadFailure/hung on the strip (deriveStripLoadState)', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: { code: -1, name: 'stale' },
    hung: true,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushCrash({ wcId: 10, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } });

  assert.equal(tab.crash !== null, true);
  assert.equal(tab.loadFailure, null, 'a dead renderer is never also reported failed');
  assert.equal(tab.hung, false, 'a dead renderer is never also reported hung');
  assert.equal(tab.btn.dataset.loadState, 'crashed');
});

test('a tab-crash null push (cleared by navigation) hides the panel and clears the strip on the active tab', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' }
  };
  tab.btn.dataset.loadState = 'crashed';
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);
  h.els.loadFailureSurface.classList.remove('hidden'); // simulate it was showing

  h.pushCrash({ wcId: 10, crash: null });

  assert.equal(tab.crash, null);
  assert.equal(tab.btn.dataset.loadState, undefined);
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), true);
});

test('a crash push on a BACKGROUND tab marks the strip but never shows the panel', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('some-other-tab');
  await loadController(h);

  h.pushCrash({ wcId: 10, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } });

  assert.ok(tab.crash);
  assert.equal(tab.btn.dataset.loadState, 'crashed');
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), true, 'a background crash never opens the panel');
});

test('a crash push for an unknown wcId is a no-op', async () => {
  const h = createHarness();
  await loadController(h);
  assert.doesNotThrow(() => h.pushCrash({ wcId: 999, crash: { reason: 'crashed', exitCode: 139, url: 'x' } }));
});

// ---------------------------------------------------------------------------
// HAT H2b: showCrashPanelForAudit() stamps a SYNTHETIC tab.crash chrome-side
// that main never learns about, so main's did-start-navigation clear-and-push
// never fires for it — onTabDidNavigate is the fix, clearing any crash record
// (synthetic or real) the moment the tab's next navigation commits.
// ---------------------------------------------------------------------------

test('HAT H2b: onTabDidNavigate clears a SYNTHETIC crash record, restores the strip, and hides the panel on the active tab', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://crashed.test/',
    title: 'Crashed',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  // Simulate showCrashPanelForAudit()'s synthetic stamp (main never told the
  // chrome about this crash, so no tab-crash push will ever clear it).
  tab.crash = { reason: 'crashed', exitCode: 139, url: tab.url };
  controller.applyStripState(tab);
  controller.show(tab);
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), false, 'sanity: the panel is showing');

  controller.onTabDidNavigate(tab);

  assert.equal(tab.crash, null, 'the synthetic crash record must be cleared on the next committed navigation');
  assert.equal(tab.btn.dataset.loadState, undefined, 'the strip must be restored');
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), true, 'the panel must be hidden');
});

test('HAT H2b: onTabDidNavigate on a tab with no crash record is a harmless no-op', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://x.test/',
    title: 'X',
    btn: makeBtn(),
    loadFailure: null,
    crash: null
  };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  // A REAL crash is already cleared by main's own tab-crash null push (which
  // arrives before did-navigate, since did-start-navigation precedes it) —
  // this call must be a no-op, not throw, and must not re-show the panel.
  assert.doesNotThrow(() => controller.onTabDidNavigate(tab));
  assert.equal(h.els.loadFailureSurface.classList.contains('hidden'), true);
});

test('HAT H2b: onTabDidNavigate on a BACKGROUND tab clears its crash record but never touches the panel shown for the real active tab', async () => {
  const h = createHarness();
  const active = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://active.test/',
    title: 'Active',
    btn: makeBtn(),
    loadFailure: null,
    crash: { reason: 'crashed', exitCode: 139, url: 'https://active.test/' }
  };
  const bg = {
    id: 'tab-2',
    wcId: 20,
    url: 'https://bg.test/',
    title: 'BG',
    btn: makeBtn(),
    loadFailure: null,
    crash: { reason: 'crashed', exitCode: 139, url: 'https://bg.test/' }
  };
  h.addTab(active);
  h.addTab(bg);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.applyStripState(active);
  controller.show(active);

  controller.onTabDidNavigate(bg);

  assert.equal(bg.crash, null, 'the background tab still clears its own crash record');
  assert.deepEqual(active.crash, { reason: 'crashed', exitCode: 139, url: 'https://active.test/' });
  assert.equal(
    h.els.loadFailureSurface.classList.contains('hidden'),
    false,
    "a background tab's navigation must not hide the panel shown for the real active tab"
  );
});

test('DD1: a fresh failed load clears a prior crash (crash then a fresh failed load)', async () => {
  const h = createHarness();
  const tab = {
    id: 'tab-1',
    wcId: 10,
    url: 'https://x.test/',
    title: 'X',
    btn: makeBtn(),
    loadFailure: null,
    crash: { reason: 'crashed', exitCode: 139, url: 'https://x.test/' }
  };
  h.addTab(tab);
  h.setActive('tab-1');
  await loadController(h);

  h.pushFailure({ wcId: 10, failure: { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'https://x.test/' } });

  assert.equal(tab.crash, null);
  assert.deepEqual(tab.loadFailure, { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'https://x.test/' });
});
