'use strict';

// Unit tests for src/shared/password-generator.js (M12 Flight 3, Leg 3 / DD7).
//
// The module is a real ES module; Node >=22 require(esm) loads the exact file the
// page ships. Pure — no DOM, no Electron. Randomness comes from
// `globalThis.crypto.getRandomValues` (present in BOTH the sandboxed page AND here),
// which one test spies to prove it is the source (not Math.random / node:crypto).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { generatePassword, CLASSES, CLASS_NAMES } = require('../../src/shared/password-generator');

const LOWER = new Set(CLASSES.lower);
const UPPER = new Set(CLASSES.upper);
const DIGITS = new Set(CLASSES.digits);
const SYMBOLS = new Set(CLASSES.symbols);

function classesPresent(pw) {
  return {
    lower: [...pw].some((c) => LOWER.has(c)),
    upper: [...pw].some((c) => UPPER.has(c)),
    digits: [...pw].some((c) => DIGITS.has(c)),
    symbols: [...pw].some((c) => SYMBOLS.has(c)),
  };
}

test('defaults: length 20, all four classes present', () => {
  const pw = generatePassword();
  assert.equal(pw.length, 20);
  assert.deepEqual(classesPresent(pw), { lower: true, upper: true, digits: true, symbols: true });
});

test('honors an explicit length', () => {
  for (const len of [4, 12, 32, 64]) {
    assert.equal(generatePassword({ length: len }).length, len);
  }
});

test('each ENABLED class appears at least once and DISABLED classes never appear', () => {
  // digits-only
  const digitsOnly = generatePassword({ length: 16, lower: false, upper: false, digits: true, symbols: false });
  assert.ok([...digitsOnly].every((c) => DIGITS.has(c)), 'digits-only must contain only digits');
  assert.deepEqual(classesPresent(digitsOnly), { lower: false, upper: false, digits: true, symbols: false });

  // lower + upper only — no digit, no symbol, both letter classes present
  const letters = generatePassword({ length: 30, lower: true, upper: true, digits: false, symbols: false });
  const p = classesPresent(letters);
  assert.equal(p.lower, true);
  assert.equal(p.upper, true);
  assert.equal(p.digits, false);
  assert.equal(p.symbols, false);
});

test('guarantees >=1 of each enabled class even at the minimum length (length == class count)', () => {
  // 4 classes, length 4 → exactly one of each, every time.
  for (let i = 0; i < 200; i += 1) {
    const pw = generatePassword({ length: 4 });
    assert.equal(pw.length, 4);
    assert.deepEqual(classesPresent(pw), { lower: true, upper: true, digits: true, symbols: true },
      `every 4-char all-class password must hold one of each (iteration ${i})`);
  }
});

test('unbiased smoke: a long single-class password covers most of its alphabet', () => {
  // Over a long draw from one class, a biased generator (e.g. modulo) would still
  // cover the alphabet, but an empty/near-empty coverage would signal a broken draw.
  const pw = generatePassword({ length: 4000, lower: true, upper: false, digits: false, symbols: false });
  const seen = new Set(pw);
  assert.ok(seen.size >= 24, `expected near-full a-z coverage, saw ${seen.size}/26`);
});

test('unbiased smoke: every position across many draws sees a variety of characters', () => {
  // A biased Fisher-Yates (or sort-based shuffle) tends to pin certain classes to
  // certain positions. Sample position 0 across many generations — it should not be
  // dominated by a single class.
  const firstCharClasses = { lower: 0, upper: 0, digits: 0, symbols: 0 };
  for (let i = 0; i < 400; i += 1) {
    const c = generatePassword({ length: 8 })[0];
    if (LOWER.has(c)) firstCharClasses.lower += 1;
    else if (UPPER.has(c)) firstCharClasses.upper += 1;
    else if (DIGITS.has(c)) firstCharClasses.digits += 1;
    else if (SYMBOLS.has(c)) firstCharClasses.symbols += 1;
  }
  // No single class should occupy position 0 in EVERY draw (a pinned-front bug).
  for (const name of CLASS_NAMES) {
    assert.ok(firstCharClasses[name] < 400, `position 0 is always ${name} — shuffle is not distributing`);
    assert.ok(firstCharClasses[name] > 0, `position 0 is never ${name} — shuffle is skewed`);
  }
});

test('the randomness source is globalThis.crypto.getRandomValues (spy)', () => {
  const original = globalThis.crypto.getRandomValues;
  let calls = 0;
  try {
    globalThis.crypto.getRandomValues = function spy(arr) {
      calls += 1;
      return original.call(globalThis.crypto, arr);
    };
    const pw = generatePassword({ length: 12 });
    assert.equal(pw.length, 12);
    assert.ok(calls > 0, 'generatePassword must draw from globalThis.crypto.getRandomValues');
  } finally {
    globalThis.crypto.getRandomValues = original;
  }
});

test('rejects length below the enabled-class count', () => {
  // 4 classes but length 3 → cannot include one of each.
  assert.throws(() => generatePassword({ length: 3 }), /below the 4 enabled classes|length/i);
  // 2 classes, length 1 → still below.
  assert.throws(
    () => generatePassword({ length: 1, lower: true, upper: true, digits: false, symbols: false }),
    /length/i
  );
});

test('rejects all classes off', () => {
  assert.throws(
    () => generatePassword({ lower: false, upper: false, digits: false, symbols: false }),
    /at least one character class/i
  );
});

test('rejects a non-integer / non-positive length', () => {
  assert.throws(() => generatePassword({ length: 0 }), /positive integer/i);
  assert.throws(() => generatePassword({ length: -5 }), /positive integer/i);
  assert.throws(() => generatePassword({ length: 12.5 }), /positive integer/i);
});
