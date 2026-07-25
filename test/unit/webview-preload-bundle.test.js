'use strict';

// Bundle-integrity pin (flight/02 leg 1 — preload-bundling-infra, AC7).
// Model: test/unit/preload-graph-esm-free.test.js (forward pin, not a
// closed-cache assertion).
//
// The web-guest preload (webview-preload.js) is bundled by esbuild into
// src/preload/webview-preload.bundle.js so a SANDBOXED preload's restricted
// module loader (leg 2) can load it — sandboxed preloads cannot resolve
// relative require()s. This test asserts the property that makes that
// possible: no relative require() survives bundling, require('electron')
// stays external, and the two inlined leaves' exported functions are present
// in the output.
//
// The bundle is a gitignored, regenerated-at-every-entry artifact (never
// committed — see DD1/DD2 in the flight spec) — this test rebuilds it itself
// via `npm run build:preload` so it is hermetic and does not depend on
// whatever pretest/prestart hook ran before it. esbuild is a devDependency,
// present in CI.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const bundlePath = path.join(repoRoot, 'src', 'preload', 'webview-preload.bundle.js');

// Rebuild fresh before asserting — hermetic regardless of what ran (or didn't
// run) before this test file, and doubles as a regression check that
// `npm run build:preload` itself succeeds (AC1).
execFileSync('node', [path.join(repoRoot, 'scripts', 'build-preload.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit'
});

test('build:preload emits the bundle (AC1)', () => {
  assert.ok(fs.existsSync(bundlePath), `expected bundle at ${bundlePath} after npm run build:preload`);
});

test('bundle has no surviving relative require — sandbox-loadability property (AC2)', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');

  // Anti-vacuous guard: the bundle must be non-trivial (the two leaves are
  // hundreds of lines combined) — an empty/near-empty read would mean this
  // walk isn't reading what it thinks.
  assert.ok(src.length > 1000, `bundle unexpectedly small (${src.length} bytes) — build may have failed silently`);

  const relativeRequire = /require\((['"])\.\.?\//;
  assert.equal(
    relativeRequire.test(src),
    false,
    'bundle contains a surviving relative require() — a sandboxed preload\'s restricted loader ' +
      'cannot resolve this at runtime (the exact property leg 2\'s sandbox flip depends on)'
  );
});

test('bundle keeps require("electron") external (AC1/AC2)', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');
  assert.match(src, /require\((['"])electron\1\)/, 'expected require("electron") to remain external in the bundle');
});

test('bundle inlines the two leaves — their exported function names are present (AC3)', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');

  // esbuild may rename these to avoid symbol collisions (e.g. `fillLoginForm2`)
  // when no-minify keeps readable names — substring checks are deliberately
  // used (not exact-identifier regexes) so the pin survives that renaming
  // while still proving the leaf source is present, not just referenced.
  const expectedNames = ['fillLoginForm', 'findAllLoginFields', 'findLoginFields', 'createVaultIconController'];
  for (const name of expectedNames) {
    assert.ok(src.includes(name), `expected inlined function name "${name}" to appear in the bundle`);
  }
});

test('bundle is CJS (no leftover ESM export syntax)', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');
  assert.equal(/^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m.test(src), false);
});
