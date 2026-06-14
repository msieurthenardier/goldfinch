// @ts-check
'use strict';
const { resolveContents, classifyContents } = require('./resolve');
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
// webContents.debugger lives ONLY in this module's readAxTree (DD3): there is no pure-JS
// path to the platform accessibility tree, so the a11y read attaches the in-process CDP
// debugger on demand, detaches in a finally, holds a synchronous single-client lock, and
// returns a clean debugger-unavailable refusal when the contents is already held
// (attach-on-demand / detach-in-finally / single-client lock / clean refusal —
// DD3/DD7/DD8/DD9). Every OTHER op in this module (captureScreenshot / captureWindow /
// readDom) and every OTHER automation module (resolve.js / input.js) stays debugger-free.
// Leg 4 (wire-and-docs) adds the dispatch keys to engine.js (no engine.js edit here).

// Single-client lock (DD7): wcIds with an in-flight debugger attach. The has()/add() pair is
// synchronous (no await between) so concurrent readAxTree calls on the same contents are race-safe.
const attached = new Set();

/**
 * Build the discriminated debugger-unavailable refusal object (DD8). Returned (NOT thrown) by
 * readAxTree when the contents is already held — either the in-engine lock (`reason: 'locked'`)
 * or a real attach failure (`reason: 'attach-failed'`, another CDP client holds it). Structurally
 * distinct from a success (which is an Array of AXNodes) — callers discriminate via Array.isArray.
 *
 * @param {number} wcId
 * @param {'locked' | 'attach-failed'} reason
 * @returns {{ automation: 'debugger-unavailable', reason: string, wcId: number }}
 */
const debuggerUnavailable = (wcId, reason) =>
  ({ automation: 'debugger-unavailable', reason, wcId });

// Default paint-settle delay (ms) after foregrounding a guest before capturePage().
// DD1's blank-capture is a compositor/visibility effect on an already-loaded guest, so the
// FIXED-DELAY branch is the primary path — there is no load event to await in the common
// case. The exact value (and whether any delay even helps) is a leg-time live check
// (flight Divert criterion), tuned in the Leg-5 smoke; this is a small conservative default.
const DEFAULT_PAINT_DELAY_MS = 80;

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
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — mainWindow.webContents (injected; passed through to classify the result)
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
  const { chromeContents, activate } = deps;
  // BOTH resolves forward the full deps so allowInternal flows on each (DD6 / Leg 2).
  let wc = resolveContents(wcId, deps);
  if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                                       // DD1/DD5 foreground-to-act (guest only)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and
    // re-resolving re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
    await waitForPaint(wc, { delayMs });                        // paint-settle after foregrounding
  }
  const image = await wc.capturePage();                         // capturePage() is a Promise in Electron ^42
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
 * Foreground-first, debugger-free read of a target tab's full-fidelity live DOM (DD2/DD4/DD5).
 * Mirrors captureScreenshot / input.js actOn: resolve → (guest) await activate → RE-RESOLVE
 * (stale-handle guard) → read via wc.executeJavaScript. Chrome is always live (no activate).
 *
 * Resolve-before-activate means an internal-session / bad-handle / dead wcId throws via
 * resolveContents BEFORE activate or executeJavaScript is reached — on the internal-session
 * path NEITHER activate NOR executeJavaScript runs (DD6 absolute exclusion).
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
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — mainWindow.webContents (injected; passed through to classify the result)
 *   activate — brings a guest to front before the read (DD5 foreground-to-act); absent for
 *              chrome-only callers, in which case a guest is read without foregrounding
 *   allowInternal — admin's DD6 relaxation, forwarded to BOTH resolveContents calls
 * @returns {Promise<{ url: string, title: string, html: string }>} a consistent live-DOM
 *   snapshot: location.href, document.title, and the full documentElement outerHTML.
 */
async function readDom(wcId, deps) {
  const { chromeContents, activate } = deps;
  let wc = resolveContents(wcId, deps);
  if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                                       // DD5 foreground-to-act (guest only)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and
    // re-resolving re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
  }
  return wc.executeJavaScript(READ_DOM_SNIPPET);
}

/**
 * Whole-window (chrome + composited guests) capture (DD1). Its own export / dispatch key —
 * NOT a null-wcId overload of captureScreenshot. Takes no wcId and never activates.
 *
 * A nullish chromeContents throws the EXISTING 'automation: chrome window unavailable'
 * message verbatim (the same string engine.js:34 throws for the same null-window condition —
 * reused, not a new variant).
 *
 * @param {{ chromeContents: any }} deps
 * @returns {Promise<string>} base64-encoded PNG
 */
async function captureWindow({ chromeContents }) {
  if (!chromeContents) throw new Error('automation: chrome window unavailable');
  const image = await chromeContents.capturePage();
  return image.toPNG().toString('base64');
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
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 * }} deps
 *   fromId   — webContents.fromId at the call site (injected)
 *   chromeContents — mainWindow.webContents (injected; passed through to classify the result)
 *   activate — brings a guest to front before the read (DD5 foreground-to-act); absent for
 *              chrome-only callers
 *   allowInternal — admin's DD6 relaxation, forwarded to BOTH resolveContents calls
 * @param {{ depth?: number, properties?: string[] }} [opts]  DD4 Flight-9 stub — accepted, ignored in v1
 * @returns {Promise<Array<object> | { automation: 'debugger-unavailable', reason: string, wcId: number }>}
 */
async function readAxTree(wcId, deps, { depth, properties } = {}) {
  void depth; void properties;                  // DD4 Flight-9 stub — accepted, unimplemented in v1
  const { chromeContents, activate } = deps;
  let wc = resolveContents(wcId, deps);   // throws bad/dead/internal (DD6); allowInternal forwarded
  if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                        // DD5 foreground-to-act (await BEFORE the lock)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and re-resolving
    // re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
  }
  // Single-client lock (DD7) — keyed on the STABLE wcId, not the per-resolve `wc` handle, so it
  // correctly spans the re-resolve above. The has() check and add() are synchronous with NO await
  // between them; the only awaits are AFTER the add (the sendCommands). Two concurrent calls on one
  // wcId may both activate (idempotent bring-to-front) but only one wins the synchronous add().
  if (attached.has(wcId)) return debuggerUnavailable(wcId, 'locked');  // sync check…
  attached.add(wcId);                                                  // …+ add (no await between)
  try {
    try {
      wc.debugger.attach('1.3');
    } catch {
      return debuggerUnavailable(wcId, 'attach-failed');   // another client holds it (DD8)
    }
    try {
      // NOTE: do NOT re-resolve between attach and detach — the finally detach below must run on
      // the SAME `wc` that was attached (it does, as written; this comment guards future edits).
      await wc.debugger.sendCommand('Accessibility.enable');
      const res = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
      return res && Array.isArray(res.nodes) ? res.nodes : [];        // empty = valid success (DD4)
    } finally {
      try { wc.debugger.detach(); } catch { /* already detached — don't mask the outcome */ }
    }
  } finally {
    attached.delete(wcId);                       // release the lock (DD7) — even on attach-throw
  }
}

module.exports = { captureScreenshot, readDom, captureWindow, readAxTree };
