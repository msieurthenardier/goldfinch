'use strict';

// Unit tests for the main-world GESTURE-CLASSIFICATION / ORDINAL-RESOLUTION
// module (Mission 21, Flight 1, Leg 5 — broadened-capture, DD1/DD3/DD4). Pure,
// Electron-free — fake element/entry shapes only, no DOM library.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isButtonLikeElement,
  isFieldElement,
  isCaptureGesture,
  resolveOrdinalInFamily,
  resolveGestureTargets,
  snapshotHasProvenancedSecret,
  secretRoleForKind
} = require('../../src/preload/vault-gesture-policy');

function el(tagName, attrs = {}) {
  return {
    tagName,
    type: attrs.type,
    getAttribute: (name) => (name in attrs ? attrs[name] : null)
  };
}

// --- isButtonLikeElement ------------------------------------------------------

test('isButtonLikeElement: a <button> with NO type attribute is button-like (the motivating shape)', () => {
  assert.equal(isButtonLikeElement(el('BUTTON')), true);
});

test('isButtonLikeElement: <button type="button"> and <button type="submit"> are both button-like — never type-specific', () => {
  assert.equal(isButtonLikeElement(el('BUTTON', { type: 'button' })), true);
  assert.equal(isButtonLikeElement(el('BUTTON', { type: 'submit' })), true);
});

test('isButtonLikeElement: input[type=submit/button/image] are button-like; input[type=text] is not', () => {
  assert.equal(isButtonLikeElement(el('INPUT', { type: 'submit' })), true);
  assert.equal(isButtonLikeElement(el('INPUT', { type: 'button' })), true);
  assert.equal(isButtonLikeElement(el('INPUT', { type: 'image' })), true);
  assert.equal(isButtonLikeElement(el('INPUT', { type: 'text' })), false);
});

test('isButtonLikeElement: role="button" on an arbitrary element counts', () => {
  assert.equal(isButtonLikeElement(el('SPAN', { role: 'button' })), true);
  assert.equal(isButtonLikeElement(el('SPAN')), false);
});

test('isButtonLikeElement: null/undefined/shapeless target is false, never throws', () => {
  assert.equal(isButtonLikeElement(null), false);
  assert.equal(isButtonLikeElement(undefined), false);
  assert.equal(isButtonLikeElement({}), false);
});

// --- isFieldElement ------------------------------------------------------------

test('isFieldElement: a text-entry-ish input/select/textarea is field-like', () => {
  assert.equal(isFieldElement(el('INPUT', { type: 'text' })), true);
  assert.equal(isFieldElement(el('INPUT', { type: 'password' })), true);
  assert.equal(isFieldElement(el('INPUT')), true, 'a missing type attribute normalizes to text-like, not excluded');
  assert.equal(isFieldElement(el('SELECT')), true);
  assert.equal(isFieldElement(el('TEXTAREA')), true);
});

test('isFieldElement: button/submit/checkbox/radio/image/file/hidden inputs are NOT field-like', () => {
  for (const type of ['button', 'submit', 'checkbox', 'radio', 'image', 'file', 'hidden']) {
    assert.equal(isFieldElement(el('INPUT', { type })), false, `type=${type}`);
  }
});

// --- isCaptureGesture (DD1/DD3) ------------------------------------------------

test('isCaptureGesture: a TRUSTED click on a button-like element qualifies', () => {
  assert.equal(isCaptureGesture({ type: 'click', isTrusted: true, target: el('BUTTON') }), true);
});

test('isCaptureGesture: an UNTRUSTED click never qualifies, even on a button-like element', () => {
  assert.equal(isCaptureGesture({ type: 'click', isTrusted: false, target: el('BUTTON') }), false);
});

test('isCaptureGesture: a trusted click on a non-button-like element does not qualify', () => {
  assert.equal(isCaptureGesture({ type: 'click', isTrusted: true, target: el('DIV') }), false);
});

test('isCaptureGesture: a TRUSTED Enter keydown while focus is in a field-like element qualifies', () => {
  assert.equal(
    isCaptureGesture({ type: 'keydown', isTrusted: true, key: 'Enter', target: el('INPUT', { type: 'password' }) }),
    true
  );
});

test("isCaptureGesture: a non-Enter keydown never qualifies (the observer's OWN provenance-granting listener stays broad on every keystroke — this is a DIFFERENT, narrower gesture concept)", () => {
  assert.equal(
    isCaptureGesture({ type: 'keydown', isTrusted: true, key: 'a', target: el('INPUT', { type: 'password' }) }),
    false
  );
});

test('isCaptureGesture: a trusted Enter keydown on a non-field element (e.g. a button) does not qualify via the Enter path', () => {
  assert.equal(isCaptureGesture({ type: 'keydown', isTrusted: true, key: 'Enter', target: el('DIV') }), false);
});

