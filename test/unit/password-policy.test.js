'use strict';

// Unit tests for src/shared/password-policy.js (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, AC1-5). Real ES module; Node >=22 require(esm) loads the
// exact file the app ships. Pure — no DOM, no Electron.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeGenerateConstraints,
  parsePasswordRules,
  resolvePolicy,
  generateCandidates
} = require('../../src/shared/password-policy');

// --- AC1: sanitizeGenerateConstraints ---

test('sanitizeGenerateConstraints: a well-formed object passes through', () => {
  assert.deepEqual(sanitizeGenerateConstraints({ minLength: 8, maxLength: 20, passwordRules: 'required: upper;' }), {
    minLength: 8,
    maxLength: 20,
    passwordRules: 'required: upper;'
  });
});

test('sanitizeGenerateConstraints: absent fields resolve to null', () => {
  assert.deepEqual(sanitizeGenerateConstraints({}), { minLength: null, maxLength: null, passwordRules: null });
});

test('sanitizeGenerateConstraints: -1 sentinel resolves to null (unset), for either bound', () => {
  assert.deepEqual(sanitizeGenerateConstraints({ minLength: -1, maxLength: -1 }), {
    minLength: null,
    maxLength: null,
    passwordRules: null
  });
});

test('sanitizeGenerateConstraints: a literal null minLength/maxLength resolves to null (unset) — the shape readGenerateConstraints actually emits for an attribute-less field, via parseIntOrNull, not -1', () => {
  const sanitized = sanitizeGenerateConstraints({ minLength: null, maxLength: null, passwordRules: null });
  assert.deepEqual(sanitized, { minLength: null, maxLength: null, passwordRules: null });
  assert.equal(resolvePolicy(sanitized).ok, true);
});

test('sanitizeGenerateConstraints: integers clamp into [1, 128]', () => {
  assert.deepEqual(sanitizeGenerateConstraints({ minLength: 0, maxLength: 9999 }), {
    minLength: 1,
    maxLength: 128,
    passwordRules: null
  });
});

test('sanitizeGenerateConstraints: a non-integer bound is malformed -> null', () => {
  assert.equal(sanitizeGenerateConstraints({ minLength: 4.5 }), null);
  assert.equal(sanitizeGenerateConstraints({ minLength: '8' }), null);
});

test('sanitizeGenerateConstraints: a negative bound other than -1 is malformed -> null', () => {
  assert.equal(sanitizeGenerateConstraints({ minLength: -5 }), null);
});

test('sanitizeGenerateConstraints: passwordRules over 512 chars is malformed -> null', () => {
  assert.equal(sanitizeGenerateConstraints({ passwordRules: 'x'.repeat(513) }), null);
  assert.deepEqual(sanitizeGenerateConstraints({ passwordRules: 'x'.repeat(512) }), {
    minLength: null,
    maxLength: null,
    passwordRules: 'x'.repeat(512)
  });
});

test('sanitizeGenerateConstraints: a non-string passwordRules is malformed -> null', () => {
  assert.equal(sanitizeGenerateConstraints({ passwordRules: 12 }), null);
});

test("sanitizeGenerateConstraints: empty passwordRules ('') resolves to null", () => {
  assert.deepEqual(sanitizeGenerateConstraints({ passwordRules: '' }), {
    minLength: null,
    maxLength: null,
    passwordRules: null
  });
});

test('sanitizeGenerateConstraints: unknown keys are ignored', () => {
  assert.deepEqual(sanitizeGenerateConstraints({ minLength: 10, evil: 'x' }), {
    minLength: 10,
    maxLength: null,
    passwordRules: null
  });
});

test('sanitizeGenerateConstraints: a non-plain-object raw returns null', () => {
  assert.equal(sanitizeGenerateConstraints(null), null);
  assert.equal(sanitizeGenerateConstraints(undefined), null);
  assert.equal(sanitizeGenerateConstraints('x'), null);
  assert.equal(sanitizeGenerateConstraints([1, 2]), null);
  assert.equal(sanitizeGenerateConstraints(5), null);
});

// --- AC2: parsePasswordRules ---

