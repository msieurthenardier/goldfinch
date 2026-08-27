'use strict';

// Positive-control scan (M16 F2 Leg 1/2, DD4/DD5/DD12): the removed `HOMEPAGE`
// constant, the removed engine fallback's quoted id, and either's hardcoded
// URL must never reappear in the four chrome files these legs rewrote. RED if
// any literal is reintroduced — including in a comment (the Flight 1 Grep-AC
// lesson: say "the removed home-page constant" / "the removed engine
// fallback" instead of typing the literal).
//
// M16 F2 Leg 2 adds welcome-controller.js (the engine block renders from the
// SEARCH_ENGINES table, never a hand-typed default) and extends the scan from
// "google.com" (a URL fragment) to the quoted engine-id literal itself —
// leg 2 deletes the app's last `'google'` coalescing fallback
// (navigation-controller.js's toUrl) and the `searchEngineCache` placeholder
// seed, both of which read the bare quoted string, not a URL.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILES = [
  path.join(__dirname, '../../src/renderer/renderer.js'),
  path.join(__dirname, '../../src/renderer/chrome/navigation-controller.js'),
  path.join(__dirname, '../../src/renderer/chrome/tab-controller.js'),
  path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js')
];

test("no HOMEPAGE / google.com / 'google' literal remains in renderer.js, navigation-controller.js, tab-controller.js, or welcome-controller.js", () => {
  for (const file of FILES) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/HOMEPAGE/.test(source), false, `${path.basename(file)} still mentions HOMEPAGE`);
    assert.equal(/google\.com/.test(source), false, `${path.basename(file)} still mentions google.com`);
    assert.equal(
      /['"]google['"]/.test(source),
      false,
      `${path.basename(file)} still mentions the quoted 'google' engine id`
    );
  }
});

// Negative control (proves the positive control above actually exercises the
// regex, per the flight's Grep-AC convention): the shared search-engines
// table IS allowed to carry 'google.com' — this leg never touches it.
test('negative control: src/shared/search-engines.js is allowed to mention google.com (not scanned above)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/shared/search-engines.js'), 'utf8');
  assert.equal(/google\.com/.test(source), true, 'sanity: the curated table should still define the google engine');
});