test('isCaptureGesture: an untrusted Enter keydown never qualifies', () => {
  assert.equal(
    isCaptureGesture({ type: 'keydown', isTrusted: false, key: 'Enter', target: el('INPUT', { type: 'text' }) }),
    false
  );
});

test('isCaptureGesture: an unrecognized event type never qualifies; a null/missing event is false, never throws', () => {
  assert.equal(isCaptureGesture({ type: 'focus', isTrusted: true, target: el('BUTTON') }), false);
  assert.equal(isCaptureGesture(null), false);
  assert.equal(isCaptureGesture(undefined), false);
});

// --- resolveOrdinalInFamily / resolveGestureTargets (multi-form disambiguation) --

test('resolveOrdinalInFamily: target IS one of the tracked fields itself (the Enter case) — matched by identity, any role', () => {
  const password = { tag: 'pw' };
  const username = { tag: 'user' };
  const entries = [{ username, password, form: null }];
  assert.equal(resolveOrdinalInFamily(password, entries, ['username', 'password']), 0);
  assert.equal(resolveOrdinalInFamily(username, entries, ['username', 'password']), 0);
});

test("resolveOrdinalInFamily: multi-form disambiguation via the SECOND form's own submit control (PR#112 finding-9 precision)", () => {
  const form1 = { tag: 'form1' };
  const form2 = { tag: 'form2' };
  const entries = [
    { username: { tag: 'u1' }, password: { tag: 'p1' }, form: form1 },
    { username: { tag: 'u2' }, password: { tag: 'p2' }, form: form2 }
  ];
  const submit2 = { form: form2 };
  assert.equal(resolveOrdinalInFamily(submit2, entries, ['username', 'password']), 1);
  const submit1 = { form: form1 };
  assert.equal(resolveOrdinalInFamily(submit1, entries, ['username', 'password']), 0);
});

test('resolveOrdinalInFamily: form containment via .closest("form") when .form is absent', () => {
  const form1 = { tag: 'form1' };
  const entries = [{ username: null, password: { tag: 'p1' }, form: form1 }];
  const target = { closest: (sel) => (sel === 'form' ? form1 : null) };
  assert.equal(resolveOrdinalInFamily(target, entries, ['username', 'password']), 0);
});

test('resolveOrdinalInFamily: inside a REAL form that matches none of the detected entries resolves null (never guesses)', () => {
  const otherForm = { tag: 'unrelated-form' };
  const entries = [{ username: null, password: { tag: 'p1' }, form: { tag: 'form1' } }];
  const target = { form: otherForm };
  assert.equal(resolveOrdinalInFamily(target, entries, ['username', 'password']), null);
});

test('resolveOrdinalInFamily: NO form association at all (the motivating "outside every form" shape) falls back to the SOLE entry', () => {
  const entries = [{ number: { tag: 'card-number' }, form: null }];
  const target = { form: null }; // no .closest either
  assert.equal(resolveOrdinalInFamily(target, entries, ['number']), 0);
});

test('resolveOrdinalInFamily: NO form association with MULTIPLE entries never guesses — resolves null', () => {
  const entries = [
    { number: { tag: 'n1' }, form: null },
    { number: { tag: 'n2' }, form: null }
  ];
  const target = { form: null };
  assert.equal(resolveOrdinalInFamily(target, entries, ['number']), null);
});

test('resolveOrdinalInFamily: empty entries / null target resolve null, never throw', () => {
  assert.equal(resolveOrdinalInFamily(null, [{ password: {}, form: null }], ['password']), null);
  assert.equal(resolveOrdinalInFamily({ tag: 'x' }, [], ['password']), null);
  assert.equal(resolveOrdinalInFamily({ tag: 'x' }, null, ['password']), null);
});

test('resolveGestureTargets: LOGIN and CARD both resolve (list [login, card], in that order — Leg 6 rewrite of "login wins over card"; the card entry has no form of its own, so it resolves via step 3\'s sole-entry fallback rather than being suppressed by login resolving first)', () => {
  const password = { tag: 'pw' };
  const logins = [{ username: null, password, form: null }];
  const cards = [{ number: { tag: 'n' }, form: null }];
  assert.deepEqual(resolveGestureTargets(password, { logins, cards }), [
    { kind: 'login', ordinal: 0 },
    { kind: 'card', ordinal: 0 }
  ]);
});

test('resolveGestureTargets: resolves a CARD entry when no login entry matches (empty logins array short-circuits to no match)', () => {
  const number = { tag: 'n' };
  const logins = [];
  const cards = [{ number, form: null }];
  assert.deepEqual(resolveGestureTargets(number, { logins, cards }), [{ kind: 'card', ordinal: 0 }]);
});

