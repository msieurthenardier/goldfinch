'use strict';

// Squawk 0062 (squawks/0062-badging-api-taskbar-badge.md): a web page could stamp a
// number onto the Goldfinch taskbar/dock icon through the Badging API
// (navigator.setAppBadge), which Electron forwards straight to the app-level badge
// with no permission string — session-runtime.js's positive permission allowlist
// never sees it, and Chromium has no runtime feature to switch it off
// (`--disable-blink-features=Badging` was verified live to be a no-op). The guest
// preload therefore deletes setAppBadge/clearAppBadge from Navigator.prototype at
// module top, before any page script runs.
//
// The end-to-end effect (the methods absent in a live top-frame renderer, a page
// call throwing) needs a real Chromium and is verified over the MCP `evaluate` op,
// not here. This is a source-scan pin in the guest-tab-boundary-preload-pin.test.js
// style over the preload source. It pins what IS checkable offline:
//   1. webview-preload.js deletes BOTH methods from Navigator.prototype.
//   2. The deletion sits at module top — before the preload's first listener
//      registration (the captured-native keydown handoff), i.e. in the region that
//      executes as the page's first script.
//   3. The product itself never sets a badge (no app.setBadgeCount / setOverlayIcon /
//      setAppBadge call in src/), so removing the API removes no product behavior.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, collectSources } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(REPO_ROOT, 'src', 'preload', 'webview-preload.js');
const SRC_DIR = path.join(REPO_ROOT, 'src');

// The removal loop: `for (const name of ['setAppBadge', 'clearAppBadge']) { … delete
// Navigator.prototype[name] … }` — wrap-insensitive (CLAUDE.md's regex-target pin
// convention), order of the two names fixed.
const REMOVAL_RE =
  /for\s*\(\s*const\s+name\s+of\s*\[\s*'setAppBadge'\s*,\s*'clearAppBadge'\s*\]\s*\)\s*\{[\s\S]{0,200}?delete\s+Navigator\.prototype\[name\]/;

function readMaskedPreload() {
  return maskComments(fs.readFileSync(PRELOAD, 'utf8'));
}

test('webview-preload.js deletes setAppBadge and clearAppBadge from Navigator.prototype', () => {
  const masked = readMaskedPreload();
  assert.match(
    masked,
    REMOVAL_RE,
    "expected webview-preload.js to loop over ['setAppBadge', 'clearAppBadge'] and delete Navigator.prototype[name]"
  );
});

test('the Badging removal runs at module top, before the first listener registration', () => {
  const masked = readMaskedPreload();
  const removalIdx = masked.search(REMOVAL_RE);
  assert.notEqual(removalIdx, -1, 'expected the Badging removal loop in webview-preload.js');

  const firstListenerIdx = masked.search(/nativeAddEventListener\(\s*'keydown'/);
  assert.notEqual(firstListenerIdx, -1, 'expected the captured-native keydown registration in webview-preload.js');
  assert.ok(
    removalIdx < firstListenerIdx,
    'the Badging removal must precede the preload’s first listener registration (module-top, first-script region)'
  );

  // Top level, unguarded: every `{` opened before the loop must have been closed
  // again — an unmatched brace means the loop sits inside an `if`, a function, or
  // an IIFE, i.e. a code path exists where the removal never runs. Brace depth is
  // counted over the comment-masked text (string/regex bodies in this preload's
  // top region carry no braces; a future one would surface here as a loud fail,
  // not a silent pass).
  const before = masked.slice(0, removalIdx);
  const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
  assert.equal(depth, 0, `expected the Badging removal at module top level (brace depth 0), got depth ${depth}`);
});

test('the product itself never sets an app badge, so removing the API removes no feature', () => {
  const offenders = [];
  for (const file of collectSources(SRC_DIR)) {
    const masked = maskComments(fs.readFileSync(file, 'utf8'));
    // The preload's own `delete Navigator.prototype[name]` loop names the methods as
    // string literals, never as a call — this call-shaped scan does not match it.
    if (/\b(setBadgeCount|setOverlayIcon|setAppBadge|clearAppBadge)\s*\(/.test(masked)) {
      offenders.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `expected no badge-setting call in src/, found in: ${offenders.join(', ')}`);
});
