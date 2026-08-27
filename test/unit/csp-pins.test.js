'use strict';

// CSP pin (Mission 13 Flight 1 / Leg 2 — DD2/AC4). Source-scan style test
// reading each renderer document as text (pattern precedent:
// test/unit/chrome-shared-scripts.test.js, which reads INDEX_HTML the same
// way) and extracting the <meta http-equiv="Content-Security-Policy"> content
// attribute. Non-vacuous: every assertion below fails loudly if the meta tag
// itself is missing (extractCsp throws rather than returning an empty/falsy
// value that would make the token-absence assertions pass for the wrong
// reason).
//
// Chrome (index.html): img-src/media-src must have shed http:/https: entirely
// (the cross-jar fetch/proxy fix, DD2) and must include the new
// goldfinch-media: scheme (the only way the chrome fetches remote media now).
//
// The three overlay documents (find-overlay, menu-overlay, tearoff-overlay)
// must stay unable to reach the proxy scheme or the open web at all — their
// CSPs are strict (`default-src 'self'`/`'none'`) and must never gain http:,
// https:, or goldfinch-media: sources, by omission or by future edit.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RENDERER_DIR = path.join(__dirname, '../../src/renderer');
const INDEX_HTML = path.join(RENDERER_DIR, 'index.html');
const FIND_OVERLAY_HTML = path.join(RENDERER_DIR, 'find-overlay.html');
const MENU_OVERLAY_HTML = path.join(RENDERER_DIR, 'menu-overlay.html');
const TEAROFF_OVERLAY_HTML = path.join(RENDERER_DIR, 'tearoff-overlay.html');

// Extracts the Content-Security-Policy meta tag's `content` attribute value
// from an HTML document on disk. Throws (never returns '' or null) if the
// meta tag isn't found, so a markup drift fails the test loudly instead of
// making every downstream token-absence assertion vacuously true.
function extractCsp(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const metaRe = /<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;
  const metaMatch = metaRe.exec(html);
  if (!metaMatch) {
    throw new Error(`No Content-Security-Policy meta tag found in ${htmlPath}`);
  }
  const contentMatch = /content="([^"]*)"/.exec(metaMatch[0]);
  if (!contentMatch || !contentMatch[1]) {
    throw new Error(`Content-Security-Policy meta tag has no non-empty content attribute in ${htmlPath}`);
  }
  return contentMatch[1];
}

// Pull out a single directive's value list (e.g. "img-src") from a CSP string.
function directive(csp, name) {
  const re = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`, 'i');
  const m = re.exec(csp);
  if (!m) throw new Error(`Directive "${name}" not found in CSP: ${csp}`);
  return m[1].trim();
}

test('chrome index.html CSP: img-src/media-src drop http:/https: and gain goldfinch-media: (DD2/AC4)', () => {
  const csp = extractCsp(INDEX_HTML);

  const imgSrc = directive(csp, 'img-src');
  const mediaSrc = directive(csp, 'media-src');

  for (const [name, value] of [
    ['img-src', imgSrc],
    ['media-src', mediaSrc]
  ]) {
    assert.equal(/\bhttp:/.test(value), false, `${name} must not contain http: — got "${value}"`);
    assert.equal(/\bhttps:/.test(value), false, `${name} must not contain https: — got "${value}"`);
    assert.equal(/\bgoldfinch-media:/.test(value), true, `${name} must contain goldfinch-media: — got "${value}"`);
  }

  // Other directives (default-src, style-src) are untouched by this leg.
  assert.equal(directive(csp, 'default-src'), "'self'");
});

test('overlay documents stay unreachable from the proxy scheme and the open web (DD2/AC4)', () => {
  for (const overlayPath of [FIND_OVERLAY_HTML, MENU_OVERLAY_HTML, TEAROFF_OVERLAY_HTML]) {
    const csp = extractCsp(overlayPath);
    assert.equal(/\bhttp:/.test(csp), false, `${overlayPath}: CSP must not contain http: — got "${csp}"`);
    assert.equal(/\bhttps:/.test(csp), false, `${overlayPath}: CSP must not contain https: — got "${csp}"`);
    assert.equal(
      /\bgoldfinch-media:/.test(csp),
      false,
      `${overlayPath}: CSP must not contain goldfinch-media: — got "${csp}"`
    );
  }
});
