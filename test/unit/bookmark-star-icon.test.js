'use strict';

// Unit tests for the shared bookmark-star glyph builder (M15 F1 Leg 5 HAT fix I2:
// replaces the suggestions-sheet bookmark badge's prior `textContent = 'Bookmark'`
// text pill). Pure/document-injected like copy-icon.js, so it's testable against
// the fake-document helper without a live sheet — the actual row wiring (badge
// aria-hidden + sr-only description + aria-describedby) lives in menu-overlay.js
// and is reasoned about directly (no jsdom harness for that page script), per the
// Leg 4 precedent recorded in the flight log.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildBookmarkStarIcon } = require('../../src/shared/bookmark-star-icon.js');

test('buildBookmarkStarIcon returns a decorative, filled SVG star — never a text node', () => {
  const document = createDocument();
  const icon = buildBookmarkStarIcon(document);

  assert.equal(icon.tagName, 'SVG');
  assert.equal(icon.attributes.get('aria-hidden'), 'true', 'must stay decorative — the row carries the accessible signal via its own sr-only node');
  assert.equal(icon.attributes.get('focusable'), 'false');
  assert.equal(icon.attributes.get('fill'), 'currentColor', 'filled, not stroked — legible at badge size (unlike the address-bar star\'s unstarred outline state)');
  assert.equal(icon.attributes.get('stroke'), 'none');
  assert.equal(icon.textContent, '', 'markup-free per the sheet\'s no-innerHTML discipline — shape comes from a <path> child, not text');

  const path = icon.children.find((c) => c.tagName === 'PATH');
  assert.ok(path, 'the star shape is a real <path> child element');
  assert.ok(path.attributes.get('d').length > 0, 'the path carries real geometry (same Lucide star as the address-bar #star glyph)');
});

test('buildBookmarkStarIcon carries the sizing class and stays free of width/height presentation attributes', () => {
  // M15 F2 Leg 4 HAT fix (bookmark star invisible regression): pins the
  // contract this fix relies on. `.sg-badge-star` (menu-overlay.css) is the
  // icon's ONLY size source — never a percentage of an ambient
  // flex-stretched height (that was the regression: it resolved to zero and
  // made the star invisible). Follow-up HAT fix #3 moved that rule's value
  // from `2.25em` to a fixed `16px` (parity with the address-bar `#star`
  // glyph, per operator verdict) — the sizing-class contract this test pins
  // is unaffected by that value change.
  // This is a pure builder — it can't assert computed geometry (no layout in
  // jsdom-free fake DOM), only the markup contract the CSS fix depends on:
  // the sizing class is present, and no width/height attribute reappears to
  // fight the CSS (DD12(b)'s original complaint).
  const document = createDocument();
  const icon = buildBookmarkStarIcon(document);

  assert.equal(icon.classList.contains('sg-badge-star'), true, 'must carry the class that .sg-badge-star sizing rules target');
  assert.equal(icon.attributes.has('width'), false, 'no width presentation attribute — CSS is the only size source');
  assert.equal(icon.attributes.has('height'), false, 'no height presentation attribute — CSS is the only size source');
});

test('buildBookmarkStarIcon yields a fresh, independent node on each call', () => {
  const document = createDocument();
  const a = buildBookmarkStarIcon(document);
  const b = buildBookmarkStarIcon(document);
  assert.notEqual(a, b);
  assert.notEqual(a.children[0], b.children[0]);
});
