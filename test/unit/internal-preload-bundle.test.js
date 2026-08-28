'use strict';

// Bundle-integrity pin for the internal/trusted preload (M17 Flight 1 Leg 1,
// DD5 / AC8). Cloned from test/unit/webview-preload-bundle.test.js: the
// internal preload (internal-preload.js, sandboxed since construction —
// register-tab-ipc.js's trusted branch) previously had ZERO relative
// require()s, so it never needed bundling. The guest tab-boundary signal
// (DD2) gives it its first one — require('../shared/tab-boundary') — which a
// sandboxed preload's restricted loader cannot resolve unbundled, so it now
// gets the same esbuild treatment as the web branch.
//
// Model: test/unit/preload-graph-esm-free.test.js / webview-preload-bundle.test.js
// (forward pin, not a closed-cache assertion).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const bundlePath = path.join(repoRoot, 'src', 'preload', 'internal-preload.bundle.js');

// Rebuild fresh before asserting — hermetic regardless of what ran (or didn't
// run) before this test file, and doubles as a regression check that
// `npm run build:preload` itself succeeds.
execFileSync('node', [path.join(repoRoot, 'scripts', 'build-preload.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit'
});

test('build:preload emits the internal-preload bundle (AC8)', () => {
  assert.ok(fs.existsSync(bundlePath), `expected bundle at ${bundlePath} after npm run build:preload`);
});

test('bundle has no surviving relative require — sandbox-loadability property', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');

  // Anti-vacuous guard: the bundle must be non-trivial (internal-preload.js
  // alone is hundreds of lines) — an empty/near-empty read would mean this
  // walk isn't reading what it thinks.
  assert.ok(src.length > 1000, `bundle unexpectedly small (${src.length} bytes) — build may have failed silently`);

  const relativeRequire = /require\((['"])\.\.?\//;
  assert.equal(
    relativeRequire.test(src),
    false,
    "bundle contains a surviving relative require() — a sandboxed preload's restricted loader " +
      'cannot resolve this at runtime'
  );
});

test('bundle keeps require("electron") external', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');
  assert.match(src, /require\((['"])electron\1\)/, 'expected require("electron") to remain external in the bundle');
});

test('bundle inlines the tab-boundary leaf — its exported function names are present', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');

  // esbuild may rename these to avoid symbol collisions when no-minify keeps
  // readable names — substring checks are deliberately used (not exact-
  // identifier regexes) so the pin survives that renaming while still
  // proving the leaf source is present, not just referenced.
  const expectedNames = ['tabBoundary', 'tabSequence'];
  for (const name of expectedNames) {
    assert.ok(src.includes(name), `expected inlined function name "${name}" to appear in the bundle`);
  }
});

test('bundle is CJS (no leftover ESM export syntax)', () => {
  const src = fs.readFileSync(bundlePath, 'utf8');
  assert.equal(/^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m.test(src), false);
});
