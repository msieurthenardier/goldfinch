// @ts-check
'use strict';

// Session snapshot builder (M09 Flight 9, Leg 2, DD2) — the pure, Electron-free
// function that turns live window records into the on-disk session manifest,
// dropping every non-persist-jar (burner / internal) tab by the POSITIVE persist-jar
// allowlist (persist-jar-gate.js, shared with closed-tab-capture.js). No negative
// "is-burner" check anywhere: a tab is KEPT iff its partition resolves to a
// registered jar.
//
// Electron-free (the window-registry / closed-tab-capture precedent): webContents
// handles are read through the injected records only (getURL / isDestroyed), so the
// builder unit-tests offline with fakes.
//
// `active` derives from the window's activeTabWcId (wcId === activeTabWcId), NOT the
// tab entry's write-only `entry.active` — every authority read in main uses
// activeTabWcId (window-census.js, move-targets.js). So a filtered-out active tab
// (e.g. an active burner) leaves NO surviving tab marked active, exactly as intended.

const { resolvePersistJar } = require('./persist-jar-gate');

/**
 * @param {{
 *   windows: Array<{
 *     tabViews: Map<number, { view: { webContents: any }, partition: string, trusted: boolean }>,
 *     activeTabWcId: number | null
 *   }>,
 *   jarsList: Array<{ id: string, partition: string }>
 * }} parts
 * @returns {{ version: number, windows: Array<{ tabs: Array<{ url: string, jarId: string, active: boolean }> }> }}
 */
function buildSessionSnapshot({ windows, jarsList }) {
  const outWindows = [];
  for (const rec of windows) {
    const tabs = [];
    for (const [wcId, entry] of rec.tabViews) {
      const jar = resolvePersistJar(entry, jarsList);
      if (!jar) continue; // burner / internal — dropped by the positive allowlist
      const wc = entry.view.webContents;
      if (!wc || wc.isDestroyed()) continue; // uncapturable — nothing left to read
      tabs.push({ url: wc.getURL(), jarId: jar.id, active: wcId === rec.activeTabWcId });
    }
    if (tabs.length > 0) outWindows.push({ tabs }); // drop a zero-surviving-tab window
  }
  return { version: 1, windows: outWindows };
}

module.exports = { buildSessionSnapshot };
