'use strict';

// End-to-end test (Mission 21, Flight 4, Leg 3 — generate-in-picker, AC16):
// proves "a generated password survives into the vault through the SAME save
// path as a typed one" at the PLANNER boundary, with no mechanism shortcuts —
// drives the scenario from `fillGeneratedForm`'s real output, grants
// provenance through the REAL observer's `grantForFill`, resolves the form's
// own submit-button target, and runs the REAL `resolveGestureTargets` +
// `planCaptures` resolver/planner chain (never a reimplementation of any of
// it — the `planSignupEmailAsUsernameFixture` precedent in
// vault-capture-plan.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { extractFixtureFile } = require('../helpers/fixture-extractor');
const { planCaptures } = require('../../src/preload/vault-capture-plan');
const { findAllLoginFields, fillGeneratedForm } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');
const { findAllIdentityFields } = require('../../src/preload/vault-identity-fields');
const { createEntryObserver } = require('../../src/preload/vault-entry-observer');
const { resolveGestureTargets } = require('../../src/preload/vault-gesture-policy');

const GENERATED = 'Zz9-Kq2!VvLmN4pR'; // stand-in for a real generated candidate

function fixture(name) {
  return path.join(__dirname, '..', 'fixtures', 'save-moment', 'password-roles', name);
}

/**
 * Drive the real end-to-end chain for one fixture: fillGeneratedForm ->
 * observer.grantForFill -> resolveGestureTargets(submit button) ->
 * planCaptures. Returns the planned login entry, or undefined.
 * @param {string} fixtureName
 */
function planGeneratedFillFixture(fixtureName) {
  const doc = extractFixtureFile(fixture(fixtureName));
  const logins = findAllLoginFields(doc);
  const cards = findAllCardFields(doc);
  const identities = findAllIdentityFields(doc);

  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields,
    findAllCardFields,
    findAllIdentityFields
  });
  // Grant provenance for every OTHER login field's fixture-pre-set value
  // (username, and — on the change-password fixture — the current password)
  // BEFORE the generated fill, standing in for "the operator typed this" —
  // the same idiom vault-capture-plan.test.js's
  // `planSignupEmailAsUsernameFixture` uses. The fill below then overwrites
  // ONLY the new/confirm fields and grants THEIR provenance itself.
  for (const entry of logins) {
    if (entry.username && entry.username.value) observer._grant(entry.username);
    if (entry.password && entry.password.getAttribute('autocomplete') === 'current-password' && entry.password.value) {
      observer._grant(entry.password);
    }
  }

  // The clicked field's own ordinal is arbitrary within the scope — 0, the
  // handle's own scope-widening finds the real 'new' field regardless of
  // which field in the scope was clicked (AC6's own guarantee).
  const fillResult = fillGeneratedForm(doc, [GENERATED], 0);
  assert.equal(fillResult.filled, true, 'fillGeneratedForm must actually fill this fixture');
  observer.grantForFill(fillResult);
  const snapshot = observer.snapshot();

  const target = doc.querySelector('button[type=submit]');
  const resolved = resolveGestureTargets(target, { logins, cards, identities });
  const entriesByKind = { login: logins, card: cards, identity: identities };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });

  return plan.find((c) => c.kind === 'login');
}

test('AC16: a sign-up fixture — the generated value survives into the planned login password', () => {
  const loginPlan = planGeneratedFillFixture('signup-new-password-marked.html');
  assert.ok(loginPlan, 'expected a login capture to be planned');
  assert.equal(new TextDecoder().decode(loginPlan.payload.password), GENERATED);
  assert.equal(loginPlan.payload.currentPassword, undefined, 'a sign-up plans no currentPassword');
});

test('AC16: a change-password fixture — the generated value survives, alongside the CURRENT password', () => {
  const loginPlan = planGeneratedFillFixture('change-password-three-marked.html');
  assert.ok(loginPlan, 'expected a login capture to be planned');
  assert.equal(new TextDecoder().decode(loginPlan.payload.password), GENERATED);
  assert.ok(loginPlan.payload.currentPassword instanceof Uint8Array, 'the current password must ride the payload too');
  // The fixture's own pre-set current-password value (untouched by the fill —
  // fillGeneratedForm never writes the `current` field) is what should have
  // been provenanced and planned as currentPassword.
  assert.equal(new TextDecoder().decode(loginPlan.payload.currentPassword), 'OldPass1!');
});
