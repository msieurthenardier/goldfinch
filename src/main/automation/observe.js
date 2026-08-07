// @ts-check
'use strict';
const { resolveContents, classifyContents, isInternalContents } = require('./resolve');
const { withDebuggerSession } = require('./cdp');
const { setDevTools } = require('../devtools');
// F7 DD7: bounded capturePage race. Reaching up to src/main/ is the established shape
// here (see ../devtools above); capture-timeout.js is itself Electron-free, so this
// module's Electron-free property is preserved.
const { withCaptureTimeout } = require('../capture-timeout');
// Automation engine — READ half (observe). Foreground-first, debugger-free screenshots
// via webContents.capturePage() (DD1): a guest is brought to front before capture or it
// returns blank (Flight-1 spike). Results are base64 PNG strings (NativeImage.toPNG().
// toString('base64')) so they are JSON-serializable across the dev seam and the future
// Flight-3 transport.
//
// ELECTRON-FREE at top (no require('electron')): every Electron handle (fromId,
// chromeContents, activate) is injected through deps so orchestration is unit-testable
// offline with fakes. Live capture is integration-verified (Leg 5 smoke + Leg 6 HAT).
//
// webContents.debugger discipline is now shared via cdp.js (withDebuggerSession /
// debuggerUnavailable / attached Set). readAxTree uses withDebuggerSession, which
// enforces attach-on-demand / detach-in-finally / single-client lock. The shared lock
// means a concurrent scroll (input.js) + readAxTree on the same wcId cannot both attach.
// (DD3/DD7/DD8/DD9; the DD8 boundary crossing — scroll now also uses the debugger — is
// operator-approved for this leg.) Every OTHER op in this module (captureScreenshot /
// captureWindow / readDom) stays debugger-free.
// Leg 4 (wire-and-docs) adds the dispatch keys to engine.js (no engine.js edit here).
//
// Flight-9 eval ops (evaluate / injectScript): debugger-free webContents.executeJavaScript
// ops (DD1: ZERO CDP — they never touch cdp.js / withDebuggerSession). They are co-located
// here with readDom because they share its resolve → read skeleton, EVEN THOUGH injectScript
// is a *write* (it defines globals / patches prototypes). The "observe" filename is
// historical; a future reader should not trip on a write living here.
//
// M09 F7 DD6 — THE ACTIVATE SKELETON IS NO LONGER SHARED BY THIS MODULE'S OPS. The
// predicate: an op that needs RENDERED OUTPUT raises the owning window; an op that reads
// live JS/DOM state does not. So captureScreenshot (pixels) and readAxTree (the AX tree is
// a rendered artifact) still resolve → activate → re-resolve; readDom and evaluate DO NOT
// ACTIVATE AT ALL — executeJavaScript works fine on a background guest, and making a *read*
// steal the operator's foreground is a worse bug than the one DD6 fixes. Both halves are
// pinned in automation-observe.test.js; do not "harmonize" them.
//
// evaluate / injectScript run the FINAL isInternalContents(wc) refusal — the load-bearing
// DD2-HIGH guard: admin's allowInternal:true makes resolveContents permissive, so without
// this op-local check admin could run arbitrary JS in goldfinch://settings and reach the
// privileged goldfinchInternal bridge. It now runs on the ONE resolved wc (there is no
// activate branch left in those two ops for it to sit after).
//
// Flight-9 devtools ops (openDevTools / closeDevTools): webContents.openDevTools({mode:'detach'})
// / webContents.closeDevTools() — synchronous/void → {"ok":true}. They are co-located here (NOT a
// new devtools.js) because they share the same resolve → FINAL isInternalContents refusal → act
// skeleton as the eval ops. They touch NO CDP / cdp.js: openDevTools is a webContents method; the
// CDP *client* it spawns is Chromium's own DevTools front-end (the source of leg-5's intended
// readAxTree/scroll attach-failed conflict — NOT a regression). NO foreground-to-act activation
// (DevTools attaches to the contents regardless of paint). The FINAL isInternalContents(wc) refusal
// fires EVEN for admin (allowInternal:true): opening DevTools establishes a full CDP client on the
// page, so DevTools on goldfinch://settings is a privilege-escalation surface onto the privileged
// goldfinchInternal bridge — the mission's debugger-attach-skip-internal hard rule. evaluate /
// injectScript keep working under DevTools (executeJavaScript, not the debugger).

