'use strict';

// Unit tests for the pure password-field role classifier (Mission 21, Flight 4,
// Leg 2 — password-field-roles, flight DD1). Plain fake field objects (the
// vault-fill-fields.test.js / vault-identity-fields.test.js precedent) — no DOM,
// no fixture extractor. Covers every layer, the layering precedence, the
// second-`new` -> `confirm` rule (shared across layers 1 and 2), every AC4 kind,
// and `loginScopeOrdinals` (form scope, form-less scope, a mixed page, out of
// range).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginScopeOrdinals, classifyPasswordScope } = require('../../src/preload/password-field-roles');

/**
 * A minimal password-field-shaped fake: `getAttribute('autocomplete')` and the
 * four attributes `fieldHaystack` reads (name/id/placeholder/aria-label via
 * getAttribute).
 */
class FakeField {
  constructor({ autocomplete, name, id, placeholder, ariaLabel, form } = {}) {
    this.autocomplete = autocomplete;
    this.name = name;
    this.id = id;
    this.placeholder = placeholder;
    this._ariaLabel = ariaLabel;
    this.form = form === undefined ? null : form;
  }
  getAttribute(attr) {
    if (attr === 'autocomplete') return this.autocomplete == null ? null : this.autocomplete;
    if (attr === 'aria-label') return this._ariaLabel == null ? null : this._ariaLabel;
    return null;
  }
}

// A field with no getAttribute at all, and no name/id/placeholder — the AC4
// "never throws" case.
class BareField {}

/* ------------------------------------------------------- layer 1: autocomplete */

test('AC1: autocomplete new-password -> new; current-password -> current', () => {
  const result = classifyPasswordScope([
    new FakeField({ autocomplete: 'current-password' }),
    new FakeField({ autocomplete: 'new-password' })
  ]);
  assert.deepEqual(result.roles, ['current', 'new']);
  assert.equal(result.kind, 'classified');
});

test('AC1: a second new-password in the scope (document order) resolves confirm', () => {
  const result = classifyPasswordScope([
    new FakeField({ autocomplete: 'new-password' }),
    new FakeField({ autocomplete: 'new-password' })
  ]);
  assert.deepEqual(result.roles, ['new', 'confirm']);
  assert.equal(result.kind, 'classified');
});

test('AC1: autocomplete value with extra tokens still resolves (whitespace split, "section-x new-password")', () => {
  const result = classifyPasswordScope([new FakeField({ autocomplete: 'section-x new-password' })]);
  assert.deepEqual(result.roles, ['new']);
  assert.equal(result.kind, 'classified');
});

/* --------------------------------------------------- layer 2: fallback tokens */

test('AC2: name/id/placeholder tokens resolve current/new via camelCase (current-new-token-named shape)', () => {
  const result = classifyPasswordScope([
    new FakeField({ name: 'oldPassword' }),
    new FakeField({ name: 'newPassword' })
  ]);
  assert.deepEqual(result.roles, ['current', 'new']);
});

test('AC2: confirm tokens: confirm, confirmation, repeat, retype, verify, again', () => {
  for (const token of ['confirm', 'confirmation', 'repeat', 'retype', 'verify', 'again']) {
    const result = classifyPasswordScope([new FakeField({ name: `password_${token}` })]);
    assert.equal(result.roles[0], 'confirm', `expected "${token}" to resolve confirm`);
  }
});

test('AC2: current tokens: current, old, existing', () => {
  for (const token of ['current', 'old', 'existing']) {
    const result = classifyPasswordScope([new FakeField({ name: `password_${token}` })]);
    assert.equal(result.roles[0], 'current', `expected "${token}" to resolve current`);
  }
});

test('AC2: precedence within one field is confirm > current > new (confirmNewPassword, newPasswordConfirm)', () => {
  assert.equal(classifyPasswordScope([new FakeField({ name: 'confirmNewPassword' })]).roles[0], 'confirm');
  assert.equal(classifyPasswordScope([new FakeField({ name: 'newPasswordConfirm' })]).roles[0], 'confirm');
});

