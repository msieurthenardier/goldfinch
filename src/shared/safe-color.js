// @ts-check

// Injection-safe color validator — extracted from src/main/jars.js (M05 Flight 8,
// Leg 3) so the menu-overlay sheet validates container dot colors against the SAME
// domain the product accepts (jars.add / validateContainers). A stricter sheet-side
// rule would silently render fallback dots for legal colors — parity divergence.
//
// Real ES module (M07 Flight 2 sweep): `export` for module consumers (import in
// automation-indicator-model.js and all four page controllers — renderer.js,
// pages/jars.js, pages/settings.js, menu-overlay.js; require(esm) in
// src/main/jars.js and the test runner). The transitional globalThis bridge was
// removed in leg 5 when the page controllers converted.
//
// HEX: 3/4/6/8 hex digits — 4 and 8 are CSS4 RGBA shorthand (e.g. #abc8, #11223344).
// KEYWORD: letters-only (≤20 chars) — covers all CSS color keywords (red,
// rebeccapurple, etc.) and cannot contain injection characters (parens, semicolons,
// quotes, angle brackets, spaces).
const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const KEYWORD = /^[a-zA-Z]{1,20}$/;

/** @param {any} c @returns {boolean} */
export function isSafeColor(c) {
  return typeof c === 'string' && (HEX.test(c) || KEYWORD.test(c));
}
