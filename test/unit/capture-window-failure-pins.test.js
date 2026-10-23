'use strict';

// Squawk 0155 — source-scan pins over main.js grabWindow's Wayland composite fallback.
//
// No test in this repo loads main.js (test/helpers/source-scan.js says so), so the wiring
// that makes a captureWindow failure NAME its cause is pinned here as a scan. The helper's
// behavior is unit-tested in capture-failure.test.js. What is pinned:
//
//   P1 — the catch-all SWALLOWS NOTHING: it throws captureFailure('composite', err), and the
//        only `return null`s left in grabWindow are the two genuine no-window cases (no
//        record, destroyed chrome) — the only cases 'automation: chrome window unavailable'
//        is allowed to claim (automation-observe.test.js pins that string verbatim).
//   P2 — the chrome capture's rejection is named per step ('chrome').
//   P3 — the active guest capture goes through captureWithOneRetry (the bounded retry for a
//        not-yet-painted guest), labelled 'active guest'.
//   P4 — the guest layer is gated on the guest view being ON SCREEN (view.getVisible()),
//        both before the first attempt and inside the retried thunk: a guest hidden behind
//        a chrome takeover panel is never composited over that panel.
//   P5 — an empty chrome image is a named refusal, not a null.
//
// Regexes are wrap-insensitive (\s*) per the regex-target mutation-pin convention, and every
// mutation is guarded by assertMutated so a stale .replace() target fails instead of passing
// vacuously. Comments are masked (maskComments preserves offsets) so prose can neither trip
// nor satisfy a scan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main', 'main.js');
const REAL = fs.readFileSync(MAIN, 'utf8');

/** @param {string} source @returns {string} grabWindow's comment-masked body ('' when absent) */
function grabWindowBody(source) {
  const masked = maskComments(source);
  const head = masked.indexOf('async function grabWindow(');
  if (head === -1) return '';
  const open = masked.indexOf('{', head);
  const close = findMatchingBracket(masked, open, '{', '}');
  return close === -1 ? '' : masked.slice(open, close + 1);
}

/**
 * Run every pin against a source; returns the names of the pins that FAIL.
 * @param {string} source
 * @returns {string[]}
 */