test('AC2: a second `new` token in the scope becomes confirm, as in layer 1', () => {
  const result = classifyPasswordScope([new FakeField({ name: 'newPass1' }), new FakeField({ name: 'newPass2' })]);
  assert.deepEqual(result.roles, ['new', 'confirm']);
});

test('AC2: layer 2 runs only for fields layer 1 left unresolved (autocomplete wins over a conflicting token)', () => {
  // autocomplete says current, the id token vocabulary would say "new" — the
  // autocomplete-resolved role must not be re-examined by layer 2.
  const result = classifyPasswordScope([new FakeField({ autocomplete: 'current-password', id: 'newPasswordField' })]);
  assert.deepEqual(result.roles, ['current']);
});

test('AC2: id token resolution works through normalizeFieldHaystack (snake_case and hyphens)', () => {
  const result = classifyPasswordScope([
    new FakeField({ id: 'current_password' }),
    new FakeField({ id: 'new-password-field' })
  ]);
  assert.deepEqual(result.roles, ['current', 'new']);
});

/* ------------------------------------------------------------- layer 3: structure */

test('AC3: three unresolved fields -> current, new, confirm in document order', () => {
  const result = classifyPasswordScope([new FakeField(), new FakeField(), new FakeField()]);
  assert.deepEqual(result.roles, ['current', 'new', 'confirm']);
  assert.equal(result.kind, 'classified');
});

test('AC3: three fields, one pre-resolved (middle = new via token) -> the other two fill current/confirm in document order', () => {
  const result = classifyPasswordScope([new FakeField(), new FakeField({ name: 'newPwd' }), new FakeField()]);
  assert.deepEqual(result.roles, ['current', 'new', 'confirm']);
});

test('AC3: two unresolved fields, neither current -> new + confirm', () => {
  const result = classifyPasswordScope([new FakeField(), new FakeField()]);
  assert.deepEqual(result.roles, ['new', 'confirm']);
  assert.equal(result.kind, 'classified');
});

test('AC3: two fields, one already resolved current -> the other structurally fills new', () => {
  const result = classifyPasswordScope([new FakeField({ name: 'currentPwd' }), new FakeField()]);
  assert.deepEqual(result.roles, ['current', 'new']);
});

test('AC3: two fields, one already resolved current is in the SECOND position -> the first structurally fills new', () => {
  const result = classifyPasswordScope([new FakeField(), new FakeField({ name: 'currentPwd' })]);
  assert.deepEqual(result.roles, ['new', 'current']);
});

test('AC3: one field carries no structural signal — stays null when otherwise unresolved', () => {
  const result = classifyPasswordScope([new FakeField()]);
  assert.deepEqual(result.roles, [null]);
  assert.equal(result.kind, 'sign-in');
});

/* --------------------------------------------------------------------- AC4: kind */

test('AC4: sign-in — a one-field scope whose field is unresolved', () => {
  assert.equal(classifyPasswordScope([new FakeField()]).kind, 'sign-in');
});

test('AC4: sign-in — a one-field scope resolved current (autocomplete)', () => {
  const result = classifyPasswordScope([new FakeField({ autocomplete: 'current-password' })]);
  assert.equal(result.kind, 'sign-in');
  assert.deepEqual(result.roles, ['current']);
});

test('AC4: a single field resolved new is classified, roles [\'new\'] (the "lying autocomplete" case)', () => {
  const result = classifyPasswordScope([new FakeField({ autocomplete: 'new-password' })]);
  assert.equal(result.kind, 'classified');
  assert.deepEqual(result.roles, ['new']);
});

