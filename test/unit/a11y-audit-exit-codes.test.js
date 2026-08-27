'use strict';

// Source-pin for squawk 0031 (a11y-audit exit-code collision). scripts/a11y-audit.mjs
// is a standalone entry-point script (main() is invoked at the bottom of the file, it
// exports nothing importable), so this test statically parses the source text — no
// boot, no vm execution — rather than importing and calling into it, matching the
// static-parse house style used by test/unit/seam-contract.test.js for the same file.
//
// Squawk 0031: `fail()` (apparatus/setup failure — could not attach, target not found,
// missing key, etc.) and the "new violations found" branch both used to exit 1, so a
// caller could not tell "the audit didn't run" from "the audit ran and found problems".
// Fixed mapping: 0 clean, 1 new violations, 2 apparatus/setup failure. This pin locks
// each process.exit(...) call to its assigned code so a future edit can't silently
// re-collide fail() with the violations branch (or the clean branch).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const A11Y_AUDIT_MJS = path.join(__dirname, '../../scripts/a11y-audit.mjs');

test('a11y-audit exit codes: fail() exits 2, violations branch exits 1, clean branch exits 0', () => {
  const source = fs.readFileSync(A11Y_AUDIT_MJS, 'utf8');

  // fail() — the sole apparatus/setup-failure exit point (called from every non-clean,
  // non-violations process.exit site: connect failure, getChromeTarget, enumerateTabs,
  // guest-target lookup, findSheetWcId, and the top-level main().catch).
  const failMatch = source.match(
    /function fail\(msg\) \{\s*console\.error\(`a11y-audit: \$\{msg\}`\);\s*process\.exit\((\d+)\);\s*\}/
  );
  assert.ok(failMatch, 'expected a fail(msg) function with a single process.exit(<code>) body');
  assert.equal(
    failMatch[1],
    '2',
    'fail() (apparatus/setup failure) must exit 2 — distinct from the violations branch\'s exit 1, ' +
      'so a caller can tell "not run" from "red" (squawk 0031)'
  );

  // The two report-branch exits in main(): clean (0) precedes new-violations (1) in
  // source order, and no other process.exit(...) sites exist outside fail() and these
  // two — every apparatus-failure path funnels through fail() instead of a bare exit.
  const exitCalls = [...source.matchAll(/process\.exit\((\d+)\);/g)].map((m) => m[1]);
  assert.deepEqual(
    exitCalls,
    ['2', '0', '1'],
    `expected exactly three process.exit(...) call sites in source order — fail()'s 2, the clean ` +
      `branch's 0, then the new-violations branch's 1 — found ${JSON.stringify(exitCalls)}. If a new ` +
      'exit site was added, classify it (apparatus failure vs. violations vs. clean) and update this pin.'
  );
});
