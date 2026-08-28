// @ts-check

// Real ES module (M17 F1 L2, DD9). Required by BOTH guest preloads —
// webview-preload.js (contextIsolation:false, page main world) and
// internal-preload.js (contextIsolation:true, sandbox:true, via
// require('../shared/tab-boundary')) — and imported by the chrome's
// shortcut-controller.js. A SANDBOXED preload's restricted module loader
// cannot resolve a relative require() at all, which is why both preloads
// that reach this file are bundled ahead of time by scripts/build-preload.mjs
// (DD5): esbuild inlines this ESM source into each CJS bundle, and its
// `require('./x').tabBoundary`-style interop yields the named exports as
// plain properties (confirmed empirically at the DD9 design review — no
// `.default`, no build-preload.mjs change needed). Node 22's synchronous
// `require(esm)` serves the SAME file to the two guest-preload unit tests and
// to any other CJS consumer, the exact pattern `cross-view-nav.js` already
// established for main.js:135 and its own test.
//
// tabBoundary(doc, direction) is the pure decision behind the guest tab-
// exhaustion signal (M17 Flight 1 Leg 1, DD2): given a document and a Tab
// direction, would pressing that key now leave the page's tabbable sequence?
// No DOM globals beyond the passed-in `doc` — offline-testable with a fake
// document, mirroring every other Electron-free pure decision module.

// Selector list per DD2: anchors/areas with an href, the natively-focusable
// form/control elements, iframes (opaque — treated as ONE tabbable; the
// sequence inside a frame is invisible to the top document), contenteditable
// hosts, and anything carrying an explicit tabindex. `[tabindex="-1"]` is
// filtered OUT below, not excluded from the selector, so a `tabindex="-1"`
// element on an otherwise-focusable tag (e.g. a `<div tabindex="-1">`) is
// still discovered and then correctly dropped by the tabindex filter.
const FOCUSABLE_SELECTOR =
  'a[href], area[href], button, input, select, textarea, iframe, [contenteditable="true"], [tabindex]';

/**
 * Whether `el` is currently part of the tabbable sequence: not disabled, not
 * `hidden`, not `tabindex="-1"`, not display:none/visibility:hidden —
 * `getClientRects().length === 0` is the live-DOM visibility test (a
 * display:none element or one inside a display:none/visibility:hidden
 * ancestor renders zero client rects; this is also why the chrome's collapsed
 * media/privacy panels — `width:0; overflow:hidden` only — need the
 * `visibility: hidden` addition in styles.css to be excluded here, DD4) —
 * and not visibility:hidden per COMPUTED style, own or inherited from an
 * ancestor (post-review defect fix, same class as the chrome-side check in
 * shortcut-controller.js: `getClientRects()` alone only detects
 * `display:none`. A `visibility:hidden` element still lays out its box and
 * reports NON-empty client rects — it's just not painted — so a hidden
 * control at either end of a real guest page's sequence was being counted as
 * tabbable here while Chromium's own sequential focus skips it, either
 * suppressing the boundary signal or firing it early). The computed-style
 * check goes through `doc.defaultView.getComputedStyle` — the module stays
 * doc-only, no bare `window`/`getComputedStyle` global — and a missing
 * `doc`, `defaultView`, or `getComputedStyle` is treated as "visible" (no
 * computed-style filtering applied), so callers/fakes that don't supply one
 * keep their existing behavior.
 * @param {any} el
 * @param {any} [doc]
 * @returns {boolean}
 */
function isFocusable(el, doc) {
  if (typeof el.hasAttribute === 'function') {
    if (el.hasAttribute('disabled')) return false;
    if (el.hasAttribute('hidden')) return false;
  } else if (el.disabled || el.hidden) {
    return false;
  }
  const tabindex =
    typeof el.getAttribute === 'function'
      ? el.getAttribute('tabindex')
      : el.tabIndex != null
        ? String(el.tabIndex)
        : null;
  if (tabindex === '-1') return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  const view = doc && doc.defaultView;
  const getComputedStyle = view && view.getComputedStyle;
  if (typeof getComputedStyle === 'function') {
    const style = getComputedStyle.call(view, el);
    if (style && style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * The page's live tabbable sequence, DOM order, filtered by isFocusable.
 * Exported alongside the boundary predicate for testability (AC1).
 * @param {any} doc
 * @returns {any[]}
 */
function tabSequence(doc) {
  const nodes = Array.from(doc.querySelectorAll(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => isFocusable(el, doc));
}

/**
 * tabBoundary(doc, direction)
 *
 * Decides whether a Tab (`direction: 'forward'`) or Shift+Tab
 * (`direction: 'backward'`) press, right now, would leave the document's
 * tabbable sequence.
 *
 * Edge cases (leg spec):
 *   - Zero tabbables: `atBoundary: true` for BOTH directions — nothing to
 *     traverse, so Tab hands off immediately (count: 0).
 *   - `document.activeElement` not in the sequence at all (e.g. `body`, with
 *     tabbables present): NOT a boundary — Chromium's own default Tab action
 *     enters the sequence (first element forward, last element backward).
 *   - Otherwise: boundary iff the active element is the LAST entry (forward)
 *     or the FIRST entry (backward).
 *
 * @param {any} doc
 * @param {'forward' | 'backward'} direction
 * @returns {{ atBoundary: boolean, count: number }}
 */
function tabBoundary(doc, direction) {
  const seq = tabSequence(doc);
  const count = seq.length;
  if (count === 0) return { atBoundary: true, count: 0 };
  const active = doc.activeElement;
  const idx = seq.indexOf(active);
  if (idx === -1) return { atBoundary: false, count };
  const atBoundary = direction === 'forward' ? idx === count - 1 : idx === 0;
  return { atBoundary, count };
}

export { tabBoundary, tabSequence, isFocusable, FOCUSABLE_SELECTOR };
