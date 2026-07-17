'use strict';

// Tab-drag zone model (M09 Flight 8, Leg 3) — the pure DD16 decision: does this
// window-local point reorder within the strip, or tear the tab off?
//
// The tab-order.test.js house pattern (a pure model, required directly, no DOM), plus
// the two source-scan readings AC1 asks for: the module reaches for NO Electron and NO
// cross-window coordinate source. Those scans are MASKED (leg 1's helper) on purpose —
// this file's own module header names `screenX`, `getBounds`, `getPosition` and the
// `screen` module in prose, so a naive `grep -c` over it reads ≥ 1 on the comments alone
// and has discrimination ZERO. The mask is what makes the reading mean anything, and the
// mutation below is what proves the mask did not simply erase the file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');
const { classifyDragPoint, isOutsideStrip } = require('../../src/shared/tab-drag-zone');
const { dropIndexFromPointer } = require('../../src/shared/tab-order');

const MODULE_PATH = path.join(__dirname, '../../src/shared/tab-drag-zone.js');

// A strip 44px tall at the top of the viewport, holding three 100px slots. The strip is
// WIDER than its tabs (the real #tabstrip carries the #tabstrip-drag spacer and the
// window controls), which is what makes "left the strip" a genuinely 2-D question:
// x=520 is past every tab and still inside the strip.
const STRIP = { left: 0, top: 0, right: 800, bottom: 44 };
const SLOTS = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 }
];

// ---------------------------------------------------------------------------
// AC3 — within the strip it reorders, with EXACTLY dropIndexFromPointer's index
// ---------------------------------------------------------------------------

test('a point inside the strip reorders', () => {
  assert.deepEqual(classifyDragPoint(STRIP, SLOTS, 250, 22, 0), { zone: 'reorder', index: 1 });
});

test('the reorder index is EXACTLY dropIndexFromPointer, at every x across the strip', () => {
  // The F2 regression net, stated as an identity rather than as spot checks: this module
  // adds the y-axis test and NOTHING else. Any divergence at any x is a behavior change
  // to a contract F2 pinned and this leg is forbidden to touch.
  for (let draggedIndex = 0; draggedIndex < SLOTS.length; draggedIndex++) {
    for (let x = -20; x <= 820; x += 5) {
      const zone = classifyDragPoint(STRIP, SLOTS, x, 22, draggedIndex);
      const expected = dropIndexFromPointer(SLOTS, x, draggedIndex);
      // x outside the strip's horizontal span is a tear-off, not a reorder — the identity
      // is asserted where the zone model claims to reorder, which is the whole strip.
      if (x < STRIP.left || x > STRIP.right) {
        assert.deepEqual(zone, { zone: 'tearOff' }, `x=${x} is outside the strip`);
      } else {
        assert.deepEqual(zone, { zone: 'reorder', index: expected }, `x=${x}, dragged=${draggedIndex}`);
      }
    }
  }
});

test('a point past every tab but still inside the strip reorders (the drag-spacer span)', () => {
  // x=520 sits over #tabstrip-drag: no tab is there, but the pointer never left the strip.
  assert.deepEqual(classifyDragPoint(STRIP, SLOTS, 520, 22, 0), { zone: 'reorder', index: 2 });
});

// ---------------------------------------------------------------------------
// AC3's two readings — THE Y-AXIS MUST CHANGE THE ANSWER
// ---------------------------------------------------------------------------

test('the SAME x reorders inside the strip and tears off below it — y is read', () => {
  // Both readings, same x, one axis apart. If these were equal the zone model would not
  // be reading y at all and the AC would be discharged by a model that cannot tear off.
  const inside = classifyDragPoint(STRIP, SLOTS, 250, 22, 0);
  const below = classifyDragPoint(STRIP, SLOTS, 250, 120, 0);
  assert.deepEqual(inside, { zone: 'reorder', index: 1 });
  assert.deepEqual(below, { zone: 'tearOff' });
  assert.notDeepEqual(inside, below, 'the y-axis must change the answer');
});

test('above the strip tears off too', () => {
  assert.deepEqual(classifyDragPoint(STRIP, SLOTS, 250, -10, 0), { zone: 'tearOff' });
});

test('left and right of the strip tear off', () => {
  assert.deepEqual(classifyDragPoint(STRIP, SLOTS, -1, 22, 0), { zone: 'tearOff' });
  assert.deepEqual(classifyDragPoint(STRIP, SLOTS, 801, 22, 0), { zone: 'tearOff' });
});

test('the strip rect is INCLUSIVE on every edge — ties resolve toward NOT tearing off', () => {
  for (const [x, y] of [[0, 0], [800, 0], [0, 44], [800, 44], [250, 44], [250, 0]]) {
    assert.equal(classifyDragPoint(STRIP, SLOTS, x, y, 0).zone, 'reorder', `(${x},${y}) is on an edge`);
  }
});

// ---------------------------------------------------------------------------
// Degenerate input — an unreadable rect must NOT spend the destructive outcome
// ---------------------------------------------------------------------------

test('a missing or non-finite strip rect reorders rather than tearing off', () => {
  for (const bad of [null, undefined, {}, { left: NaN, top: 0, right: 800, bottom: 44 }]) {
    assert.equal(
      classifyDragPoint(/** @type {any} */ (bad), SLOTS, 250, 999, 0).zone,
      'reorder',
      'a failed DOM measurement must not tear a tab off'
    );
  }
});

