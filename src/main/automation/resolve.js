// @ts-check
'use strict';

// Automation engine — webContents resolution and classification.
//
// This module is deliberately ELECTRON-FREE (no require('electron') at the top)
// so the pure predicates are unit-testable offline without an Electron stub.
// The chrome webContents reference and webContents.fromId are INJECTED into
// resolveContents rather than imported here.
//
// src/main/automation/ is the automation engine module group. The dev-only
// seam (exposing engine entry points for CDP-driven automation) is interim
// (DD7) and will be landed in Leg 5.

/**
 * Returns true iff wc.session.__goldfinchInternal === true (strict equality).
 *
 * Returns false for: missing wc, missing wc.session, marker undefined/false,
 * and truthy-but-not-true marker (e.g. 1). Never throws.
 *
 * Mirrors the strict === true discipline from internal-ipc.js:31 — pass the
 * raw marker value; do not pre-coerce with !! (a truthy-but-wrong value must
 * not be treated as internal).
 *
 * @param {any} wc  a webContents (or fake) — may be null/undefined
 * @returns {boolean} true iff wc.session.__goldfinchInternal === true (strict)
 */
function isInternalContents(wc) {
  return !!wc && !!wc.session && wc.session.__goldfinchInternal === true;
}

/**
 * Returns 'chrome' when wc is the chrome renderer contents, 'guest' otherwise.
 *
 * chromeContents is mainWindow.webContents at the call site (injected, not
 * imported). A nullish chromeContents injection simply never matches a real
 * wc, returning 'guest' — the engine glue (Leg 5) is responsible for
 * injecting a live mainWindow.webContents before any classification matters.
 *
 * Never throws on a valid wc. The security guard (isInternalContents) does not
 * depend on chromeContents, so a null chrome injection cannot weaken the
 * internal-session rejection in resolveContents.
 *
 * @param {any} wc  the resolved webContents
 * @param {any} chromeContents  mainWindow.webContents (injected)
 * @returns {'chrome' | 'guest'}
 */
function classifyContents(wc, chromeContents) {
  return wc === chromeContents ? 'chrome' : 'guest';
}

/**
 * Resolve a webContentsId to a live, drivable webContents.
 *
 * Throws distinct errors for three rejection paths:
 *   - bad-handle: wcId is not a number
 *   - no-such-contents: fromId returns null/undefined, or the resolved
 *     contents is already destroyed
 *   - internal-session: the resolved contents belongs to the internal
 *     goldfinch://settings session (DD5 load-bearing guard — a directly-
 *     supplied internal-guest wcId must be rejected here, not merely
 *     excluded from enumerate, to close the bypass path)
 *
 * @param {number} wcId  the webContentsId to resolve
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — mainWindow.webContents (injected; passed through for
 *                    callers that immediately classify the result)
 * @returns {any} the live webContents
 * @throws {Error} with message prefixed 'automation: ' identifying which guard fired
 */
function resolveContents(wcId, { fromId, chromeContents: _chromeContents }) {
  if (typeof wcId !== 'number') {
    throw new Error('automation: bad-handle — wcId must be a number, got ' + typeof wcId);
  }

  const wc = fromId(wcId);

  if (!wc || wc.isDestroyed?.()) {
    throw new Error('automation: no-such-contents — wcId ' + wcId + ' is not a live webContents');
  }

  // DD5 load-bearing guard: reject internal-session contents at resolve-time.
  // A directly-supplied internal-guest wcId is rejected here, not merely
  // filtered from an enumerate pass — this closes the bypass path.
  if (isInternalContents(wc)) {
    throw new Error('automation: internal-session — wcId ' + wcId + ' belongs to the internal goldfinch://settings session and cannot be driven');
  }

  return wc;
}

module.exports = { isInternalContents, classifyContents, resolveContents };