test('resolveGestureTargets: neither family resolves anything -> [] (never null); missing entries default to empty arrays', () => {
  assert.deepEqual(resolveGestureTargets({ tag: 'x' }, { logins: [], cards: [] }), []);
  assert.deepEqual(resolveGestureTargets({ tag: 'x' }, {}), []);
  assert.deepEqual(resolveGestureTargets({ tag: 'x' }), []);
});

// --- snapshotHasProvenancedSecret / secretRoleForKind ---------------------------

test('secretRoleForKind: "password" for login, "number" for card', () => {
  assert.equal(secretRoleForKind('login'), 'password');
  assert.equal(secretRoleForKind('card'), 'number');
});

test('snapshotHasProvenancedSecret: a login entry with a provenanced (non-null) password value is true', () => {
  assert.equal(snapshotHasProvenancedSecret({ password: { detected: true, value: 'hunter2' } }, 'login'), true);
});

test('snapshotHasProvenancedSecret: detected-but-UNPROVENANCED (value: null) is false — the DD3h three-state shape', () => {
  assert.equal(snapshotHasProvenancedSecret({ password: { detected: true, value: null } }, 'login'), false);
});

test('snapshotHasProvenancedSecret: the secret key entirely ABSENT (never detected) is false', () => {
  assert.equal(snapshotHasProvenancedSecret({ username: { detected: true, value: 'alice' } }, 'login'), false);
});

test('snapshotHasProvenancedSecret: a card entry checks the "number" role, not "password"', () => {
  assert.equal(snapshotHasProvenancedSecret({ number: { detected: true, value: '4111111111111111' } }, 'card'), true);
  assert.equal(snapshotHasProvenancedSecret({ password: { detected: true, value: 'x' } }, 'card'), false);
});

test('snapshotHasProvenancedSecret: a null/undefined entrySnapshot is false, never throws', () => {
  assert.equal(snapshotHasProvenancedSecret(null, 'login'), false);
  assert.equal(snapshotHasProvenancedSecret(undefined, 'card'), false);
});

// --- AC5/AC6 (M21 F3 Leg 4): identity's third arm ---------------------------

test('AC5: resolveGestureTargets resolves an IDENTITY entry when neither login nor card has anything to match (list order is login, card, identity — Leg 6 rewrite)', () => {
  const street = { tag: 'street' };
  const identities = [{ street, form: null }];
  assert.deepEqual(resolveGestureTargets(street, { logins: [], cards: [], identities }), [
    { kind: 'identity', ordinal: 0 }
  ]);
});

test("Leg 6 rewrite of \"AC5: DD5 precedence — login beats card beats identity\" — the fixed order survives purely for DETERMINISM now, not as a winner-take-all rule: all three resolve and are returned as list [login, card, identity], in that order. NOTE (per the leg's own Edge Cases): this synthetic shape — one fake node shared by all three families' entries — cannot occur on a real page, because LD3's detection-time claims (isClaimedByLogin / isClaimedByCard) remove a field contested with login or card from identity's candidates before detection ever hands this function three entries pointing at the same node. This is a resolver-in-isolation worst case, not a reachable page.", () => {
  const password = { tag: 'pw' };
  const logins = [{ username: null, password, form: null }];
  const cards = [{ number: password, form: null }]; // a contrived shared-node stand-in
  const identities = [{ street: password, form: null }];
  assert.deepEqual(resolveGestureTargets(password, { logins, cards, identities }), [
    { kind: 'login', ordinal: 0 },
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ]);
});

test('AC5: missing `identities` defaults to an empty array (Leg 6 rewrite: [] not null)', () => {
  assert.deepEqual(resolveGestureTargets({ tag: 'x' }, { logins: [], cards: [] }), []);
});

// --- Leg 6 (gesture-holds-every-family) AC1: the 7-row pinned table -----------
// Every row exercises `resolveGestureTargets` alone (no planner, no snapshot) —
// plain fake entries in the same style as the tests above, never real DOM.

test("AC1 row 1: card + billing in ONE form, the form's submit button -> [card, identity]", () => {
  const form1 = { tag: 'form1' };
  const cards = [{ number: { tag: 'n' }, form: form1 }];
  const identities = [{ street: { tag: 'street' }, form: form1 }];
  const target = { form: form1 }; // the submit button, inside the same form
  assert.deepEqual(resolveGestureTargets(target, { logins: [], cards, identities }), [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ]);
});

