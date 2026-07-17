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
 * Enumerate all non-internal, fully-initialized tabs across ALL windows (F7 DD1).
 *
 * Assembles the census from N per-chrome round-trips — one executeInChrome per
 * registered, BOOTED window, in registry insertion order — and stamps each row's
 * windowId from the REGISTRY. Row order: registry insertion order, then each
 * window's existing listTabs creation order (renderer.js's order, unchanged).
 *
 * THE REGISTRY IS THE OWNERSHIP AUTHORITY. Each window's returned rows are filtered
 * to that record's own tabViews membership (w.ownsTab); the renderer is
 * authoritative only for url/title/jarId and never learns windowId. That filter is
 * what makes a double-count STRUCTURALLY IMPOSSIBLE across N non-atomic
 * round-trips: a tab moving A→B mid-census can be REPORTED by both chromes, but
 * only the record that OWNS it stamps a row.
 *
 * The return is a PLAIN ARRAY — no marker, no wrapper, no own properties. A
 * mid-boot window (booted === false) contributes ZERO rows and gets NO round-trip:
 * its renderer genuinely has no tabs yet. enumerateWindows().booted is the
 * completeness discriminator (DD2), deliberately NOT a marker on this return — a
 * wrapper breaks the jar facade's .filter outright, and an array-with-an-own-property
 * is SILENTLY dropped by Array.prototype.filter, which does not copy own props.
 *
 * @param {{ executeInRenderer: (code: string) => Promise<any>, executeInChrome?: (chrome: any, code: string) => Promise<any>, listWindows?: () => Array<{ windowId: number, chrome: any, booted: boolean, ownsTab: (wcId: number) => boolean }>, fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 *   listWindows — main.js's registry seam (F7 DD1): the registered windows in
 *                 insertion order, each with its chrome, boot state, and ownership
 *                 predicate. Absent → no behavior change (the pre-F7 single-window
 *                 path). Electron-free: the only handle that crosses is `chrome`,
 *                 and it goes to executeInChrome and nowhere else.
 * @returns {Promise<{ wcId: number, url: string, title: string, jarId: string|null, active: boolean, windowId?: number }[]>}
 */
async function enumerateTabs(deps) {
  // Fallback is gated on listWindows ALONE in practice: executeInChrome is built
  // UNCONDITIONALLY in engine.js's deps() (:107, a plain object-literal property),
  // NOT via the conditional-spread idiom listWindows/chromeForTab use — so it can
  // never be absent from engine-built deps. The check is DECORATIVE: it guards a
  // hand-built deps bag (unit tests), and it exists for SYMMETRY with activateTab's
  // identical guard (tabs.js:166), so the two routed ops in this file cannot look
  // like one of them is wrong. Do not "harmonize" them by DELETING one.
  //
  // The fallback itself is load-bearing and SILENT: absent listWindows → the pre-F7
  // single-window path emitting NO windowId (the house "Absent → no behavior change"
  // idiom, engine.js:33-41). That silence is why BOTH live injection sites are
  // grep-pinned — a forgotten injection restores window-scoped enumeration with no
  // test failure anywhere.
  if (typeof deps.listWindows !== 'function' || typeof deps.executeInChrome !== 'function') {
    const raw = await deps.executeInRenderer('window.__goldfinchAutomation.listTabs()');
    return mapEnumeratedTabs(raw, deps); // forwards allowInternal so admin keeps the internal tab
  }

  const out = [];
  for (const w of deps.listWindows()) {           // registry insertion order
    // A mid-boot window contributes ZERO rows and gets NO round-trip. Its adopted
    // tab (a move-created window's) is already in rec.tabViews BEFORE its chrome
    // boots, so it is invisible for that interval — that is exactly what DD2's
    // `booted` exists to disclose, and it is documented in docs/mcp-automation.md.
    if (!w.booted) continue;
    let raw;
    try {
      raw = await deps.executeInChrome(w.chrome, 'window.__goldfinchAutomation.listTabs()');
    } catch {
      continue;   // one window's failure never fails the census (e.g. a window closing mid-census)
    }
    for (const t of mapEnumeratedTabs(raw, deps)) {  // per window, UNCHANGED
      if (!w.ownsTab(t.wcId)) continue;             // the registry-authoritative filter
      out.push({ ...t, windowId: w.windowId });     // windowId stamped HERE, from the registry
    }
  }
  return out;
}

/**
 * Open a new tab at the given URL.
 *
 * The URL is JSON.stringify-encoded before injection into the code string to
 * prevent string-concatenation injection (AC6). The renderer's createTab
 * untrusted branch re-applies isSafeTabUrl as the authoritative gate.
 *
 * When jarId is provided it is also JSON.stringify-encoded and appended as a
 * second argument to the renderer hook. When omitted (null/undefined) the
 * single-arg form is used so JSON.stringify(undefined) → "undefined" never
 * appears in the generated code string (the jarId == null guard is deliberate).
 *
 * Resolves to the new tab's wcId once dom-ready fires in the renderer, or
 * null if the URL was rejected or no handle became available within the timeout.
 *
 * @param {string} url
 * @param {string|null|undefined} jarId
 * @param {{ executeInRenderer: (code: string) => Promise<any> }} deps
 * @returns {Promise<number|null>}
 */
async function openTab(url, jarId, { executeInRenderer }) {
  if (typeof url !== 'string') {
    throw new Error('automation: bad-url — url must be a string');
  }
  const jarArg = jarId == null ? '' : ', ' + JSON.stringify(jarId);
  return executeInRenderer('window.__goldfinchAutomation.openTab(' + JSON.stringify(url) + jarArg + ')');
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
 * Bring the tab identified by wcId to the front (activate it), and RAISE its owning
 * window (F7 DD6 — the foreground-to-act contract restated at WINDOW scope).
 *
 * Re-validates the target via resolveContents before dispatching (AC5 / DD5).
 *
 * THREE-WAY RULE (F7 DD6, scoped at leg-2 design — the scoping is FORCED BY THE CODE):
 *
 *   chromeForTab(wcId) | dispatch | behavior
 *   -------------------|----------|-----------------------------------------------
 *   null               | (none)   | return false. No raise, no throw.
 *   a chrome           | true     | raise the owning window, return true
 *   a chrome           | false    | throw the named refusal (registry/renderer desync)
 *
 * The NULL branch is load-bearing and is a RULING, not an omission. classifyContents
 * (resolve.js:56-60) calls anything that is not a registered chrome a 'guest', so the
 * menu-overlay sheet and the find overlay classify as guests that no window's tabViews
 * contains. Pre-F7 these dispatched, missed, and returned a DISCARDED false — which is
 * precisely why the probe walk works. Returning that same false is the honest answer
 * ("this wcId is not a registry-owned tab"), not a silent no-op. A blanket false⇒throw
 * would break `npm run a11y` (a flight checkpoint — its own catch swallows the throw and
 * then fails), all 10 probe-walk specs, find-overlay-geometry's readDom probe, and
 * per-wcId captureScreenshot on overlay ids.
 *
 * The refusal exists for the case the registry says the tab IS owned and the owning
 * chrome's tabs Map disagrees — a genuine desync. It is a THROW, not a returned refusal
 * object: a returned object would still be DISCARDED at all seven raise sites, re-creating
 * the exact silent no-op S1 is. A throw propagates through every `await activate(wcId)`
 * with zero call-site changes.
 *
 * mcp-tools.js:34's boolean pin survives: this still returns true (owned+activated) or
 * false (not a registry-owned tab). Only the THIRD outcome — the desync — is a throw.
 *
 * @param {number} wcId
 * @param {{ executeInRenderer: (code: string) => Promise<any>, executeInChrome?: (chrome: any, code: string) => Promise<any>, chromeForTab?: (wcId: number) => any, raiseWindowForTab?: (wcId: number) => void, fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 *   chromeForTab — the OWNING window's chrome webContents for a tab, resolved AT EVENT
 *                  TIME (main.js:246-249 → window-registry.js:170-173). Absent → no
 *                  behavior change (the house idiom, engine.js:33-41).
 *   executeInChrome — dispatch seam onto a SPECIFIC chrome (engine.js's deps()), keeping
 *                  this module Electron-free.
 *   raiseWindowForTab — raises the owning window (win.focus() + registry.noteFocus()).
 * @returns {Promise<boolean>}
 */
async function activateTab(wcId, deps) {
  resolveContents(wcId, deps); // throws on bad/dead/internal (allowInternal forwarded)

  // F7 DD6 (recon S1): dispatch to the tab's OWNING window's chrome, resolved AT
  // EVENT TIME. Pre-F7 this went through deps.executeInRenderer → the LAST-FOCUSED
  // chrome (engine.js:71-76), whose activateTabByWcId searches its OWN document's
  // tabs Map (renderer.js:3603-3608), missed a window-B tab, returned false — and
  // every caller DISCARDED that false, so acts proceeded against an unraised,
  // unrendered background guest and reported success.
  if (typeof deps.chromeForTab !== 'function' || typeof deps.executeInChrome !== 'function') {
    // Absent dep → pre-F7 behavior (the house "Absent → no behavior change" idiom,
    // engine.js:33-41). Offline/unit callers only: BOTH live injection sites are
    // grep-pinned by the leg's AC6 precisely because this fallback is SILENT — a
    // forgotten injection restores S1 with no test failure anywhere.
    return deps.executeInRenderer('window.__goldfinchAutomation.activateTabByWcId(' + wcId + ')');
  }

  const owning = deps.chromeForTab(wcId);
  if (!owning) {
    // NOT a registry-owned tab (the overlay/probe-walk branch — see the three-way
    // rule above). Return today's discarded false verbatim: no raise, no throw.
    return false;
  }

  const ok = await deps.executeInChrome(owning, 'window.__goldfinchAutomation.activateTabByWcId(' + wcId + ')');
  if (!ok) {
    // The registry says this window owns the tab, but its chrome's tabs Map
    // disagrees — a real desync. NEVER a silent no-op again (DD6).
    throw new Error('automation: activate-refused — wcId ' + wcId + ' is owned by a window whose chrome could not activate it');
  }
  // Raise AFTER dispatch, so the window comes forward already showing the right tab;
  // and a refusal raises nothing (we threw first).
  if (typeof deps.raiseWindowForTab === 'function') deps.raiseWindowForTab(wcId);
  return true;
}

module.exports = { mapEnumeratedTabs, enumerateTabs, openTab, closeTab, activateTab };