test('parsePasswordRules: required/allowed classes, case-insensitive, whitespace-tolerant', () => {
  const r = parsePasswordRules(' Required : Upper , Digit ; Allowed : special ; ');
  assert.ok(r);
  assert.equal(r.required.length, 2);
  assert.equal(r.allowed.length, 1);
});

test('parsePasswordRules: minlength/maxlength/max-consecutive', () => {
  const r = parsePasswordRules('minlength: 10; maxlength: 24; max-consecutive: 3;');
  assert.deepEqual(
    { minlength: r.minlength, maxlength: r.maxlength, maxConsecutive: r.maxConsecutive },
    { minlength: 10, maxlength: 24, maxConsecutive: 3 }
  );
});

test('parsePasswordRules: unknown rule NAMES are ignored, not an error', () => {
  const r = parsePasswordRules('foo: bar; minlength: 8;');
  assert.ok(r);
  assert.equal(r.minlength, 8);
});

test('parsePasswordRules: a custom [...] set', () => {
  const r = parsePasswordRules('required: [ab c];');
  assert.ok(r);
  assert.equal(r.required.length, 1);
  // space is stripped per the custom-set rule.
  assert.equal([...r.required[0]].sort().join(''), 'abc');
});

test('parsePasswordRules: unicode is treated as ascii-printable', () => {
  const r1 = parsePasswordRules('required: unicode;');
  const r2 = parsePasswordRules('required: ascii-printable;');
  assert.deepEqual(r1.required, r2.required);
});

test('parsePasswordRules: the special class matches the WebKit literal set', () => {
  const r = parsePasswordRules('required: special;');
  assert.equal([...r.required[0]].sort().join(''), [...'-~!@#$%^&*_+=`|(){}[:;"\'<>,.?]'].sort().join(''));
});

test('parsePasswordRules: an unterminated [ is a syntax error -> null', () => {
  assert.equal(parsePasswordRules('required: [abc;'), null);
});

test('parsePasswordRules: a non-integer where one is required is a syntax error -> null', () => {
  assert.equal(parsePasswordRules('minlength: abc;'), null);
});

test('parsePasswordRules: an unknown class keyword is a syntax error -> null (never partially applied)', () => {
  assert.equal(parsePasswordRules('required: upper, bogus;'), null);
});

test('parsePasswordRules: a non-string or empty input returns null', () => {
  assert.equal(parsePasswordRules(null), null);
  assert.equal(parsePasswordRules(''), null);
  assert.equal(parsePasswordRules('   '), null);
  assert.equal(parsePasswordRules(42), null);
});

// --- AC3: resolvePolicy ---

test('resolvePolicy: defaults (no constraints) — length 20, four classes, their union', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: null });
  assert.equal(p.ok, true);
  assert.equal(p.length, 20);
  assert.equal(p.requiredSets.length, 4);
  assert.equal(p.maxConsecutive, null);
});

test('resolvePolicy: minLength/maxLength attributes narrow the length', () => {
  const p = resolvePolicy({ minLength: 30, maxLength: null, passwordRules: null });
  assert.equal(p.ok, true);
  assert.equal(p.length, 30);
});

test('resolvePolicy: min > max is unsatisfiable', () => {
  const p = resolvePolicy({ minLength: 20, maxLength: 10, passwordRules: null });
  assert.equal(p.ok, false);
});

test('resolvePolicy: a final length below 8 is unsatisfiable', () => {
  const p = resolvePolicy({ minLength: null, maxLength: 5, passwordRules: null });
  assert.equal(p.ok, false);
});

test('resolvePolicy: length below requiredSets.length is unsatisfiable for the RULES pass, and (per DD6) gracefully degrades to the attributes-only default rather than surfacing it', () => {
  // 5 required classes packed into a maxLength of 4 via passwordrules maxlength
  // makes the WITH-RULES pass fail on "length < requiredSets.length" — but the
  // default (4-class) attributes-only pass never can (length >= 8 always implies
  // length >= 4), so resolvePolicy degrades to it rather than giving up. This is
  // exactly DD6's "widest satisfiable", not a bug: the branch is real inside the
  // policy computation, but by construction it can never be the reason the PUBLIC
  // resolvePolicy() itself gives up (see the sibling `min > max` variant below for
  // a scenario where the degrade path ALSO fails and ok stays false).
  const p = resolvePolicy({
    minLength: null,
    maxLength: null,
    passwordRules: 'required: upper, lower, digit, special, [x]; maxlength: 4;'
  });
  assert.equal(p.ok, true);
  assert.equal(p.requiredSets.length, 4); // the DEFAULT four classes, rules dropped.
});

