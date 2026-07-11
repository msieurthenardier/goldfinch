// @ts-check
'use strict';

// Pure row-model for the goldfinch://jars management page (M06 Flight 3, Leg 1 /
// DD3). Extracted so the page's list logic is unit-testable without DOM, following
// the mission's proven pure-module split (container-menu.js / default-routing.js /
// inherit-container.js precedent). Also hosts PALETTE (DD4) and pickNewJarColor
// (M06 Flight 4 Leg 5 HAT F5) — the new-jar color-selection helper, kept beside
// the palette it draws from.
//
// Contract: returns an ORDERED array of rows — every persistent jar (in the order
// jars.list() returns them) followed by the static Burner row. `isDefault` is true
// on exactly one row: the persistent jar matching `defaultId`, or the Burner row
// when `defaultId == null` (the store's null-means-Burner convention — jar-ipc.js
// DD2). No DOM, no Electron; the caller applies isSafeColor before touching
// style.background (defense in depth, menu-overlay.js:202 precedent).
//
// BURNER resolved hybrid-style (M06 Flight 2 DD8 precedent, RESOLVED_BURNER in
// container-menu.js): CommonJS require() under the test runner, global under the
// script-tag internal page (nodeIntegration:false, no require()). jars.html loads
// burner.js before this file — see the F2 D1 shared-scope-collision lesson: this
// module must NOT redeclare a top-level `const BURNER`.
const RESOLVED_BURNER = typeof module !== 'undefined' && module.exports
  ? require('./burner').BURNER
  : /** @type {{ id: string, name: string, color: string }} */ (/** @type {any} */ (globalThis).BURNER);

// Curated palette (M06 Flight 3, Leg 2 / DD4): a fixed, frozen set of swatches for
// the create/recolor swatch grid. Each entry is a plain 6-digit hex so it always
// passes isSafeColor (unit-pinned below) — the page palette is UX, the store's
// cleanColor (jars.js:80) remains the enforcement backstop. First entry is the
// preselected color for a new jar. Distinct, no near-duplicates.
const PALETTE = Object.freeze([
  '#4caf50', // green (matches the fresh-seed "Personal" default — sensible first pick)
  '#2196f3', // blue
  '#f5c518', // gold (brand accent)
  '#ff7043', // orange
  '#ab47bc', // purple
  '#26a69a', // teal
  '#ef5350', // red
  '#5c6bc0', // indigo
  '#8d6e63', // brown
  '#78909c', // blue-grey
  '#ec407a', // pink
  '#9ccc65' // light green
]);

/**
 * Build the ordered list of jar rows for the management page.
 *
 * @param {Array<{ id?: any, name?: any, color?: any }>} containers
 * @param {string | null | undefined} defaultId
 * @returns {Array<{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }>}
 */
function buildJarPageModel(containers, defaultId) {
  /** @type {Array<{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }>} */
  const rows = [];
  for (const c of containers || []) {
    if (!c || typeof c.id !== 'string') continue;
    rows.push({
      id: c.id,
      name: String(c.name != null ? c.name : c.id),
      color: typeof c.color === 'string' ? c.color : '',
      isDefault: c.id === defaultId,
      isBurner: false
    });
  }
  // Static Burner row — never a store entry (src/shared/burner.js). Default
  // exactly when defaultId is null/undefined (the store's "Burner holds the
  // flag" convention — jar-ipc.js broadcastJarsChanged / DD2).
  rows.push({
    id: RESOLVED_BURNER.id,
    name: RESOLVED_BURNER.name,
    color: RESOLVED_BURNER.color,
    isDefault: defaultId == null,
    isBurner: true
  });
  return rows;
}

/**
 * Pick a color for a newly-created jar (M06 Flight 4 Leg 5 HAT F5): uniformly
 * random among `palette` entries NOT already in `usedColors`, so new jars don't
 * visually collide with existing ones. When every palette entry is already used
 * (or `usedColors` otherwise covers the whole palette), falls back to uniformly
 * random over the WHOLE palette — collision is unavoidable at that point, so we
 * stop trying to avoid it rather than picking a fixed entry.
 *
 * Defensive on malformed input: a non-array/empty `palette` returns PALETTE[0]
 * (a safe, known-isSafeColor-clean value) rather than throwing or returning
 * undefined — production never passes anything but PALETTE here, and the store's
 * cleanColor (jars.js) backstops any color that slips through regardless.
 *
 * @param {readonly string[]} palette
 * @param {Array<any> | null | undefined} usedColors
 * @param {() => number} [random] injectable RNG, defaults to Math.random (test seam)
 * @returns {string}
 */
function pickNewJarColor(palette, usedColors, random = Math.random) {
  if (!Array.isArray(palette) || palette.length === 0) return PALETTE[0];
  const used = new Set(Array.isArray(usedColors) ? usedColors : []);
  const unused = palette.filter((color) => !used.has(color));
  const pool = unused.length > 0 ? unused : palette;
  const index = Math.floor(random() * pool.length);
  // Clamp defensively: a random() implementation that returns exactly 1 (out of
  // spec for Math.random, but this is an injectable test seam) must not index
  // past the end of pool.
  return pool[Math.min(index, pool.length - 1)];
}

// Dual export: CommonJS (main process + test runner) and global (renderer-class
// documents, which run with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildJarPageModel, PALETTE, pickNewJarColor };
} else {
  /** @type {any} */ (globalThis).buildJarPageModel = buildJarPageModel;
  /** @type {any} */ (globalThis).PALETTE = PALETTE;
  /** @type {any} */ (globalThis).pickNewJarColor = pickNewJarColor;
}