// Default paint-settle delay (ms) after foregrounding a guest before capturePage().
// DD1's blank-capture is a compositor/visibility effect on an already-loaded guest, so the
// FIXED-DELAY branch is the primary path — there is no load event to await in the common
// case. The exact value (and whether any delay even helps) is a leg-time live check
// (flight Divert criterion), tuned in the Leg-5 smoke; this is a small conservative default.
const DEFAULT_PAINT_DELAY_MS = 80;

/**
 * M15 F3 L1 (DD1b) — read the sheet's current `{menuType, token}` for the RESOLVED wc, or
 * null. Module-private half of the snapshot/re-check pair below.
 *
 * The snapshot lives HERE, inside each admitted op after its FIRST resolveContents, and NOT
 * in engine.js's deps(): deps() is built with no wcId (the target is not known yet) and
 * sheetMenuFor is per-window-record, so a deps-time snapshot would compare window A's menu
 * against window B's sheet. Here, `wc` is in hand.
 *
 * Returns null for every ordinary tab/chrome target (no sheet matches) — which is exactly
 * why the comparison below must treat null → null as UNCHANGED.
 *
 * @param {any} wc  the resolved webContents
 * @param {{ sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null) }} deps
 * @returns {{ menuType: string, token: number } | null}
 */
function sheetMenuSnapshot(wc, deps) {
  return typeof deps.sheetMenuFor === 'function' ? (deps.sheetMenuFor(wc) || null) : null;
}

/**
 * M15 F3 L1 (DD1b) — the POST-AWAIT re-check every admitted sheet op runs, on the
 * main.js grabWindow TOCTOU idiom. `resolveContents` proved the gate at resolve time; the
 * menu can be closed or model-replaced during the op's async work, so the RESULT is
 * discarded unless the sheet's menu is byte-for-byte the same menu it was.
 *
 * Three deliberate properties:
 *   - null → null does NOT throw. The snapshot is `sheetMenuFor(wc)`, NOT "the window's
 *     current menu": for an ordinary tab both reads are null, and treating that as a
 *     mismatch would fail every tab captureScreenshot taken while a menu happened to open.
 *   - `token` is compared as well as `menuType`, so a close-and-reopen of the SAME
 *     allowlisted menu ALSO throws. That is deliberate and is the safe direction — the read
 *     spans two distinct menu sessions and nothing proves the second rendered before the
 *     read landed. Do not "fix" it to a menuType-only compare.
 *   - It applies UNCONDITIONALLY, including on readAxTree's `{automation:'debugger-unavailable'}`
 *     early return (cdp.js returns without attaching, so nothing was read; re-checking is
 *     harmless and simpler than a special case).
 *
 * @param {any} wc  the FINAL resolved webContents (post-re-resolve where an op re-resolves)
 * @param {{ sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null) }} deps
 * @param {{ menuType: string, token: number } | null} before  the first-resolve snapshot
 * @param {string} op  op name, for the thrown message
 * @throws {Error} `automation: sheet-menu-changed` when the menu moved under the op
 */
function assertSheetMenuStable(wc, deps, before, op) {
  const after = sheetMenuSnapshot(wc, deps);
  const same = before === null
    ? after === null
    : (after !== null && after.menuType === before.menuType && after.token === before.token);
  if (!same) {
    throw new Error(
      'automation: sheet-menu-changed — ' + op + ' result discarded: the overlay sheet\'s menu changed ' +
      'during the op (' + (before ? before.menuType + '#' + before.token : 'null') + ' → ' +
      (after ? after.menuType + '#' + after.token : 'null') + ')'
    );
  }
}

/**
 * Resolve a Promise after `ms` milliseconds. Module-private; the real waitForPaint default
 * uses it for the fixed-delay branch. Tests inject an immediate/no-op waitForPaint so no
 * real timer ever fires.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default paint-settle implementation. Injectable via deps.waitForPaint so unit tests run
 * without real timers and the Leg-5 smoke can sweep values without editing the module.
 *
 * The FIXED-DELAY branch is the LOAD-BEARING / primary path: the common screenshot case is
 * an already-loaded foreground guest, where DD1's blank capture is a compositor/visibility
 * effect (no load event to await). The `did-stop-loading` branch is ONLY the fallback for a
 * guest foregrounded mid-navigation (still loading).
 *
 * @param {any} wc  the (re-resolved) foreground guest webContents
 * @param {{ delayMs?: number }} [opts]
 * @returns {Promise<void>}
 */
