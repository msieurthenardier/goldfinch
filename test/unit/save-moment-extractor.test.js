'use strict';

// Unit tests for the hand-rolled fixture extractor (Mission 21, Flight 1, Leg 4 —
// fixture-corpus). These tests prove the extractor is INTERNALLY CONSISTENT with
// its own two pinned form-association rules and its attribute/property
// normalization rules — they do NOT prove browser parity (see the extractor's own
// header comment; only a live cross-check retires that risk, DD6).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractDocument } = require('../helpers/fixture-extractor');
const { findAllLoginFields, fillLoginForm } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');
const { createEntryObserver } = require('../../src/preload/vault-entry-observer');

// node:test isolates each test FILE in its own process, so this module-scope stub
// (the vault-entry-observer.test.js precedent) never leaks into another suite.
// Without it, createEntryObserver's install() would schedule real, un-mocked
// setTimeout retries (up to ~2s) for every test below that calls install() — this
// file's own integration tests care about grant/snapshot behavior, not
// detachment, so giving armMutationObserver() something to succeed against
// immediately keeps the suite fast.
class StubMutationObserver {
  observe() {}
}
global.MutationObserver = StubMutationObserver;

// --- rule (a): form-association, containment + the ignored-nested-form case ----

test('an input directly inside a <form> resolves .form and .closest("form") to it', () => {
  const doc = extractDocument('<form id="f1"><input id="pw" type="password"></form>');
  const input = doc.getElementById('pw');
  const form = doc.getElementById('f1');
  assert.equal(input.form, form);
  assert.equal(input.closest('form'), form);
});

test('an input outside every form resolves .form and .closest("form") to null', () => {
  const doc = extractDocument('<div><input id="pw" type="password"></div>');
  const input = doc.getElementById('pw');
  assert.equal(input.form, null);
  assert.equal(input.closest('form'), null);
});

test('rule (a): a <form> start tag while a form is already open is IGNORED — no nested element, content reparents to the outer form', () => {
  const doc = extractDocument(
    '<form id="outer">' +
      '<input id="a" type="text">' +
      '<form id="inner">' +
      '<input id="b" type="password">' +
      '</form>' +
      '</form>'
  );
  // The inner <form> tag was never a real element — a naive nesting tree-builder
  // would create it and register its id.
  assert.equal(doc.getElementById('inner'), null);

  const outer = doc.getElementById('outer');
  const a = doc.getElementById('a');
  const b = doc.getElementById('b');
  // Both inputs reparented to the OUTER form — both physically appear in its
  // subtree, and both resolve .form to it.
  assert.deepEqual(outer.querySelectorAll('input'), [a, b]);
  assert.equal(a.form, outer);
  assert.equal(b.form, outer);

  // The two pure detection modules (reused directly, per the leg's own guidance)
  // see exactly one login entry, scoped to the outer form.
  const entries = findAllLoginFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].password, b);
  assert.equal(entries[0].username, a);
});

test('rule (a), single-pointer fidelity: a second, genuinely sibling <form> after the ignored one opens and closes normally', () => {
  // Confirms the single formPointer (never a stack) resets correctly: after the
  // outer form's real close tag, a wholly separate later <form> is NOT itself
  // treated as "already open" and gets its own real element.
  const doc = extractDocument(
    '<form id="outer"><form id="inner"><input id="b" type="password"></form></form>' +
      '<form id="second"><input id="c" type="password"></form>'
  );
  assert.equal(doc.getElementById('inner'), null);
  const second = doc.getElementById('second');
  assert.notEqual(second, null);
  const c = doc.getElementById('c');
  assert.equal(c.form, second);
});

// --- rule (b): form= IDREF wins over containment, anywhere in the tree ---------

test('rule (b): a valid form= IDREF wins over containment for a field outside every form', () => {
  const doc = extractDocument('<form id="f1"></form><input id="x" type="password" form="f1">');
  const f1 = doc.getElementById('f1');
  const x = doc.getElementById('x');
  assert.equal(x.form, f1);
});

test('rule (b): a valid form= IDREF wins over containment even for a field physically inside a DIFFERENT form', () => {
  const doc = extractDocument('<form id="A"><input id="y" type="password" form="B"></form><form id="B"></form>');
  const A = doc.getElementById('A');
  const B = doc.getElementById('B');
  const y = doc.getElementById('y');
  assert.notEqual(y.form, A);
  assert.equal(y.form, B);
});

test('an invalid form= IDREF (unknown id) falls back to containment', () => {
  const doc = extractDocument('<form id="A"><input id="z" type="password" form="nope"></form>');
  const A = doc.getElementById('A');
  const z = doc.getElementById('z');
  assert.equal(z.form, A);
});

test('a form= IDREF pointing at a non-form element falls back to containment', () => {
  const doc = extractDocument(
    '<div id="notaform"></div><form id="A"><input id="z" type="password" form="notaform"></form>'
  );
  const A = doc.getElementById('A');
  const z = doc.getElementById('z');
  assert.equal(z.form, A);
});

// --- attribute-vs-property normalization ---------------------------------------

test('a missing type attribute normalizes .type to "text"', () => {
  const doc = extractDocument('<input id="x">');
  assert.equal(doc.getElementById('x').type, 'text');
});

test('an invalid/unknown type attribute normalizes .type to "text"', () => {
  const doc = extractDocument('<input id="x" type="not-a-real-type">');
  assert.equal(doc.getElementById('x').type, 'text');
});

test('a valid type attribute is preserved and lowercased', () => {
  const doc = extractDocument('<input id="x" type="PASSWORD">');
  assert.equal(doc.getElementById('x').type, 'password');
});