test('resolvePolicy: an empty alphabet from the rules also degrades to the attributes-only default', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: 'allowed: [];' });
  assert.equal(p.ok, true);
  assert.equal(p.requiredSets.length, 4);
});

test('resolvePolicy: an empty-alphabet rules failure with NO attributes-only rescue (conflicting attribute bounds) stays unsatisfiable', () => {
  const p = resolvePolicy({ minLength: 200, maxLength: null, passwordRules: 'allowed: [];' });
  assert.equal(p.ok, false);
});

test('resolvePolicy: passwordRules narrows the alphabet to allowed+required', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: 'required: digit; allowed: upper;' });
  assert.equal(p.ok, true);
  assert.ok([...p.alphabet].every((c) => /[0-9A-Z]/.test(c)));
  assert.equal(p.requiredSets.length, 1);
});

test('resolvePolicy: unsatisfiable RULES degrade to the attributes-only policy (DD6 "widest satisfiable")', () => {
  // maxlength: 4 makes the 5-required-class rule unsatisfiable, but the
  // ATTRIBUTE minLength/maxLength alone (no passwordRules) is fine.
  const p = resolvePolicy({
    minLength: 10,
    maxLength: 12,
    passwordRules: 'required: upper, lower, digit, special, [x]; maxlength: 4;'
  });
  assert.equal(p.ok, true);
  assert.equal(p.length, 12);
  assert.equal(p.requiredSets.length, 4); // the DEFAULT four classes, rules ignored.
});

test('resolvePolicy: an oversized minlength rule (> the hard 128 cap) is unsatisfiable for the rules pass and degrades to the ordinary 20-char default — never a 200-char password', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: 'minlength: 200;' });
  assert.equal(p.ok, true);
  assert.equal(p.length, 20);
});

test('resolvePolicy: an oversized minlength rule with NO attributes-only rescue stays unsatisfiable, never generating past 128', () => {
  const p = resolvePolicy({ minLength: 200, maxLength: null, passwordRules: null });
  assert.equal(p.ok, false);
});

test('resolvePolicy: an unparseable passwordRules is ignored entirely (treated as absent)', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: 'required: bogus;' });
  assert.equal(p.ok, true);
  assert.equal(p.requiredSets.length, 4); // defaults, since the whole attribute was dropped.
});

test('resolvePolicy: max-consecutive rides through to the resolved policy', () => {
  const p = resolvePolicy({ minLength: null, maxLength: null, passwordRules: 'max-consecutive: 2;' });
  assert.equal(p.ok, true);
  assert.equal(p.maxConsecutive, 2);
});

// --- AC5: generateCandidates ---

test('generateCandidates: [] when the primary policy is not satisfiable', () => {
  assert.deepEqual(generateCandidates({ minLength: 20, maxLength: 10, passwordRules: null }), []);
});

test('generateCandidates: a single candidate when the primary is already alnum-only', () => {
  const cs = generateCandidates({
    minLength: null,
    maxLength: null,
    passwordRules: 'required: upper, lower, digit; maxlength: 16;'
  });
  assert.equal(cs.length, 1);
  assert.ok(/^[A-Za-z0-9]+$/.test(cs[0]));
});

test('generateCandidates: a two-candidate default (the alnum fallback differs from the full-alphabet primary)', () => {
  const cs = generateCandidates({ minLength: null, maxLength: null, passwordRules: null });
  assert.equal(cs.length, 2);
  assert.equal(cs[0].length, 20);
  assert.equal(cs[1].length, 20);
  assert.ok(/^[A-Za-z0-9]+$/.test(cs[1]), 'the fallback candidate must be alnum-only');
});

test('generateCandidates: every candidate is <= 128 chars', () => {
  const cs = generateCandidates({ minLength: 128, maxLength: null, passwordRules: null });
  for (const c of cs) assert.ok(c.length <= 128);
});
