'use strict';

// Unit tests for the isolated-world Generate-in-picker fill helper (Mission 21,
// Flight 4, Leg 3 — generate-in-picker, DD7/AC15). Same hand-rolled fake-DOM
// discipline as vault-fill-fields.test.js, extended with getAttribute/
// setAttribute so autocomplete/pattern can be modeled.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillGeneratedForm } = require('../../src/preload/vault-fill-fields');

class FakeInput {
  constructor(type, name) {
    this.type = type === undefined ? 'text' : type;
    this.name = name || '';
    this.value = '';
    this.form = null;
    this.events = [];
    this._attrs = {};
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  dispatchEvent(evt) {
    this.events.push({ type: evt.type, bubbles: !!evt.bubbles });
    return true;
  }
}

class FakeForm {
  constructor(inputs) {
    this.inputs = inputs;
    for (const input of inputs) input.form = this;
  }
  querySelectorAll(selector) {
    return selector === 'input' ? this.inputs.slice() : [];
  }
}

function makeDoc(forms) {
  const all = forms.flatMap((f) => f.inputs);
  return {
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return all.filter((i) => i.type === 'password');
      if (selector === 'input') return all.slice();
      return [];
    }
  };
}

const CANDIDATES = ['GenPrimary123!', 'genfallback123'];

test('a sign-up scope: new + confirm both filled with the SAME value', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const confirmPw = new FakeInput('password', 'password2');
  confirmPw.setAttribute('autocomplete', 'new-password'); // second new-password -> confirm
  const doc = makeDoc([new FakeForm([newPw, confirmPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);

  assert.equal(result.filled, true);
  assert.equal(newPw.value, CANDIDATES[0]);
  assert.equal(confirmPw.value, CANDIDATES[0]);
  assert.deepEqual(result.fields, [
    { field: newPw, value: CANDIDATES[0] },
    { field: confirmPw, value: CANDIDATES[0] }
  ]);
  assert.deepEqual(newPw.events, [
    { type: 'input', bubbles: true },
    { type: 'change', bubbles: true }
  ]);
});

test('a change-password scope: current + new + confirm — current stays untouched', () => {
  const current = new FakeInput('password', 'current');
  current.setAttribute('autocomplete', 'current-password');
  const next = new FakeInput('password', 'next');
  next.setAttribute('autocomplete', 'new-password');
  const confirm = new FakeInput('password', 'confirm');
  confirm.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([current, next, confirm])]);

  // Clicked on the "current" field's own entry (ordinal 0) — the scope still
  // resolves the NEW field's fill regardless of which entry was clicked.
  const result = fillGeneratedForm(doc, CANDIDATES, 0);

  assert.equal(result.filled, true);
  assert.equal(current.value, '', 'the current password must never be touched');
  assert.equal(current.events.length, 0);
  assert.equal(next.value, CANDIDATES[0]);
  assert.equal(confirm.value, CANDIDATES[0]);
});

test('a sign-in scope (single unmarked field): nothing filled', () => {
  const pw = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([pw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);

  assert.equal(result.filled, false);
  assert.deepEqual(result.fields, []);
  assert.equal(pw.value, '');
});

test('a null or stale ordinal fills nothing — NO first-field fallback', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([newPw])]);

  assert.deepEqual(fillGeneratedForm(doc, CANDIDATES, null), { filled: false, fields: [] });
  assert.deepEqual(fillGeneratedForm(doc, CANDIDATES, undefined), { filled: false, fields: [] });
  assert.deepEqual(fillGeneratedForm(doc, CANDIDATES, -1), { filled: false, fields: [] });
  assert.deepEqual(fillGeneratedForm(doc, CANDIDATES, 1.5), { filled: false, fields: [] });
  assert.deepEqual(fillGeneratedForm(doc, CANDIDATES, 5), { filled: false, fields: [] }, 'out of range');
  assert.equal(newPw.value, '');
});

test('a pattern matching only the fallback candidate: the fallback is used', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  // Only lowercase+digits, length exactly matching the fallback candidate.
  newPw.setAttribute('pattern', '[a-z0-9]{14}');
  const doc = makeDoc([new FakeForm([newPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);
  assert.equal(result.filled, true);
  assert.equal(newPw.value, CANDIDATES[1]);
});

test('a pattern matching neither candidate: nothing filled', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  newPw.setAttribute('pattern', '[0-9]{50}'); // matches neither candidate
  const doc = makeDoc([new FakeForm([newPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);
  assert.deepEqual(result, { filled: false, fields: [] });
  assert.equal(newPw.value, '');
});

test('an invalid pattern (fails to compile): the primary candidate is used', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  newPw.setAttribute('pattern', '(unterminated');
  const doc = makeDoc([new FakeForm([newPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);
  assert.equal(result.filled, true);
  assert.equal(newPw.value, CANDIDATES[0]);
});

test('an over-long pattern (> 1024 chars): the primary candidate is used, never compiled', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  newPw.setAttribute('pattern', 'a'.repeat(1025));
  const doc = makeDoc([new FakeForm([newPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);
  assert.equal(result.filled, true);
  assert.equal(newPw.value, CANDIDATES[0]);
});

test('an absent pattern: the primary candidate is used', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([newPw])]);

  fillGeneratedForm(doc, CANDIDATES, 0);
  assert.equal(newPw.value, CANDIDATES[0]);
});

test('the returned fields list exactly matches what was written (new+confirm, order preserved)', () => {
  const newPw = new FakeInput('password', 'p1');
  newPw.setAttribute('autocomplete', 'new-password');
  const confirmPw = new FakeInput('password', 'p2');
  confirmPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([newPw, confirmPw])]);

  const result = fillGeneratedForm(doc, CANDIDATES, 0);
  assert.deepEqual(result.fields, [
    { field: newPw, value: CANDIDATES[0] },
    { field: confirmPw, value: CANDIDATES[0] }
  ]);
});

test('a candidate over 128 chars is never considered', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([newPw])]);

  const tooLong = 'x'.repeat(129);
  const result = fillGeneratedForm(doc, [tooLong], 0);
  assert.deepEqual(result, { filled: false, fields: [] });
});

test('a non-array candidates argument fills nothing', () => {
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([newPw])]);
  assert.deepEqual(fillGeneratedForm(doc, null, 0), { filled: false, fields: [] });
  assert.deepEqual(fillGeneratedForm(doc, undefined, 0), { filled: false, fields: [] });
});

test('never fills a username field, even when present in the scope', () => {
  const username = new FakeInput('text', 'username');
  const newPw = new FakeInput('password', 'password');
  newPw.setAttribute('autocomplete', 'new-password');
  const doc = makeDoc([new FakeForm([username, newPw])]);

  fillGeneratedForm(doc, CANDIDATES, 0);
  assert.equal(username.value, '', 'the username field is never a fill target');
});
