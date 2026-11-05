'use strict';

// Sortie 06 Leg 1 (AC10): the pure corner-prompt bounds helper.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeSavePromptBounds } = require('../../src/main/save-prompt-geometry');

const GUEST = { x: 0, y: 100, width: 1000, height: 600 };

test('AC10: anchor present - right edge sits at the anchor, width 340, top = guest.y + 8', () => {
  const b = computeSavePromptBounds({ guest: GUEST, anchorRightDip: 900, findVisible: false, contentHeight: 150 });
  assert.deepEqual(b, { x: 560, y: 108, width: 340, height: 150 });
});

test('AC10: anchor absent / zero / negative / NaN / non-number falls back to guest right - 12', () => {
  const expected = { x: 1000 - 12 - 340, y: 108, width: 340, height: 150 };
  for (const anchorRightDip of [undefined, null, 0, -5, NaN, Infinity, '900']) {
    const b = computeSavePromptBounds({
      guest: GUEST,
      anchorRightDip: /** @type {any} */ (anchorRightDip),
      contentHeight: 150
    });
    assert.deepEqual(b, expected, String(anchorRightDip));
  }
});

test('AC10: find bar visible stacks the card 56 below the top margin', () => {
  const b = computeSavePromptBounds({ guest: GUEST, anchorRightDip: 900, findVisible: true, contentHeight: 150 });
  assert.equal(b.y, 100 + 8 + 56);
});

test('AC10: x is clamped inside [guest.x + 8, guest.x + width - 8] for an anchor beyond either edge', () => {
  const far = computeSavePromptBounds({ guest: GUEST, anchorRightDip: 5000, contentHeight: 150 });
  assert.equal(far.x + far.width, 1000 - 8);
  const near = computeSavePromptBounds({ guest: GUEST, anchorRightDip: 50, contentHeight: 150 });
  assert.equal(near.x, 8);
});

test('AC10: a guest narrower than 356 gets width = guest.width - 16', () => {
  const b = computeSavePromptBounds({
    guest: { x: 10, y: 0, width: 300, height: 600 },
    anchorRightDip: 290,
    contentHeight: 150
  });
  assert.equal(b.width, 284);
  assert.equal(b.x, 10 + 8);
});

test('AC10: height clamps to [80, guest.height - 16]', () => {
  assert.equal(computeSavePromptBounds({ guest: GUEST, contentHeight: 10 }).height, 80);
  assert.equal(computeSavePromptBounds({ guest: GUEST, contentHeight: 90 }).height, 90);
  assert.equal(computeSavePromptBounds({ guest: GUEST, contentHeight: 9999 }).height, 600 - 16);
  assert.equal(computeSavePromptBounds({ guest: GUEST, contentHeight: NaN }).height, 80);
  const short = computeSavePromptBounds({ guest: { x: 0, y: 0, width: 1000, height: 300 }, contentHeight: 500 });
  assert.equal(short.height, 284);
});

test('AC10: every output is an integer (setBounds takes ints)', () => {
  const b = computeSavePromptBounds({
    guest: { x: 0.4, y: 100.6, width: 999.5, height: 600.2 },
    anchorRightDip: 903.7,
    contentHeight: 150.4
  });
  for (const v of Object.values(b)) assert.ok(Number.isInteger(v), String(v));
});
