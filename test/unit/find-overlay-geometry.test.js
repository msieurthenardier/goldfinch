'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFindOverlayBounds,
  FIND_OVERLAY_WIDTH,
  FIND_OVERLAY_HEIGHT,
  FIND_OVERLAY_MARGIN_TOP,
  FIND_OVERLAY_MARGIN_RIGHT
} = require('../../src/main/find-overlay-geometry');

// ---------------------------------------------------------------------------
// AC8 case 1 — normal anchor: top-right strip of the guest with margins,
// mirroring the inset bar's CSS anchor (top: 8px; right: 12px).
// ---------------------------------------------------------------------------

test('normal guest: anchors to the top-right strip with margins', () => {
  const guest = { x: 0, y: 88, width: 1400, height: 812 };
  const b = computeFindOverlayBounds(guest);
  assert.deepEqual(b, {
    x: 1400 - FIND_OVERLAY_WIDTH - FIND_OVERLAY_MARGIN_RIGHT, // 1008
    y: 88 + FIND_OVERLAY_MARGIN_TOP, // 96
    width: FIND_OVERLAY_WIDTH,
    height: FIND_OVERLAY_HEIGHT
  });
});

test('offset guest (panel open): x/y stay guest-relative', () => {
  const guest = { x: 60, y: 100, width: 1000, height: 700 };
  const b = computeFindOverlayBounds(guest);
  assert.equal(b.x, 60 + 1000 - FIND_OVERLAY_WIDTH - FIND_OVERLAY_MARGIN_RIGHT);
  assert.equal(b.y, 100 + FIND_OVERLAY_MARGIN_TOP);
  assert.equal(b.width, FIND_OVERLAY_WIDTH);
});

// ---------------------------------------------------------------------------
// AC8 case 2 — narrow-guest clamp: width <= guest width, x >= guest.x
// (the overlay never overhangs the guest strip horizontally).
// ---------------------------------------------------------------------------

test('narrow guest: width clamps to guest width and x clamps to guest.x', () => {
  const guest = { x: 20, y: 88, width: 300, height: 600 }; // narrower than FIND_OVERLAY_WIDTH
  const b = computeFindOverlayBounds(guest);
  assert.equal(b.width, 300, 'width clamped to guest width');
  assert.ok(b.x >= guest.x, 'x never left of the guest');
  assert.equal(b.x, 20, 'full-width overlay pins to guest.x (right margin yields x < guest.x, clamped)');
  assert.ok(b.x + b.width <= guest.x + guest.width, 'no right overhang');
});

test('guest slightly wider than overlay: right margin honored without clamping', () => {
  const guest = { x: 0, y: 88, width: FIND_OVERLAY_WIDTH + FIND_OVERLAY_MARGIN_RIGHT + 10, height: 600 };
  const b = computeFindOverlayBounds(guest);
  assert.equal(b.width, FIND_OVERLAY_WIDTH);
  assert.equal(b.x, 10);
});

// ---------------------------------------------------------------------------
// AC8 case 3 — integer (rounded) output for fractional DIP inputs
// (getBoundingClientRect can yield fractional values; setBounds takes ints).
// ---------------------------------------------------------------------------

test('fractional guest bounds: all outputs are rounded integers', () => {
  const guest = { x: 0.4, y: 88.6, width: 1280.5, height: 700.2 };
  const b = computeFindOverlayBounds(guest);
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.ok(Number.isInteger(b[k]), `${k} is an integer (got ${b[k]})`);
  }
  assert.equal(b.y, Math.round(88.6 + FIND_OVERLAY_MARGIN_TOP));
});

// ---------------------------------------------------------------------------
// AC8 case 4 — vertical overhang on a very short guest is a documented
// non-goal (unreachable at the window's minHeight: 600). Assert CURRENT
// behavior: no vertical clamp — the overlay may extend past the guest bottom.
// ---------------------------------------------------------------------------

test('very short guest: no vertical clamp (documented non-goal)', () => {
  const guest = { x: 0, y: 88, width: 1400, height: 40 }; // shorter than overlay + top margin
  const b = computeFindOverlayBounds(guest);
  assert.equal(b.height, FIND_OVERLAY_HEIGHT, 'height is never shrunk');
  assert.equal(b.y, 88 + FIND_OVERLAY_MARGIN_TOP);
  assert.ok(
    b.y + b.height > guest.y + guest.height,
    'overlay overhangs the guest bottom — accepted, unreachable at minHeight: 600'
  );
});
