'use strict';

// Per-family gesture-detach watch (M21 F3 L2, DD1's amendment / LD1), extracted from
// `webview-preload.js` into its own pure, injected-deps module — the kind-keyed
// arm/clear/fire state machine unit-tests under `node --test` against plain
// `{ isConnected }` stand-ins and an injected `MutationObserver` constructor,
// following the `vault-entry-tracker.js` precedent for this exact preload/DOM
// boundary (CLAUDE.md's "Electron-free injected-deps modules" default: the LOGIC
// here touches only `MutationObserver` and `.isConnected`, neither Electron-specific,
// even though the real caller, `webview-preload.js`, cannot itself be `require()`d
// under `node --test`).
//
// THE PROBLEM THIS FIXES (LD1): one gesture used to arm ONE field set; a SECOND
// gesture — even for a DIFFERENT FAMILY — replaced that set wholesale, and the
// single MutationObserver early-returned if it already existed. Under multi-hold
// (DD1) that silently lost the FIRST family's detach signal the moment a second
// family's gesture armed. This module keeps a `Map<kind, fields[]>` instead: the
// ONE MutationObserver fires `onSettle()` when ANY ONE kind's set is FULLY
// detached, and clears only THAT kind's set — the sibling kind's watch stays armed
// and fires independently on its own later detachment.
//
// `onSettle` is a bare, payload-free callback — this module carries no
// `ipcRenderer`/Electron dependency at all; the caller decides what "settled"
// means (webview-preload.js sends the `guest-vault-gesture-settle` IPC trigger).
// Main keeps releasing EVERY pending record for the tab regardless of which
// kind's fields detached (the settle IPC stays tab-scoped, never per-kind —
// see `register-browser-ipc.js`), so this module never needs to say WHICH kind
// settled, only THAT one did.

/**
 * @param {{
 *   MutationObserver: typeof MutationObserver,
 *   root: () => (Node | null | undefined),
 *   onSettle: () => void
 * }} deps
 *   `root` is a FUNCTION (not a bare node) so the watch can be constructed before
 *   the document root exists and still observe the live element the first time
 *   `arm()` actually needs to create the observer.
 */
function createGestureDetachWatch(deps) {
  /** @type {Map<string, any[]>} */
  const watched = new Map();
  /** @type {any} */
  let observer = null;

  // A set has "settled" only when EVERY one of its fields is no longer connected —
  // a single field disconnecting out of a larger set (a stray removal, not a real
  // form teardown) must NOT fire (AC10b). Checked for every armed kind on every
  // mutation batch; a kind with nothing armed is skipped cheaply.
  function checkAll() {
    for (const [kind, fields] of [...watched]) {
      if (fields.length === 0) continue;
      const fullyDetached = fields.every((f) => f && !f.isConnected);
      if (!fullyDetached) continue;
      watched.delete(kind);
      deps.onSettle();
    }
  }

  /**
   * Arm (or replace) the watched field set for ONE kind. A second call for the
   * SAME kind replaces its set wholesale (last-wins — matching the pre-extraction
   * single-kind semantics); a call for a DIFFERENT kind leaves every other kind's
   * armed set untouched.
   * @param {string} kind
   * @param {any[]} fields
   */
  function arm(kind, fields) {
    const live = (fields || []).filter(Boolean);
    if (!live.length) return;
    watched.set(kind, live);
    if (observer) return; // already watching — the fresh field set above is enough
    const root = deps.root();
    // Fails closed: no MutationObserver / no root yet means no detach signal for
    // this arm — never a forged one. A later arm() call (this kind or another) will
    // retry root() and may succeed once the document is further along.
    if (typeof deps.MutationObserver !== 'function' || !root) return;
    observer = new deps.MutationObserver(checkAll);
    observer.observe(root, { childList: true, subtree: true });
  }

  return { arm };
}

module.exports = { createGestureDetachWatch };