function failingPins(source) {
  const body = grabWindowBody(source);
  if (!body) return ['subject'];
  const failed = [];

  // P1 — catch-all throws the named refusal; exactly the two no-window `return null`s remain.
  const lastCatch = body.lastIndexOf('catch (err)');
  const tail = lastCatch === -1 ? '' : body.slice(lastCatch);
  if (!/catch\s*\(err\)\s*\{\s*throw\s+captureFailure\(\s*'composite'\s*,\s*err\s*\)\s*;\s*\}\s*\}$/.test(tail)) {
    failed.push('P1-catch-all');
  }
  // Template literals are blanked first: the executeJavaScript composite script has its own
  // `return null;` (a dropped layer), which runs in the chrome renderer, not in grabWindow.
  const code = body.replace(/`[^`]*`/g, '``');
  const nulls = code.match(/return\s+null\s*;/g) || [];
  const allowed =
    (code.match(/if\s*\(\s*!grabRec\s*\)\s*return\s+null\s*;/g) || []).length +
    (code.match(/if\s*\(\s*!cc\s*\|\|\s*cc\.isDestroyed\(\)\s*\)\s*return\s+null\s*;/g) || []).length;
  if (nulls.length !== 2 || allowed !== 2) failed.push('P1-null-returns');

  // P2 — chrome capture rejection named 'chrome'.
  if (
    !/withCaptureTimeout\(\s*cc\.capturePage\(\)\s*,\s*'chrome'\s*\)\s*\.catch\(\s*\(err\)\s*=>\s*\{\s*throw\s+captureFailure\(\s*'chrome'\s*,\s*err\s*\)/.test(
      body
    )
  ) {
    failed.push('P2-chrome-named');
  }

  // P3 — guest capture through the one bounded retry.
  if (!/captureWithOneRetry\(\s*captureGuest\s*,\s*'active guest'\s*\)/.test(body)) failed.push('P3-guest-retry');

  // P4 — on-screen gate, before the first attempt AND inside the retried thunk.
  if (!/const\s+atc\s*=[^;]*activeEntry\.view\.getVisible\(\)[^;]*;/.test(body)) failed.push('P4-gate-atc');
  if (
    !/const\s+captureGuest\s*=\s*\(\)\s*=>[^;]*activeEntry\.view\.getVisible\(\)[^;]*withCaptureTimeout\(\s*atc\.capturePage\(\)\s*,\s*'active guest'\s*\)/.test(
      body
    )
  ) {
    failed.push('P4-gate-retry');
  }

  // P5 — empty chrome image named.
  if (
    !/if\s*\(\s*!chromeImg\s*\|\|\s*chromeImg\.isEmpty\(\)\s*\)\s*throw\s+captureFailure\(\s*'chrome'\s*,/.test(body)
  ) {
    failed.push('P5-empty-chrome');
  }
  return failed;
}

/** @param {string} before @param {string} after @param {string} what */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

test('squawk 0155: grabWindow names every composite failure (all pins hold on the real source)', () => {
  assert.deepEqual(failingPins(REAL), []);
});

test('squawk 0155: the helpers are imported from the Electron-free module, not re-implemented', () => {
  const masked = maskComments(REAL);
  assert.ok(
    /const\s*\{\s*captureFailure\s*,\s*captureWithOneRetry\s*\}\s*=\s*require\(\s*'\.\/capture-failure'\s*\)/.test(
      masked
    )
  );
});

// --- neuter verification: each pin goes red on the defect it exists to catch -------------

test('neuter P1: restoring the old swallow-to-null catch-all fails the pin', () => {
  const mutated = REAL.replace(/throw\s+captureFailure\(\s*'composite'\s*,\s*err\s*\)\s*;(\s*)\}\n\}/, (_m, ws) => {
    return `/* fallback failed */${ws}}\n  return null;\n}`;
  });
  assertMutated(REAL, mutated, 'catch-all swallow');
  const failed = failingPins(mutated);
  assert.ok(failed.includes('P1-catch-all'), String(failed));
  assert.ok(failed.includes('P1-null-returns'), String(failed));
});

test('neuter P1: a NEW bare `return null` anywhere in grabWindow fails the pin', () => {
  const mutated = REAL.replace(
    /if\s*\(\s*!chromeImg\s*\|\|\s*chromeImg\.isEmpty\(\)\s*\)\s*throw\s+captureFailure\([^;]*;/,
    'if (!chromeImg) return null;'
  );
  assertMutated(REAL, mutated, 'bare return null');
  const failed = failingPins(mutated);
  assert.ok(failed.includes('P1-null-returns'), String(failed));
  assert.ok(failed.includes('P5-empty-chrome'), String(failed));
});

test('neuter P2: an unlabelled chrome capture fails the pin', () => {
  const mutated = REAL.replace(
    /withCaptureTimeout\(\s*cc\.capturePage\(\)\s*,\s*'chrome'\s*\)\.catch\(\(err\)\s*=>\s*\{\s*throw\s+captureFailure\(\s*'chrome'\s*,\s*err\s*\);\s*\}\)/,
    "withCaptureTimeout(cc.capturePage(), 'chrome')"
  );
  assertMutated(REAL, mutated, 'unlabelled chrome capture');
  assert.ok(failingPins(mutated).includes('P2-chrome-named'));
});

test('neuter P3: a direct (unretried) guest capture fails the pin', () => {
  const mutated = REAL.replace(/captureWithOneRetry\(\s*captureGuest\s*,\s*'active guest'\s*\)/, 'captureGuest()');
  assertMutated(REAL, mutated, 'unretried guest capture');
  assert.ok(failingPins(mutated).includes('P3-guest-retry'));
});

test('neuter P4: dropping the on-screen gate (first attempt or retry) fails the pin', () => {
  const noAtcGate = REAL.replace(
    /(const\s+atc\s*=\s*activeWc\s*&&\s*!activeWc\.isDestroyed\(\))\s*&&\s*activeEntry\.view\.getVisible\(\)/,
    (_m, keep) => keep
  );
  assertMutated(REAL, noAtcGate, 'atc gate removal');
  assert.ok(failingPins(noAtcGate).includes('P4-gate-atc'));

  const noRetryGate = REAL.replace(
    /(atc\s*&&\s*!atc\.isDestroyed\(\))\s*&&\s*activeEntry\.view\.getVisible\(\)(\s*\?\s*withCaptureTimeout)/,
    (_m, keep, rest) => keep + rest
  );
  assertMutated(REAL, noRetryGate, 'retry gate removal');
  assert.ok(failingPins(noRetryGate).includes('P4-gate-retry'));
});

test('vacuity guard: a renamed/missing grabWindow fails loudly', () => {
  const mutated = REAL.replace('async function grabWindow(', 'async function grabWindowRenamed(');
  assertMutated(REAL, mutated, 'rename');
  assert.deepEqual(failingPins(mutated), ['subject']);
});
