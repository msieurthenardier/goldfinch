'use strict';
// @ts-check

// Tear-off overlay lifecycle (M09 F10 Leg L4-rebuild) — the "Release to open in a new
// window" pill, hosted in an always-on-top overlay WebContentsView so it renders OVER
// the guest page and follows the cursor anywhere (the L4 chrome-DOM ghost was occluded
// by the guest's native view once the drag left the strip band). A trimmed copy of
// find-overlay-manager.js's lifecycle (lazy singleton view, destroyed-recreate guard,
// render-process-gone self-teardown, show = position + add-after-guest RAISE +
// setVisible, hide = visibility-gated removeChildView, teardown = SOLE destruction site
// in the per-window `close` handler — the F6/F7 leak class). The find-session state
// machine is DROPPED; positioning is a pill-anchored setBounds off the pointer.
//
// Electron-free (deps injected — the find/menu-overlay precedent): `node --test`-able
// with fakes, never imports Electron. main.js constructs ONE instance PER WINDOW into
// that window's registry record (`rec.tearoffOverlay`); the deps close over THAT
// window's contentView. Divergence from find/menu, by design (AC3): the pill has NO
// preload and webContents.focus() is NEVER called on it — it is pure paint, so a
// tear-off drag never steals focus from the guest or the tab strip.

// Pill geometry (DIP). Pure constants — no Electron, stays offline-testable. The small
// trailing offset keeps the pill off the exact cursor tip (the old chrome-DOM ghost's
// +12,+12 translate).
const PILL_W = 260;
const PILL_H = 28;
const OFFSET = 12;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{
 *   webContents: {
 *     on: (event: string, cb: (...a: any[]) => void) => any,
 *     isDestroyed: () => boolean,
 *     destroy?: () => void
 *   },
 *   setBounds: (b: Bounds) => void,
 *   setVisible: (v: boolean) => void
 * }} OverlayViewLike
 * @typedef {{
 *   addChildView: (v: OverlayViewLike) => void,
 *   removeChildView: (v: OverlayViewLike) => void
 * }} ContentViewLike
 */

/**
 * @param {{
 *   getContentView: () => (ContentViewLike | null),
 *   createOverlayView: () => OverlayViewLike
 * }} deps
 */
function createTearoffOverlayManager({ getContentView, createOverlayView }) {
  /** @type {OverlayViewLike | null} */
  let view = null;
  // Tracks stack presence (removeChildView of a non-child is undefined behavior — gate
  // on this).
  let visible = false;
  // Latest pointer position (DIP), stored always; applied to the view while visible.
  /** @type {{ x: number, y: number } | null} */
  let lastPos = null;

  // Full teardown (the per-window `close` handler — the SOLE destruction caller): remove
  // from the stack if present, destroy the webContents if still alive, drop the view.
  function teardown() {
    if (view) {
      if (visible) {
        const cv = getContentView();
        if (cv) cv.removeChildView(view);
      }
      const wc = view.webContents;
      if (!wc.isDestroyed() && typeof wc.destroy === 'function') wc.destroy();
    }
    view = null;
    visible = false;
    lastPos = null;
  }

  // Lazy-construct the pill view. Destroyed-recreate guard + render-process-gone
  // self-teardown (a crashed wc keeps isDestroyed() false, so the guard alone misses it).
  function ensureView() {
    if (view && view.webContents.isDestroyed()) {
      view = null;
      visible = false;
    }
    if (view) return view;
    view = createOverlayView();
    view.webContents.on('render-process-gone', () => teardown());
    return view;
  }

  // Pill-anchored bounds off the last pointer position (the small trailing offset).
  /** @param {OverlayViewLike} v */
  function applyBounds(v) {
    if (lastPos) v.setBounds({ x: lastPos.x + OFFSET, y: lastPos.y + OFFSET, width: PILL_W, height: PILL_H });
  }

  // Store the pointer position (always); re-position the pill while visible. This is the
  // syncBounds analog — the `:move` IPC funnels here.
  /** @param {number} x @param {number} y */
  function setPosition(x, y) {
    lastPos = { x, y };
    if (visible && view) applyBounds(view);
  }

  // Show = position + addChildView (the re-add RAISES above the guest) + setVisible(true).
  // Optional (x,y) seeds the position in one call (the `:show` IPC); omitted on the
  // z-order re-assert path, which keeps the last position. No-op when the window is gone.
  /** @param {number} [x] @param {number} [y] */
  function show(x, y) {
    const cv = getContentView();
    if (!cv) return;
    if (typeof x === 'number' && typeof y === 'number') lastPos = { x, y };
    const v = ensureView();
    applyBounds(v);
    cv.addChildView(v);
    v.setVisible(true);
    visible = true;
  }

  // Hide = removeChildView (NEVER setVisible(false)-only — a hidden-but-present sibling
  // still occupies the compositing stack). Idempotent; the view is kept for reuse.
  function hide() {
    if (!visible) return;
    const cv = getContentView();
    if (cv && view) cv.removeChildView(view);
    visible = false;
  }

  return {
    ensureView,
    show,
    hide,
    setPosition,
    teardown,
    isVisible: () => visible,
    getView: () => view
  };
}

module.exports = { createTearoffOverlayManager };
