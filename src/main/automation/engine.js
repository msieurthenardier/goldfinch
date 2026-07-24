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
 * @param {(windowId?: number) => (Electron.WebContents | null)} getChromeContents
 *   Accessor for a chrome WebContents (may return null if the window/view is closed).
 *   F7 DD3: takes an OPTIONAL windowId — omitted → the last-focused record (the
 *   pre-F7 contract every existing caller relies on); supplied → that window's
 *   chrome, or null when the id names no registered window.
 * @param {{ allowInternal?: boolean, getDownloads?: (() => any) | null, grabWindow?: ((windowId?: number) => Promise<string|null>) | null, listWindows?: (() => Array<{ windowId: number, chrome: any, booted: boolean, ownsTab: (wcId: number) => boolean }>) | null, enumerateWindows?: (() => any[]) | null, isTabViewWcId?: ((id: number) => boolean) | null, isChromeContents?: ((wc: any) => boolean) | null, isSheetContents?: ((wc: any) => boolean) | null, chromeForTab?: ((id: number) => any) | null, raiseWindowForTab?: ((id: number) => void) | null, getHistoryReads?: ({ listRecent: (jarId: string, opts: any) => any, search: (jarId: string, query: string, opts: any) => any }) | null, isKnownJar?: ((jarId: string) => boolean) | null }} [opts]
 *   allowInternal — one of admin's TWO relaxations (DD6 / Leg 2 + M05 F8 DD8):
 *   when true, deps carry allowInternal so resolveContents (a) lets the internal
 *   goldfinch://settings session through AND (b) skips the non-tab-contents
 *   guard (chrome-class overlay views — the menu-overlay sheet, the find
 *   overlay — resolve only at the admin tier). The mcp-server builds the admin
 *   engine with `{ allowInternal: true }`; jar engines (and every other caller)
 *   leave it false. Threaded into deps() and forwarded to EVERY resolveContents
 *   call site.
 *   isTabViewWcId — main.js's tab-membership predicate (M05 F8 DD8; M09 F6
 *   widened it to ALL-WINDOWS membership via the window registry), threaded
 *   into deps() so resolveContents can refuse non-tab, non-chrome wcIds at
 *   non-admin tiers. Absent → no behavior change.
 *   isChromeContents — main.js's "is any registered chrome" predicate (M09 F6,
 *   DD8): rides deps so classifyContents recognizes EVERY window's chrome (a
 *   second window's chrome must not classify 'guest' — the leg-1 spike
 *   residual) and resolveContents/resolveContentsForJar apply their chrome
 *   exemption/exclusion to every registered chrome. Absent → identity-only.
 *   chromeForTab — main.js's class-3 owner routing (M09 F7 DD6): the OWNING
 *   window's chrome webContents for a tab, resolved AT EVENT TIME. activateTab
 *   dispatches through it instead of executeInRenderer's LAST-FOCUSED chrome,
 *   which is what made a cross-window activate silently no-op (recon S1).
 *   Absent → no behavior change (activateTab falls back to the pre-F7
 *   executeInRenderer dispatch, no raise, no refusal).
 *   raiseWindowForTab — main.js's window raise for a tab's owning window (M09 F7
 *   DD6): win.focus() + registry.noteFocus(), the main.js:2646-2649 idiom (both
 *   halves — programmatic focus fires no focus event under WSLg). Called AFTER a
 *   successful dispatch. Absent → no behavior change (dispatch without raise).
 *   listWindows — main.js's registry seam for DD1's ALL-WINDOWS tab census: the
 *   registered windows in insertion order, each as { windowId, chrome, booted,
 *   ownsTab }. tabs.enumerateTabs assembles one executeInChrome round-trip per
 *   booted window and stamps windowId from the REGISTRY (the renderer never learns
 *   it). Rides base by the conditional-spread idiom. Absent → no behavior change
 *   (the pre-F7 single-window enumeration, emitting no windowId) — and because that
 *   fallback is SILENT, both live injection sites are grep-pinned by the leg.
 *   enumerateWindows — main.js's window-topology accessor (M09 F7 DD2), backed by
 *   the pure window-census.js. Reads NOTHING but the live registry records at call
 *   time (zero state). Backs the enumerateWindows op AND getChromeTarget's windowId
 *   resolution, so the two cannot become separate topology sources. Absent →
 *   enumerateWindows throws a clean `windows-unavailable` (the downloads-unavailable
 *   precedent below) and getChromeTarget keeps its pre-F7 last-focused path.
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
function createEngine(getChromeContents, { allowInternal = false, getDownloads = null, grabWindow = null, listWindows = null, enumerateWindows = null, isTabViewWcId = null, isChromeContents = null, isSheetContents = null, chromeForTab = null, raiseWindowForTab = null, getHistoryReads = null, isKnownJar = null } = {}) {
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
    // F7 DD6: dispatch onto a SPECIFIC chrome (the tab's owning window's), as opposed
    // to executeInRenderer's last-focused one. Built here beside executeInRenderer, with
    // the same null guard, so tabs.js stays ELECTRON-FREE — it never receives a raw
    // webContents to call methods on beyond this seam.
    const executeInChrome = (/** @type {any} */ chrome, /** @type {string} */ code) => {
      if (!chrome) throw new Error('automation: chrome window unavailable');
      return chrome.executeJavaScript(code);
    };
    // allowInternal (DD6 / Leg 2 + F8 DD8): one of admin's TWO relaxations
    // (internal-session AND non-tab-contents both lift under it), forwarded to
    // every resolveContents call site via deps. isTabViewWcId (F8 DD8) rides the
    // same deps so non-admin tiers refuse chrome-class overlay wcIds (menu sheet,
    // find overlay). fromPartition (session.fromPartition) is carried so the
    // engine and the scope façade share ONE Session→partition resolver — the
    // membership compare in resolveContentsForJar uses the same interned Session
    // that resolveContents sees, so they cannot diverge.
    // chromeForTab / raiseWindowForTab (F7 DD6) ride base by the SAME conditional-spread
    // idiom as isTabViewWcId/isChromeContents: absent → the key is not present at all →
    // tabs.activateTab takes its pre-F7 executeInRenderer path. executeInChrome is
    // unconditional (it is built here, not injected).
    // listWindows (F7 DD1) rides base by the SAME conditional-spread idiom: absent →
    // the key is not present at all → tabs.enumerateTabs takes its pre-F7
    // single-window executeInRenderer path.
    // isSheetContents (PR#112 finding 1) rides base by the SAME conditional-spread idiom. Unlike
    // isTabViewWcId, its resolver guard is ABSOLUTE — admin's allowInternal does NOT lift it — so
    // the vault secret sheet is undrivable at every tier.
    const base = { fromId, chromeContents, executeInRenderer, executeInChrome, allowInternal, fromPartition: session.fromPartition, grabWindow, ...(typeof listWindows === 'function' ? { listWindows } : {}), ...(typeof isTabViewWcId === 'function' ? { isTabViewWcId } : {}), ...(typeof isChromeContents === 'function' ? { isChromeContents } : {}), ...(typeof isSheetContents === 'function' ? { isSheetContents } : {}), ...(typeof chromeForTab === 'function' ? { chromeForTab } : {}), ...(typeof raiseWindowForTab === 'function' ? { raiseWindowForTab } : {}) };
    // activateTab returns Promise<boolean> (the executeInRenderer result) but the input.js deps
    // type declares activate as (id: number) => Promise<void>. The boolean result is unused by
    // actOn; cast via @type to satisfy the narrower type without widening the input module's API.
    /** @type {(wcId: number) => Promise<void>} */
    const activate = (wcId) => /** @type {Promise<any>} */ (tabs.activateTab(wcId, base));
    return { ...base, activate };
  };

  /**
   * F7 DD3's shared discriminator check: resolve a supplied windowId against DD2's
   * census, or throw the NAMED refusal. Omitted windowId → null (the caller takes
   * its last-focused path, unchanged).
   *
   * A silent fall-back to last-focused on an unknown id is EXACTLY the class this
   * flight exists to kill: captureWindow({windowId: <a closed window>}) would return
   * ANOTHER window's pixels and report success — recon S1's silent-success, restated
   * at window scope, in the very leg that fixes capture's binding.
   *
   * @param {number | undefined} windowId
   * @returns {any | null} the census row for windowId, or null when omitted
   */
  const requireWindow = (windowId) => {
    if (windowId == null) return null;
    if (typeof enumerateWindows !== 'function') {
      throw new Error('automation: windows-unavailable — window registry not wired');
    }
    const row = enumerateWindows().find((/** @type {any} */ r) => r.windowId === windowId);
    if (!row) throw new Error('automation: no-such-window — no window ' + windowId);
    return row;
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
    // F7 DD3: accepts the windowId discriminator (omitted → last-focused). Its WIRE
    // SHAPE IS UNCHANGED — a bare base64 string, because mcp-tools.js's imageResult
    // consumes it POSITIONALLY. Wrapping it to add windowId would yield a malformed
    // image with NO error (the DD1 incomplete-marker failure mode, one DD over).
    // enumerateWindows is the topology read: a caller who needs to know which window
    // it captured asks the discovery primitive; the capture op returns pixels.
    captureWindow: (/** @type {{ windowId?: number }} */ { windowId } = {}) => {
      // Validate the discriminator HERE, against DD2's census — the same single
      // topology source getChromeTarget derives from. Deliberately NOT inferred from
      // grabWindow returning null: null is ALSO how a genuine capture failure on a
      // VALID window reports, so inferring the refusal downstream would answer
      // "no-such-window" for a window that plainly exists. A named refusal must name
      // the real cause.
      requireWindow(windowId);
      return observe.captureWindow(deps(), { windowId });
    },
    // F7 DD2: the flight's single window-topology discovery primitive. Admin-only via
    // the scope façade (scope.js), never filtered here. Zero state — main.js's
    // accessor derives every row from the live registry records at call time.
    enumerateWindows: () => {
      if (typeof enumerateWindows !== 'function') {
        throw new Error('automation: windows-unavailable — window registry not wired');
      }
      return enumerateWindows();
    },
    readDom: (/** @type {number} */ wcId) => observe.readDom(wcId, deps()),
    readAxTree: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.readAxTree(wcId, deps(), opts),
    evaluate: (/** @type {number} */ wcId, /** @type {string} */ expression) => observe.evaluate(wcId, expression, deps()),
    injectScript: (/** @type {number} */ wcId, /** @type {string} */ script) => observe.injectScript(wcId, script, deps()),
    openDevTools: (/** @type {number} */ wcId) => observe.openDevTools(wcId, deps()),
    closeDevTools: (/** @type {number} */ wcId) => observe.closeDevTools(wcId, deps()),
    printToPDF: (/** @type {number} */ wcId) => print.printToPDF(wcId, deps()),
    findInPage: (/** @type {number} */ wcId, /** @type {string} */ text, /** @type {any} */ opts) => find.findInPage(wcId, text, deps(), opts),
    stopFindInPage: (/** @type {number} */ wcId) => find.stopFindInPage(wcId, deps()),
    // F7 DD3: an optional windowId discriminator; omitted → the last-focused chrome
    // (F6's accessor, kept — an OS-focus read would regress determinism under WSLg).
    // The return gains windowId: unlike captureWindow's, it is a JSON object and
    // nothing consumes it positionally, so the field rides cleanly.
    //
    // The windowId resolution derives from DD2's census (requireWindow), which is
    // what keeps enumerateWindows "the flight's SINGLE discovery primitive" rather
    // than letting a second topology source drift alongside it.
    getChromeTarget: (/** @type {{ windowId?: number }} */ { windowId } = {}) => {
      const row = requireWindow(windowId);   // throws no-such-window on an unknown id
      const cc = getChromeContents(windowId);
      // Kept VERBATIM: a null chrome is a DISTINCT, already-pinned condition from
      // no-such-window (the window exists but its view is closed/starting up).
      if (!cc) throw new Error('automation: chrome-window-unavailable — chrome contents is null (closed or starting up)');
      // windowId from the RESOLVED row when supplied; otherwise from the census row
      // whose chrome IS this one — never re-derived from a second source.
      const resolved = row
        ? row.windowId
        : (typeof enumerateWindows === 'function'
          ? (enumerateWindows().find((/** @type {any} */ r) => r.chromeWcId === cc.id) || {}).windowId
          : undefined);
      return { wcId: cc.id, kind: 'chrome', url: cc.getURL(), ...(resolved != null ? { windowId: resolved } : {}) };
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