function defaultWaitForPaint(wc, { delayMs = DEFAULT_PAINT_DELAY_MS } = {}) {
  if (typeof wc?.isLoading === 'function' && wc.isLoading()) {
    // Fallback: guest foregrounded mid-navigation — wait for the load to finish.
    return new Promise((resolve) => wc.once('did-stop-loading', () => resolve()));
  }
  // Primary path: already-loaded guest — fixed delay lets the compositor paint the
  // now-foreground guest before capture.
  return delay(delayMs);
}

/**
 * Foreground-first, base64-PNG screenshot of a target tab (DD1/DD5). Mirrors input.js
 * actOn: resolve → (guest) await activate → RE-RESOLVE (stale-handle guard) → wait for
 * paint settle → capture. Chrome is always live (no activate). Debugger-free.
 *
 * Resolve-before-activate means an internal-session / bad-handle / dead wcId throws via
 * resolveContents BEFORE activate or capturePage is reached (DD6 absolute exclusion).
 *
 * Signature mirrors readAxTree's already-safe (wcId, deps, opts) shape (DD7): caller-tunable
 * paint params (waitForPaint / delayMs) live in a SEPARATE 3rd `opts` arg so an over-supplied
 * opts key can never clobber the injected fromId / chromeContents / activate in the deps bag.
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 *   allowSheet?: boolean,
 *   sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null),
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — the accessor chrome webContents (injected; passed through to classify the result)
 *   activate — brings a guest to front before capture (DD5 foreground-to-act); absent for
 *              chrome-only callers
 *   allowInternal — admin's DD6 relaxation, forwarded to BOTH resolveContents calls
 * @param {{ waitForPaint?: (wc: any, opts?: { delayMs?: number }) => Promise<void>, delayMs?: number }} [opts]
 *   waitForPaint — paint-settle implementation (defaults to defaultWaitForPaint; injectable so
 *                  unit tests run without real timers)
 *   delayMs      — fixed paint-settle delay override (Leg-5 tuning)
 * @returns {Promise<string>} base64-encoded PNG
 */
