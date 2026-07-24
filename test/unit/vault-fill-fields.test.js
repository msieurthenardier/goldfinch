'use strict';

// Unit test for the guest-preload login-form field-selection + fill helpers
// (Mission 12, Flight 1, Leg 4). Zero-dep: a hand-rolled fake `document` (the
// jars-page-dom.js / media-controller.test.js precedent) models EXACTLY the DOM
// surface the helper pins — `querySelectorAll('input[type=password]')`, the
// password field's `.form`, `form.querySelectorAll('input')`, `.value`, and
// `.dispatchEvent`. No jsdom, no browser. Node 22 provides global `Event`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findLoginFields, findAllLoginFields, fillLoginForm, isLivePasswordField } = require('../../src/preload/vault-fill-fields');

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

// A document over an ordered list of forms PLUS optional loose (form-less) inputs.
// Document order is the concatenation of each form's inputs then the loose inputs.
function makeMixedDoc(forms, loose = []) {
  const all = [...forms.flatMap((f) => f.inputs), ...loose];
  return {
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return all.filter((i) => i.type === 'password');
      if (selector === 'input') return all.slice();
      return [];
    },
  };
}

// --- findAllLoginFields (M12 F2 Leg 1, DD2): one entry per password field ---

test('findAllLoginFields: multi-form page → one entry per password field, each with its own form/username', () => {
  const userA = new FakeInput('text', 'user-a');
  const passA = new FakeInput('password', 'pass-a');
  const formA = new FakeForm([userA, passA]);
  const userB = new FakeInput('email', 'user-b');
  const passB = new FakeInput('password', 'pass-b');
  const formB = new FakeForm([userB, passB]);
  const doc = makeDoc([formA, formB]);

  const entries = findAllLoginFields(doc);
  assert.equal(entries.length, 2, 'one entry per password field, in document order');
  assert.equal(entries[0].password, passA);
  assert.equal(entries[0].username, userA);
  assert.equal(entries[0].form, formA);
  assert.equal(entries[1].password, passB);
  assert.equal(entries[1].username, userB);
  assert.equal(entries[1].form, formB);
});

test('findAllLoginFields: password-only form → username null, form set', () => {
  const pass = new FakeInput('password', 'password');
  const form = new FakeForm([pass]);
  const doc = makeDoc([form]);

  const entries = findAllLoginFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].password, pass);
  assert.equal(entries[0].username, null, 'no preceding text input → null username');
  assert.equal(entries[0].form, form);
});

test('findAllLoginFields: form-less password field → form null, username null, still returned', () => {
  const loosePass = new FakeInput('password', 'loose'); // .form stays null, no .closest
  const doc = makeMixedDoc([], [loosePass]);

  const entries = findAllLoginFields(doc);
  assert.equal(entries.length, 1, 'a password field outside any <form> still yields an entry');
  assert.equal(entries[0].password, loosePass);
  assert.equal(entries[0].form, null);
  assert.equal(entries[0].username, null);
});

test('findAllLoginFields: no-login page (no password field) → empty array', () => {
  const search = new FakeInput('search', 'q');
  const doc = makeDoc([new FakeForm([search])]);

  assert.deepEqual(findAllLoginFields(doc), []);
});

test('findAllLoginFields: two password fields in ONE form (signup/confirm) → two entries, same form', () => {
  const user = new FakeInput('text', 'username');
  const pass1 = new FakeInput('password', 'new');
  const pass2 = new FakeInput('password', 'confirm');
  const form = new FakeForm([user, pass1, pass2]);
  const doc = makeDoc([form]);

  const entries = findAllLoginFields(doc);
  assert.equal(entries.length, 2, 'per-field enumeration (grouping-by-form happens in the preload)');
  assert.equal(entries[0].form, form);
  assert.equal(entries[1].form, form);
  // Both resolve the same closest-preceding username (the only preceding text input).
  assert.equal(entries[0].username, user);
  assert.equal(entries[1].username, user);
});

test('findAllLoginFields: null/garbage doc → empty array (pure, no throw)', () => {
  assert.deepEqual(findAllLoginFields(null), []);
  assert.deepEqual(findAllLoginFields({}), []);
});

// --- targetPassword binding (PR#112 finding 9): the clicked form's field wins ---

test('targetPassword fills the SECOND login form, not the document-first (finding 9)', () => {
  const userA = new FakeInput('text', 'user-a');
  const passA = new FakeInput('password', 'pass-a');
  const formA = new FakeForm([userA, passA]);
  const userB = new FakeInput('email', 'user-b');
  const passB = new FakeInput('password', 'pass-b');
  const formB = new FakeForm([userB, passB]);
  const doc = makeDoc([formA, formB]);

  // The gesture targeted form B's password field — fill THAT form, not the first.
  const result = fillLoginForm(doc, { username: 'bob@example.com', password: 'hunter2' }, passB);

  assert.deepEqual(result, { filled: true });
  assert.equal(passB.value, 'hunter2', 'the clicked form B is filled');
  assert.equal(userB.value, 'bob@example.com');
  assert.equal(passA.value, '', 'the document-first form A is NOT filled');
  assert.equal(userA.value, '');
});

test('a null / stale targetPassword falls back to the first-field heuristic (MCP path)', () => {
  const userA = new FakeInput('text', 'user-a');
  const passA = new FakeInput('password', 'pass-a');
  const passB = new FakeInput('password', 'pass-b');
  const doc = makeDoc([new FakeForm([userA, passA]), new FakeForm([passB])]);

  // Null target → first field (unchanged MCP behavior).
  fillLoginForm(doc, { username: 'alice', password: 'pw' }, null);
  assert.equal(passA.value, 'pw', 'null target → first password field');

  // A detached/foreign field not in the doc → treated as stale → first field.
  passA.value = '';
  const foreign = new FakeInput('password', 'foreign');
  fillLoginForm(doc, { username: 'alice', password: 'pw2' }, foreign);
  assert.equal(passA.value, 'pw2', 'foreign target is not present in doc → falls back to first');
  assert.equal(foreign.value, '', 'the foreign field is never filled');
});

test('isLivePasswordField: true only for a password input present in the doc', () => {
  const pass = new FakeInput('password', 'p');
  const text = new FakeInput('text', 't');
  const doc = makeDoc([new FakeForm([text, pass])]);
  assert.equal(isLivePasswordField(doc, pass), true);
  assert.equal(isLivePasswordField(doc, text), false, 'a text input is not a live password field');
  assert.equal(isLivePasswordField(doc, new FakeInput('password', 'x')), false, 'a detached field is not live');
  assert.equal(isLivePasswordField(null, pass), false);
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
