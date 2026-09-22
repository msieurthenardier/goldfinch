'use strict';

// Unit tests for the pure PER-FAMILY CAPTURE PLANNER (Mission 21, Flight 3,
// Leg 6 — gesture-holds-every-family, LD2 — rewritten at design review, HIGH).
// See vault-capture-plan.js's own header for why this module exists at all:
// the property under test here — "every resolving family is planned
// independently, regardless of processing order or another family's own
// gate" — is exactly the property a naive per-family loop inside
// `onCaptureGesture` could silently violate, on the headline combined-form
// scenario this whole leg exists to fix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { planCaptures } = require('../../src/preload/vault-capture-plan');
// AC6b: loads a REAL corpus fixture and drives the REAL detection/observer/
// resolver chain (never a reimplementation) — see that section below.
const { extractFixtureFile } = require('../helpers/fixture-extractor');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');
const { findAllIdentityFields, IDENTITY_ROLES } = require('../../src/preload/vault-identity-fields');
const { createEntryObserver, LOGIN_ROLES, CARD_ROLES } = require('../../src/preload/vault-entry-observer');
const { resolveGestureTargets } = require('../../src/preload/vault-gesture-policy');

// --- fixture builders ---------------------------------------------------------

function loginEntry() {
  return { username: { tag: 'u' }, password: { tag: 'p' } };
}
function loginSnapshot({ provenanced = true, usernameDetected = true } = {}) {
  const snap = {};
  if (usernameDetected) snap.username = { detected: true, value: provenanced ? 'alice' : null };
  snap.password = { detected: true, value: provenanced ? 'hunter2' : null };
  return snap;
}

function cardEntry() {
  return {
    number: { tag: 'n' },
    cardholder: { tag: 'ch' },
    expiry: { tag: 'exp' },
    expMonth: null,
    expYear: null,
    csc: { tag: 'csc' }
  };
}
function cardSnapshot({ provenanced = true } = {}) {
  return {
    number: { detected: true, value: provenanced ? '4111111111111111' : null },
    cardholder: { detected: true, value: 'Ada Lovelace' },
    expiry: { detected: true, value: '04/29' },
    csc: { detected: true, value: '123' }
  };
}

function identityEntry() {
  return {
    street: { tag: 'street' },
    street2: null,
    postalCode: { tag: 'zip' },
    city: null,
    region: null,
    country: null,
    fullName: null,
    firstName: null,
    lastName: null,
    email: { tag: 'email' },
    phone: null
  };
}
function identitySnapshot({ anchorProvenanced = true, nonPostalProvenanced = true } = {}) {
  return {
    anchorRole: 'street',
    street: { detected: true, value: anchorProvenanced ? '1 Main St' : null },
    email: { detected: true, value: nonPostalProvenanced ? 'ada@example.com' : null }
  };
}

// --- planCard / planLogin / planIdentity, via planCaptures --------------------

