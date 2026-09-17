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
  const hangNoticeText = new FakeElement('span');
  hangNoticeText.textContent = "This page isn't responding"; // mirrors index.html's static initial text
  const hangNoticeWait = new FakeElement('button');
  const hangNoticeKill = new FakeElement('button');
  const els = { hangNotice, hangNoticeText, hangNoticeWait, hangNoticeKill };

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

// ---------------------------------------------------------------------------
// HAT H3 follow-up: the forced kill of a busy renderer takes several seconds
// to land, so Kill must give SYNCHRONOUS, visible feedback (text + disabled
// buttons + data-state) before the verb is even sent, and a second click
// while that pending state is up must be a no-op.
// ---------------------------------------------------------------------------

test('HAT H3: Kill click gives immediate feedback — text, disabled buttons, data-state — before the verb lands', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });

  h.els.hangNoticeKill.click();

  assert.equal(h.els.hangNoticeText.textContent, 'Stopping the page…');
  assert.equal(h.els.hangNoticeWait.disabled, true);
  assert.equal(h.els.hangNoticeKill.disabled, true);
  assert.equal(h.els.hangNotice.dataset.state, 'killing');
  assert.deepEqual(h.tabNavigateCalls, [{ wcId: 10, verb: 'kill-reload' }]);
});

test('HAT H3: a second Kill click while already killing sends no additional tabNavigate and leaves state as-is', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });
  h.els.hangNoticeKill.click();

  h.els.hangNoticeKill.click();

  assert.deepEqual(h.tabNavigateCalls, [{ wcId: 10, verb: 'kill-reload' }], 'no second kill-reload dispatch');
  assert.equal(h.els.hangNoticeText.textContent, 'Stopping the page…', 'still showing the pending copy');
  assert.equal(h.els.hangNotice.dataset.state, 'killing');
});

test('HAT H3: a tab-hung false push for the killed tab restores the bar (hung-false clears the pending-kill state)', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });
  h.els.hangNoticeKill.click();

  controller.onTabHung({ wcId: 10, hung: false });

  assert.equal(h.els.hangNoticeText.textContent, "This page isn't responding");
  assert.equal(h.els.hangNoticeWait.disabled, false);
  assert.equal(h.els.hangNoticeKill.disabled, false);
  assert.equal(h.els.hangNotice.dataset.state, undefined);
});

test('HAT H3: onTabDidNavigate for the killed tab also restores the pending-kill state', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 10, hung: true });
  h.els.hangNoticeKill.click();

  controller.onTabDidNavigate(tab);

  assert.equal(h.els.hangNoticeText.textContent, "This page isn't responding");
  assert.equal(h.els.hangNoticeWait.disabled, false);
  assert.equal(h.els.hangNoticeKill.disabled, false);
  assert.equal(h.els.hangNotice.dataset.state, undefined);
});

test('HAT H3: a tab-hung false push for an UNRELATED background tab never touches an in-flight kill on the active tab', async () => {
  const h = createHarness();
  const active = { id: 'tab-active', wcId: 1, hung: false };
  const background = { id: 'tab-bg', wcId: 2, hung: true };
  h.addTab(active);
  h.addTab(background);
  h.setActive('tab-active');
  const controller = await loadController(h);
  controller.onTabHung({ wcId: 1, hung: true });
  h.els.hangNoticeKill.click();

  controller.onTabHung({ wcId: 2, hung: false });

  assert.equal(
    h.els.hangNoticeText.textContent,
    'Stopping the page…',
    "the active tab's pending-kill copy is untouched"
  );
  assert.equal(h.els.hangNoticeKill.disabled, true);
  assert.equal(h.els.hangNotice.dataset.state, 'killing');
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

// ---------------------------------------------------------------------------
// HAT H2b: showHangNoticeForAudit() stamps a SYNTHETIC tab.hung chrome-side
// that main never learns about, so main's did-start-navigation clear-and-push
// never fires for it — onTabDidNavigate is the fix, clearing any hung state
// (synthetic or real) the moment the tab's next navigation commits.
// ---------------------------------------------------------------------------

test('HAT H2b: onTabDidNavigate clears a SYNTHETIC hung record, refreshes the strip, and hides the bar on the active tab', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);
  // Simulate showHangNoticeForAudit()'s synthetic stamp (main never told the
  // chrome about this hang, so no tab-hung push will ever clear it).
  tab.hung = true;
  controller.project(tab);
  assert.equal(h.els.hangNotice.classList.contains('hidden'), false, 'sanity: the bar is showing');
  tab.hangDismissed = true; // a stale dismissal lingering from an earlier episode must also be cleared

  controller.onTabDidNavigate(tab);

  assert.equal(tab.hung, false, 'the synthetic hung record must be cleared on the next committed navigation');
  assert.equal(tab.hangDismissed, false);
  assert.ok(h.refreshStripCalls.includes(tab), 'the strip must be refreshed');
  assert.equal(h.els.hangNotice.classList.contains('hidden'), true, 'the bar must be hidden');
});

test('HAT H2b: onTabDidNavigate on a tab that is not hung is a harmless no-op', async () => {
  const h = createHarness();
  const tab = { id: 'tab-1', wcId: 10, hung: false };
  h.addTab(tab);
  h.setActive('tab-1');
  const controller = await loadController(h);

  // A REAL hang is already cleared by main's own tab-hung false push (which
  // arrives before did-navigate) — this call must be a no-op, not throw, and
  // must not re-show the bar.
  assert.doesNotThrow(() => controller.onTabDidNavigate(tab));
  assert.equal(h.els.hangNotice.classList.contains('hidden'), true);
});

test('HAT H2b: onTabDidNavigate on a BACKGROUND tab clears its hung record but never touches the bar shown for the real active tab', async () => {
  const h = createHarness();
  const active = { id: 'tab-1', wcId: 10, hung: true };
  const bg = { id: 'tab-2', wcId: 20, hung: true };
  h.addTab(active);
  h.addTab(bg);
  h.setActive('tab-1');
  const controller = await loadController(h);
  controller.project(active);

  controller.onTabDidNavigate(bg);

  assert.equal(bg.hung, false, 'the background tab still clears its own hung record');
  assert.equal(active.hung, true);
  assert.equal(
    h.els.hangNotice.classList.contains('hidden'),
    false,
    "a background tab's navigation must not hide the bar shown for the real active tab"
  );
});
