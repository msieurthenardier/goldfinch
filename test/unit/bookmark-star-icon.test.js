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

test('buildBookmarkStarIcon yields a fresh, independent node on each call', () => {
  const document = createDocument();
  const a = buildBookmarkStarIcon(document);
  const b = buildBookmarkStarIcon(document);
  assert.notEqual(a, b);
  assert.notEqual(a.children[0], b.children[0]);
});
