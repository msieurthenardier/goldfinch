// @ts-check
'use strict';

// Automation engine — tab-lifecycle operations (enumerate / open / close / activate).
//
// This module is deliberately ELECTRON-FREE at the top level. The Electron
// handles (webContents.fromId, mainWindow.webContents.executeJavaScript) are
// INJECTED as function arguments so the orchestration is unit-testable with
// fakes and no Electron stub.
//
// The security boundary (DD5) is authoritative in this module:
//   - mapEnumeratedTabs drops any wcId whose resolved contents belongs to the
//     internal goldfinch://settings session.
//   - closeTab / activateTab call resolveContents before dispatching, so a
//     directly-supplied internal-guest wcId (or a bad/dead handle) throws before
//     any renderer call is made.
//
// The renderer hook (window.__goldfinchAutomation) is defined in renderer.js.
// This module drives it via executeInRenderer (executeJavaScript under the hood).

const { resolveContents, isInternalContents } = require('./resolve');

/**
 * Map a raw per-tab array from the renderer hook's listTabs() into the
 * canonical DD2 shape, filtering out tabs that are not yet at dom-ready
 * (wcId === null), whose webContents cannot be resolved, or whose session is
 * the internal goldfinch://settings session (DD5).
 *
 * Pure function — never throws. Per-entry resolve failures drop that entry
 * rather than aborting the map.
 *
 * The internal-session drop is gated on !allowInternal (DD6 / Leg 2): the admin
 * engine (allowInternal:true) KEEPS the internal goldfinch://settings tab in the
 * enumeration; jar/default engines drop it.
 *
 * @param {Array<{wcId: number|null, url: string, title: string, jarId: string|null, active: boolean}>|null} rawTabs
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {{ wcId: number, url: string, title: string, jarId: string|null, active: boolean }[]}
 */
function mapEnumeratedTabs(rawTabs, { fromId, allowInternal = false }) {
  const out = [];
  for (const t of rawTabs || []) {
    if (typeof t.wcId !== 'number') continue;        // not yet at dom-ready
    let wc;
    try { wc = fromId(t.wcId); } catch { continue; }
    if (!wc || wc.isDestroyed?.()) continue;          // gone / destroyed
    if (!allowInternal && isInternalContents(wc)) continue; // DD5/DD6: internal dropped unless admin
    out.push({ wcId: t.wcId, url: t.url, title: t.title, jarId: t.jarId, active: !!t.active });
  }
  return out;
}

/**
 * Enumerate all non-internal, fully-initialized tabs.
 *
 * Calls the renderer hook's listTabs(), then filters and maps the result
 * through mapEnumeratedTabs (DD5 internal-session exclusion applied in main).
 *
 * @param {{ executeInRenderer: (code: string) => Promise<any>, fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {Promise<{ wcId: number, url: string, title: string, jarId: string|null, active: boolean }[]>}
 */
async function enumerateTabs(deps) {
  const raw = await deps.executeInRenderer('window.__goldfinchAutomation.listTabs()');
  return mapEnumeratedTabs(raw, deps); // forwards allowInternal so admin keeps the internal tab
}

/**
 * Open a new tab at the given URL.
 *
 * The URL is JSON.stringify-encoded before injection into the code string to
 * prevent string-concatenation injection (AC6). The renderer's createTab
 * untrusted branch re-applies isSafeTabUrl as the authoritative gate.
 *
 * Resolves to the new tab's wcId once dom-ready fires in the renderer, or
 * null if the URL was rejected or no handle became available within the timeout.
 *
 * @param {string} url
 * @param {{ executeInRenderer: (code: string) => Promise<any> }} deps
 * @returns {Promise<number|null>}
 */
async function openTab(url, { executeInRenderer }) {
  if (typeof url !== 'string') {
    throw new Error('automation: bad-url — url must be a string');
  }
  return executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + ')');
}

/**
 * Close the tab identified by wcId.
 *
 * Re-validates the target via resolveContents before dispatching (AC5 / DD5):
 * an internal-guest wcId, a dead handle, or a non-number wcId throws rather
 * than silently failing.
 *
 * Note: the renderer's closeTab auto-spawns a new blank tab when the last tab
 * is closed, so a subsequent enumerateTabs shows one blank tab, not zero.
 *
 * @param {number} wcId
 * @param {{ executeInRenderer: (code: string) => Promise<any>, fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {Promise<boolean>}
 */
async function closeTab(wcId, deps) {
  resolveContents(wcId, deps); // throws on bad/dead/internal (allowInternal forwarded)
  return deps.executeInRenderer('window.__goldfinchAutomation.closeTabByWcId(' + wcId + ')');
}

/**
 * Bring the tab identified by wcId to the front (activate it).
 *
 * Re-validates the target via resolveContents before dispatching (AC5 / DD5).
 *
 * @param {number} wcId
 * @param {{ executeInRenderer: (code: string) => Promise<any>, fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {Promise<boolean>}
 */
async function activateTab(wcId, deps) {
  resolveContents(wcId, deps); // throws on bad/dead/internal (allowInternal forwarded)
  return deps.executeInRenderer('window.__goldfinchAutomation.activateTabByWcId(' + wcId + ')');
}

module.exports = { mapEnumeratedTabs, enumerateTabs, openTab, closeTab, activateTab };
