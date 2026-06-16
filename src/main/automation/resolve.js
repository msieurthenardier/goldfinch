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
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — mainWindow.webContents (injected; passed through for
 *                    callers that immediately classify the result)
 *   allowInternal — when true (admin's SOLE relaxation, Leg 2 / DD6), the
 *                   internal-session throw is SKIPPED. Defaults to false/undefined:
 *                   existing callers that pass no allowInternal behave exactly as
 *                   before. bad-handle / no-such-contents ALWAYS apply.
 * @returns {any} the live webContents
 * @throws {Error} with message prefixed 'automation: ' identifying which guard fired
 */
function resolveContents(wcId, { fromId, chromeContents: _chromeContents, allowInternal = false }) {
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
  //
  // DD6 (Leg 2): the admin engine builds deps with allowInternal:true — its
  // SOLE relaxation of this exclusion. Jar keys (and every existing caller)
  // leave allowInternal false/undefined, so the internal session stays
  // ABSOLUTELY off-limits to them.
  if (!allowInternal && isInternalContents(wc)) {
    throw new Error('automation: internal-session — wcId ' + wcId + ' belongs to the internal goldfinch://settings session and cannot be driven');
  }

  return wc;
}

/**
 * Resolve a webContentsId AND verify it belongs to the given jar by SESSION
 * OBJECT IDENTITY (DD7 — the SC8 linchpin).
 *
 * Membership is decided by `wc.session === deps.fromPartition(jar.partition)`,
 * NOT by partition-string comparison and NEVER by the renderer-reported jarId.
 * Electron interns sessions by partition, so a guest webview created with
 * `partition = jar.partition` shares the *same* Session object main resolves —
 * the same discipline isInternalContents uses for the internal marker.
 *
 * Net-new in Leg 2 — no Session→jar map exists today. The compare is LAZY (no
 * cached map) so a runtime `jars-add` is picked up immediately: fromPartition is
 * called fresh each time, and Electron returns the live interned Session.
 *
 * Order of guards:
 *   1. resolveContents(wcId, deps) — applies bad-handle / no-such-contents /
 *      internal-session (internal stays ABSOLUTE here; jar keys never carry
 *      allowInternal, so an internal wcId throws before the membership check).
 *   2. chrome-exclusion (Flight-6, defense-in-depth) — refuse the chrome
 *      renderer's webContents for ANY jar identity, BEFORE the session check.
 *      Today the chrome uses session.defaultSession and no jar partition aliases
 *      it (so the session check below already refuses it), but object-identity
 *      exclusion is robust against any future config change that gives the chrome
 *      a jar-aliased session. Backstops getChromeTarget's admin-only façade gate
 *      for the wcId-first ops. Guard is a no-op when deps.chromeContents is nullish.
 *   3. session object-identity membership — throws `automation: out-of-jar` on
 *      mismatch (or when jar is absent).
 *
 * Kept ELECTRON-FREE: fromPartition is injected via deps (the engine/scope ctx
 * passes session.fromPartition).
 *
 * @param {number} wcId  the webContentsId to resolve
 * @param {{ id: string, partition: string } | null | undefined} jar  the jar to confine to
 * @param {{ fromId: (id: number) => any, chromeContents?: any, fromPartition: (partition: string) => any, allowInternal?: boolean }} deps
 * @returns {any} the live, in-jar webContents
 * @throws {Error} bad-handle / no-such-contents / internal-session (via
 *   resolveContents) or `automation: out-of-jar` on a chrome-exclusion hit or
 *   a membership mismatch.
 */
function resolveContentsForJar(wcId, jar, deps) {
  const wc = resolveContents(wcId, deps); // bad-handle / no-such-contents / internal-session
  // Flight-6 chrome-exclusion (defense-in-depth): refuse the chrome renderer's webContents for
  // ANY jar identity, BEFORE the session check. Today the chrome uses session.defaultSession and
  // no jar partition aliases it (so the session check below already refuses it), but object-
  // identity exclusion is robust against any future config change that gives the chrome a
  // jar-aliased session. Backstops getChromeTarget's admin-only façade gate for the wcId-first ops.
  if (deps.chromeContents != null && wc === deps.chromeContents) {
    throw new Error('automation: out-of-jar — wcId ' + wcId + ' is the chrome renderer and is not drivable by a jar key');
  }
  if (!jar || wc.session !== deps.fromPartition(jar.partition)) {
    throw new Error(
      'automation: out-of-jar — wcId ' + wcId +
      ' does not belong to jar ' + (jar ? jar.id : '(none)')
    );
  }
  return wc;
}

module.exports = { isInternalContents, classifyContents, resolveContents, resolveContentsForJar };
