'use strict';

// ---------------------------------------------------------------------------
// Guest-side "a bookmark was dropped on this page" listeners
// (M15 Flight 3 "Drag Interactions" Leg 4 — DD5 / DD5b / DD6).
//
// Electron-free, injected-deps CORE, required by webview-preload.js: the same
// division of labour as vault-fill-icon.js / vault-fill-fields.js — the preload
// owns the document-start captures and the two registrations, this module owns
// the handler bodies so they unit-test headlessly under `node --test`.
//
// WHY THE `dragover` preventDefault IS THE FEATURE, NOT AN OPTIMISATION (DD5b,
// measured in Operator Session 3): a bookmark dragged onto an ordinary page
// produced 29 `dragover` and ZERO `drop`. That is the plain HTML5 rule — `drop`
// is never dispatched unless something `preventDefault()`s `dragover`. So the
// gate below is what makes a drop exist at all.
//
// WHY WE STILL DO NOT FIGHT A COMPETING DEFAULT, and the honest version of the
// reasoning (design-review correction — an earlier draft told this story wrong):
// the probe cannot distinguish "no shell-level navigation exists" from "the drop
// was rejected before any default could run", and once we preventDefault
// `dragover` a `drop` IS dispatched — a regime the probe never entered. Two real
// mechanisms cover us: (a) Blink's navigate-on-drop path is gated on the
// document not having handled the drag, so our own `dragover` preventDefault
// suppresses it with the same call that makes `drop` fire; (b) Electron's
// `navigateOnDragDrop` webPreference defaults to false and is set nowhere in
// this repo.
//
// WHY THE SIGNAL CARRIES NOTHING (DD6): `contextIsolation` is OFF in web guests
// (this preload shares the page's main world — farbling needs that), so a
// hostile page can fabricate a `DragEvent` and reach `handleDrop` directly. The
// send therefore carries NO url and NO id: the chrome resolves what was dragged
// from its OWN live drag session, and main refuses the forward unless a bookmark
// drag was declared by that window's chrome (and CONSUMES the declaration on the
// first successful forward). A signal that carries no data cannot be aimed.
//
// FRAME SCOPE — a decision, not an omission: webview-preload.js runs in EVERY
// frame of a guest webContents (hence its IS_TOP_FRAME gating elsewhere), and
// this leg registers in ALL of them. Main navigates the TAB, not a frame, so the
// outcome is identical whichever frame received the drop; top-frame-only would
// make iframe regions inert and the feature would silently fail on iframe-heavy
// pages. The cost — a subframe can also fabricate a signal — is already bounded
// by main's declaration gate + consume-on-forward.
// ---------------------------------------------------------------------------

const { BOOKMARK_DND_MIME } = require('../shared/bookmark-drag.js');

/** The one guest→main channel this module sends on. Bare — no payload, ever. */
const GUEST_BOOKMARK_DROP_CHANNEL = 'guest-bookmark-drop';

/**
 * Does this drag carry the chrome's own bookmark type?
 *
 * ⚠ MANDATORY GATE, NOT COSMETIC (DD2/AC3). Ungated, the `dragover` handler
 * would `preventDefault()` EVERY drag on EVERY page — making pages accept file
 * and link drops they otherwise refuse. `types` is readable during `dragover`
 * under the HTML5 drag protected mode; `getData` is not, and the guest never
 * calls it: it can RECOGNISE a bookmark drag and can never READ which bookmark.
 *
 * Hand-rolled scan rather than `types.includes(…)`: `types` is a plain array in
 * Chromium but an array-like `DOMStringList` under older shapes, and this runs
 * in the page's own main world where `Array.prototype.includes` is
 * page-writable. Annoyance hardening only — see the DD6 note above for why
 * forgery is pointless rather than blocked.
 *
 * @param {any} e a DragEvent (or anything a page dispatched in its place)
 * @returns {boolean}
 */
function hasBookmarkType(e) {
  try {
    const types = e && e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    const len = types.length >>> 0;
    for (let i = 0; i < len; i++) {
      if (types[i] === BOOKMARK_DND_MIME) return true;
    }
    return false;
  } catch {
    return false; // an unreadable dataTransfer is not a bookmark drag
  }
}

/**
 * Build the two guest listeners.
 *
 * @param {{
 *   ipcRenderer: { send: (channel: string, ...args: any[]) => void },
 *   setTimeout: (fn: () => void, ms: number) => any
 * }} deps `setTimeout` MUST be the one captured at document-start by the
 *   preload — never resolved at drop time. See `handleDrop`.
 */
function createBookmarkDropListeners({ ipcRenderer, setTimeout: defer }) {
  /**
   * `dragover`: accept the drag — and nothing else — when it is ours.
   *
   * The `preventDefault()` here is what causes a `drop` to be dispatched at all
   * (DD5b). No `dropEffect` is set: the leg specifies "preventDefault(). Nothing
   * else", and the leg-3 anomaly note records that `dropEffect` reads back
   * "none" under a synthetic `DataTransfer` anyway, so it is a HAT observation
   * either way.
   * @param {any} e
   */
  function handleDragOver(e) {
    if (!hasBookmarkType(e)) return;
    e.preventDefault();
  }

  /**
   * `drop`: decide, LATE, whether the page consumed it.
   *
   * ⚠ THIS HANDLER MUST NOT `preventDefault()` (AC4). There is no default left
   * to suppress (see the header), and calling it would set `defaultPrevented` —
   * the very flag that discriminates "the page consumed this drop" from "nothing
   * did". Polluting it would make the browser always lose to itself.
   *
   * ⚠ THE READ MUST BE A `setTimeout(…, 0)` MACROTASK. Not synchronous, and NOT
   * `queueMicrotask`:
   *   - this preload runs at DOCUMENT-START, so its `window` listener is FIRST
   *     in registration order and fires AHEAD of a page's own handler on the
   *     same node (`window`/`document` global dropzones are the common shape) —
   *     a synchronous read sees `false` and destroys exactly the drops the
   *     page-wins policy exists to protect;
   *   - a microtask checkpoint runs between listeners whenever the JS stack is
   *     empty, which for a browser-dispatched event it IS, so `queueMicrotask`
   *     can still run before the next listener. Only a fresh macrotask is
   *     guaranteed to be after the whole dispatch.
   *
   * ⚠ `dataTransfer` LEAVES PROTECTED MODE when dispatch ends — every `types` /
   * `getData` read from the deferred callback returns empty. So the gate is read
   * SYNCHRONOUSLY here and only `defaultPrevented` is read late.
   * @param {any} e
   */
  function handleDrop(e) {
    if (!hasBookmarkType(e)) return; // synchronous — protected-mode read
    // NO e.preventDefault() — see above.
    defer(() => {
      let consumedByPage = true; // fail-closed: an unreadable flag never navigates
      try {
        consumedByPage = e.defaultPrevented === true;
      } catch {
        /* keep the fail-closed default */
      }
      if (consumedByPage) return; // the page's own drop handler took it — page wins
      try {
        ipcRenderer.send(GUEST_BOOKMARK_DROP_CHANNEL); // AC5: bare — no url, no id
      } catch {
        /* main gone / tab tearing down */
      }
    }, 0);
  }

  return { handleDragOver, handleDrop };
}

module.exports = { createBookmarkDropListeners, hasBookmarkType, GUEST_BOOKMARK_DROP_CHANNEL, BOOKMARK_DND_MIME };
