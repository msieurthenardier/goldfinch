// @ts-check
'use strict';
// Single automation entry point (flight technical approach). Wires the pure engine modules to
// real Electron handles. Interim dev seam reaches this via main.js (DD7). engine.js itself is
// debugger-free (DD8); it wires ./observe, whose readAxTree is the engine's sole debugger user.
// Integration-verified in Leg 6 live smoke — not unit-tested offline (requires Electron runtime).
const { webContents, session } = require('electron');
const tabs = require('./tabs');
const nav = require('./nav');
const input = require('./input');
const observe = require('./observe');
const zoom = require('./zoom');
const print = require('./print');
const find = require('./find');

/**
 * Create the automation engine, bound to the live Electron environment.
 * Deps are built freshly per call so a recreated window is always picked up.
 * engine.js itself uses no webContents.debugger (DD8); it wires ./observe, whose readAxTree is
 * the engine's sole debugger user.
 *
 * @param {() => (Electron.WebContents | null)} getChromeContents
 *   Accessor for the current chrome WebContents (may return null if the window/view is closed).
 * @param {{ allowInternal?: boolean, getDownloads?: (() => any) | null }} [opts]
 *   allowInternal — admin's SOLE relaxation (DD6 / Leg 2): when true, deps carry
 *   allowInternal so resolveContents lets the internal goldfinch://settings
 *   session through. The mcp-server builds the admin engine with
 *   `{ allowInternal: true }`; jar engines (and every other caller) leave it
 *   false. Threaded into deps() and forwarded to EVERY resolveContents call site.
 *   getDownloads — accessor for the app-level downloads list (Flight 5). When
 *   wired (main.js threads `() => downloadsManager.listAll()`), the getDownloadsList
 *   op returns the merged download records. Absent → getDownloadsList throws a clean
 *   `downloads-unavailable`. Field named getDownloads to avoid shadowing the op name.
 * @returns {{ [op: string]: (...args: any[]) => any }}
 */
function createEngine(getChromeContents, { allowInternal = false, getDownloads = null } = {}) {
  const fromId = (/** @type {number} */ id) => webContents.fromId(id);

  /**
   * Build deps fresh per call.
   * Guards executeInRenderer against a null window so a closed/absent window yields a
   * clean automation error instead of a confusing null-deref TypeError mid-smoke.
   * activate is built on `base` (NOT the returned deps) so activateTab never receives an
   * `activate` of its own — avoids any accidental recursion.
   */
  const deps = () => {
    const chromeContents = getChromeContents();
    const executeInRenderer = (/** @type {string} */ code) => {
      if (!chromeContents) throw new Error('automation: chrome window unavailable');
      return chromeContents.executeJavaScript(code);
    };
    // allowInternal (DD6 / Leg 2): admin's sole relaxation, forwarded to every
    // resolveContents call site via deps. fromPartition (session.fromPartition)
    // is carried so the engine and the scope façade share ONE Session→partition
    // resolver — the membership compare in resolveContentsForJar uses the same
    // interned Session that resolveContents sees, so they cannot diverge.
    const base = { fromId, chromeContents, executeInRenderer, allowInternal, fromPartition: session.fromPartition };
    // activateTab returns Promise<boolean> (the executeInRenderer result) but the input.js deps
    // type declares activate as (id: number) => Promise<void>. The boolean result is unused by
    // actOn; cast via @type to satisfy the narrower type without widening the input module's API.
    /** @type {(wcId: number) => Promise<void>} */
    const activate = (wcId) => /** @type {Promise<any>} */ (tabs.activateTab(wcId, base));
    return { ...base, activate };
  };

  return {
    enumerateTabs: () => tabs.enumerateTabs(deps()),
    openTab: (/** @type {string} */ url, /** @type {string|undefined} */ jarId) => tabs.openTab(url, jarId, deps()),
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
    pressKey: (/** @type {number} */ wcId, /** @type {string} */ name, /** @type {string[]|undefined} */ modifiers) => input.pressKey(wcId, name, modifiers, deps()),
    getZoom: (/** @type {number} */ wcId) => zoom.getZoom(wcId, deps()),
    setZoom: (/** @type {number} */ wcId, /** @type {number} */ factor) => zoom.setZoom(wcId, factor, deps()),
    captureScreenshot: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.captureScreenshot(wcId, deps(), opts),
    captureWindow: () => observe.captureWindow(deps()),
    readDom: (/** @type {number} */ wcId) => observe.readDom(wcId, deps()),
    readAxTree: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.readAxTree(wcId, deps(), opts),
    evaluate: (/** @type {number} */ wcId, /** @type {string} */ expression) => observe.evaluate(wcId, expression, deps()),
    injectScript: (/** @type {number} */ wcId, /** @type {string} */ script) => observe.injectScript(wcId, script, deps()),
    openDevTools: (/** @type {number} */ wcId) => observe.openDevTools(wcId, deps()),
    closeDevTools: (/** @type {number} */ wcId) => observe.closeDevTools(wcId, deps()),
    printToPDF: (/** @type {number} */ wcId) => print.printToPDF(wcId, deps()),
    findInPage: (/** @type {number} */ wcId, /** @type {string} */ text, /** @type {any} */ opts) => find.findInPage(wcId, text, deps(), opts),
    stopFindInPage: (/** @type {number} */ wcId) => find.stopFindInPage(wcId, deps()),
    getChromeTarget: () => {
      const cc = getChromeContents();
      if (!cc) throw new Error('automation: chrome-window-unavailable — chrome contents is null (closed or starting up)');
      return { wcId: cc.id, kind: 'chrome', url: cc.getURL() };
    },
    // App-level downloads view (Flight 5, DD6): no wcId, admin-only via the scope façade.
    // Reads the merged download records from the wired accessor; never touches a session.
    getDownloadsList: () => {
      if (typeof getDownloads !== 'function') {
        throw new Error('automation: downloads-unavailable — downloads manager not wired');
      }
      return getDownloads();
    },
  };
}

module.exports = { createEngine };
