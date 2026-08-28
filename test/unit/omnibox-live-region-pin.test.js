'use strict';

// Structural pins (M17 Flight 1 Leg 3, AC3): the omnibox suggestion-announcement
// static shape — the chrome-owned #suggest-status live region (DD12), #address's
// retired aria-expanded (DD11), and the registration/config sites that wire both.
// Grep-AC style pins over the source text (the guest-tab-boundary-preload-pin.test.js
// house style), not a behavior test — the runtime behavior is exercised live via the
// behavior spec and via omnibox-suggest-model.test.js / navigation-controller.test.js's
// pure/controller coverage.
//
// Neuter-verified: each assertion below was checked to go RED when its guarded line is
// removed/altered, then restored (see the flight log's neuter table).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { findMatchingBracket } = require('../helpers/source-scan');

const repoRoot = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'index.html'), 'utf8');
const contextJs = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'chrome', 'context.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'renderer.js'), 'utf8');

test('index.html: #suggest-status is a polite status live region, sr-only (DD12)', () => {
  // Wrap-insensitive (regex-target idiom, CLAUDE.md "Patterns"): a Prettier re-wrap of
  // this single attribute line must not silently stale the anchor.
  assert.match(
    indexHtml,
    /<div\s+id=["']suggest-status["']\s+class=["']sr-only["']\s+role=["']status["']\s+aria-live=["']polite["']\s*>\s*<\/div>/
  );
});

test('index.html: #address carries aria-autocomplete="list" and no role/aria-expanded (DD11)', () => {
  const match = /<input\b[^>]*id=["']address["'][^>]*\/>/.exec(indexHtml);
  assert.ok(match, '#address input tag not found');
  const tag = match[0];
  assert.match(tag, /aria-autocomplete=["']list["']/);
  assert.doesNotMatch(tag, /\brole=/);
  assert.doesNotMatch(tag, /aria-expanded/);
});

test('context.js: registers suggestStatus -> suggest-status (DD12)', () => {
  assert.match(contextJs, /suggestStatus:\s*['"]suggest-status['"]/);
});

test("renderer.js: the suggestions overlay state's ariaTarget returns null, not els.address (DD11)", () => {
  const anchor = 'suggestions: {';
  const occurrences = rendererJs.split(anchor).length - 1;
  assert.equal(occurrences, 1, `expected exactly one "${anchor}" entry in renderer.js, found ${occurrences}`);
  // Bracket-matched block extraction (test/helpers/source-scan.js, the seam-contract.js
  // precedent) rather than a bounded-lookahead scan — the suggestions state's own body
  // is itself a `key: value,` list, so a lookahead tuned to stop at the NEXT sibling
  // dispatch-table entry would also (wrongly) stop at this entry's own `open:`/`token:`
  // lines.
  const openIdx = rendererJs.indexOf(anchor) + anchor.length - 1; // index of the '{'
  assert.equal(rendererJs[openIdx], '{');
  const closeIdx = findMatchingBracket(rendererJs, openIdx, '{', '}');
  assert.ok(closeIdx !== -1, 'suggestions block closing brace not found');
  const block = rendererJs.slice(openIdx, closeIdx + 1);
  assert.match(block, /ariaTarget:\s*\(\)\s*=>\s*null/);
  assert.doesNotMatch(block, /ariaTarget:\s*\(\)\s*=>\s*els\.address/);
});
