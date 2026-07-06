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
// the sentinels are `action:burner` / `action:new-container`. The chrome's
// channel-6 `container` case dispatches on the prefix.
//
// Labels are DATA — the sheet renders them via textContent only (DD8); `color` is
// data too, applied sheet-side via style.background AFTER the shared isSafeColor
// check (invalid → the default grey dot).

/**
 * @param {Array<{ id?: any, name?: any, color?: any }>} containers
 * @returns {Array<{ id: string, label: string, color?: string, variant?: string }>}
 */
function buildContainerModel(containers) {
  /** @type {Array<{ id: string, label: string, color?: string, variant?: string }>} */
  const model = [];
  for (const c of containers || []) {
    if (!c || typeof c.id !== 'string') continue;
    /** @type {{ id: string, label: string, color?: string, variant?: string }} */
    const item = { id: 'jar:' + c.id, label: String(c.name != null ? c.name : c.id) };
    if (typeof c.color === 'string') item.color = c.color;
    model.push(item);
  }
  // Burner sentinel — old markup was `Burner tab <em>(evaporates)</em>`; the sheet
  // is textContent-only, so the label carries the flattened text.
  model.push({ id: 'action:burner', label: 'Burner tab (evaporates)', color: '#ff8c42' });
  // variant:'add' is a presentation hint (the old .cm-item.add separator styling).
  model.push({ id: 'action:new-container', label: '+ New container…', variant: 'add' });
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
