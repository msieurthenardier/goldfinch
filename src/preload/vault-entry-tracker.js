'use strict';

const { VAULT_ENTRY_OBSERVER_HANDLE } = require('./vault-entry-observer-handle');

// Main-world POLICY module for the entry tracker (Mission 21, Flight 1, Leg 3 —
// entry-tracker, DD3g/DD3h). Per DD3g: "The main-world module does policy —
// gesture gating, snapshot timing, DD3c's save-vs-update rule, and the hop to
// main." This leg builds and wires the OBSERVATION side only (the flight's own
// Objective) — the gesture, the snapshot trigger, offer-on-settle, and DD3c's
// save-vs-update rule are all Leg 5 (`broadened-capture`). What THIS module owns
// today is narrower: the isolated-world INSTALL lifecycle (fail-closed + a
// one-time diagnostic, DD3h), and routing Goldfinch's own fills into that world
// so fill-and-grant happen in ONE realm (DD3h) — no main-world node reference
// ever needs to identify which field to credit, which is exactly the crossing
// DD3g proved impossible.
//
// Electron-free / injected-deps, the house pattern for main-side logic that must
// stay `require()`-able under `node --test`: `execInWorld` wraps
// webFrame.executeJavaScriptInIsolatedWorld (or a test double) so nothing here
// touches `require('electron')` directly.
//
// Also carries the SHARED entry-resolution walk (`resolveTargetForAnchor`) that
// used to live only inline inside vault-fill-icon.js's `targetForAnchor` — per
// DD3g's "same pure module, two execution contexts, different trust levels": the
// chrome icon's decorative placement still resolves in the MAIN world (it needs a
// main-world node to position against), while capture resolution moves into the
// isolated world (elsewhere). This is the one shared implementation both
// call sites should use, rather than a second hand-copied walk.

/**
 * The entry (`{ username, password }` for a login, or the card role map for a
 * card) that `anchor` belongs to, and the KIND of that entry. This is the exact
 * walk `vault-fill-icon.js`'s `targetForAnchor` performed inline before this leg
 * — moved here so it has exactly one implementation, consumed as an OPTIONAL,
 * injected dep by the icon controller (which keeps its own identical fallback
 * copy so every pre-existing call site, none of which inject this, is
 * unaffected — see vault-fill-icon.js).
 *
 * The card anchor set mirrors vault-fill-icon.js's own `cardAnchorsOf`: the
 * split `expMonth` / `expYear` selects are deliberately never anchors (an
 * overlaid icon fights the native dropdown affordance) — this is icon-placement
 * business logic threaded through here only because the walk itself is shared,
 * not because this module owns icon policy.
 *
 * @param {any} doc
 * @param {any} anchor
 * @param {object} finders
 * @param {(doc: any) => Array<{username: any, password: any, form: any}>} finders.findAllLoginFields
 * @param {(doc: any) => Array<{number: any, cardholder: any, expiry: any, csc: any, form: any}>} [finders.findAllCardFields]
 * @returns {{ kind: 'login'|'card', field: any } | null}
 */
function resolveTargetForAnchor(doc, anchor, { findAllLoginFields, findAllCardFields }) {
  if (!anchor) return null;
  const logins = typeof findAllLoginFields === 'function' ? findAllLoginFields(doc) : [];
  for (const entry of logins) {
    if (entry.password === anchor || entry.username === anchor) {
      return entry.password ? { kind: 'login', field: entry.password } : null;
    }
  }
  const cards = typeof findAllCardFields === 'function' ? findAllCardFields(doc) : [];
  for (const entry of cards) {
    for (const role of ['number', 'cardholder', 'expiry', 'csc']) {
      if (entry[role] && entry[role] === anchor) {
        return entry.number ? { kind: 'card', field: entry.number } : null;
      }
    }
  }
  return null;
}

/**
 * @param {object} deps
 * @param {(script: string) => Promise<any>} deps.execInWorld  runs a script in
 *   the isolated world and resolves with its completion value (the injected
 *   wrapper around webFrame.executeJavaScriptInIsolatedWorld — a genuine
 *   Promise, never assumed to resolve synchronously; DD3f). A throw inside the
 *   script resolves `undefined` rather than rejecting (DD3h) — this module never
 *   distinguishes a rejection from an unshaped resolve; both are treated as
 *   install/fill failure.
 * @param {string} deps.installScript  the build-time-generated, self-contained
 *   install script text (scripts/build-preload.mjs's observer esbuild target,
 *   bundling vault-entry-observer.js + the two pure field modules).
 * @param {(message: string) => void} [deps.warn]  called AT MOST ONCE, the first
 *   time install fails — "fail closed and NOT silent" (DD3h): a systemic,
 *   indefinite outage of the whole feature must be diagnosable, not discovered
 *   months later.
 */
