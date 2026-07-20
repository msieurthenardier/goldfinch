'use strict';

// Unit test for the guest-preload login-form field-selection + fill helpers
// (Mission 12, Flight 1, Leg 4). Zero-dep: a hand-rolled fake `document` (the
// jars-page-dom.js / media-controller.test.js precedent) models EXACTLY the DOM
// surface the helper pins — `querySelectorAll('input[type=password]')`, the
// password field's `.form`, `form.querySelectorAll('input')`, `.value`, and
// `.dispatchEvent`. No jsdom, no browser. Node 22 provides global `Event`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findLoginFields, fillLoginForm } = require('../../src/preload/vault-fill-fields');

class FakeInput {
  // `type` omitted models a no-type input (a real <input>.type is 'text').
  constructor(type, name) {
    this.type = type === undefined ? 'text' : type;
    this.name = name || '';
    this.value = '';
    this.form = null;
    this.events = [];
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

// A document over an ordered list of forms; document order is the concatenation
// of each form's inputs.
function makeDoc(forms) {
  const all = forms.flatMap((f) => f.inputs);
  return {
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return all.filter((i) => i.type === 'password');
      if (selector === 'input') return all.slice();
      return [];
    },
  };
}

test('fills both fields and dispatches input+change on a normal login form', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);

  const result = fillLoginForm(doc, { username: 'alice@example.com', password: 's3cr3t!' });

  assert.deepEqual(result, { filled: true });
  assert.equal(user.value, 'alice@example.com');
  assert.equal(pass.value, 's3cr3t!');
  assert.deepEqual(user.events, [
    { type: 'input', bubbles: true },
    { type: 'change', bubbles: true },
  ]);
  assert.deepEqual(pass.events, [
    { type: 'input', bubbles: true },
    { type: 'change', bubbles: true },
  ]);
});

test('no password field on the page → fills nothing', () => {
  const search = new FakeInput('search', 'q');
  const doc = makeDoc([new FakeForm([search])]);

  assert.equal(findLoginFields(doc), null);
  const result = fillLoginForm(doc, { username: 'alice', password: 'pw' });

  assert.deepEqual(result, { filled: false });
  assert.equal(search.value, '');
  assert.deepEqual(search.events, []);
});

test('multiple forms → the password-bearing form supplies the username', () => {
  // Form A is a search box (a text input, NO password) that must be ignored.
  const searchBox = new FakeInput('text', 'site-search');
  const formA = new FakeForm([searchBox]);
  // Form B is the login form.
  const loginUser = new FakeInput('email', 'email');
  const loginPass = new FakeInput('password', 'password');
  const formB = new FakeForm([loginUser, loginPass]);
  const doc = makeDoc([formA, formB]);

  const fields = findLoginFields(doc);
  assert.equal(fields.username, loginUser, 'username comes from the password-bearing form');
  assert.equal(fields.password, loginPass);

  fillLoginForm(doc, { username: 'bob@example.com', password: 'hunter2' });
  assert.equal(searchBox.value, '', 'the unrelated search form is untouched');
  assert.equal(loginUser.value, 'bob@example.com');
  assert.equal(loginPass.value, 'hunter2');
});

test('username heuristic is deterministic: LAST text/email/tel/no-type input PRECEDING the password', () => {
  const olderEmail = new FakeInput('email', 'contact-email'); // qualifies, but earlier
  const remember = new FakeInput('checkbox', 'remember');     // skipped (not a text type)
  const noType = new FakeInput(undefined, 'username');        // no-type → models as text; LAST qualifying before pw
  const pass = new FakeInput('password', 'password');
  const trailing = new FakeInput('text', 'coupon');           // AFTER the password → never chosen
  const doc = makeDoc([new FakeForm([olderEmail, remember, noType, pass, trailing])]);

  const fields = findLoginFields(doc);
  assert.equal(fields.username, noType, 'the closest-preceding qualifying input is chosen');

  fillLoginForm(doc, { username: 'carol', password: 'pw' });
  assert.equal(noType.value, 'carol');
  assert.equal(olderEmail.value, '', 'an earlier qualifying input is not filled');
  assert.equal(trailing.value, '', 'an input after the password is not filled');
  assert.equal(pass.value, 'pw');
});

test('password-only form fills the password and no username', () => {
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([pass])]);

  const fields = findLoginFields(doc);
  assert.equal(fields.username, null);
  const result = fillLoginForm(doc, { username: 'ignored', password: 'pw-only' });

  assert.deepEqual(result, { filled: true });
  assert.equal(pass.value, 'pw-only');
});

test('top-frame guard: never fills inside an iframe (window.top !== window)', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);

  const saved = global.window;
  try {
    // A framed context: window.top is a different object than window.
    global.window = { top: {} };
    const result = fillLoginForm(doc, { username: 'alice', password: 'pw' });
    assert.deepEqual(result, { filled: false });
    assert.equal(user.value, '', 'iframe fill is refused');
    assert.equal(pass.value, '');
  } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
});
