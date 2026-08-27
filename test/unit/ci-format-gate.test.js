'use strict';

// Source-pin for squawk 0042 (CI format gate has no test guard). Flight 5 wired
// `npm run format:check` into ci/tasks/lint.yml and .github/workflows/ci.yml, and added
// the script to package.json — verified once by hand, guarded by nothing. A future edit
// to either CI file or to package.json's scripts could silently drop the gate. This test
// statically parses the three files as text — no boot, no YAML/JSON execution beyond
// JSON.parse of package.json — and asserts presence/ordering, matching the static-parse
// house style used by test/unit/seam-contract.test.js and
// test/unit/a11y-audit-exit-codes.test.js for scripts/a11y-audit.mjs.
//
// Every assertion here is a presence/ordering check (there is no "assert absence of
// nothing" case that would apply — the corrective action is entirely additive), so each
// anchor is asserted with assert.ok/assert.equal against an extracted value, never a
// vacuous truthy-string check, and a missing anchor fails loudly with the actual value.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const LINT_YML = path.join(REPO_ROOT, 'ci/tasks/lint.yml');
const CI_YML = path.join(REPO_ROOT, '.github/workflows/ci.yml');
const PRETTIERIGNORE = path.join(REPO_ROOT, '.prettierignore');

test('package.json: format and format:check scripts are pinned to prettier', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  assert.ok(pkg.scripts, 'package.json has no "scripts" object');
  assert.equal(
    pkg.scripts['format:check'],
    'prettier --check .',
    `expected scripts["format:check"] === 'prettier --check .', found ${JSON.stringify(pkg.scripts['format:check'])}`
  );
  assert.equal(
    pkg.scripts.format,
    'prettier --write .',
    `expected scripts.format === 'prettier --write .', found ${JSON.stringify(pkg.scripts.format)}`
  );
});

test('ci/tasks/lint.yml: runs npm run lint before npm run format:check', () => {
  const source = fs.readFileSync(LINT_YML, 'utf8');

  const lintIdx = source.indexOf('npm run lint');
  assert.ok(lintIdx !== -1, 'ci/tasks/lint.yml does not contain "npm run lint"');

  const formatCheckIdx = source.indexOf('npm run format:check');
  assert.ok(formatCheckIdx !== -1, 'ci/tasks/lint.yml does not contain "npm run format:check"');

  assert.ok(
    lintIdx < formatCheckIdx,
    'ci/tasks/lint.yml must run "npm run lint" before "npm run format:check", found the reverse order'
  );
});

test('.github/workflows/ci.yml: a "Format check" step runs npm run format:check after the "Lint" step', () => {
  const source = fs.readFileSync(CI_YML, 'utf8');

  // Locate the "Lint" step's run: line.
  const lintStepMatch = source.match(/- name: Lint\s*\n\s*run: (.+)/);
  assert.ok(lintStepMatch, '.github/workflows/ci.yml has no "- name: Lint" step with a run: line');
  assert.equal(
    lintStepMatch[1].trim(),
    'npm run lint',
    `expected the Lint step's run: to be "npm run lint", found ${JSON.stringify(lintStepMatch[1].trim())}`
  );

  // Locate the "Format check" step's run: line.
  const formatStepMatch = source.match(/- name: Format check\s*\n\s*run: (.+)/);
  assert.ok(formatStepMatch, '.github/workflows/ci.yml has no "- name: Format check" step with a run: line');
  assert.equal(
    formatStepMatch[1].trim(),
    'npm run format:check',
    `expected the Format check step's run: to be "npm run format:check", found ${JSON.stringify(
      formatStepMatch[1].trim()
    )}`
  );

  // Ordering: the Format check step must appear after the Lint step in source order.
  const lintPos = source.indexOf('- name: Lint');
  const formatPos = source.indexOf('- name: Format check');
  assert.ok(
    lintPos < formatPos,
    '.github/workflows/ci.yml must position the "Format check" step after the "Lint" step, found the reverse order'
  );
});

test('.prettierignore: still excludes the generated preload bundle and the lockfile', () => {
  const source = fs.readFileSync(PRETTIERIGNORE, 'utf8');
  const entries = source.split(/\r?\n/).map((line) => line.trim());

  assert.ok(
    entries.includes('src/preload/webview-preload.bundle.js'),
    '.prettierignore no longer excludes src/preload/webview-preload.bundle.js — the generated bundle could ' +
      'break the format:check gate'
  );
  assert.ok(
    entries.includes('package-lock.json'),
    '.prettierignore no longer excludes package-lock.json — the generated lockfile could break the ' +
      'format:check gate'
  );
});
