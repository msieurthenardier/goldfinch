'use strict';

// Shared fakes for the save-prompt suites (Sortie 06 Leg 1): a recording prompt view whose
// webContents `focus` THROWS (the manager must never call it), a recording contentView, and a
// fully-wired manager factory over them. No Electron anywhere.

const { createSavePromptManager } = require('../../src/main/save-prompt-manager');
const { computeSavePromptBounds } = require('../../src/main/save-prompt-geometry');

// Clock guard (squawk 0172): the manager's default clock is the REAL one, so a test that leaves an
// offer open would hold the process ~10 s at exit. The harness clock resolves the timer API at CALL
// time: under a test's MockTimers it forwards to the mocked globals (tests tick them); otherwise it
// returns an inert handle and NEVER arms a real timer.
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const INERT = Symbol('inert-timer');
const harnessSetTimeout = (fn, ms) =>
  globalThis.setTimeout === REAL_SET_TIMEOUT ? INERT : globalThis.setTimeout(fn, ms);
const harnessClearTimeout = (h) => {
  if (h !== INERT) globalThis.clearTimeout(h);
};

/** Throws if any live Timeout handle exists (call from an `after` hook in each save-prompt suite). */
function assertNoLiveTimers() {
  const live = process.getActiveResourcesInfo().filter((r) => r === 'Timeout');
  if (live.length) throw new Error(`save-prompt suite left ${live.length} real timer(s) armed`);
}

function makeFakeView() {
  const listeners = new Map();
  let destroyed = false;
  const view = {
    calls: [],
    webContents: {
      on: (event, cb) => {
        listeners.set(event, cb);
      },
      emit: (event, ...args) => {
        const cb = listeners.get(event);
        if (cb) cb(...args);
      },
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
        view.calls.push(['destroy']);
      },
      // The prompt is NEVER focused on appearance (DD2): any call fails the suite loudly, unless
      // a Leg 3 test arms `view.allowFocus` to exercise the explicit F6 path (`focusPrompt`).
      focus: () => {
        if (!view.allowFocus) throw new Error('save-prompt manager must never call webContents.focus()');
        view.calls.push(['focus']);
      },
      send: (channel, payload) => {
        view.calls.push(['send', channel, payload]);
      },
      markDestroyed: () => {
        destroyed = true;
      }
    },
    setBounds: (b) => view.calls.push(['setBounds', b]),
    setVisible: (v) => view.calls.push(['setVisible', v])
  };
  return view;
}

function makeFakeContentView(log) {
  return {
    addChildView: (v) => log.push(['addChildView', v]),
    removeChildView: (v) => log.push(['removeChildView', v])
  };
}

const OFFER_MODEL = Object.freeze({
  origin: 'https://a.example',
  username: 'me',
  mode: 'save',
  kind: 'login',
  defaultVaultId: 'personal',
  choices: [
    { vaultId: 'personal', label: 'Personal' },
    { vaultId: 'global', label: 'Global' }
  ]
});

/**
 * @param {{ [k: string]: any }} [over]  dep overrides
 */
function makeHarness(over = {}) {
  const log = []; // shared order log: ['addChildView'|'removeChildView'|'chrome'|'save'|'dismiss', ...]
  const views = [];
  const state = {
    contentView: makeFakeContentView(log),
    guest: { x: 0, y: 100, width: 1000, height: 600 },
    findVisible: false,
    sheetVisible: false,
    fullscreen: false,
    zoom: 1,
    saveResult: { saved: true }
  };
  const chromeSends = [];
  const saves = [];
  const dismisses = [];
  const guestFocuses = [];
  const manager = createSavePromptManager({
    getContentView: () => state.contentView,
    createView: () => {
      const v = makeFakeView();
      views.push(v);
      return v;
    },
    getActiveGuestBounds: () => state.guest,
    isFindVisible: () => state.findVisible,
    isSheetVisible: () => state.sheetVisible,
    isFullscreen: () => state.fullscreen,
    computeBounds: computeSavePromptBounds,
    chromeZoomFactor: () => state.zoom,
    sendToChrome: (channel, payload) => {
      chromeSends.push([channel, payload]);
      log.push(['chrome', channel, payload]);
    },
    captureSave: (arg) => {
      saves.push(arg);
      log.push(['save', arg]);
      if (typeof state.saveResult === 'function') return state.saveResult(arg);
      return state.saveResult;
    },
    captureDismiss: (id) => {
      dismisses.push(id);
      log.push(['dismiss', id]);
    },
    focusActiveGuest: () => {
      guestFocuses.push(true);
      log.push(['focus-guest']);
      return true;
    },
    setTimeout: harnessSetTimeout,
    clearTimeout: harnessClearTimeout,
    ...over
  });
  return { manager, state, views, log, chromeSends, saves, dismisses, guestFocuses };
}

/** Present a default offer and report its height so it is SHOWN. */
function presentShown(h, { token = 1, captureId = 'cap1', wcId = 7, model = OFFER_MODEL, height = 140, ...rest } = {}) {
  const r = h.manager.present({ token, captureId, wcId, model, anchor: 900, queue: null, ...rest });
  if (r.presented) h.views[h.views.length - 1].webContents.emit('did-finish-load');
  if (r.presented) h.manager.reportHeight(token, height);
  return r;
}

module.exports = { makeFakeView, makeFakeContentView, makeHarness, presentShown, OFFER_MODEL, assertNoLiveTimers };
