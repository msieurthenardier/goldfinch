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
 * @param {{ allowInternal?: boolean, getDownloads?: (() => any) | null, grabWindow?: (() => Promise<string|null>) | null, isTabViewWcId?: ((id: number) => boolean) | null, getHistoryReads?: ({ listRecent: (jarId: string, opts: any) => any, search: (jarId: string, query: string, opts: any) => any }) | null, isKnownJar?: ((jarId: string) => boolean) | null }} [opts]
 *   allowInternal — one of admin's TWO relaxations (DD6 / Leg 2 + M05 F8 DD8):
 *   when true, deps carry allowInternal so resolveContents (a) lets the internal
 *   goldfinch://settings session through AND (b) skips the non-tab-contents
 *   guard (chrome-class overlay views — the menu-overlay sheet, the find
 *   overlay — resolve only at the admin tier). The mcp-server builds the admin
 *   engine with `{ allowInternal: true }`; jar engines (and every other caller)
 *   leave it false. Threaded into deps() and forwarded to EVERY resolveContents
 *   call site.
 *   isTabViewWcId — main.js's tabViews-membership predicate (M05 F8 DD8),
 *   threaded into deps() so resolveContents can refuse non-tab, non-chrome
 *   wcIds at non-admin tiers. Absent → no behavior change.
 *   getDownloads — accessor for the app-level downloads list (Flight 5). When
 *   wired (main.js threads `() => downloadsManager.listAll()`), the getDownloadsList
 *   op returns the merged download records. Absent → getDownloadsList throws a clean
 *   `downloads-unavailable`. Field named getDownloads to avoid shadowing the op name.
 *   grabWindow — async function returning a base64 PNG of the whole window, or null
 *   on failure. Injected from main.js (Flight 3, Leg 1); kept out of observe.js so
 *   that module stays Electron-free and unit-testable. Absent → captureWindow throws
 *   'automation: chrome window unavailable' (same as before injection).
 *   getHistoryReads — accessor pair for the per-jar history store (Mission 08
 *   Flight 5): `{ listRecent(jarId, opts), search(jarId, query, opts) }`, threaded
 *   from historyStore in main.js (the getDownloads injection precedent). Backs the
 *   getHistory op (reads only; no mutation ops on the automation surface this
 *   mission). Field named getHistoryReads to avoid shadowing the op name.
 *   isKnownJar — accessor `(jarId) => boolean`, threaded from `jars.list()` in
 *   main.js (already in scope there). getHistory validates a supplied jarId
 *   against it before reading — an unknown jarId is refused with a distinct
 *   `unknown-jar` code rather than a silent empty result.
 * @returns {{ [op: string]: (...args: any[]) => any }}
 */
function createEngine(getChromeContents, { allowInternal = false, getDownloads = null, grabWindow = null, isTabViewWcId = null, getHistoryReads = null, isKnownJar = null } = {}) {
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
    // allowInternal (DD6 / Leg 2 + F8 DD8): one of admin's TWO relaxations
    // (internal-session AND non-tab-contents both lift under it), forwarded to
    // every resolveContents call site via deps. isTabViewWcId (F8 DD8) rides the
    // same deps so non-admin tiers refuse chrome-class overlay wcIds (menu sheet,
    // find overlay). fromPartition (session.fromPartition) is carried so the
    // engine and the scope façade share ONE Session→partition resolver — the
    // membership compare in resolveContentsForJar uses the same interned Session
    // that resolveContents sees, so they cannot diverge.
    const base = { fromId, chromeContents, executeInRenderer, allowInternal, fromPartition: session.fromPartition, grabWindow, ...(typeof isTabViewWcId === 'function' ? { isTabViewWcId } : {}) };
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
    dragPointer: (/** @type {number} */ wcId, /** @type {{x:number,y:number}} */ from, /** @type {{x:number,y:number}} */ to, /** @type {any} */ opts) =>
      input.dragPointer(wcId, from, to, deps(), opts),
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
    // Per-jar history read (Mission 08 Flight 5, DD1): no wcId, jar-CONFINED via the
    // scope façade (NOT admin-only — contrast with getDownloadsList/captureWindow/
    // getChromeTarget above). jarId is validated HERE (required, must resolve against
    // isKnownJar); the own-jar-vs-foreign-jar confinement compare happens in scope.js.
    // query and before are mutually exclusive (search has no cursor); query present
    // (non-empty string) → search, else → listRecent (before passes through as a cursor).
    getHistory: (/** @type {string} */ jarId, /** @type {{ query?: string, limit?: number, before?: number }} */ opts = {}) => {
      if (typeof jarId !== 'string' || jarId.length === 0) {
        throw new Error('automation: bad-args — jarId required');
      }
      if (typeof isKnownJar !== 'function' || !isKnownJar(jarId)) {
        throw new Error('automation: unknown-jar');
      }
      const { query, limit, before } = opts || {};
      if (query != null && before != null) {
        throw new Error('automation: bad-args — query does not page');
      }
      const visits = typeof query === 'string' && query.length > 0
        ? getHistoryReads.search(jarId, query, { limit })
        : getHistoryReads.listRecent(jarId, { limit, before });
      return { jarId, visits };
    },
  };
}

module.exports = { createEngine };
