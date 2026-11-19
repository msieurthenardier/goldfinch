'use strict';

// Unit tests for window-capture.js (Mission 24 Flight 3, leg 1) with fakes. The "sheet layered
// only for an allowlisted type" and "save prompt never composited" scenarios are also proven by
// the source-scan pins (sheet-automation-gate-invariant / save-prompt-automation-guard); both
// surfaces are unobservable live.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowGrabber } = require('../../src/main/window-capture');
const { AUTOMATABLE_MENU_TYPES } = require('../../src/main/automation/resolve');
const { captureWindow } = require('../../src/main/automation/observe');

const img = (tag) => ({ isEmpty: () => false, toPNG: () => Buffer.from(tag) });
const b64 = (tag) => Buffer.from(tag).toString('base64');

function fakeView(tag, { visible = true, bounds = { x: 1, y: 2, width: 30, height: 40 } } = {}) {
  const wc = { isDestroyed: () => false, capturePage: async () => img(tag) };
  return { webContents: wc, getVisible: () => visible, getBounds: () => bounds };
}

function fakeOverlay(tag, menuType) {
  const view = fakeView(tag);
  const wc = view.webContents;
  return { isVisible: () => true, getView: () => view, wc, menuType };
}

function makeRig({
  switchValues = ['wayland'],
  sheet = null,
  savePrompt = null,
  chromeDestroyed = false,
  noRecord = false
} = {}) {
  const executed = [];
  const chromeWc = {
    isDestroyed: () => chromeDestroyed,
    capturePage: async () => img('chrome'),
    executeJavaScript: async (script) => {
      executed.push(script);
      return 'COMPOSITE';
    }
  };
  const guest = fakeView('guest');
  const rec = {
    win: { getContentBounds: () => ({ width: 10, height: 10 }), getMediaSourceId: () => 'x' },
    chromeView: { webContents: chromeWc },
    activeTabWcId: 7,
    tabViews: new Map([[7, { view: guest }]]),
    findOverlay: null,
    sheet,
    savePrompt
  };
  let switchCalls = 0;
  let sourcesCalls = 0;
  const registry = {
    get: (id) => (noRecord ? null : id === 5 ? rec : null),
    getLastFocused: () => (noRecord ? null : rec),
    sheetMenuFor: (wc) => (sheet && wc === sheet.wc ? { menuType: sheet.menuType } : null)
  };
  const app = {
    commandLine: {
      getSwitchValue: () => switchValues[Math.min(switchCalls++, switchValues.length - 1)]
    }
  };
  const desktopCapturer = {
    getSources: async () => {
      sourcesCalls++;
      return [];
    }
  };
  const grabber = createWindowGrabber({ registry, app, desktopCapturer });
  return { grabber, executed, getSwitchCalls: () => switchCalls, getSourcesCalls: () => sourcesCalls };
}

test('no record -> null', async () => {
  const { grabber } = makeRig({ noRecord: true });
  assert.equal(await grabber.grabWindow(), null);
  assert.equal(await grabber.grabWindow(99), null);
});

test('destroyed chrome -> null', async () => {
  const { grabber } = makeRig({ chromeDestroyed: true });
  assert.equal(await grabber.grabWindow(), null);
});

test('Wayland switch skips desktopCapturer; the switch is read per call', async () => {
  const rig = makeRig({ switchValues: ['wayland', 'x11'] });
  assert.equal(await rig.grabber.grabWindow(), 'COMPOSITE');
  assert.equal(rig.getSourcesCalls(), 0, 'wayland skips desktopCapturer');
  assert.equal(await rig.grabber.grabWindow(), 'COMPOSITE');
  assert.equal(rig.getSourcesCalls(), 1, 'second call re-read the switch and tried desktopCapturer');
  assert.equal(rig.getSwitchCalls(), 2);
});

test('sheet layered for an allowlisted menu type', async () => {
  const menuType = [...AUTOMATABLE_MENU_TYPES][0];
  const rig = makeRig({ sheet: fakeOverlay('sheetpx', menuType) });
  await rig.grabber.grabWindow();
  assert.ok(rig.executed[0].includes(b64('sheetpx')), 'sheet pixels composited');
});

test('sheet NOT layered for a non-allowlisted menu type', async () => {
  const rig = makeRig({ sheet: fakeOverlay('sheetpx', 'vault-unlock') });
  await rig.grabber.grabWindow();
  assert.ok(rig.executed[0], 'guest layer still composites');
  assert.equal(rig.executed[0].includes(b64('sheetpx')), false, 'sheet pixels never composited');
});

test('a visible save prompt is never composited', async () => {
  const rig = makeRig({ savePrompt: fakeOverlay('promptpx', 'save-prompt') });
  await rig.grabber.grabWindow();
  assert.equal(rig.executed[0].includes(b64('promptpx')), false);
});

test('a composite failure surfaces as capture-failed', async () => {
  const failing = createWindowGrabber({
    registry: {
      getLastFocused: () => ({
        win: {},
        chromeView: {
          webContents: {
            isDestroyed: () => false,
            capturePage: async () => img('chrome'),
            executeJavaScript: async () => {
              throw new Error('boom');
            }
          }
        },
        activeTabWcId: 7,
        tabViews: new Map([[7, { view: fakeView('guest') }]]),
        findOverlay: null,
        sheet: null
      }),
      get: () => null,
      sheetMenuFor: () => null
    },
    app: { commandLine: { getSwitchValue: () => 'wayland' } },
    desktopCapturer: { getSources: async () => [] }
  });
  await assert.rejects(failing.grabWindow(), /capture-failed/);
});

test('scenario: observe.captureWindow drives the real grabWindow end to end', async () => {
  const rig = makeRig();
  assert.equal(await captureWindow({ grabWindow: rig.grabber.grabWindow }), 'COMPOSITE');
  const none = makeRig({ noRecord: true });
  await assert.rejects(captureWindow({ grabWindow: none.grabber.grabWindow }), /chrome window unavailable/);
});

test('window-capture.js is Electron-free', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/main/window-capture.js'),
    'utf8'
  );
  assert.equal(/require\(['"]electron['"]\)/.test(src), false);
});
