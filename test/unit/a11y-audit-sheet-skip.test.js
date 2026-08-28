'use strict';

// Source-pin for squawk 0045 (a11y-audit sheet-state loop refused since M15 F3).
// scripts/a11y-audit.mjs is a standalone entry-point script (main() is invoked at the
// bottom of the file, it exports nothing importable), so this test statically parses
// the source text — no boot, no vm execution — matching the static-parse house style
// used by test/unit/a11y-audit-exit-codes.test.js and test/unit/seam-contract.test.js
// for the same file.
//
// Squawk 0045: the SHEET_STATES loop used to open each sheet state from the chrome,
// then call `runAxe` (→ `injectScript`) and `evaluate` on the sheet's wcId. Main
// refuses BOTH ops on any sheet wcId, unconditionally, at every tier
// (src/main/automation/resolve.js's isSheetContents guard — CLAUDE.md § MCP
// automation, "READABLE BUT NOT SCRIPTABLE since M15 F3"), so the very first sheet
// state killed the whole run with an apparatus-failure exit (2) before the chrome
// states' results were ever reported. Fixed shape: the sheet loop is replaced with a
// single printed skip notice; SHEET_STATES stays as the record of what is not
// covered, but nothing in the live path opens a sheet state, resolves a sheet wcId,
// or calls runAxe/evaluate on one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const A11Y_AUDIT_MJS = path.join(__dirname, '../../scripts/a11y-audit.mjs');

test('a11y-audit sheet loop: guarded by the skip notice (squawk 0045), never calls runAxe/evaluate on a sheet wcId in the live path', () => {
  const source = fs.readFileSync(A11Y_AUDIT_MJS, 'utf8');

  // SHEET_STATES stays as the record of what is not covered.
  assert.ok(
    /const SHEET_STATES = \[/.test(source),
    'expected SHEET_STATES to remain defined as the record of skipped sheet states'
  );

  // The skip notice must exist and must reference SHEET_STATES.length (so it can
  // never silently go stale relative to the array it is reporting on).
  assert.ok(
    source.includes('a11y-audit: skipping ${SHEET_STATES.length} sheet state(s) — unauditable by axe per '),
    'expected a printed skip notice listing SHEET_STATES.length skipped sheet state(s)'
  );
  assert.ok(
    source.includes('SHEET_STATES.map((s) => s.label).join'),
    'expected the skip notice to list every skipped state label'
  );

  // The live path must never iterate SHEET_STATES to drive the UI (the old
  // `for (const state of SHEET_STATES)` loop that opened each state from the chrome).
  assert.ok(
    !source.includes('for (const state of SHEET_STATES)'),
    'expected no loop over SHEET_STATES in the live path — the sheet loop must stay skipped, not run'
  );

  // The live path must never call runAxe with a sheet-resolved wcId.
  assert.ok(
    !/runAxe\(client,\s*sheetWcId/.test(source),
    'expected no runAxe(client, sheetWcId, ...) call site — axe must never be injected into a sheet'
  );

  // The sheet-wcId discovery/dismissal machinery the old loop depended on
  // (findSheetWcId, SHEET_DISMISS_EXPR, SHEET_CLOSED_EXPR) must no longer be DEFINED
  // (a removal-note comment may still name them historically) — dead, callable code
  // left behind would re-invite exactly this bug.
  assert.ok(
    !/function findSheetWcId/.test(source),
    'expected findSheetWcId to be removed — nothing in the live path resolves a sheet wcId'
  );
  assert.ok(
    !/const SHEET_DISMISS_EXPR\s*=/.test(source),
    'expected SHEET_DISMISS_EXPR to no longer be defined — nothing in the live path evaluates on a sheet wcId'
  );
  assert.ok(
    !/const SHEET_CLOSED_EXPR\s*=/.test(source),
    'expected SHEET_CLOSED_EXPR to no longer be defined — nothing in the live path evaluates on a sheet wcId'
  );
});