test('AC4: classified — exactly one new, one current, one confirm, no null', () => {
  const result = classifyPasswordScope([
    new FakeField({ autocomplete: 'current-password' }),
    new FakeField({ autocomplete: 'new-password' }),
    new FakeField({ name: 'confirmPassword' })
  ]);
  assert.equal(result.kind, 'classified');
});

test('AC4: ambiguous — more than three password fields', () => {
  const result = classifyPasswordScope([new FakeField(), new FakeField(), new FakeField(), new FakeField()]);
  assert.equal(result.kind, 'ambiguous');
});

test('AC4: ambiguous — a duplicated current (two autocomplete=current-password fields)', () => {
  const result = classifyPasswordScope([
    new FakeField({ autocomplete: 'current-password' }),
    new FakeField({ autocomplete: 'current-password' }),
    new FakeField({ autocomplete: 'new-password' })
  ]);
  assert.equal(result.kind, 'ambiguous');
});

test('AC4: ambiguous — a field left null in a multi-field scope', () => {
  // Structure (layer 3) only fills 2- or 3-field scopes; a 4-field scope with
  // one resolved field guarantees at least one leftover null deterministically.
  const result = classifyPasswordScope([
    new FakeField({ autocomplete: 'new-password' }),
    new FakeField(),
    new FakeField(),
    new FakeField()
  ]);
  assert.equal(result.kind, 'ambiguous');
  assert.ok(
    result.roles.includes(null),
    'expected at least one field to stay unresolved (structure only covers 2/3 fields)'
  );
});

test('AC4: never throws on a field lacking getAttribute or attributes', () => {
  assert.doesNotThrow(() => classifyPasswordScope([new BareField(), new BareField()]));
  const result = classifyPasswordScope([new BareField(), new BareField()]);
  assert.deepEqual(result.roles, ['new', 'confirm']); // structure still applies
});

test('classifyPasswordScope: a non-array input never throws, yields ambiguous with empty roles', () => {
  assert.doesNotThrow(() => classifyPasswordScope(null));
  assert.doesNotThrow(() => classifyPasswordScope(undefined));
  assert.deepEqual(classifyPasswordScope(null).roles, []);
});

/* ------------------------------------------------------------- loginScopeOrdinals */

test("AC5: form scope — every entry sharing the handle's non-null .form", () => {
  const form = { id: 'f1' };
  const otherForm = { id: 'f2' };
  const entries = [{ form }, { form }, { form: otherForm }, { form }];
  assert.deepEqual(loginScopeOrdinals(entries, 0), [0, 1, 3]);
  assert.deepEqual(loginScopeOrdinals(entries, 1), [0, 1, 3]);
  assert.deepEqual(loginScopeOrdinals(entries, 2), [2]);
});

test("AC5: form-less scope — every entry whose .form is null or undefined, when the handle's own .form is null/undefined", () => {
  const form = { id: 'f1' };
  const entries = [{ form: null }, { form }, { form: undefined }, {}];
  // entries[3] has no `.form` property at all (undefined).
  assert.deepEqual(loginScopeOrdinals(entries, 0), [0, 2, 3]);
  assert.deepEqual(loginScopeOrdinals(entries, 2), [0, 2, 3]);
  assert.deepEqual(loginScopeOrdinals(entries, 3), [0, 2, 3]);
});

test('AC5: a mixed page (form-scoped entries alongside form-less entries) partitions correctly', () => {
  const formA = { id: 'a' };
  const entries = [{ form: formA }, { form: null }, { form: formA }, { form: null }];
  assert.deepEqual(loginScopeOrdinals(entries, 0), [0, 2]);
  assert.deepEqual(loginScopeOrdinals(entries, 1), [1, 3]);
});

test('AC5: out-of-range ordinal returns []', () => {
  const entries = [{ form: null }];
  assert.deepEqual(loginScopeOrdinals(entries, 5), []);
  assert.deepEqual(loginScopeOrdinals(entries, -1), []);
  assert.deepEqual(loginScopeOrdinals(entries, 1.5), []);
  assert.deepEqual(loginScopeOrdinals(entries, NaN), []);
});

