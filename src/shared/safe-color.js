// @ts-check
'use strict';

// Injection-safe color validator — extracted from src/main/jars.js (M05 Flight 8,
// Leg 3) so the menu-overlay sheet validates container dot colors against the SAME
// domain the product accepts (jars.add / validateContainers). A stricter sheet-side
// rule would silently render fallback dots for legal colors — parity divergence.
//
// HEX: 3/4/6/8 hex digits — 4 and 8 are CSS4 RGBA shorthand (e.g. #abc8, #11223344).
// KEYWORD: letters-only (≤20 chars) — covers all CSS color keywords (red,
// rebeccapurple, etc.) and cannot contain injection characters (parens, semicolons,
// quotes, angle brackets, spaces).
const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const KEYWORD = /^[a-zA-Z]{1,20}$/;

/** @param {any} c @returns {boolean} */
function isSafeColor(c) {
  return typeof c === 'string' && (HEX.test(c) || KEYWORD.test(c));
}

// Dual export: CommonJS (main process — jars.js re-exports it — + test runner) and
// global (renderer-class documents, which run with nodeIntegration:false and cannot
// require()). The menu-overlay sheet loads this via <script> before menu-overlay.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isSafeColor };
} else {
  /** @type {any} */ (globalThis).isSafeColor = isSafeColor;
}
