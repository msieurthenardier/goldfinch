// @ts-check
'use strict';

// Container-picker menu model for the menu-overlay sheet (M05 Flight 8, Leg 3 /
// AC1). Rebuilt per open from the SAME `containers` array the old chrome-DOM menu
// reads (parity — there is no runtime jar-list refresh in the product).
//
// NAMESPACED id space (round-2 design-review catch): jars.slug() maps a
// user-created jar named "New Container" to id `new-container` (and "Burner" →
// `burner`), and the Leg-3 sheet dialog makes those names reachable — a FLAT id
// space would let a real jar shadow the sentinels (activating it would re-open the
// dialog / open a burner instead of the user's jar). Jar items are `jar:<jarId>`;
// the sentinels are `action:burner` / `action:new-container` / `action:manage-jars`
// (M06 Flight 3 Leg 3, opens the goldfinch://jars page). The chrome's channel-6
// `container` case dispatches on the prefix.
//
// Labels are DATA — the sheet renders them via textContent only (DD8); `color` is
// data too, applied sheet-side via style.background AFTER the shared isSafeColor
// check (invalid → the default grey dot).

// BURNER resolved hybrid-style (M06 Flight 2 DD8): CommonJS require() under the test
// runner, global under the script-tag chrome (nodeIntegration:false, no require()).
// index.html loads burner.js before this file.
//
// NOTE (Leg 3 D1 fix): do NOT destructure into a top-level `const BURNER` here.
// Classic (non-module) <script> tags in one document share a single global lexical
// environment for top-level let/const/class — index.html loads burner.js (which
// itself declares a top-level `const BURNER`) immediately before this file, so a
// second top-level `const BURNER`/`const { BURNER }` collides and throws
// `SyntaxError: Identifier 'BURNER' has already been declared` at PARSE time,
// silently killing this entire script (buildContainerModel never gets defined) —
// invisible to the Node-runner unit suite (require() has its own module scope, no
// collision there), only observable on a real chrome-document boot. The local
// binding is named RESOLVED_BURNER instead so it never re-declares the global.
const RESOLVED_BURNER = typeof module !== 'undefined' && module.exports
  ? require('./burner').BURNER
  : /** @type {{ id: string, name: string, color: string }} */ (/** @type {any} */ (globalThis).BURNER);

/**
 * @param {Array<{ id?: any, name?: any, color?: any }>} containers
 * @param {any} [defaultId]
 * @returns {Array<{ id: string, label: string, color?: string, isDefault?: boolean } | { type: 'separator' }>}
 */
function buildContainerModel(containers, defaultId) {
  /** @type {Array<{ id: string, label: string, color?: string, isDefault?: boolean } | { type: 'separator' }>} */
  const model = [];
  const list = containers || [];
  // Default-holder resolution (Flight 5 Leg 1, DD1): the row whose id === defaultId
  // carries the marker; when defaultId is null/undefined OR matches no container in
  // the list (dangling — jar deleted, stale value), Burner carries it instead. This
  // mirrors resolveNewTabContainer's fallback (default-routing.js), which routes to
  // burner for BOTH cases — the marker must never lie about where a new tab opens.
  const holderIsBurner =
    defaultId == null || !list.some((c) => c && typeof c.id === 'string' && c.id === defaultId);
  for (const c of list) {
    if (!c || typeof c.id !== 'string') continue;
    /** @type {{ id: string, label: string, color?: string, isDefault?: boolean }} */
    const item = { id: 'jar:' + c.id, label: String(c.name != null ? c.name : c.id) };
    if (typeof c.color === 'string') item.color = c.color;
    if (!holderIsBurner && c.id === defaultId) item.isDefault = true;
    model.push(item);
  }
  // Burner sentinel — old markup was `Burner tab <em>(evaporates)</em>`; the sheet
  // is textContent-only, so the label carries the flattened text. Name/color derive
  // from the shared BURNER constant (DD8) instead of duplicating the literal.
  /** @type {{ id: string, label: string, color?: string, isDefault?: boolean }} */
  const burnerItem = { id: 'action:burner', label: `${RESOLVED_BURNER.name} tab (evaporates)`, color: RESOLVED_BURNER.color };
  if (holderIsBurner) burnerItem.isDefault = true;
  model.push(burnerItem);
  // Divider separating the jar rows (including Burner) from the action rows below
  // (HAT step-1 finding F1a, operator ruling): the sheet's generic `.cm-sep`
  // renderer (menu-overlay.js, ported from the page-context menu) already handles
  // `{ type: 'separator' }` — non-focusable, role="separator", excluded from the
  // roving-tabindex item set for free (no id, so it never dispatches on activation).
  model.push({ type: 'separator' });
  // Sentinel renamed from "+ New container…" → "New Jar" (F1b) and stripped of the
  // old `variant: 'add'` accent styling (F1c — it now renders as a plain item,
  // consistent with "Manage jars…" below; the divider above is the sole separator
  // cue now). Action id unchanged — the chrome's channel-6 dispatch depends on it.
  model.push({ id: 'action:new-container', label: 'New Jar' });
  // Manage-jars sentinel (Leg 3, chrome entry point): opens the goldfinch://jars
  // page. Placed AFTER quick-create — quick-create stays as the in-flow path
  // (operator ruling), the page is the full-featured surface. Plain navigation
  // row, same "white"/undecorated styling as the quick-create row above.
  model.push({ id: 'action:manage-jars', label: 'Manage jars…' });
  return model;
}

// Dual export: CommonJS (test runner) and global (the chrome renderer, which runs
// with nodeIntegration:false and cannot require()). index.html loads this via
// <script> before renderer.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildContainerModel };
} else {
  /** @type {any} */ (globalThis).buildContainerModel = buildContainerModel;
}