test('AC1 row 2: card + billing in ONE form, Enter in the billing Email field -> [card, identity]', () => {
  const form1 = { tag: 'form1' };
  const cards = [{ number: { tag: 'n' }, form: form1 }];
  const emailField = { tag: 'email', form: form1 }; // Enter's target carries its own .form too
  const identities = [{ street: { tag: 'street' }, email: emailField, form: form1 }];
  assert.deepEqual(resolveGestureTargets(emailField, { logins: [], cards, identities }), [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ]);
});

test("AC1 row 3: card form + billing form, submit OUTSIDE both (the real Jostens shape) -> [card, identity], each via its family's own sole-entry fallback", () => {
  const cardForm = { tag: 'card-form' };
  const billingForm = { tag: 'billing-form' };
  const cards = [{ number: { tag: 'n' }, form: cardForm }];
  const identities = [{ street: { tag: 'street' }, form: billingForm }];
  const target = { form: null }; // no .closest either — no form association at all
  assert.deepEqual(resolveGestureTargets(target, { logins: [], cards, identities }), [
    { kind: 'card', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ]);
});

test('AC1 row 4: card form + billing form, SEPARATE, "Save card" inside the card form -> [card] only', () => {
  const cardForm = { tag: 'card-form' };
  const billingForm = { tag: 'billing-form' };
  const cards = [{ number: { tag: 'n' }, form: cardForm }];
  const identities = [{ street: { tag: 'street' }, form: billingForm }];
  const target = { form: cardForm }; // "Save card", inside the card form only
  assert.deepEqual(resolveGestureTargets(target, { logins: [], cards, identities }), [{ kind: 'card', ordinal: 0 }]);
});

test('AC1 row 5: sign-up (name, email, address, password) in ONE form, submit -> [login, identity]', () => {
  const form1 = { tag: 'signup-form' };
  const logins = [{ username: null, password: { tag: 'pw' }, form: form1 }];
  const identities = [{ street: { tag: 'street' }, form: form1 }];
  const target = { form: form1 };
  assert.deepEqual(resolveGestureTargets(target, { logins, cards: [], identities }), [
    { kind: 'login', ordinal: 0 },
    { kind: 'identity', ordinal: 0 }
  ]);
});

test('AC1 row 6: plain login form, submit -> [login]', () => {
  const form1 = { tag: 'login-form' };
  const logins = [{ username: null, password: { tag: 'pw' }, form: form1 }];
  const target = { form: form1 };
  assert.deepEqual(resolveGestureTargets(target, { logins, cards: [], identities: [] }), [
    { kind: 'login', ordinal: 0 }
  ]);
});

test('AC1 row 7: nothing detected, any button -> []', () => {
  assert.deepEqual(resolveGestureTargets({ form: null }, { logins: [], cards: [], identities: [] }), []);
});

test('AC6: identity gate — anchor-only (no non-postal field provenanced) is false', () => {
  const snap = {
    anchorRole: 'street',
    street: { detected: true, value: '1 Main St' },
    email: { detected: true, value: null }
  };
  assert.equal(snapshotHasProvenancedSecret(snap, 'identity'), false);
});

test('AC6: identity gate — non-postal-only (no anchor provenanced) is false', () => {
  const snap = {
    anchorRole: 'street',
    street: { detected: true, value: null },
    email: { detected: true, value: 'a@b.com' }
  };
  assert.equal(snapshotHasProvenancedSecret(snap, 'identity'), false);
});

test('AC6: identity gate — BOTH anchor and a non-postal field provenanced is true', () => {
  const snap = {
    anchorRole: 'street',
    street: { detected: true, value: '1 Main St' },
    email: { detected: true, value: 'a@b.com' }
  };
  assert.equal(snapshotHasProvenancedSecret(snap, 'identity'), true);
});

test('AC6: identity gate — a MISSING anchorRole fails closed', () => {
  const snap = {
    street: { detected: true, value: '1 Main St' },
    email: { detected: true, value: 'a@b.com' }
  };
  assert.equal(snapshotHasProvenancedSecret(snap, 'identity'), false);
});

test('AC6: identity gate — an UNRECOGNISED anchorRole (not a real postal role) fails closed', () => {
  const snap = {
    anchorRole: 'email', // a real role, but NOT postal — must not be treated as an anchor
    street: { detected: true, value: '1 Main St' },
    email: { detected: true, value: 'a@b.com' }
  };
  assert.equal(snapshotHasProvenancedSecret(snap, 'identity'), false);
  const snap2 = { anchorRole: 'bogus', street: { detected: true, value: '1 Main St' } };
  assert.equal(snapshotHasProvenancedSecret(snap2, 'identity'), false);
});

test('AC6: secretRoleForKind is never consulted for identity — it stays login/card only', () => {
  // secretRoleForKind has no identity branch at all; snapshotHasProvenancedSecret's
  // identity arm must not fall through to it.
  assert.notEqual(secretRoleForKind('identity'), 'street');
});
