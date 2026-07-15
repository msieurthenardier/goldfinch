// @ts-check
'use strict';

// Automation engine — the jar-scoping FAÇADE (Leg 2, DD4/DD6/DD7).
//
// scopeEngine wraps a live engine so a request's resolved IDENTITY confines what
// it can see and drive:
//   - admin  → the engine is returned UNCHANGED. The admin engine is built with
//              { allowInternal: true }, so it already enumerates every jar's guest
//              tabs + the internal goldfinch://settings tab, drives/observes any of
//              them, and allows captureWindow and getChromeTarget. No jar filtering.
//              (Flight-6: the chrome renderer is now discoverable via getChromeTarget
//              — admin-only, via this façade gate. See flight log FD scope decision.)
//   - jar    → a façade that, on every wcId-first op, FIRST verifies jar
//              membership by SESSION OBJECT IDENTITY (resolveContentsForJar /
//              DD7) before delegating to the engine op. enumerateTabs is filtered
//              by resolved session (never the renderer-reported jarId).
//              captureWindow is REFUSED with a DISTINCT admin-only error. openTab
//              is jar-targeted (DD3, Flight 6): the façade forces the caller's own
//              jar.id, refuses a foreign jarId (out-of-jar), and delegates to the
//              engine. Admin openTab passes any jarId straight through to the renderer
//              container-lookup, which refuses unknown jarIds (unknown-jar). getHistory
//              is jar-CONFINED (Mission 08 Flight 5, DD1) — the first jar-confined
//              no-wcId read: a jar key reads only its OWN jar's history (a supplied
//              jarId must match, or be absent → defaulted to own jar); a foreign
//              jarId is refused (out-of-jar), thrown BEFORE any engine call. Admin
//              (engine unchanged) may name any KNOWN jar.
//
// ELECTRON-FREE: every Electron handle (fromId, fromPartition, getChromeContents,
// jars) is injected via ctx, so this module unit-tests offline with fakes.
//
// SHARED fromId / fromPartition: ctx.fromId and ctx.fromPartition MUST be the
// SAME handles the engine uses (main.js injects one fromId / one
// session.fromPartition into both the engine and this ctx). Otherwise a
// membership check could pass while the engine op resolves a DIFFERENT contents.

const { resolveContentsForJar } = require('./resolve');

// The wcId-first ops a jar key may invoke: membership needs only the first arg
// (wcId). enumerateTabs (filter), captureWindow (refuse), and openTab (delegate)
// are special-cased OUTSIDE this set.
//
// THREE-PLACE REGISTRATION: any new guest-targeting (wcId-first) automation op must
// be registered in THREE places — engine.js (dispatch), mcp-tools.js (ToolDef), and
// HERE (WCID_FIRST_OPS) — plus an op-local isInternalContents guard if it can touch
// internal pages. Miss this list and jar keys throw "engine.<op> is not a function"
// (the leg-05 SC8 gap). The automation-scope.test.js three-place-registration guard
// enforces the WCID_FIRST_OPS half by cross-checking against the MCP tool registry.
const WCID_FIRST_OPS = [
  'closeTab', 'activateTab',
  'navigate', 'goBack', 'goForward', 'reload',
  'click', 'typeText', 'scroll', 'pressKey',
  'captureScreenshot', 'readDom', 'readAxTree',
  'evaluate', 'injectScript',
  // DevTools ops (Flight 9): wcId-first, jar-membership-checked. DevTools on a jar's own
  // guest is within the jar key's authority — NOT admin-only (unlike captureWindow /
  // getChromeTarget). The internal-session exclusion is enforced op-locally even for admin.
  'openDevTools', 'closeDevTools',
  // Zoom & print (Flight 1): wcId-first, jar-membership-checked. A jar key may
  // zoom/print its OWN guests; resolveContentsForJar refuses out-of-jar/internal/chrome.
  // The op-local internal guard in zoom.js/print.js additionally covers the admin path.
  'getZoom', 'setZoom', 'printToPDF',
  // Find in page (Flight 2 / Mission 4): wcId-first, jar-membership-checked. A jar key
  // may find in its OWN guests. The op-local internal guard in find.js covers admin.
  'findInPage', 'stopFindInPage',
  // Pointer drag (M09 F2 Leg 2, DD4): wcId-first, jar-membership-checked like click. A
  // jar key may drag within its OWN guest's viewport; admin may drag the chrome (tab
  // reorder). No new trust surface — same tier as click.
  'dragPointer',
];

