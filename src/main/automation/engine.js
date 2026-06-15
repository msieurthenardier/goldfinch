// @ts-check
'use strict';
// Single automation entry point (flight technical approach). Wires the pure engine modules to
// real Electron handles. Interim dev seam reaches this via main.js (DD7). engine.js itself is
// debugger-free (DD8); it wires ./observe, whose readAxTree is the engine's sole debugger user.
// Integration-verified in Leg 6 live smoke — not unit-tested offline (requires Electron runtime).
const { webContents } = require('electron');
const tabs = require('./tabs');
const nav = require('./nav');
const input = require('./input');
const observe = require('./observe');

/**
 * Create the automation engine, bound to the live Electron environment.
 * Deps are built freshly per call so a recreated window is always picked up.
 * engine.js itself uses no webContents.debugger (DD8); it wires ./observe, whose readAxTree is
 * the engine's sole debugger user.
 *
 * @param {() => (Electron.BrowserWindow | null)} getMainWindow
 *   Accessor for the current chrome BrowserWindow (may return null if window is closed).
 * @returns {{ [op: string]: (...args: any[]) => any }}
 */
function createEngine(getMainWindow) {
  const fromId = (/** @type {number} */ id) => webContents.fromId(id);

  /**
   * Build deps fresh per call.
   * Guards executeInRenderer against a null window so a closed/absent window yields a
   * clean automation error instead of a confusing null-deref TypeError mid-smoke.
   * activate is built on `base` (NOT the returned deps) so activateTab never receives an
   * `activate` of its own — avoids any accidental recursion.
   */
  const deps = () => {
    const mw = getMainWindow();
    const chromeContents = mw ? mw.webContents : null;
    const executeInRenderer = (/** @type {string} */ code) => {
      if (!mw) throw new Error('automation: chrome window unavailable');
      return mw.webContents.executeJavaScript(code);
    };
    const base = { fromId, chromeContents, executeInRenderer };
    // activateTab returns Promise<boolean> (the executeInRenderer result) but the input.js deps
    // type declares activate as (id: number) => Promise<void>. The boolean result is unused by
    // actOn; cast via @type to satisfy the narrower type without widening the input module's API.
    /** @type {(wcId: number) => Promise<void>} */
    const activate = (wcId) => /** @type {Promise<any>} */ (tabs.activateTab(wcId, base));
    return { ...base, activate };
  };

  return {
    enumerateTabs: () => tabs.enumerateTabs(deps()),
    openTab: (/** @type {string} */ url) => tabs.openTab(url, deps()),
    closeTab: (/** @type {number} */ wcId) => tabs.closeTab(wcId, deps()),
    activateTab: (/** @type {number} */ wcId) => tabs.activateTab(wcId, deps()),
    navigate: (/** @type {number} */ wcId, /** @type {string} */ url) => nav.navigate(wcId, url, deps()),
    goBack: (/** @type {number} */ wcId) => nav.goBack(wcId, deps()),
    goForward: (/** @type {number} */ wcId) => nav.goForward(wcId, deps()),
    reload: (/** @type {number} */ wcId) => nav.reload(wcId, deps()),
    click: (/** @type {number} */ wcId, /** @type {number} */ x, /** @type {number} */ y, /** @type {any} */ opts) =>
      input.click(wcId, x, y, deps(), opts),
    typeText: (/** @type {number} */ wcId, /** @type {string} */ text) => input.typeText(wcId, text, deps()),
    scroll: (/** @type {number} */ wcId, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ dx, /** @type {number} */ dy) =>
      input.scroll(wcId, x, y, dx, dy, deps()),
    pressKey: (/** @type {number} */ wcId, /** @type {string} */ name) => input.pressKey(wcId, name, deps()),
    captureScreenshot: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.captureScreenshot(wcId, deps(), opts),
    captureWindow: () => observe.captureWindow(deps()),
    readDom: (/** @type {number} */ wcId) => observe.readDom(wcId, deps()),
    readAxTree: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.readAxTree(wcId, deps(), opts),
  };
}

module.exports = { createEngine };
