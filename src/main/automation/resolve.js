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
 * M15 F3 L1 (DD1/DD1d) — the menuType half of the sheet gate.
 *
 * The chrome-owned menu-overlay sheet is ONE persistent WebContents whose single
 * document renders EVERY menu the chrome opens — including the vault's master-password
 * entry and the one-time recovery / access / admin key displays. Sheet automation is
 * therefore admitted by TWO allowlists that must BOTH pass (see resolveContents' guard 3):
 *
 *   1. the sheet's CURRENT menuType is in this set, and
 *   2. the OP is one of exactly three reads (see engine.js's `allowSheet` opt-in).
 *
 * ALLOWLIST, NEVER A DENYLIST (DD1d). A menuType absent from this set is refused, so a
 * sheet menuType added by a future flight is refused until someone deliberately admits
 * it here. `getCurrentMenu()` returning null — no menu open — refuses too.
 *
 * ⚠ ADDING A MEMBER IS A SECURITY DECISION. Everything the sheet has rendered since its
 * last close is co-resident in one document (#menu-root), so admitting a menuType asserts
 * that the card is secret-free AND that the eager close-scrub (DD1f,
 * menu-overlay-manager.js's `menu-overlay:close` → the sheet's report.silence() +
 * menuController.closeAll()) still runs on every close path.
 */
const AUTOMATABLE_MENU_TYPES = new Set(['bookmarks-overflow', 'bookmark-edit']);

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
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean, isTabViewWcId?: (id: number) => boolean, isPopupWcId?: (id: number) => boolean, isChromeContents?: (wc: any) => boolean, isSheetContents?: (wc: any) => boolean, allowSheet?: boolean, sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null) }} deps
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
 *   isPopupWcId — (M14 F2 L2, DD1a) the popup-registry membership predicate:
 *                   a script-opened popup's contents are DRIVABLE, so the
 *                   non-tab-contents refusal widens to "not a tab AND not a
 *                   popup". Membership/tier confinement is UNCHANGED — a jar
 *                   key still reaches only popups whose session is its own jar
 *                   (resolveContentsForJar's session-identity check; the popup's
 *                   session IS the interned opener-jar session). Never a
 *                   partition-string compare (DD7 discipline — the registry's
 *                   captured partition is census-only). Absent predicate = no
 *                   behavior change.
 *   allowSheet    — (M15 F3 L1, DD1b) the OP half of the sheet gate. OPT-IN, spread onto
 *                   deps by exactly three dispatch entries in engine.js
 *                   (captureScreenshot / readDom / readAxTree). Absent/false — which is
 *                   every other op, and every op added in future — leaves guard 3 at its
 *                   pre-M15 absolute refusal. Deliberately NOT `deps(opName)`: that is
 *                   ~28 edits and FAIL-OPEN (a forgotten argument yields undefined),
 *                   whereas an opt-in flag makes "a new op is admitted by accident"
 *                   unrepresentable rather than merely documented.
 *   sheetMenuFor  — (M15 F3 L1, DD1b) window-registry's LIVE reader
 *                   `(wc) => { menuType, token } | null` for the sheet owning `wc`
 *                   (null when no sheet matches, or the matching sheet is hidden /
 *                   has no open menu). A live reader rather than a snapshot: deps have
 *                   no wcId, and the sheet is per-window record — see engine.js. Absent
 *                   predicate = guard 3 refuses exactly as it did before this leg.
 * @returns {any} the live webContents
 * @throws {Error} with message prefixed 'automation: ' identifying which guard fired
 */
