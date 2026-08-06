// @ts-check
'use strict';

// Pure bounds helper for the floating find-overlay WebContentsView (M05 Flight 7, DD2).
// Computes the overlay's DIP rect anchored to the TOP-RIGHT strip of the active guest's
// bounds. The margins below are this module's OWN authority — the pre-overlay inset
// `#find-bar` whose CSS anchor they were originally copied from is gone, so nothing
// mirrors them and no CSS rule can drift out from under them.
//
// Electron-free by design: unit-tested offline with plain objects (node --test).
// Bounds are DIP end-to-end (renderer getBoundingClientRect is DIP; setBounds takes DIP) —
// no DPR scaling math here or anywhere in the overlay path.

const FIND_OVERLAY_WIDTH = 380; // DIP; clamped to guest width on narrow guests
const FIND_OVERLAY_HEIGHT = 48; // bar + breathing room for shadow
// Sole source of truth for the overlay's inset from the guest's top-right corner:
// the view is positioned by setBounds, and find-overlay.css styles only the contents
// of the view rect (find-overlay.css's own `#find-bar` sets no top/right).
const FIND_OVERLAY_MARGIN_TOP = 8; // DIP inset from the guest's top edge
const FIND_OVERLAY_MARGIN_RIGHT = 12; // DIP inset from the guest's right edge

/**
 * Compute the overlay's window-relative DIP bounds from the active guest's DIP bounds.
 *
 * - width = min(FIND_OVERLAY_WIDTH, guest.width) — never overhang a narrow guest.
 * - x = right-aligned inside the guest with FIND_OVERLAY_MARGIN_RIGHT, clamped to >= guest.x.
 * - y = guest.y + FIND_OVERLAY_MARGIN_TOP. Vertical overhang on a guest shorter than
 *   ~56 DIP is a documented non-goal (unreachable at the window's minHeight: 600).
 * - All outputs are rounded integers (setBounds takes ints).
 *
 * Does NOT tolerate a null/undefined guest — callers guard (skip when no guest bounds
 * have ever been seen; the next tab-set-bounds corrects it).
 *
 * @param {{ x: number, y: number, width: number, height: number }} guest
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function computeFindOverlayBounds(guest) {
  const width = Math.min(FIND_OVERLAY_WIDTH, guest.width);
  const x = Math.max(guest.x, guest.x + guest.width - width - FIND_OVERLAY_MARGIN_RIGHT);
  const y = guest.y + FIND_OVERLAY_MARGIN_TOP;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(FIND_OVERLAY_HEIGHT)
  };
}

module.exports = {
  computeFindOverlayBounds,
  FIND_OVERLAY_WIDTH,
  FIND_OVERLAY_HEIGHT,
  FIND_OVERLAY_MARGIN_TOP,
  FIND_OVERLAY_MARGIN_RIGHT
};