/**
 * Scope an engine to a resolved identity.
 *
 * @param {{ [op: string]: (...args: any[]) => any }} engine  the live engine
 * @param {string} identity  'admin' or a jarId
 * @param {{
 *   jars: { list: () => Array<{ id: string, partition: string }> },
 *   fromId: (id: number) => any,
 *   fromPartition: (partition: string) => any,
 *   getChromeContents: () => any,
 *   isChromeContents?: (wc: any) => boolean,
 * }} ctx
 * @returns {{ [op: string]: (...args: any[]) => any }}
 */
function scopeEngine(engine, identity, ctx) {
  // Admin bypasses jar-scoping entirely — the engine is already allowInternal.
  if (identity === 'admin') return engine;

  const { jars, fromId, fromPartition, getChromeContents, isChromeContents } = ctx;

  // Resolve the jar LAZILY each call would be ideal for runtime jars-add, but
  // the jar's existence is fixed for a session's lifetime against jars.list().
  // Re-resolve per call so a jar DELETED mid-session degrades to all-ops-error,
  // and a jar ADDED mid-session (not this identity) is irrelevant. The membership
  // compare inside resolveContentsForJar is itself lazy (fromPartition fresh).
  const findJar = () => jars.list().find((j) => j.id === identity);

  // If the jar is absent right now (revoked/unknown/deleted), every op errors.
  // We still build the façade dynamically so a jar re-added later (same id) would
  // resolve — but in practice a revoked key is also 401'd at the gate, so this is
  // belt-and-suspenders for the jar-deleted-but-key-valid edge.
  /**
   * Resolve the jar or throw a no-such-jar error (used by every op).
   * @returns {{ id: string, partition: string }}
   */
  const requireJar = () => {
    const jar = findJar();
    if (!jar) {
      throw new Error('automation: no-such-jar — jar ' + identity + ' is not present (revoked or deleted)');
    }
    return jar;
  };

  /**
   * Build the per-op membership deps freshly each call: getChromeContents() is
   * read live (a recreated/closed window is picked up), and fromId/fromPartition
   * are the shared handles. allowInternal stays false — a jar key never reaches
   * the internal session.
   */
  const memberDeps = () => ({
    fromId,
    chromeContents: getChromeContents(),
    fromPartition,
    // M09 F6 (DD8 / review L5): the chrome-exclusion compare widens to "is any
    // registered chrome" — window 2's chrome is equally out of a jar key's reach.
    ...(typeof isChromeContents === 'function' ? { isChromeContents } : {}),
  });

  /** @type {{ [op: string]: (...args: any[]) => any }} */
  const facade = {};

  // Generic wrapper over the wcId-first ops: resolveContentsForJar FIRST (throws
  // out-of-jar / bad / dead / internal), then delegate to the engine op verbatim.
  // The membership check needs only the first arg; ...rest is forwarded untouched.
  for (const op of WCID_FIRST_OPS) {
    facade[op] = (/** @type {number} */ wcId, /** @type {any[]} */ ...rest) => {
      const jar = requireJar();
      resolveContentsForJar(wcId, jar, memberDeps()); // throws on out-of-jar / bad / dead / internal
      return engine[op](wcId, ...rest);
    };
  }

  // enumerateTabs → filter the engine's enumeration to THIS jar's tabs, by
  // RESOLVED SESSION (never the renderer-reported t.jarId). A tab whose session
  // matches no persistent jar (burner) is dropped; a tab whose renderer jarId
  // disagrees with its session is scoped by the session.
  facade.enumerateTabs = async () => {
    const jar = requireJar();
    const tabs = await engine.enumerateTabs();
    const jarSession = fromPartition(jar.partition);
    return tabs.filter((t) => {
      let wc;
      try { wc = fromId(t.wcId); } catch { return false; }
      return !!wc && wc.session === jarSession;
    });
  };

  // captureWindow → REFUSED for jar keys with a DISTINCT admin-only message (NOT
  // out-of-jar), so the audit log / behavior test can tell "targeted another
  // jar's tab" apart from "this op is admin-only".
  facade.captureWindow = () => {
    requireJar(); // an unknown jar still errors here (no-such-jar) before admin-only
    throw new Error('automation: admin-only — captureWindow (whole-window capture) is restricted to the admin identity');
  };

  // openTab → jar-targeted (DD3, Flight 6). A jar key may only open in ITS OWN jar:
  // a supplied jarId must match this identity (or be absent → defaulted to own jar);
  // a foreign jarId is refused. Admin (engine unchanged) may target any jar.
  facade.openTab = (/** @type {string} */ url, /** @type {string|undefined} */ jarId) => {
    const jar = requireJar();
    if (jarId != null && jarId !== jar.id) {
      throw new Error('automation: out-of-jar — a jar key may only open tabs in its own jar (' + jar.id + ')');
    }
    return engine.openTab(url, jar.id);   // force the caller's own jar
  };

  // getChromeTarget → REFUSED for jar keys with a DISTINCT admin-only message (mirrors
  // captureWindow). The chrome shell is reachable only by the admin identity; defense-in-depth
  // is the resolveContentsForJar chrome-exclusion for any wcId-first op (DD1, Flight 6).
  facade.getChromeTarget = () => {
    requireJar(); // unknown jar errors no-such-jar first, mirroring captureWindow
    throw new Error('automation: admin-only — getChromeTarget (chrome renderer discovery) is restricted to the admin identity');
  };

  // enumerateWindows → REFUSED for jar keys (admin-only, app-level — mirrors
  // getChromeTarget/captureWindow/downloadsList). WINDOW TOPOLOGY IS ADMIN (F7 DD2):
  // the census names windows a jar identity may hold no tabs in at all, which is the
  // getDownloadsList doctrine exactly — "an app-level cross-jar view is an admin
  // capability … new tools must not widen the surface's reach" (DD6). Contrast with
  // enumerateTabs, which stays jar-CONFINED by resolved session: a jar key now sees
  // all WINDOWS' tabs for ITS OWN jar (DD1's intent), but never the window list.
  facade.enumerateWindows = () => {
    requireJar(); // unknown jar errors no-such-jar first, mirroring captureWindow/getChromeTarget
    throw new Error('automation: admin-only — enumerateWindows (window topology discovery) is restricted to the admin identity');
  };

  // downloadsList → REFUSED for jar keys (admin-only, app-level — mirrors getChromeTarget/captureWindow).
  // An app-level cross-jar view is an admin capability; a jar key must not learn what other jars
  // downloaded ("new tools must not widen the surface's reach", DD6). Explicit block, NOT a WCID_FIRST_OPS
  // omission — the latter throws the opaque "engine.getDownloadsList is not a function" (the scope.js:38 gap).
  facade.getDownloadsList = () => {
    requireJar(); // unknown jar errors no-such-jar first, mirroring captureWindow/getChromeTarget
    throw new Error('automation: admin-only — downloadsList (app-level downloads view) is restricted to the admin identity');
  };

  // getHistory → jar-CONFINED custom op (Mission 08 Flight 5, DD1/DD4) — the FIRST
  // jar-confined no-wcId read: contrast with captureWindow/getChromeTarget/
  // getDownloadsList above, which are admin-only refusals. A jar key may read its
  // OWN jar's history: a supplied jarId must match this identity (or be absent →
  // defaulted to own jar); a foreign jarId is refused with out-of-jar, thrown
  // BEFORE any engine/accessor call (zero accessor invocations on refusal — pinned
  // by the unit test). Admin (engine unchanged, above) may target any KNOWN jar; a
  // missing or unknown jarId is validated engine-side (bad-args / unknown-jar),
  // since admin has no implicit jar.
  facade.getHistory = (/** @type {string|undefined} */ jarId, /** @type {any} */ opts) => {
    const jar = requireJar();
    if (jarId != null && jarId !== jar.id) {
      throw new Error('automation: out-of-jar — a jar key may only read history for its own jar (' + jar.id + ')');
    }
    return engine.getHistory(jar.id, opts);
  };

  return facade;
}

module.exports = { scopeEngine, WCID_FIRST_OPS };
