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
  resolveGestureTarget,
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

// --- resolveOrdinalInFamily / resolveGestureTarget (multi-form disambiguation) --

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

test('resolveGestureTarget: resolves a LOGIN entry before ever checking cards', () => {
  const password = { tag: 'pw' };
  const logins = [{ username: null, password, form: null }];
  const cards = [{ number: { tag: 'n' }, form: null }];
  assert.deepEqual(resolveGestureTarget(password, { logins, cards }), { kind: 'login', ordinal: 0 });
});

test('resolveGestureTarget: resolves a CARD entry when no login entry matches', () => {
  const number = { tag: 'n' };
  const logins = [];
  const cards = [{ number, form: null }];
  assert.deepEqual(resolveGestureTarget(number, { logins, cards }), { kind: 'card', ordinal: 0 });
});

test('resolveGestureTarget: neither family resolves anything -> null; missing entries default to empty arrays', () => {
  assert.equal(resolveGestureTarget({ tag: 'x' }, { logins: [], cards: [] }), null);
  assert.equal(resolveGestureTarget({ tag: 'x' }, {}), null);
  assert.equal(resolveGestureTarget({ tag: 'x' }), null);
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

test('AC5: resolveGestureTarget resolves an IDENTITY entry when neither login nor card matches, checked LAST (DD5)', () => {
  const street = { tag: 'street' };
  const identities = [{ street, form: null }];
  assert.deepEqual(resolveGestureTarget(street, { logins: [], cards: [], identities }), {
    kind: 'identity',
    ordinal: 0
  });
});

test('AC5: DD5 precedence — login beats card beats identity when all three could resolve', () => {
  const password = { tag: 'pw' };
  const logins = [{ username: null, password, form: null }];
  const cards = [{ number: password, form: null }]; // a contrived shared-node stand-in
  const identities = [{ street: password, form: null }];
  assert.deepEqual(resolveGestureTarget(password, { logins, cards, identities }), { kind: 'login', ordinal: 0 });
});

test('AC5: missing `identities` defaults to an empty array', () => {
  assert.equal(resolveGestureTarget({ tag: 'x' }, { logins: [], cards: [] }), null);
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