test('.maxLength defaults to -1, not null/undefined, when the attribute is absent', () => {
  const doc = extractDocument('<input id="x">');
  assert.equal(doc.getElementById('x').maxLength, -1);
  assert.notEqual(doc.getElementById('x').maxLength, null);
  assert.notEqual(doc.getElementById('x').maxLength, undefined);
});

test('.maxLength parses a valid maxlength attribute', () => {
  const doc = extractDocument('<input id="x" maxlength="7">');
  assert.equal(doc.getElementById('x').maxLength, 7);
});

test('.maxLength defaults to -1 for an invalid (non-numeric or negative) maxlength attribute', () => {
  const doc1 = extractDocument('<input id="x" maxlength="not-a-number">');
  assert.equal(doc1.getElementById('x').maxLength, -1);
  const doc2 = extractDocument('<input id="x" maxlength="-3">');
  assert.equal(doc2.getElementById('x').maxLength, -1);
});

test("a <select>'s .value derives from the SELECTED option, never a literal attribute on the tag", () => {
  const doc = extractDocument(
    '<select id="s"><option value="28">28</option><option value="29" selected>29</option></select>'
  );
  const select = doc.getElementById('s');
  assert.equal(select.getAttribute('value'), null); // no such attribute exists on <select>
  assert.equal(select.value, '29');
});

test('a <select> with no selected option defaults .value to the first option', () => {
  const doc = extractDocument('<select id="s"><option value="a">A</option><option value="b">B</option></select>');
  assert.equal(doc.getElementById('s').value, 'a');
});

test('a <select> with multiple selected options resolves to the LAST one declared (real-markup dedup behavior)', () => {
  const doc = extractDocument(
    '<select id="s"><option value="a" selected>A</option><option value="b" selected>B</option></select>'
  );
  assert.equal(doc.getElementById('s').value, 'b');
});

test('an option value falls back to its text content when no value attribute is present', () => {
  const doc = extractDocument('<select id="s"><option selected>2028</option></select>');
  assert.equal(doc.getElementById('s').value, '2028');
});

// --- the pinned query surface itself --------------------------------------------

test('querySelectorAll("input, select") finds both kinds in document order', () => {
  const doc = extractDocument('<input id="a"><select id="b"></select><input id="c">');
  const found = doc.querySelectorAll('input, select').map((el) => el.id);
  assert.deepEqual(found, ['a', 'b', 'c']);
});

test('a form-scoped querySelectorAll("input") never returns fields from outside the form', () => {
  const doc = extractDocument('<input id="outside"><form id="f"><input id="inside"></form>');
  const form = doc.getElementById('f');
  const found = form.querySelectorAll('input').map((el) => el.id);
  assert.deepEqual(found, ['inside']);
});

// --- document interface: addEventListener + documentElement, proven working ----
// AC: "The extractor's document interface must include addEventListener and
// documentElement" — createEntryObserver needs both, and Leg 5 will drive it
// against fixture markup. These integration tests exercise the REAL production
// module against a REAL extracted document, so Leg 5 does not rediscover a gap.

test('document interface exposes addEventListener and documentElement', () => {
  const doc = extractDocument('<input id="x">');
  assert.equal(typeof doc.addEventListener, 'function');
  assert.notEqual(doc.documentElement, undefined);
  assert.notEqual(doc.documentElement, null);
});

test('integration: createEntryObserver genuinely grants provenance from a trusted event dispatched on an extracted field, via document-level capturing listeners', () => {
  const doc = extractDocument(
    '<form id="f"><input id="user" type="text" name="username"><input id="pw" type="password"></form>'
  );
  const password = doc.getElementById('pw');
  const observer = createEntryObserver({ document: doc, findAllLoginFields, findAllCardFields });
  observer.install();

  password.value = 'real-typed-value';
  // A plain object, not a real `new Event()` — a script-constructed real Event is
  // always isTrusted:false by browser design, so a trusted-gesture SIMULATION
  // must be a plain event-like object, exactly the shape createEntryObserver
  // itself reads (isTrusted / target).
  password.dispatchEvent({ type: 'input', isTrusted: true, bubbles: true });

  assert.deepEqual(observer.snapshot(), {
    logins: [{ username: { detected: true, value: null }, password: { detected: true, value: 'real-typed-value' } }],
    cards: [],
    identities: []
  });
});

test('integration: an UNTRUSTED (script-dispatched) event on an extracted field never grants provenance', () => {
  const doc = extractDocument('<input id="pw" type="password">');
  const password = doc.getElementById('pw');
  const observer = createEntryObserver({ document: doc, findAllLoginFields, findAllCardFields });
  observer.install();

  password.value = 'attacker-value';
  password.dispatchEvent(new Event('input', { bubbles: true })); // real Event → isTrusted:false

  assert.deepEqual(observer.snapshot(), {
    logins: [{ password: { detected: true, value: null } }],
    cards: [],
    identities: []
  });
});

test('integration: fillLoginForm (production fill path) writes into an extracted document and grantForFill records it, no read-back', () => {
  const doc = extractDocument('<form id="f"><input id="user" type="text"><input id="pw" type="password"></form>');
  const observer = createEntryObserver({ document: doc, findAllLoginFields, findAllCardFields });
  observer.install();

  const result = fillLoginForm(doc, { username: 'alice', password: 'hunter2' });
  assert.equal(result.filled, true);
  observer.grantForFill(result);

  assert.deepEqual(observer.snapshot(), {
    logins: [{ username: { detected: true, value: 'alice' }, password: { detected: true, value: 'hunter2' } }],
    cards: [],
    identities: []
  });
  // The extractor's setFieldValue-driven write really landed on the node.
  assert.equal(doc.getElementById('pw').value, 'hunter2');
});
