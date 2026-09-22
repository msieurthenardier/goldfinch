'use strict';

// CONTRACT test for the Generate-in-picker gesture payload chain (Mission 21,
// Flight 4, Leg 5 — hat-and-alignment, HAT step 4 FAIL fix). Not a unit test of
// any one hop — every existing test in this area (password-field-roles.test.js,
// password-policy.test.js, vault-controller-generate.test.js's payload tests)
// feeds a HAND-BUILT payload into exactly one hop of
//   findAllLoginFields (preload, real DOM-shaped fixture)
//     -> generateGestureInfo (preload, src/preload/password-field-roles.js)
//     -> sanitizeGenerateConstraints + resolvePolicy (src/shared/password-policy.js)
//     -> validateGenerateGesture (main, src/main/register-browser-ipc.js)
// so no test ever fed the PRELOAD's real output into MAIN's real validator.
// That gap hid the defect this test pins: `generateGestureInfo` emits
// `{ minLength: null, maxLength: null, passwordRules: null }` for a field with
// no length attributes (via `parseIntOrNull`), but `sanitizeGenerateConstraints`
// treated only `undefined`/`-1` as "absent" and rejected `null` as malformed —
// so EVERY unconstrained new-password field lost the "Generate strong
// password" row entirely (the picker degraded to the bare gesture,
// `canGenerate` never computed).
//
// This test drives the real fixture corpus (test/fixtures/save-moment,
// 'password-roles' family) through the REAL chain end to end, with no
// hand-built payload at any hop — the same reasoning as save-moment-corpus.test.js's
// own "no snapshot / golden-file baselines" house rule, applied one layer over
// (gesture-info correctness, not detection correctness).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractFixtureFile } = require('../helpers/fixture-extractor');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');
const { generateGestureInfo } = require('../../src/preload/password-field-roles');
const { validateGenerateGesture } = require('../../src/main/register-browser-ipc');
const manifest = require('../fixtures/save-moment/manifest');

const FIXTURES_DIR = require('node:path').join(__dirname, '..', 'fixtures', 'save-moment');

// Every gated 'plans-login' fixture whose own `expectRoles` includes a 'new'
// role — the population the flight-log's HAT step 4 defect covers (a
// new-password field somewhere in the scope). `expectRoles: 'sign-in'`
// (a plain string, not an array) is excluded by construction: Array.isArray
// is false for it.
const NEW_PASSWORD_FIXTURES = manifest.filter(
  (e) =>
    e.tier === 'gated' && e.assert === 'plans-login' && Array.isArray(e.expectRoles) && e.expectRoles.includes('new')
);

// Sanity: the six fixtures the task named explicitly must all be present in
// the filtered set — guards against a future manifest edit silently narrowing
// this test's own coverage.
const REQUIRED_IDS = [
  'signup-new-password-marked',
  'signup-password-confirm-unmarked',
  'change-password-three-marked',
  'change-password-three-unmarked',
  'change-password-no-username',
  'current-new-marked'
];

test('generate-gesture-contract: the named fixtures are present in the filtered new-password population', () => {
  const ids = NEW_PASSWORD_FIXTURES.map((e) => e.id);
  for (const id of REQUIRED_IDS) {
    assert.ok(ids.includes(id), `expected '${id}' in the new-password fixture population, got [${ids.join(', ')}]`);
  }
});

for (const entry of NEW_PASSWORD_FIXTURES) {
  test(`generate-gesture-contract: ${entry.id} — real preload output validates canGenerate: true main-side`, () => {
    const doc = extractFixtureFile(require('node:path').join(FIXTURES_DIR, entry.file));
    const entries = findAllLoginFields(doc);
    assert.ok(entries.length > 0, `expected at least one detected login entry in ${entry.id}`);

    // Find the ordinal generateGestureInfo resolves a 'new' role for — mirrors
    // the docstring's own "regardless of which field within the scope was
    // actually clicked" contract: any ordinal in the scope resolves the same
    // outcome, so we don't need to reproduce which button the fixture's own
    // gestureSelector targets.
    let info = null;
    for (let i = 0; i < entries.length; i++) {
      const candidate = generateGestureInfo(entries, i);
      if (candidate.passwordRole === 'new') {
        info = candidate;
        break;
      }
    }
    assert.ok(info, `expected generateGestureInfo to resolve a 'new' role somewhere in ${entry.id}`);

    // The real chain: main's validator sees exactly the preload's own output,
    // wrapped the way guest-vault-gesture's payload actually carries it.
    const result = validateGenerateGesture({ generate: info });
    assert.ok(result, `expected validateGenerateGesture to accept the real preload payload for ${entry.id}, got null`);
    assert.equal(
      result.canGenerate,
      true,
      `expected canGenerate: true for ${entry.id}, constraints were malformed/unsatisfiable`
    );
  });
}

test('generate-gesture-contract: signin-current-password — no ordinal ever resolves a new role, validateGenerateGesture never called with a truthy generate payload', () => {
  const doc = extractFixtureFile(
    require('node:path').join(FIXTURES_DIR, 'password-roles', 'signin-current-password.html')
  );
  const entries = findAllLoginFields(doc);
  assert.ok(entries.length > 0, 'expected at least one detected login entry');

  for (let i = 0; i < entries.length; i++) {
    const info = generateGestureInfo(entries, i);
    assert.equal(info.passwordRole, null, `expected no 'new' role at ordinal ${i} for a sign-in field`);
    assert.equal(validateGenerateGesture({ generate: info }), null);
  }
});
