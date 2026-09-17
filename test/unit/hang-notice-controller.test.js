'use strict';

// Mission 20 Flight 3 Leg 2 (DD3): behavioral coverage for
// hang-notice-controller.js on the shared fake-DOM harness
// (test/unit/helpers/fake-dom.js). Unlike load-failure-controller.js, this
// controller builds no DOM — #hang-notice's text/buttons are static markup
// in index.html — so the harness supplies FakeElement doubles directly for
// els.hangNotice/hangNoticeWait/hangNoticeKill.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { FakeElement } = require('./helpers/fake-dom');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/hang-notice-controller.js')).href;

function createHarness() {
  const hangNotice = new FakeElement('div');
  hangNotice.classList.add('hidden'); // mirrors index.html's initial class="hidden"
  const hangNoticeWait = new FakeElement('button');
  const hangNoticeKill = new FakeElement('button');
  const els = { hangNotice, hangNoticeWait, hangNoticeKill };

  const tabsByWcId = new Map();
  const findTabByWcId = (wcId) => tabsByWcId.get(wcId) || null;
  let activeTabId = null;
  const isActiveTab = (tab) => !!tab && tab.id === activeTabId;

  const tabNavigateCalls = [];
  const refreshStripCalls = [];
  let sendActiveBoundsCalls = 0;

  return {
    els,
    findTabByWcId,
    isActiveTab,
    tabNavigateCalls,
    refreshStripCalls,
    addTab(tab) {
      tabsByWcId.set(tab.wcId, tab);
    },
    setActive(id) {
      activeTabId = id;
    },
    get sendActiveBoundsCalls() {
      return sendActiveBoundsCalls;
    },
    deps: {
      els,
      isActiveTab,
      findTabByWcId,
      tabNavigate: (payload) => tabNavigateCalls.push(payload),
      refreshStrip: (tab) => refreshStripCalls.push(tab),
      sendActiveBounds: () => {
        sendActiveBoundsCalls++;
      }
    }
  };
}

async function loadController(h) {
  const { createHangNoticeController } = await import(moduleUrl);
  return createHangNoticeController(h.deps);
}

test('onTabHung(true) on the active tab shows the bar, refreshes the strip, and stamps tab.hung', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  controller.onTabHung({ wcId: 10, hung: true });

  assert.equal(tab.hung, true);
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false, 'the bar must be shown');
  assert.deepEqual(h.refreshStripCalls, [tab]);
  assert.equal(h.sendActiveBoundsCalls, 1, 'a net visibility change calls sendActiveBounds');
});

test('onTabHung(false) on the active tab hides the bar and clears tab.hung', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: true };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true }); // rising edge first, so there is a net change to reverse
  h.sendActiveBoundsCalls; // (no-op access, keep lints quiet)

  controller.onTabHung({ wcId: 10, hung: false });

  assert.equal(tab.hung, false);
  assert.equal(h.els.hangNotice.classList.contains('hidden'), true, 'the bar must be hidden once responsive');
});

test('onTabHung on a BACKGROUND tab never touches the bar shown for the real active tab', async () => {
  const h = createHarness();
  const active = { id: 'tab-active', wcId: 1, hung: false };
  const background = { id: 'tab-bg', wcId: 2, hung: false };
  h.addTab(active);
  h.addTab(background);
  h.setActive('tab-active');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 1, hung: true }); // the active tab is genuinely hung — bar visible
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false);

  controller.onTabHung({ wcId: 2, hung: true }); // a background tab also goes unresponsive

  assert.equal(background.hung, true, 'the background tab still gets its own hung stamp');
  assert.equal(
    h.els.hangNotice.classList.contains('hidden'),
    false,
    'the bar showing for the real active tab must stay visible — a background push must not hide it'
  );
});

test('sendActiveBounds fires only on a NET visibility change, never on every push', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  controller.onTabHung({ wcId: 10, hung: true }); // hidden -> visible: net change
  assert.equal(h.sendActiveBoundsCalls, 1);
  controller.onTabHung({ wcId: 10, hung: true }); // already visible: no net change
  assert.equal(h.sendActiveBoundsCalls, 1);
  controller.onTabHung({ wcId: 10, hung: false }); // visible -> hidden: net change
  assert.equal(h.sendActiveBoundsCalls, 2);
  controller.onTabHung({ wcId: 10, hung: false }); // already hidden: no net change
  assert.equal(h.sendActiveBoundsCalls, 2);
});

test('a rising edge resets an earlier dismissal (DD3: Wait hides for THIS episode only)', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  tab.hangDismissed = true; // simulate a prior episode's dismissal lingering
  const controller = await loadController(h);

  controller.onTabHung({ wcId: 10, hung: true });

  assert.equal(tab.hangDismissed, false, 'a fresh rising edge clears the dismissal');
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false, 'the bar shows for the new episode');
});

test('a falling edge (recovered) leaves hangDismissed untouched (meaningless once not hung)', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: true, hangDismissed: true };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  controller.onTabHung({ wcId: 10, hung: false });

  assert.equal(tab.hangDismissed, true, 'a falling edge is not a "rising edge" — dismissal is untouched');
});

test('Wait hides the bar for this episode; the bar re-shows only on the NEXT rising edge', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false);

  h.els.hangNoticeWait.click();

  assert.equal(tab.hangDismissed, true);
  assert.equal(h.els.hangNotice.classList.contains('hidden'), true, 'Wait hides the bar for this episode');

  // The tab is STILL hung (no responsive arrived) — a second unresponsive
  // push without an intervening responsive must not re-show it.
  controller.onTabHung({ wcId: 10, hung: true });
  assert.equal(h.els.hangNotice.classList.contains('hidden'), true, 'no re-show without a fresh rising edge');

  // A recovery, then a NEW hang, is a fresh rising edge.
  controller.onTabHung({ wcId: 10, hung: false });
  controller.onTabHung({ wcId: 10, hung: true });
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false, 'the next rising edge re-arms the bar');
});

test('Wait with no current tab (bar not showing) is a harmless no-op', async () => {
  const h = createHarness();
  await loadController(h);
  assert.doesNotThrow(() => h.els.hangNoticeWait.click());
});

test('Kill sends tabNavigate({ wcId, verb: "kill-reload" }) for the tab the bar is currently showing', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });

  h.els.hangNoticeKill.click();

  assert.deepEqual(h.tabNavigateCalls, [{ wcId: 10, verb: 'kill-reload' }]);
});

test('Kill with no current tab (bar not showing) is a harmless no-op', async () => {
  const h = createHarness();
  await loadController(h);
  h.els.hangNoticeKill.click();
  assert.deepEqual(h.tabNavigateCalls, []);
});

test('project(tab) (activateTab projection) shows the bar for an already-hung newly-active tab', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: true };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  controller.project(tab);

  assert.equal(h.els.hangNotice.classList.contains('hidden'), false);
});

test('project(tab) hides the bar when switching to a non-hung tab', async () => {
  const h = createHarness();
  const hungTab = { id: 'tab-1', wcId: 10, hung: true };
  const cleanTab = { id: 'tab-2', wcId: 11, hung: false };
  h.addTab(hungTab);
  h.addTab(cleanTab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.project(hungTab);
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false);

  h.setActive('tab-2');
  controller.project(cleanTab);

  assert.equal(h.els.hangNotice.classList.contains('hidden'), true);
});

test('project(null) is a harmless no-op', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  assert.doesNotThrow(() => controller.project(null));
});