function createEntryTracker({ execInWorld, installScript, warn }) {
  /** @type {'pending' | 'installed' | 'failed'} */
  let installState = 'pending';
  let warned = false;
  /** @type {Promise<boolean> | null} */
  let installing = null;

  function warnOnce(message) {
    if (warned) return;
    warned = true;
    if (typeof warn === 'function') warn(message);
  }

  /**
   * Install success is asserted on the RESOLVED VALUE's shape, never on the
   * absence of a rejection (DD3h) — a throw inside the isolated-world script
   * resolves `undefined`, so a broken injection would otherwise install nothing,
   * silently, forever. One attempt per tracker lifetime (a fresh navigation gets
   * a fresh tracker instance, so this is not an indefinite retry-never policy —
   * it is "don't hammer a world that has already demonstrated it won't install").
   */
  function ensureInstalled() {
    if (installState === 'installed') return Promise.resolve(true);
    if (installState === 'failed') return Promise.resolve(false);
    if (installing) return installing;
    installing = (async () => {
      let result;
      try {
        result = await execInWorld(installScript);
      } catch {
        result = undefined; // a rejection is treated identically to an unshaped resolve
      }
      const ok = !!result && result.installed === true;
      installState = ok ? 'installed' : 'failed';
      if (!ok) {
        warnOnce(
          'vault-entry-tracker: isolated-world observer failed to install; entries will be reported unprovenanced'
        );
      }
      return ok;
    })();
    return installing;
  }

  /**
   * `argValue` must already be a plain, JSON-safe value — this module does not
   * sanitize a credential/card shape itself (the caller, webview-preload.js,
   * builds it from the exact IPC payload it already trusted before this leg).
   */
  function callScript(methodName, argValue) {
    const handle = JSON.stringify(VAULT_ENTRY_OBSERVER_HANDLE);
    const payload = JSON.stringify(argValue === undefined ? null : argValue);
    return (
      '(function () {\n' +
      '  try {\n' +
      `    var h = window[${handle}];\n` +
      '    if (!h) return { filled: false };\n' +
      `    var r = h.${methodName}(${payload});\n` +
      '    return (r && typeof r === "object") ? r : { filled: false };\n' +
      '  } catch (err) {\n' +
      '    return { filled: false };\n' +
      '  }\n' +
      '})();\n'
    );
  }

  async function runFill(methodName, argValue) {
    const ok = await ensureInstalled();
    if (!ok) return { filled: false };
    let result;
    try {
      result = await execInWorld(callScript(methodName, argValue));
    } catch {
      result = undefined;
    }
    return result && typeof result === 'object' && result.filled === true ? { filled: true } : { filled: false };
  }

  const EMPTY_SNAPSHOT = Object.freeze({ logins: [], cards: [] });

  /**
   * The GESTURE-TIME read (Leg 5, DD3f corrected at design review): called by
   * `webview-preload.js`'s main-world gesture trigger in direct response to a
   * qualifying trusted click/Enter — a SAME-PROCESS `execInWorld` call, issued
   * WHILE the current document (and its isolated world / provenance map) is
   * still alive. Never called at settle — by the time settle fires (a
   * navigation commit), the old document's isolated world is already gone; the
   * caller is expected to HOLD this result, not re-request it later.
   * Fail-closed: an uninstalled/failed observer, a rejection, or an unshaped
   * resolve all yield the same empty three-state-shape default — never a
   * throw, and never treated as "nothing detected" being conflated with "the
   * read failed" at the call site's own layer (both simply produce no
   * provenanced secret to hold).
   * @returns {Promise<{ logins: any[], cards: any[] }>}
   */
  async function readSnapshot() {
    const ok = await ensureInstalled();
    if (!ok) return EMPTY_SNAPSHOT;
    let result;
    try {
      result = await execInWorld(callScript('snapshot', null));
    } catch {
      result = undefined;
    }
    if (!result || typeof result !== 'object' || !Array.isArray(result.logins) || !Array.isArray(result.cards)) {
      return EMPTY_SNAPSHOT;
    }
    return result;
  }

  return {
    ensureInstalled,
    // Fills execute IN THE ISOLATED WORLD (DD3h) — fillLogin/fillCard here are
    // thin routers, never main-world callers of fillLoginForm/fillCardForm
    // themselves. The credential/card value crosses INTO the isolated world (as
    // a JSON literal embedded in the script text, same trust level as the
    // existing 'vault-fill'/'vault-fill-card' IPC payload); nothing about the
    // FILL — no field identity — ever crosses back OUT.
    fillLogin: (cred) => runFill('fillLogin', cred),
    fillCard: (card) => runFill('fillCard', card),
    // The gesture-time snapshot read (Leg 5).
    readSnapshot
  };
}

module.exports = { createEntryTracker, resolveTargetForAnchor };
