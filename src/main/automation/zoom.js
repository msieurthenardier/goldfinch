// @ts-check
'use strict';

// Automation engine — page zoom.
//
// Provides getZoom/setZoom over a resolved webContents, keyed by zoom *factor*
// (1.0 = 100%). Mirrors the nav.js op template.
//
// SECURITY (DD3): every call resolves through resolveContents, which rejects
// bad-handle / dead contents and (for jar keys) the internal session. The admin
// engine builds deps with { allowInternal: true }, which is resolveContents's
// SOLE relaxation of the internal-session exclusion — so resolveContents alone
// would let admin zoom goldfinch://settings. Each op therefore carries its OWN
// op-local isInternalContents guard (mirroring observe.js's evaluate /
// injectScript / openDevTools), placed AFTER resolveContents, so internal pages
// are refused EVEN under the admin key.
//
// ELECTRON-FREE: no require('electron') at the top. Electron handles are
// injected via deps ({ fromId, chromeContents }) so the module is unit-testable
// under plain node --test with fake webContents.
//
// DD8: no webContents.debugger usage. Zoom uses the getZoomFactor/setZoomFactor
// instance methods only.

const { resolveContents, isInternalContents } = require('./resolve');

// Mirrors the keyboard ladder bounds in main.js (applyZoom). Kept local: the
// automation module must not import from the Electron entry (main.js requires
// the engine, not vice-versa).
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;

/**
 * Read the current page zoom factor of a webContents (1.0 = 100%).
 *
 * Op-local internal-session guard (DD3): runs AFTER resolveContents so it fires
 * even when deps carries allowInternal:true (admin) — admin gets no internal
 * read either.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {{ factor: number }}
 */
function getZoom(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: getZoom — internal-session excluded');
  }
  return { factor: wc.getZoomFactor() };
}

/**
 * Set the page zoom factor of a webContents (1.0 = 100%), clamped to
 * [ZOOM_MIN, ZOOM_MAX]. Returns the applied (clamped) factor so the caller sees
 * what landed.
 *
 * Guard order mirrors nav.navigate: validate the cheap, side-effect-free
 * argument (factor) FIRST, then resolve, then the op-local internal guard, then
 * act. The internal-session guard runs AFTER resolveContents so it fires even
 * under admin's allowInternal:true (DD3).
 *
 * @param {number} wcId
 * @param {number} factor  zoom factor; must be a finite number > 0
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {{ factor: number }}
 */
function setZoom(wcId, factor, deps) {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
    throw new Error('automation: setZoom — factor must be a positive number, got ' + String(factor));
  }
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: setZoom — internal-session excluded');
  }
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  wc.setZoomFactor(clamped);
  return { factor: clamped };
}

module.exports = { getZoom, setZoom };