async function captureScreenshot(wcId, deps, { waitForPaint = defaultWaitForPaint, delayMs } = {}) {
  const { chromeContents, isChromeContents, activate } = deps;
  // BOTH resolves forward the full deps so allowInternal flows on each (DD6 / Leg 2).
  let wc = resolveContents(wcId, deps);
  // M15 F3 L1 (DD1b): snapshot immediately after the FIRST resolve — where wc is in hand.
  const sheetMenu = sheetMenuSnapshot(wc, deps);
  if (classifyContents(wc, chromeContents, isChromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                                       // DD1/DD5 foreground-to-act (guest only)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and
    // re-resolving re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
    await waitForPaint(wc, { delayMs });                        // paint-settle after foregrounding
  }
  // F7 DD7 (recon S3): capturePage() is a Promise in Electron ^42 — and on a
  // DETACHED-but-live view it NEVER settles, wedging the request forever with no
  // server-side recovery. resolveContents proves this wc LIVE, never ATTACHED, so
  // every isDestroyed() guard above has already passed. Hard-refuse at the bound:
  // this capture IS the op's result, so there is nothing to degrade to.
  const image = await withCaptureTimeout(wc.capturePage(), 'wcId ' + wcId);
  // M15 F3 L1 (DD1b) post-await re-check: a capture that started under an allowlisted menu
  // and was model-replaced by e.g. vault-unlock mid-paint must not return those pixels.
  assertSheetMenuStable(wc, deps, sheetMenu, 'captureScreenshot');
  return image.toPNG().toString('base64');
}

// Single-round-trip DOM read snippet (DD4). One executeJavaScript IIFE returning the whole
// object so url / title / html are a CONSISTENT SNAPSHOT taken at one instant in the renderer
// (no interleaving with concurrent page mutation between separate reads). The
// `document.documentElement ? … : ""` guard handles the rare no-documentElement case (e.g. a
// non-HTML response) so the read resolves with an empty html string rather than throwing a
// renderer-side TypeError. Full outerHTML, no trimming (DD4).
const READ_DOM_SNIPPET = '(() => ({' +
  ' url: location.href,' +
  ' title: document.title,' +
  ' html: document.documentElement ? document.documentElement.outerHTML : "" ' +
  '}))()';

/**
 * Debugger-free read of a target tab's full-fidelity live DOM (DD2/DD4/DD5), taken WITHOUT
 * foregrounding it: resolve → read via wc.executeJavaScript. One resolve, no async hop.
 *
 * [M09 F7 DD6] THIS OP NO LONGER ACTIVATES ITS TARGET — a deliberate contract change, not
 * an omission. The predicate: an op that needs RENDERED OUTPUT raises the owning window; an
 * op that reads live JS/DOM state does not. executeJavaScript works fine on a background
 * guest (there are no pixels involved), and under N windows a read that steals the
 * operator's foreground is a worse bug than the cross-window no-op DD6 fixes. Contrast
 * captureScreenshot / readAxTree in this same module, which DO still activate — both sides
 * of that asymmetry are pinned in automation-observe.test.js so a future "restore symmetry"
 * refactor fails loudly. Side-effect DD6 records: the probe walk's foreground-first hazard
 * (a probe on a background tab activating it, closing the menu under audit) DISAPPEARS.
 *
 * An internal-session / bad-handle / dead wcId throws via resolveContents BEFORE
 * executeJavaScript is reached (DD6 absolute exclusion).
 *
 * The read is one round-trip (READ_DOM_SNIPPET) returning a consistent { url, title, html }
 * snapshot. `html` is the FULL document.documentElement.outerHTML — no trimming or length cap
 * (DD4); any projection/truncation is a later (Flight-9) concern layered on top.
 *
 * executeJavaScript is the established main→guest read path here (precedent: engine.js:35,
 * the dev-seam chrome-renderer read) — debugger-free (no single-client CDP conflict) and
 * CSP-safe for self-contained property-read expressions like these. (It is deliberately NOT
 * modeled on scripts/a11y-audit.mjs, which uses CDP Runtime.evaluate to bypass page CSP for
 * *library* injection — the opposite mechanism; see flight log DD2 correction.)
 *
 * Faithfulness note — web guests run contextIsolation:false (main.js:144 sets
 * webPreferences.contextIsolation = false for non-internal/web guest webviews; the internal
 * partition gets true). executeJavaScript evaluates in that same page MAIN WORLD, so the
 * returned outerHTML reflects the LIVE, preload-and-script-mutated DOM as rendered — not the
 * raw network response. This is the intended "what's actually live" faithfulness, not a defect.
 * (Farbling wraps fingerprinting APIs — script-observable values — not the static HTML, so it
 * generally does not rewrite outerHTML; the precise claim is "live mutated DOM".)
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   allowInternal?: boolean,
 *   allowSheet?: boolean,
 *   sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null),
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — the accessor chrome webContents (injected; passed through to classify the result)
 *   allowInternal — admin's DD6 relaxation, forwarded to resolveContents
 *   allowSheet / sheetMenuFor — M15 F3 L1 (DD1b): the op-half opt-in and the live menuType
 *   reader that together admit the menu-overlay sheet under an allowlisted menuType.
 *   NOTE: deps.activate is deliberately NOT read here (F7 DD6). A caller may still supply
 *   it — the engine's shared deps bag carries one for the ops that do raise — and this op
 *   ignores it. That is the contract, pinned by test.
 * @returns {Promise<{ url: string, title: string, html: string }>} a consistent live-DOM
 *   snapshot: location.href, document.title, and the full documentElement outerHTML.
 */
async function readDom(wcId, deps) {
  // ONE resolve, no async hop ⇒ no stale handle ⇒ no post-activate re-resolve (F7 DD6
  // deleted the activate branch; the re-resolve that guarded it would be dead code).
  const wc = resolveContents(wcId, deps);
  // M15 F3 L1 (DD1b): snapshot after the (only) resolve, re-check after the round trip.
  // readDom's executeJavaScript is a FULL main→renderer round trip, so what comes back is
  // whatever the renderer had rendered when the snippet ran — not what main believed at
  // resolve time. That is a wider exposure than the stale-handle concern the other two ops
  // guard, which is why this op carries the re-check too (operator ruling 2026-08-05).
  const sheetMenu = sheetMenuSnapshot(wc, deps);
  const snapshot = await wc.executeJavaScript(READ_DOM_SNIPPET);
  assertSheetMenuStable(wc, deps, sheetMenu, 'readDom');
  return snapshot;
}

/**
 * Whole-window (chrome + composited guests) capture (DD1). Its own export / dispatch key —
 * NOT a null-wcId overload of captureScreenshot. Takes no wcId and never activates.
 *
 * A nullish or null-returning grabWindow throws the EXISTING 'automation: chrome window unavailable'
 * message verbatim (the same string engine.js:34 throws for the same null-window condition —
 * reused, not a new variant). grabWindow is injected from main.js (Flight 3, Leg 1) and keeps
 * observe.js Electron-free.
 *
 * F7 DD3: threads an OPTIONAL windowId through to grabWindow (omitted → last-focused,
 * the pre-F7 behavior). The RETURN SHAPE IS UNCHANGED — a bare base64 string. It is
 * consumed POSITIONALLY by mcp-tools.js's imageResult (:87-89, declared shape: at
 * :416), so wrapping it to carry windowId would yield a MALFORMED IMAGE WITH NO
 * ERROR. enumerateWindows is the topology read; this op returns pixels.
 *
 * An unknown windowId is refused UPSTREAM with a named no-such-window (engine.js's
 * requireWindow), so a null from grabWindow here still means exactly what it always
 * meant — the capture itself failed — and keeps its verbatim message.
 *
 * @param {{ grabWindow: ((windowId?: number) => Promise<string|null>) | null }} deps
 * @param {{ windowId?: number }} [opts]
 * @returns {Promise<string>} base64-encoded PNG
 */
async function captureWindow({ grabWindow }, { windowId } = {}) {
  if (!grabWindow) throw new Error('automation: chrome window unavailable');
  const result = await grabWindow(windowId);
  if (!result) throw new Error('automation: chrome window unavailable');
  return result;
}

/**
 * Foreground-first read of a target tab's accessibility tree via the in-process
 * webContents.debugger (DD3). This is the ONLY webContents.debugger use in the engine: there is
 * no pure-JS path to the platform a11y tree. Sequence (mirrors readDom / captureScreenshot /
 * input.js actOn): resolve → (guest) await activate → RE-RESOLVE (stale-handle guard) → acquire
 * the synchronous single-client lock → attach('1.3') → Accessibility.enable →
 * Accessibility.getFullAXTree → detach() in a finally. Chrome targets never activate.
 *
 * Lifecycle safety (DD7): attach-on-demand, detach in a `finally` (the contents is NEVER left
 * attached, even on a sendCommand error), and a module-private synchronous `Set` lock keyed on the
 * stable wcId prevents a second concurrent attach on the same contents.
 *
 * The `{ depth, properties }` options are a DD4 Flight-9 extension stub: accepted in the signature,
 * UNIMPLEMENTED in v1 (ignored — `void`ed below), and NEVER a default that drops nodes. v1 always
 * returns the raw, complete node array.
 *
 * Return contract (DD4/DD8):
 *   - success → the RAW `nodes` array (no trimming), POSSIBLY EMPTY `[]` (a contents that has not
 *     rendered an AX tree yet). An empty array is a VALID SUCCESS, structurally distinct from the
 *     refusal object — callers discriminate via `Array.isArray(result)`.
 *   - lock already held, or attach() throws (another CDP client — DevTools or a second automation
 *     client — holds it) → RETURNS `{ automation: 'debugger-unavailable', reason, wcId }` (DD8 —
 *     an expected operational condition, a first-class result, NOT a thrown error).
 *   - bad-handle / dead / internal-session → THROWS via resolveContents before any activate / lock /
 *     attach (DD6 absolute exclusion — programmer/security errors, consistent with the module).
 *   - post-attach sendCommand failure (attach SUCCEEDED, then enable / getFullAXTree rejects) →
 *     PROPAGATES (it is NOT "debugger-unavailable" — the debugger WAS available); detach() still
 *     runs in the finally.
 *
 * Stale-handle caveat (DD4): the returned AXNodes are plain JSON-serializable objects, but
 * `backendNodeId` / `frameId` are CDP-session-scoped handles that go STALE on detach — informational
 * in the snapshot, not live references (action-linking is a Flight-3+ concern).
 *
 * LIVE-UNKNOWN (NOT asserted as live-correct here): whether `Accessibility.enable` must precede
 * `getFullAXTree`, and whether protocol `'1.3'` attaches on a GUEST webContents on Electron ^42, are
 * UNVERIFIED at unit-test time — the unit test fakes the CDP sequence. Live confirmation is the
 * Leg-5 smoke / Leg-6 HAT (flight Open Question + Divert criterion); do not read the unit assertions
 * as a guarantee of the live protocol.
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 *   allowSheet?: boolean,
 *   sheetMenuFor?: (wc: any) => ({ menuType: string, token: number } | null),
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — the accessor chrome webContents (injected; passed through to classify the result)
 *   activate — brings a guest to front before the read (DD5 foreground-to-act); absent for
 *              chrome-only callers
 *   allowInternal — admin's DD6 relaxation, forwarded to BOTH resolveContents calls
 * @param {{ depth?: number, properties?: string[] }} [opts]  DD4 Flight-9 stub — accepted, ignored in v1
 * @returns {Promise<Array<object> | { automation: 'debugger-unavailable', reason: string, wcId: number }>}
 */
async function readAxTree(wcId, deps, { depth, properties } = {}) {
  void depth; void properties;                  // DD4 Flight-9 stub — accepted, unimplemented in v1
  const { chromeContents, isChromeContents, activate } = deps;
  let wc = resolveContents(wcId, deps);   // throws bad/dead/internal (DD6); allowInternal forwarded
  // M15 F3 L1 (DD1b): snapshot immediately after the FIRST resolve.
  const sheetMenu = sheetMenuSnapshot(wc, deps);
  if (classifyContents(wc, chromeContents, isChromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                        // DD5 foreground-to-act (await BEFORE the lock)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and re-resolving
    // re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
  }
  // Delegate to shared CDP session helper (cdp.js): acquires the synchronous single-client lock
  // keyed on the STABLE wcId, attaches '1.3', runs the AX commands, detaches in a finally, and
  // releases the lock in a finally. Two concurrent calls on one wcId may both activate (idempotent
  // bring-to-front) but only one wins the synchronous lock add() — the other gets 'locked'.
  // NOTE: do NOT re-resolve between withDebuggerSession entry and its internal detach — the wc
  // captured here is the same handle used for attach and detach. This comment guards future edits.
  //
  // M15 F3 L1 (DD1b) — RESIDUAL STATE NOTE, named here so it is not rediscovered: the
  // callback calls `Accessibility.enable` with NO matching `disable`, so accessibility mode
  // persists on the sheet's shared, never-reloaded document across menu boundaries. That is
  // outside DD1a's retired "leaves nothing resident" rule (which was retired as a TEST, not as
  // a concern) and it is not a leak — no caller-supplied code and no readable state are left
  // behind — but it IS residual state left by an admitted op on the very surface DD1a is about.
  const result = await withDebuggerSession(wcId, wc, async (/** @type {any} */ w) => {
    await w.debugger.sendCommand('Accessibility.enable');
    const res = await w.debugger.sendCommand('Accessibility.getFullAXTree');
    return res && Array.isArray(res.nodes) ? res.nodes : [];          // empty = valid success (DD4)
  });
  // Post-await re-check AFTER withDebuggerSession returns (never between its entry and its
  // internal detach — see the no-re-resolve note above; `wc` is still the same handle).
  // Applies unconditionally, INCLUDING to the debugger-unavailable refusal: cdp.js returns
  // without attaching there, so nothing was read, and re-checking is simpler than a carve-out.
  assertSheetMenuStable(wc, deps, sheetMenu, 'readAxTree');
  return result;
}

/**
 * Evaluate an arbitrary expression in the target tab's MAIN WORLD via
 * wc.executeJavaScript (DD1/DD2 — ZERO CDP). Mirrors readDom: resolve → FINAL
 * isInternalContents refusal → wc.executeJavaScript(expression).
 *
 * [M09 F7 DD6] THIS OP NO LONGER ACTIVATES ITS TARGET — see readDom's note for the
 * predicate and the rationale. This is the op every probe walk and every cross-window
 * drive runs on, so the change is what retires the probe walk's foreground-first hazard
 * (scripts/a11y-audit.mjs:212-235 probes ids 1..64 with it; pre-F7 a probe landing on a
 * background TAB would activate it and close the menu under audit).
 *
 * executeJavaScript natively awaits a returned Promise, so an async expression
 * (e.g. `axe.run(document)`) resolves before its value crosses back. We `await`
 * the call so the RESOLVED value (never a Promise) reaches serialization.
 *
 * Return contract (DD2):
 *   - JSON-serializable value → returned verbatim (the MCP adapter JSON-texts it).
 *   - in-page throw (ReferenceError, page code throws) → PROPAGATES as an error
 *     (surfaces as isError at the adapter) — not swallowed.
 *   - non-JSON-serializable value (function, DOM node, circular object) → this op
 *     throws the EXACT DD2 message `automation: evaluate — return value is not
 *     JSON-serializable` BEFORE returning, so the consumer never sees a raw V8
 *     structured-clone / JSON.stringify message. We pre-flight JSON.stringify here
 *     rather than relying on the adapter's bare JSON.stringify (mcp-tools.js
 *     serialize), whose throw would surface as a raw message via errResult.
 *
 * [HIGH] DD2 internal-session exclusion EVEN FOR ADMIN: the isInternalContents
 * refusal is LOAD-BEARING and survives F7 DD6's removal of the activate branch — it
 * now simply runs on the ONE resolved wc. Admin builds the engine with
 * allowInternal:true, so resolveContents will NOT throw on an internal wcId — this
 * op-local check is the sole guard against arbitrary JS in goldfinch://settings
 * reaching the privileged goldfinchInternal bridge. Refuses regardless of
 * allowInternal. (Pinned by test: it did NOT go out with the activate branch.)
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   allowInternal?: boolean,
 * }} deps
 *   NOTE: deps.activate is deliberately NOT read here (F7 DD6) — see readDom.
 * @returns {Promise<any>} the JSON-serializable evaluated value
 */
async function evaluate(wcId, expression, deps) {
  // ONE resolve, no async hop (F7 DD6 deleted the activate branch — see readDom).
  const wc = resolveContents(wcId, deps);
  // [HIGH] DD2: internal-session exclusion EVEN FOR ADMIN. With the activate branch
  // gone this runs on the sole resolved wc — the guard itself is unchanged.
  if (isInternalContents(wc)) {
    throw new Error('automation: evaluate — internal-session excluded');
  }
  // executeJavaScript natively awaits a returned Promise; `await` here means the
  // RESOLVED value (never a Promise) reaches the serialization pre-flight.
  const value = await wc.executeJavaScript(expression);
  // Pre-flight serialization in the ENGINE OP (not the adapter): a non-serializable
  // return throws the EXACT DD2 message before returning, so the consumer never sees
  // a raw V8 message. A JSON-serializable value passes through unchanged.
  try {
    JSON.stringify(value);
  } catch {
    throw new Error('automation: evaluate — return value is not JSON-serializable');
  }
  return value;
}

/**
 * Inject a script into the target tab's MAIN WORLD via wc.executeJavaScript
 * (DD1/DD2 — ZERO CDP). VOID contract: it defines globals / patches prototypes
 * (e.g. the axe-core source, a farbling hook) and returns `undefined` → the MCP
 * adapter serializes that to the one success shape `{"ok":true}`.
 *
 * No foreground-to-act activation (DD2 — intentional, pinned by a unit test):
 * injectScript SKIPS it. Defining a global / patching a prototype does not need a
 * paint, so there is NO activate call here — resolve → FINAL isInternalContents
 * refusal → executeJavaScript.
 *
 * [M09 F7 DD6] This is NO LONGER an asymmetry vs evaluate. The old text here read
 * "evaluate keeps foreground-to-act for parity with reads" — DD6 deleted evaluate's
 * activate branch (see evaluate/readDom above), so the two ops now agree: neither
 * activates. The DD2 asymmetry this note documented is gone; what remains is a
 * shared no-activate contract for the JS-state ops.
 *
 * NO persistence guarantee: window globals defined here are NOT promised to survive
 * across a later evaluate gap (a navigation clears them). The a11y driver (leg 3)
 * pairs injectScript immediately with one evaluate — the tool makes no implicit
 * persistence assumption.
 *
 * [HIGH] DD2 internal-session exclusion EVEN FOR ADMIN: same load-bearing guard as
 * evaluate — isInternalContents(wc) refuses BEFORE any executeJavaScript, regardless
 * of allowInternal. In-page throws propagate as errors (surface as isError).
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   allowInternal?: boolean,
 * }} deps
 * @returns {Promise<void>}
 */
async function injectScript(wcId, script, deps) {
  const wc = resolveContents(wcId, deps);
  // NO activate (DD2): injectScript skips foreground-to-act — it defines globals /
  // patches prototypes and needs no paint. The internal-session refusal still runs
  // on this resolved wc (no activate branch to re-resolve through).
  if (isInternalContents(wc)) {
    throw new Error('automation: injectScript — internal-session excluded');
  }
  await wc.executeJavaScript(script);          // void contract → returns undefined
}

/**
 * Open the DevTools front-end (detached OS window) on the target tab via
 * wc.openDevTools({ mode: 'detach' }) (Flight-9 — ZERO CDP from this op; the CDP
 * *client* is Chromium's own DevTools front-end, which is the whole point of the
 * leg-5 conflict). VOID contract: returns `undefined` → the MCP adapter serializes
 * that to the one success shape `{"ok":true}`.
 *
 * Sequence: resolve → FINAL isInternalContents refusal → wc.openDevTools({mode:'detach'}).
 * NO foreground-to-act activation: DevTools attaches to the contents regardless of paint,
 * so there is no activate branch (and thus no re-resolve) — the refusal runs on the
 * resolved wc.
 *
 * `{ mode: 'detach' }` opens a separate OS window (preferred under WSLg over the default
 * docked mode — less compositor interference, more predictable).
 *
 * [HIGH] internal-session exclusion EVEN FOR ADMIN: admin builds deps with
 * allowInternal:true, so resolveContents will NOT throw on an internal wcId — this
 * op-local isInternalContents check is the SOLE guard. Opening DevTools establishes a
 * full CDP client on the page (functionally a debugger attach); the mission rule forbids
 * a debugger client on the internal goldfinch://settings session (privilege escalation
 * onto the goldfinchInternal bridge). Refuses regardless of allowInternal.
 *
 * Capability distinction (leg-5 recorded finding): once DevTools is open, a concurrent
 * readAxTree/scroll (which attach the in-process debugger) surfaces `attach-failed`
 * (expected); evaluate/injectScript (executeJavaScript, not the debugger) keep working.
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   allowInternal?: boolean,
 * }} deps
 * @returns {Promise<void>}
 */
async function openDevTools(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  // NO activate (DevTools attaches regardless of paint). The internal-session refusal
  // runs on this resolved wc — fires even for admin (allowInternal:true).
  if (isInternalContents(wc)) {
    throw new Error('automation: openDevTools — internal-session excluded');
  }
  setDevTools(wc, true);                         // shared helper: wc.openDevTools({mode:'detach'}); void contract → undefined
}

/**
 * Close the DevTools front-end on the target tab via wc.closeDevTools(). VOID contract:
 * returns `undefined` → `{"ok":true}`. IDEMPOTENT — closeDevTools() on a contents whose
 * DevTools is not open is a no-op in Electron (does not throw), so there is no special
 * error path: the op contract is the same whether or not DevTools was open.
 *
 * Sequence mirrors openDevTools: resolve → FINAL isInternalContents refusal → wc.closeDevTools().
 * NO foreground-to-act activation.
 *
 * [HIGH] internal-session exclusion EVEN FOR ADMIN: same load-bearing guard as openDevTools —
 * isInternalContents(wc) refuses before any closeDevTools, regardless of allowInternal.
 *
 * @param {number} wcId
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   isChromeContents?: (wc: any) => boolean,
 *   allowInternal?: boolean,
 * }} deps
 * @returns {Promise<void>}
 */
async function closeDevTools(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: closeDevTools — internal-session excluded');
  }
  setDevTools(wc, false);                        // shared helper: wc.closeDevTools(); idempotent no-op when not open; void contract
}

module.exports = { captureScreenshot, readDom, captureWindow, readAxTree, evaluate, injectScript, openDevTools, closeDevTools };