test('planCaptures: a CARD-only resolution plans exactly one card entry, correctly shaped', () => {
  const resolved = [{ kind: 'card', ordinal: 0 }];
  const entriesByKind = { card: [cardEntry()] };
  const snapshot = { cards: [cardSnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'card');
  assert.equal(plan[0].channel, 'guest-vault-capture-card');
  assert.ok(plan[0].payload.number instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(plan[0].payload.number), '4111111111111111');
  assert.equal(plan[0].payload.cardholder, 'Ada Lovelace');
  assert.equal(plan[0].payload.expiry, '04/29');
  assert.deepEqual(plan[0].watchFields, [{ tag: 'n' }, { tag: 'ch' }, { tag: 'exp' }, null, null, { tag: 'csc' }]);
});

test('planCaptures: a LOGIN-only resolution plans exactly one login entry, correctly shaped', () => {
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const entriesByKind = { login: [loginEntry()] };
  const snapshot = { logins: [loginSnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'login');
  assert.equal(plan[0].channel, 'guest-vault-capture');
  assert.equal(plan[0].payload.username, 'alice');
  assert.equal(plan[0].payload.usernameDetected, true);
  assert.equal(new TextDecoder().decode(plan[0].payload.password), 'hunter2');
});

test('planCaptures: LOGIN with no username field detected at all sets usernameDetected:false, username:null (DD3c)', () => {
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const entriesByKind = { login: [loginEntry()] };
  const snapshot = { logins: [loginSnapshot({ usernameDetected: false })] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.equal(plan[0].payload.usernameDetected, false);
  assert.equal(plan[0].payload.username, null);
});

test('planCaptures: an IDENTITY-only resolution plans exactly one identity entry, correctly shaped', () => {
  const resolved = [{ kind: 'identity', ordinal: 0 }];
  const entriesByKind = { identity: [identityEntry()] };
  const snapshot = { identities: [identitySnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'identity');
  assert.equal(plan[0].channel, 'guest-vault-capture-identity');
  assert.ok(plan[0].payload.identitySecrets instanceof Uint8Array);
  const secrets = JSON.parse(new TextDecoder().decode(plan[0].payload.identitySecrets));
  assert.equal(secrets.street, '1 Main St');
  assert.equal(secrets.email, 'ada@example.com');
  assert.equal(secrets.city, ''); // undetected/unprovenanced fields encode as ''
  assert.ok(!Object.prototype.hasOwnProperty.call(secrets, 'fullName'), 'fullName never rides identitySecrets');
  assert.equal(plan[0].payload.fullName, ''); // no fullName in this fixture's snapshot
  // watchFields is IDENTITY_ROLES mapped through entry, filtered to live nodes only.
  assert.deepEqual(plan[0].watchFields, [{ tag: 'street' }, { tag: 'zip' }, { tag: 'email' }]);
});

// --- AC4: every resolving family is planned; one failing its gate does not stop
// the others ---------------------------------------------------------------

test('AC4: [card, identity] with BOTH provenanced -> TWO plan entries', () => {
  const resolved = [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ];
  const entriesByKind = { card: [cardEntry()], identity: [identityEntry()] };
  const snapshot = { cards: [cardSnapshot()], identities: [identitySnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['card', 'identity']
  );
});

test('AC4: card provenanced, identity NOT (its anchor is unprovenanced) -> only the card is planned', () => {
  const resolved = [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ];
  const entriesByKind = { card: [cardEntry()], identity: [identityEntry()] };
  const snapshot = { cards: [cardSnapshot()], identities: [identitySnapshot({ anchorProvenanced: false })] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['card']
  );
});

test('AC4 (the ORDER-SENSITIVE case): identity provenanced, card NOT (its number is unprovenanced), card resolved FIRST -> the FIRST-LISTED family failing its gate must not end the plan; only identity is planned', () => {
  const resolved = [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ];
  const entriesByKind = { card: [cardEntry()], identity: [identityEntry()] };
  const snapshot = { cards: [cardSnapshot({ provenanced: false })], identities: [identitySnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['identity']
  );
});

test('AC4: an unknown kind in `resolved` is skipped entirely — NEVER a login payload', () => {
  const resolved = [
    { kind: 'bogus', ordinal: 0 },
    { kind: 'login', ordinal: 0 }
  ];
  const entriesByKind = { login: [loginEntry()] };
  const snapshot = { logins: [loginSnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['login']
  );
  // No leaked login payload under the bogus kind's channel/shape.
  assert.equal(plan.length, 1);
  assert.equal(plan[0].channel, 'guest-vault-capture');
});

test('AC4: [] resolved -> [] planned', () => {
  assert.deepEqual(planCaptures({ resolved: [], entriesByKind: {}, snapshot: {} }), []);
});

test('AC4: three families, all provenanced, all planned in order [login, card, identity]', () => {
  const resolved = [
    { kind: 'login', ordinal: 0 },
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ];
  const entriesByKind = { login: [loginEntry()], card: [cardEntry()], identity: [identityEntry()] };
  const snapshot = { logins: [loginSnapshot()], cards: [cardSnapshot()], identities: [identitySnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['login', 'card', 'identity']
  );
  // No family's values appear in another's payload.
  assert.equal(new TextDecoder().decode(plan[0].payload.password), 'hunter2');
  assert.equal(new TextDecoder().decode(plan[1].payload.number), '4111111111111111');
  const identitySecrets = JSON.parse(new TextDecoder().decode(plan[2].payload.identitySecrets));
  assert.equal(identitySecrets.street, '1 Main St');
  assert.ok(!('password' in plan[1].payload), 'card payload must never carry a login/identity field');
  assert.ok(!('number' in plan[2].payload), 'identity payload must never carry a card field');
});

// --- defensive shape guards ----------------------------------------------------

test('planCaptures: a non-array `resolved` returns [] rather than throwing', () => {
  assert.deepEqual(planCaptures({ resolved: null, entriesByKind: {}, snapshot: {} }), []);
  assert.deepEqual(planCaptures({ resolved: undefined, entriesByKind: {}, snapshot: {} }), []);
});

test('planCaptures: an ordinal with no matching entry is skipped, not planned, never throws', () => {
  const resolved = [{ kind: 'login', ordinal: 5 }]; // out of range
  const entriesByKind = { login: [loginEntry()] };
  const snapshot = { logins: [loginSnapshot()] };
  assert.deepEqual(planCaptures({ resolved, entriesByKind, snapshot }), []);
});

test('planCaptures: a missing snapshot entry for a resolved family is treated as unprovenanced (no throw, not planned)', () => {
  const resolved = [{ kind: 'card', ordinal: 0 }];
  const entriesByKind = { card: [cardEntry()] };
  const snapshot = { cards: [] }; // no snapshot entry at ordinal 0
  assert.deepEqual(planCaptures({ resolved, entriesByKind, snapshot }), []);
});

// --- AC6b: the email-as-username sign-up shape (live-HAT-found gap) -----------
//
// The live re-walk (flight-log.md, HAT re-walk B) proved `isClaimedByLogin`
// works on `signup-with-address.html` — but that fixture gives login a
// DEDICATED `username` field, so email never contests it. This section loads
// the REAL `signup-email-as-username` corpus fixture (Full name, Email,
// Password, Address line 1, Postal code — email is the LAST text/email/tel
// input preceding the password field, so `resolveLoginEntry` picks it
// positionally as the username) and drives the REAL detection/observer/
// resolver/planner chain — never a reimplementation of any of it — then
// inspects PAYLOAD CONTENTS, which the corpus's own generic `offers-multi`
// assertion (`assertOffersFamilies`) does not check (it asserts only WHICH
// families plan, not what rides in their payloads). Mirrors
// `buildProvenancedObserver` in test/helpers/save-moment-assertions.js.

const SIGNUP_EMAIL_AS_USERNAME_FIXTURE = path.join(
  __dirname,
  '..',
  'fixtures',
  'save-moment',
  'multi-family',
  'signup-email-as-username.html'
);

function planSignupEmailAsUsernameFixture() {
  const doc = extractFixtureFile(SIGNUP_EMAIL_AS_USERNAME_FIXTURE);
  const logins = findAllLoginFields(doc);
  const cards = findAllCardFields(doc);
  const identities = findAllIdentityFields(doc);

  const observer = createEntryObserver({
    document: doc,
    findAllLoginFields,
    findAllCardFields,
    findAllIdentityFields
  });
  // The corpus's own stand-in for "the operator typed this" — grant
  // provenance for every detected field carrying a non-empty value (the same
  // idiom buildProvenancedObserver uses).
  for (const entry of logins) {
    for (const role of LOGIN_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  for (const entry of cards) {
    for (const role of CARD_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  for (const entry of identities) {
    for (const role of IDENTITY_ROLES) {
      const field = entry[role];
      if (field && field.value) observer._grant(field);
    }
  }
  const snapshot = observer.snapshot();

  const target = doc.getElementById('join-now');
  const resolved = resolveGestureTargets(target, { logins, cards, identities });
  const entriesByKind = { login: logins, card: cards, identity: identities };
  return planCaptures({ resolved, entriesByKind, snapshot });
}

test('AC6b: signup-email-as-username — one gesture plans BOTH login and identity', () => {
  const plan = planSignupEmailAsUsernameFixture();
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['login', 'identity']
  );
});

test("AC6b: the login payload's username is the EMAIL value (positional pick — no dedicated username field)", () => {
  const plan = planSignupEmailAsUsernameFixture();
  const login = plan.find((c) => c.kind === 'login');
  assert.ok(login, 'expected a login plan entry');
  assert.equal(login.payload.usernameDetected, true);
  assert.equal(login.payload.username, 'grace@example.com');
});

test('AC6b: the identity payload carries NO email — isClaimedByLogin removed it from identity candidates before role resolution', () => {
  const plan = planSignupEmailAsUsernameFixture();
  const identity = plan.find((c) => c.kind === 'identity');
  assert.ok(identity, 'expected an identity plan entry');
  const secrets = JSON.parse(new TextDecoder().decode(identity.payload.identitySecrets));
  // '' is the same "absent/unprovenanced" bucket every other missing role
  // encodes as (see planIdentity) — never the operator's email value.
  assert.equal(secrets.email, '', 'the email must not appear in the identity payload — it was claimed by login');
  assert.equal(secrets.street, '1 Mark I Way');
  assert.equal(secrets.postalCode, '02139');
  assert.equal(identity.payload.fullName, 'Grace Hopper');
});

// --- Mission 21, Flight 4, Leg 2 (password-field-roles): planLogin's scope
// widening (DD3a), the new-field capture + confirm-agreement rule (DD3), and
// the currentPassword payload (DD4). Fake, hand-built multi-field login
// scopes — never a corpus fixture reimplementation of what save-moment-
// corpus.test.js's `plans-login` fixtures already gate end to end; these
// tests instead pin planLogin's payload shape directly against
// `entriesByKind`/`snapshot`, mirroring loginEntry()/loginSnapshot() above.

/**
 * @param {Array<{ value: string | null, provenanced?: boolean, autocomplete?: string }>} fields
 *   one entry per password field, document order — `provenanced: false`
 *   (default true) encodes a detected-but-untyped field (`value: null` in the
 *   snapshot); `autocomplete` (optional) marks the field via
 *   `getAttribute('autocomplete')` — real password-field-roles.js layer 1 —
 *   so a scope can pin which fields are `current`/`new` without relying on
 *   layer 3's structural default (which a plain, unmarked 2-field scope with
 *   no `current` would otherwise resolve as new+confirm, per DD1).
 * @param {{ username?: string | null, usernameDetected?: boolean }} [opts]
 */
function loginScope(fields, opts = {}) {
  const form = { tag: 'shared-form' };
  const entries = fields.map((f, i) => ({
    username: opts.usernameDetected === false ? null : { tag: 'u' },
    password: {
      tag: `p${i}`,
      getAttribute: (attr) => (attr === 'autocomplete' ? (f.autocomplete ?? null) : null)
    },
    form
  }));
  const logins = fields.map((f) => {
    /** @type {any} */
    const snap = { password: { detected: true, value: f.provenanced === false ? null : f.value } };
    // DD3c's three-state shape: the KEY itself must be absent (not merely
    // `undefined`-valued) to model "no username field detected at all" —
    // `Object.prototype.hasOwnProperty` is what planLogin reads.
    if (opts.usernameDetected !== false) {
      snap.username = { detected: true, value: opts.username === undefined ? 'alice' : opts.username };
    }
    return snap;
  });
  return { entries, logins };
}

test('AC8: classified scope (current+new+confirm) plans the NEW value, carries currentPassword, username from the handle', () => {
  const { entries, logins } = loginScope([
    { value: 'OldPass1!' }, // current
    { value: 'NewPass2!' }, // new
    { value: 'NewPass2!' } // confirm (agrees)
  ]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const entriesByKind = { login: entries };
  const snapshot = { logins };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.equal(plan.length, 1);
  const [login] = plan;
  assert.equal(login.kind, 'login');
  assert.equal(login.channel, 'guest-vault-capture');
  assert.equal(new TextDecoder().decode(login.payload.password), 'NewPass2!');
  assert.ok(Object.prototype.hasOwnProperty.call(login.payload, 'currentPassword'));
  assert.equal(new TextDecoder().decode(login.payload.currentPassword), 'OldPass1!');
  assert.equal(login.payload.username, 'alice');
  assert.equal(login.payload.usernameDetected, true);
  // AC8: watchFields = every scope entry's password field + the handle's username.
  assert.deepEqual(login.watchFields, [
    entries[0].password,
    entries[1].password,
    entries[2].password,
    entries[0].username
  ]);
});

test('AC8: a confirm field is OPTIONAL — current+new with no confirm still plans, carries currentPassword', () => {
  const { entries, logins } = loginScope([
    { value: 'OldPass9!', autocomplete: 'current-password' },
    { value: 'FreshPass8!', autocomplete: 'new-password' }
  ]);
  const resolved = [{ kind: 'login', ordinal: 1 }]; // the handle can be EITHER scope member
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.equal(plan.length, 1);
  assert.equal(new TextDecoder().decode(plan[0].payload.password), 'FreshPass8!');
  assert.equal(new TextDecoder().decode(plan[0].payload.currentPassword), 'OldPass9!');
});

test('AC8: an unprovenanced confirm plans NO login', () => {
  const { entries, logins } = loginScope([
    { value: 'OldPass1!' },
    { value: 'NewPass2!' },
    { value: null, provenanced: false }
  ]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.deepEqual(
    plan.map((c) => c.kind),
    []
  );
});

test('AC8/DD3: a MISMATCHED confirm plans NO login (never the wrong value)', () => {
  const { entries, logins } = loginScope([{ value: 'OldPass1!' }, { value: 'NewPass2!' }, { value: 'Typo3!' }]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.deepEqual(plan, []);
});

test('AC8: an unprovenanced `new` field plans NO login', () => {
  const { entries, logins } = loginScope([
    { value: 'OldPass1!' },
    { value: null, provenanced: false },
    { value: null, provenanced: false }
  ]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.deepEqual(plan, []);
});

test('AC8: currentPassword is OMITTED when no current role exists in the scope (sign-up shape)', () => {
  const { entries, logins } = loginScope([{ value: 'NewPass2!' }, { value: 'NewPass2!' }]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.equal(plan.length, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(plan[0].payload, 'currentPassword'));
});

test('AC9: an AMBIGUOUS scope (four password fields) plans NO login capture', () => {
  const { entries, logins } = loginScope([{ value: 'a' }, { value: 'b' }, { value: 'c' }, { value: 'd' }]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.deepEqual(plan, []);
});

test('AC9: an ambiguous LOGIN scope does not affect a sibling CARD/IDENTITY plan in the same gesture', () => {
  const { entries, logins } = loginScope([{ value: 'a' }, { value: 'b' }, { value: 'c' }, { value: 'd' }]);
  const resolved = [
    { kind: 'login', ordinal: 0 },
    { kind: 'card', ordinal: 0 }
  ];
  const entriesByKind = { login: entries, card: [cardEntry()] };
  const snapshot = { logins, cards: [cardSnapshot()] };
  const plan = planCaptures({ resolved, entriesByKind, snapshot });
  assert.deepEqual(
    plan.map((c) => c.kind),
    ['card']
  );
});

test('AC10: a snapshot shorter than entries (mutation-race residual) plans NO login, never throws', () => {
  const { entries, logins } = loginScope([{ value: 'OldPass1!' }, { value: 'NewPass2!' }, { value: 'NewPass2!' }]);
  const resolved = [{ kind: 'login', ordinal: 0 }];
  // Only ONE snapshot entry survives — entries[1]/[2] have no snapshot counterpart.
  const shortSnapshot = { logins: [logins[0]] };
  assert.doesNotThrow(() => planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: shortSnapshot }));
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: shortSnapshot });
  assert.deepEqual(plan, []);
});

test('AC8: usernameDetected:false / username:null (no username field anywhere in the scope) still plans, with no currentPassword mixed up', () => {
  const { entries, logins } = loginScope([{ value: 'OldPass1!' }, { value: 'NewPass2!' }, { value: 'NewPass2!' }], {
    usernameDetected: false
  });
  const resolved = [{ kind: 'login', ordinal: 0 }];
  const plan = planCaptures({ resolved, entriesByKind: { login: entries }, snapshot: { logins } });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].payload.usernameDetected, false);
  assert.equal(plan[0].payload.username, null);
  assert.equal(new TextDecoder().decode(plan[0].payload.currentPassword), 'OldPass1!');
});
