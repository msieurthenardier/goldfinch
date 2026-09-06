'use strict';

// Unit tests for src/main/vault/sever-offer.js (M18 F3 Leg 3 / DD7) — the extracted, pure
// (secretKind × lock-state) route truth table behind the post-fresh-adopt sever offer card.
// Electron-free: no store, no main.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeSeverOfferRoute } = require('../../src/main/vault/sever-offer');

test('master-kind adopt while UNLOCKED routes to change-master (the operator knows the donor password — a real step-up)', () => {
  assert.equal(computeSeverOfferRoute('master', true), 'change-master');
});

test('master-kind adopt while LOCKED routes to recover (changeMasterPassword is unreachable locked)', () => {
  assert.equal(computeSeverOfferRoute('master', false), 'recover');
});

test('recovery-kind adopt routes to recover regardless of lock state (the recovery key IS the step-up)', () => {
  assert.equal(computeSeverOfferRoute('recovery', true), 'recover');
  assert.equal(computeSeverOfferRoute('recovery', false), 'recover');
});

test('the route flips LIVE on the same offer as lock state changes (DD7 edge case: "Sever card while locked")', () => {
  // The same secretKind, evaluated at two different lock states, must produce two different
  // routes for the master case — this is what makes the offer's route recomputed at QUERY
  // TIME (never cached) meaningful.
  const secretKind = 'master';
  assert.equal(computeSeverOfferRoute(secretKind, true), 'change-master');
  assert.equal(computeSeverOfferRoute(secretKind, false), 'recover');
});