function resolveContents(
  wcId,
  {
    fromId,
    chromeContents,
    allowInternal = false,
    isTabViewWcId,
    isPopupWcId,
    isChromeContents,
    isSheetContents,
    allowSheet = false,
    sheetMenuFor
  }
) {
  if (typeof wcId !== 'number') {
    throw new Error('automation: bad-handle — wcId must be a number, got ' + typeof wcId);
  }

  const wc = fromId(wcId);

  if (!wc || wc.isDestroyed?.()) {
    throw new Error('automation: no-such-contents — wcId ' + wcId + ' is not a live webContents');
  }

  // PR#112 finding 1, NARROWED by M15 F3 L1 (DD1/DD1a/DD1b/DD1d) from an absolute refusal
  // to a TWO-ALLOWLIST admission. Everything else about it is unchanged: still not lifted by
  // admin's allowInternal, still the same thrown code.
  //
  // The menu-overlay SHEET hosts the chrome-owned vault secret sheets (the master password is
  // typed there; one-time recovery/access/admin keys render there as textContent). Its wcId is
  // discoverable via enumerateWindows, so without a guard here admin could keylog / read those
  // secrets with no vault-admin key.
  //
  // The sheet is now admitted iff BOTH allowlists pass:
  //   (menuType) the sheet's CURRENT menu is in AUTOMATABLE_MENU_TYPES — allowlist, never a
  //              denylist; `null` (no menu open, or the sheet is hidden) refuses (DD1d), AND
  //   (op)       the caller opted in with allowSheet — set by exactly three engine.js dispatch
  //              entries: readDom, readAxTree, captureScreenshot (DD1a).
  // Every other op stays refused at every tier under every menuType, and an op added later is
  // refused because it did nothing (DD1a/DD1b).
  //
  // WHY readDom IS ADMITTED THOUGH IT EXECUTES SCRIPT. readDom runs READ_DOM_SNIPPET through
  // wc.executeJavaScript (observe.js). The distinction this allowlist encodes is NOT
  // "executes script vs doesn't" — it is FIXED APP-AUTHORED SNIPPET vs CALLER-SUPPLIED CODE.
  // readDom runs one closed IIFE returning { url, title, html }: it registers nothing, leaves
  // nothing resident, and the caller cannot influence it. evaluate / injectScript run
  // caller-controlled code into a realm that OUTLIVES the menu it was injected under
  // (menu-overlay-manager.js: teardown() is the only destroy; hide() is removeChildView alone),
  // so a listener installed under `bookmarks-overflow` would still be live when the same realm
  // later renders `vault-unlock`. That residency argument is why evaluate can never be admitted;
  // it is NOT the rule — printToPDF leaves nothing resident and is still refused, because it is
  // a full-fidelity content read by a second door.
  //
  // WHICH GUARD REFUSES JAR KEYS — do not restate this from memory, it is easy to get wrong.
  // It is NOT this guard and NOT guard 5. scope.js's memberDeps() threads neither
  // isSheetContents nor isTabViewWcId, so inside resolveContentsForJar guards 3 and 5 are BOTH
  // no-ops (each is `typeof … === 'function'`-gated). A jar key is refused by `out-of-jar` from
  // the session-identity compare in resolveContentsForJar — exactly as docs/mcp-automation.md
  // states. Guard 5 backstops only at the ENGINE level (main.js's MCP engine /
  // app-lifecycle.js's dev seam), a path scopeEngine's façade never reaches because facade[op]
  // calls resolveContentsForJar first. Consequence: THIS LEG WIDENS THE ADMIN TIER ONLY.
  //
  // FAIL-CLOSED BY SHAPE: an absent sheetMenuFor injection (offline tests, legacy callers, a
  // half-wired engine site) must REFUSE — never throw a TypeError from inside a live security
  // guard. Hence the explicit typeof check before the call.
  if (typeof isSheetContents === 'function' && isSheetContents(wc)) {
    const admitted =
      allowSheet === true &&
      typeof sheetMenuFor === 'function' &&
      AUTOMATABLE_MENU_TYPES.has(sheetMenuFor(wc)?.menuType);
    if (!admitted) {
      throw new Error(
        'automation: secret-sheet — wcId ' +
          wcId +
          ' is a chrome-owned secret/overlay sheet and is never automatable (any tier)'
      );
    }
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
    throw new Error(
      'automation: internal-session — wcId ' +
        wcId +
        ' belongs to the internal goldfinch://settings session and cannot be driven'
    );
  }

  // F8 DD8 (defense-in-depth): non-tab, non-chrome wcIds (chrome-class overlay
  // views — the menu-overlay sheet, the find overlay) resolve only at the admin
  // tier. NOT a live-vulnerability fix: jar-tier wcId-first ops already refuse
  // these on session identity in resolveContentsForJar (out-of-jar) — this
  // resolver-level rule is robust against a future sheet-gets-a-partition change.
  // Fires only when main.js threads the predicate; admin (allowInternal) is exempt.
  // M09 F6: ANY registered chrome is exempt (isChromeContents), mirroring the
  // accessor-chrome identity exemption — a second window's chrome is not an overlay.
  // M14 F2 L2 (DD1a): popup-registry members are exempt too — the ONLY resolve-
  // side popup change. Everything else (session-identity membership, internal
  // exclusion, chrome exclusion) applies to popups through the existing guards
  // untouched.
  if (
    !allowInternal &&
    typeof isTabViewWcId === 'function' &&
    wc !== chromeContents &&
    !(typeof isChromeContents === 'function' && isChromeContents(wc)) &&
    !isTabViewWcId(wcId) &&
    !(typeof isPopupWcId === 'function' && isPopupWcId(wcId))
  ) {
    throw new Error(
      'automation: non-tab-contents — wcId ' +
        wcId +
        ' is not a tab view (chrome-class overlay contents resolve only at the admin tier)'
    );
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
    throw new Error(
      'automation: out-of-jar — wcId ' + wcId + ' is the chrome renderer and is not drivable by a jar key'
    );
  }
  if (!jar || wc.session !== deps.fromPartition(jar.partition)) {
    throw new Error('automation: out-of-jar — wcId ' + wcId + ' does not belong to jar ' + (jar ? jar.id : '(none)'));
  }
  return wc;
}

module.exports = {
  isInternalContents,
  classifyContents,
  resolveContents,
  resolveContentsForJar,
  AUTOMATABLE_MENU_TYPES
};