test('AC5: a non-array entries argument returns [] rather than throwing', () => {
  assert.deepEqual(loginScopeOrdinals(null, 0), []);
  assert.deepEqual(loginScopeOrdinals(undefined, 0), []);
});

/* --------------------------------------------------- generateGestureInfo (AC6) */

const { generateGestureInfo } = require('../../src/preload/password-field-roles');

/** A field carrying minlength/maxlength/passwordrules, for generateGestureInfo tests. */
class ConstraintField {
  constructor({ autocomplete, name, form, minlength, maxlength, passwordrules } = {}) {
    this.autocomplete = autocomplete;
    this.name = name;
    this.form = form === undefined ? null : form;
    this._attrs = { minlength, maxlength, passwordrules };
  }
  getAttribute(attr) {
    if (attr === 'autocomplete') return this.autocomplete == null ? null : this.autocomplete;
    if (attr === 'minlength') return this._attrs.minlength == null ? null : String(this._attrs.minlength);
    if (attr === 'maxlength') return this._attrs.maxlength == null ? null : String(this._attrs.maxlength);
    if (attr === 'passwordrules') return this._attrs.passwordrules == null ? null : this._attrs.passwordrules;
    return null;
  }
}

test('AC6: a classified scope with a new role returns passwordRole "new" and the new field constraints', () => {
  const newField = new ConstraintField({
    autocomplete: 'new-password',
    minlength: 8,
    maxlength: 40,
    passwordrules: 'required: upper;'
  });
  const entries = [{ password: newField }];
  const result = generateGestureInfo(entries, 0);
  assert.deepEqual(result, {
    passwordRole: 'new',
    constraints: { minLength: 8, maxLength: 40, passwordRules: 'required: upper;' }
  });
});

test("AC6: constraints are read from the scope's new field even when the CONFIRM field was clicked", () => {
  const newField = new ConstraintField({ autocomplete: 'new-password', minlength: 12 });
  const confirmField = new ConstraintField({ autocomplete: 'new-password', minlength: 99 }); // second new -> confirm
  const entries = [{ password: newField }, { password: confirmField }];
  const result = generateGestureInfo(entries, 1); // clicked the confirm field's own entry
  assert.equal(result.passwordRole, 'new');
  assert.equal(result.constraints.minLength, 12, 'must read the NEW field, not the clicked confirm field');
});

test('AC6: a sign-in scope returns passwordRole null', () => {
  const field = new ConstraintField({ autocomplete: 'current-password' });
  const entries = [{ password: field }];
  assert.deepEqual(generateGestureInfo(entries, 0), { passwordRole: null, constraints: null });
});

test('AC6: an ambiguous scope returns passwordRole null', () => {
  const entries = [
    { password: new ConstraintField({}) },
    { password: new ConstraintField({}) },
    { password: new ConstraintField({}) },
    { password: new ConstraintField({}) }
  ]; // 4 unresolved fields, no structural rule -> ambiguous
  assert.deepEqual(generateGestureInfo(entries, 0), { passwordRole: null, constraints: null });
});

test('AC6: missing minlength/maxlength/passwordrules attributes resolve to null, not throw', () => {
  const newField = new ConstraintField({ autocomplete: 'new-password' });
  const entries = [{ password: newField }];
  assert.deepEqual(generateGestureInfo(entries, 0), {
    passwordRole: 'new',
    constraints: { minLength: null, maxLength: null, passwordRules: null }
  });
});

test('AC6: never throws on a bare field / out-of-range ordinal', () => {
  assert.doesNotThrow(() => generateGestureInfo([{ password: new BareField() }], 0));
  assert.deepEqual(generateGestureInfo([], 0), { passwordRole: null, constraints: null });
  assert.deepEqual(generateGestureInfo(null, 0), { passwordRole: null, constraints: null });
});