test('a non-finite pointer coordinate reorders rather than tearing off', () => {
  assert.equal(classifyDragPoint(STRIP, SLOTS, NaN, 22, 0).zone, 'reorder');
  assert.equal(classifyDragPoint(STRIP, SLOTS, 250, NaN, 0).zone, 'reorder');
});

test('degenerate slotRects still classify — the zone answer never depends on the slots', () => {
  assert.deepEqual(classifyDragPoint(STRIP, [], 250, 22, 0), { zone: 'reorder', index: 0 });
  assert.deepEqual(classifyDragPoint(STRIP, [], 250, 120, 0), { zone: 'tearOff' });
});

// ---------------------------------------------------------------------------
// AC1 — the module is pure: no Electron, no cross-window coordinate source.
// Both readings, per DD10: the real file, and the real file MUTATED IN MEMORY to
// contain exactly the read being banned. No file is ever written.
// ---------------------------------------------------------------------------

/** The zone module's source with every comment blanked — see the header. @returns {string} */
function maskedModule() {
  return maskComments(fs.readFileSync(MODULE_PATH, 'utf8'));
}

const ELECTRON_RE = /require\('electron'\)|from 'electron'/g;
// DD16's ban, widened from DD1's: not `screen`, not `getBounds`, not `screenX` — none of
// them is falsifiable from inside Electron, so none may appear in this module's CODE.
const GLOBAL_COORD_RE = /screenX|screenY|getBounds|getPosition|\bscreen\./g;

test('AC1: the zone module reaches for no Electron — masked, real → 0, mutated → 1', () => {
  const real = maskedModule();
  assert.equal((real.match(ELECTRON_RE) || []).length, 0, 'real (masked) → 0');

  const mutated = real.replace(
    "import { dropIndexFromPointer } from './tab-order.js';",
    "const { screen } = require('electron');\nimport { dropIndexFromPointer } from './tab-order.js';"
  );
  assert.notEqual(mutated, real, 'the electron-import mutation did not apply — the target is stale');
  assert.equal((mutated.match(ELECTRON_RE) || []).length, 1, 'mutated → 1');
});

test('AC1: the zone module reads no cross-window coordinate — masked, real → 0, mutated → 1', () => {
  const real = maskedModule();
  assert.equal((real.match(GLOBAL_COORD_RE) || []).length, 0, 'real (masked) → 0');

  const mutated = real.replace(
    'return pointerX < left || pointerX > right',
    'return pointerX + window.screenX < left || pointerX > right'
  );
  assert.notEqual(mutated, real, 'the global-coordinate mutation did not apply — the target is stale');
  assert.equal((mutated.match(GLOBAL_COORD_RE) || []).length, 1, 'mutated → 1');
});

test('the MASK is what carries those two readings — unmasked, the real file reads NON-ZERO', () => {
  // The control for the two scans above, and the reason AC1 specifies masking. The module
  // header names every banned symbol in prose. An unmasked grep therefore reports the real,
  // pure file as a violation — it cannot tell a ban from its own statement, which is
  // discrimination zero. Asserting the unmasked number is NON-zero proves the mask is doing
  // the work rather than the file simply having nothing in it to find.
  const unmasked = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.ok(
    (unmasked.match(GLOBAL_COORD_RE) || []).length > 0,
    'the header names the banned symbols — if this ever reads 0 the scans above went vacuous'
  );
  assert.equal((maskComments(unmasked).match(GLOBAL_COORD_RE) || []).length, 0, 'masked → 0');
});

// ---------------------------------------------------------------------------
// isOutsideStrip — a public export since M09 F11 Leg 2, pinned here as pure geometry in
// its own right. The `releaseInsideViewport` dragend gate it was briefly promoted for is
// GONE (the Leg 2 HAT fix removed the viewport AND-gate — it conflated a cross-window
// release with a desktop tear-off and killed the latter): the renderer no longer imports
// this function at all, and tab-drag-invariants.test.js pins its ABSENCE from dragend.
// The shipped dragend gate is `!dropHandled && (tearOff || releaseZone.zone === 'tearOff')`
// where the release zone comes from `classifyDragPoint` — which reads isOutsideStrip
// INTERNALLY, so the renderer's only remaining dependence on it is transitive. These
// direct pins keep the exported edge semantics honest for that transitive consumer.
// ---------------------------------------------------------------------------

test('isOutsideStrip: a point inside the rect is NOT outside (release-inside → tear-off gate open)', () => {
  assert.equal(isOutsideStrip(STRIP, 250, 22), false);
});

test('isOutsideStrip: a point past any edge IS outside — the cross-window release (probe4)', () => {
  assert.equal(isOutsideStrip(STRIP, STRIP.right + 1, 22), true); // past the right edge — the cross-window case
  assert.equal(isOutsideStrip(STRIP, 250, STRIP.bottom + 1), true); // below the strip
  assert.equal(isOutsideStrip(STRIP, STRIP.left - 1, 22), true); // left of it
});

test('isOutsideStrip: a degenerate / non-finite rect is NEVER outside — an unmeasurable rect never tears off', () => {
  // The dependence is TRANSITIVE now (see the section header): classifyDragPoint's own
  // degenerate-rect arm — an unreadable strip classifies `reorder`, never `tearOff` —
  // rests on this never-outside reading. A rect the module could not measure must never
  // spend the destructive outcome.
  assert.equal(isOutsideStrip(/** @type {any} */ (null), 250, 22), false);
  assert.equal(isOutsideStrip({ left: NaN, top: 0, right: 100, bottom: 40 }, 250, 22), false);
  assert.equal(isOutsideStrip(STRIP, NaN, 22), false);
});
