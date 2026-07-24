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
 * Returns 'chrome' when wc is a chrome renderer contents, 'guest' otherwise.
 *
 * chromeContents is the DD8 accessor's chrome at the call site (injected, not
 * imported). A nullish chromeContents injection simply never matches a real
 * wc, returning 'guest' — the engine glue (Leg 5) is responsible for
 * injecting a live chrome webContents before any classification matters.
 *
 * M09 F6 (DD8 widening): the optional isChromeContents predicate — main.js's
 * window-registry "is any registered chrome" — makes EVERY registered window's
 * chrome classify 'chrome', not just the accessor's (the leg-1 spike residual:
 * without it a second window's chrome classified 'guest' and the foreground-
 * first eval activation mistreated it). Absent predicate = identity-only
 * (offline tests / legacy callers unchanged).
 *
 * Never throws on a valid wc. The security guard (isInternalContents) does not
 * depend on chromeContents, so a null chrome injection cannot weaken the
 * internal-session rejection in resolveContents.
 *
 * @param {any} wc  the resolved webContents
 * @param {any} chromeContents  the accessor chrome webContents (injected)
 * @param {((wc: any) => boolean) | undefined} [isChromeContents]  any-registered-chrome predicate (injected)
 * @returns {'chrome' | 'guest'}
 */
function classifyContents(wc, chromeContents, isChromeContents) {
  if (wc === chromeContents) return 'chrome';
  if (typeof isChromeContents === 'function' && isChromeContents(wc)) return 'chrome';
  return 'guest';
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
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean, isTabViewWcId?: (id: number) => boolean, isChromeContents?: (wc: any) => boolean, isSheetContents?: (wc: any) => boolean }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — the accessor chrome webContents (injected; passed through
 *                    for callers that immediately classify the result)
 *   isChromeContents — (M09 F6, DD8) "is any registered chrome" predicate; a
 *                    second window's chrome is exempted from the non-tab-contents
 *                    guard exactly like the accessor's chrome (jar tiers still
 *                    refuse every chrome via resolveContentsForJar's exclusion)
 *   allowInternal — when true (one of admin's TWO relaxations — see below), the
 *                   internal-session throw is SKIPPED. Defaults to false/undefined:
 *                   existing callers that pass no allowInternal behave exactly as
 *                   before. bad-handle / no-such-contents ALWAYS apply.
 *   isTabViewWcId — (M05 F8 DD8, defense-in-depth) main.js's tabViews-membership
 *                   predicate. When provided and NOT allowInternal, a live wcId
 *                   that is neither a tabViews member nor the chrome contents
 *                   (e.g. the menu-overlay sheet, the find overlay — chrome-class
 *                   overlay views) throws `non-tab-contents`: such wcIds resolve
 *                   only at the ADMIN tier. This is admin's SECOND relaxation
 *                   (alongside allowInternal). Absent predicate = no behavior
 *                   change (offline tests / legacy callers).
 * @returns {any} the live webContents
 * @throws {Error} with message prefixed 'automation: ' identifying which guard fired
 */
function resolveContents(wcId, { fromId, chromeContents, allowInternal = false, isTabViewWcId, isChromeContents, isSheetContents }) {
  if (typeof wcId !== 'number') {
    throw new Error('automation: bad-handle — wcId must be a number, got ' + typeof wcId);
  }

  const wc = fromId(wcId);

  if (!wc || wc.isDestroyed?.()) {
    throw new Error('automation: no-such-contents — wcId ' + wcId + ' is not a live webContents');
  }

  // PR#112 finding 1 — ABSOLUTE, NOT lifted by admin (unlike the two relaxations below).
  // The menu-overlay SHEET hosts the chrome-owned vault secret sheets (the master password is
  // typed there; one-time recovery/access/admin keys render there as textContent). Its wcId is
  // discoverable via enumerateWindows, and admin's allowInternal otherwise lets `evaluate` run
  // arbitrary JS on it — a keylogger / secret-reader with no vault-admin key. Refuse the sheet's
  // webContents at EVERY tier so no automation op (evaluate/DOM/AX/input/click) can ever reach it.
  if (typeof isSheetContents === 'function' && isSheetContents(wc)) {
    throw new Error('automation: secret-sheet — wcId ' + wcId + ' is a chrome-owned secret/overlay sheet and is never automatable (any tier)');
  }

  // DD5 load-bearing guard: reject internal-session contents at resolve-time.
  // A directly-supplied internal-guest wcId is rejected here, not merely
  // filtered from an enumerate pass — this closes the bypass path.
  //
  // DD6 (Leg 2) / F8 DD8: the admin engine builds deps with allowInternal:true —
  // one of admin's TWO relaxations (the other being the non-tab-contents guard
  // below, which allowInternal also lifts). Jar keys (and every existing caller)
  // leave allowInternal false/undefined, so the internal session stays
  // ABSOLUTELY off-limits to them.
  if (!allowInternal && isInternalContents(wc)) {
    throw new Error('automation: internal-session — wcId ' + wcId + ' belongs to the internal goldfinch://settings session and cannot be driven');
  }

  // F8 DD8 (defense-in-depth): non-tab, non-chrome wcIds (chrome-class overlay
  // views — the menu-overlay sheet, the find overlay) resolve only at the admin
  // tier. NOT a live-vulnerability fix: jar-tier wcId-first ops already refuse
  // these on session identity in resolveContentsForJar (out-of-jar) — this
  // resolver-level rule is robust against a future sheet-gets-a-partition change.
  // Fires only when main.js threads the predicate; admin (allowInternal) is exempt.
  // M09 F6: ANY registered chrome is exempt (isChromeContents), mirroring the
  // accessor-chrome identity exemption — a second window's chrome is not an overlay.
  if (
    !allowInternal && typeof isTabViewWcId === 'function' &&
    wc !== chromeContents &&
    !(typeof isChromeContents === 'function' && isChromeContents(wc)) &&
    !isTabViewWcId(wcId)
  ) {
    throw new Error('automation: non-tab-contents — wcId ' + wcId + ' is not a tab view (chrome-class overlay contents resolve only at the admin tier)');
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
 * @param {{ fromId: (id: number) => any, chromeContents?: any, fromPartition: (partition: string) => any, allowInternal?: boolean, isChromeContents?: (wc: any) => boolean }} deps
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
  // M09 F6 (DD8 / review L5): the exclusion widens from identity-with-THE-chrome to
  // "is any registered chrome" — a second window's chrome must be equally
  // undrivable by a jar key.
  if (
    (deps.chromeContents != null && wc === deps.chromeContents) ||
    (typeof deps.isChromeContents === 'function' && deps.isChromeContents(wc))
  ) {
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
