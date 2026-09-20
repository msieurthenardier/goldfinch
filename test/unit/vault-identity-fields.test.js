'use strict';

// Unit test for the identity-field detector (Mission 21, Flight 2, Leg 2 —
// identity-boundary). Zero-dep fake `document`, same discipline as
// vault-card-fields.test.js. THIS SUITE IS THE PROOF the leg's own Context
// insists on: "the table is not trusted until attacked" — every named
// spelling from flight design is pinned here, admitted or refused, with the
// deciding vocabulary alternative named in the test itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PREFIXES,
  autocompleteRoleOf,
  fallbackRoleOf,
  isClaimedByLogin,
  findIdentityFields,
  findAllIdentityFields
} = require('../../src/preload/vault-identity-fields');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');

class FakeInput {
  constructor({ type = 'text', name = '', autocomplete = null, id = '', placeholder = '', ariaLabel = null } = {}) {
    this.tagName = 'INPUT';
    this.type = type;
    this.name = name;
    this.id = id;
    this.placeholder = placeholder;
    this._autocomplete = autocomplete;
    this._ariaLabel = ariaLabel;
    this.value = '';
    this.form = null;
    this.events = [];
  }
  getAttribute(attr) {
    if (attr === 'autocomplete') return this._autocomplete;
    if (attr === 'aria-label') return this._ariaLabel;
    return null;
  }
  dispatchEvent(evt) {
    this.events.push({ type: evt.type, bubbles: !!evt.bubbles });
    return true;
  }
}

// `resolveLoginEntry` (vault-fill-fields.js, LD3's real dependency) queries a
// form with the selector `'input'` alone, while the identity detector queries
// `'input, select'` — both selectors must resolve correctly for the SAME fake
// form/document so LD3's tests exercise the real login detector, not a stub.
class FakeForm {
  constructor(fields) {
    this.tagName = 'FORM';
    this.fields = fields;
    for (const f of fields) f.form = this;
  }
  querySelectorAll(selector) {
    if (selector === 'input, select') return this.fields.slice();
    if (selector === 'input') return this.fields.filter((f) => f.tagName === 'INPUT');
    return [];
  }
}

// A document over an ordered list of forms plus optional form-less fields.
function makeDoc(forms, loose = []) {
  const all = forms.flatMap((f) => f.fields).concat(loose);
  return {
    tagName: undefined,
    querySelectorAll(selector) {
      if (selector === 'input, select') return all.slice();
      if (selector === 'input') return all.filter((f) => f.tagName === 'INPUT');
      if (selector === 'input[type=password]') return all.filter((f) => f.tagName === 'INPUT' && f.type === 'password');
      return [];
    }
  };
}

// A single-form document wired from a plain `{ fieldName: input }` map, in
// insertion (== document) order.
function docOf(fieldMap) {
  return makeDoc([new FakeForm(Object.values(fieldMap))]);
}

/**
 * The minimal ALREADY-anchored scope this suite's per-spelling pins add one
 * field to: a real street anchor (`address1`) + a real non-postal role
 * (`email`), so the field under test is proven at FIELD-ADMISSION level,
 * isolated from whether it could anchor the scope by itself. Returns
 * `{ doc, field }` — `field` is the field under test, findable in the
 * resulting entry.
 * @param {any} field
 */
function anchoredWith(field) {
  const anchor = new FakeInput({ name: 'billingAddress1' });
  const nonPostal = new FakeInput({ name: 'email' });
  const doc = docOf({ anchor, nonPostal, field });
  return doc;
}

// --- field-level fallback role pins (no anchor/scope context) --------------

test('fallbackRoleOf: the alternatives model beats a flat token set on the motivating page', () => {
  // billingAddress1 -> ["billing","address1"] — NO "address" token exists.
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'billingAddress1' })), 'street');
  // billingFirstName / billingLastName both carry "name"; the 2-token
  // alternative for each ({first,name} / {last,name}) beats fullName's bare
  // 1-token {name}.
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'billingFirstName' })), 'firstName');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'billingLastName' })), 'lastName');
});

test('fallbackRoleOf: address1 / address2 — the literal motivating spellings', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'address1' })), 'street');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'address2' })), 'street2');
});

test('fallbackRoleOf: addr1 / addr2 — the glued abbreviations', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'addr1' })), 'street');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'addr2' })), 'street2');
});

test('fallbackRoleOf: billingAddress (bare, no digit) resolves via the {billing,address} compound, not a bare {address}', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'billingAddress' })), 'street');
});

test('fallbackRoleOf: streetAddress and shippingAddressLine1', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'streetAddress' })), 'street');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'shippingAddressLine1' })), 'street');
});

test('fallbackRoleOf: emailAddress resolves to email, never street — the round-2 tie is closed', () => {
  // ["email","address"] matches email's {email} (len 1). No street
  // alternative is ever bare {address}, so nothing competes.
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'emailAddress' })), 'email');
});

test('fallbackRoleOf: zipcode, postcode — glued lowercase tokens need their own literal entry', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'zipcode' })), 'postalCode');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'postcode' })), 'postalCode');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'zip' })), 'postalCode');
});

test('fallbackRoleOf: fname / lname — glued lowercase tokens need their own literal entry', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'fname' })), 'firstName');
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'lname' })), 'lastName');
});

test('fallbackRoleOf: mobile', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'mobile' })), 'phone');
});

test('fallbackRoleOf: bare "name" resolves fullName at field level (anchor gating is a pipeline concern)', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'name' })), 'fullName');
});

test('fallbackRoleOf: bare "city" resolves city at field level (anchor-eligibility is a separate question)', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'city' })), 'city');
});

test('fallbackRoleOf: destination matches nothing in the vocabulary', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ name: 'destination' })), null);
});

test('fallbackRoleOf: a password field is never identity-capable', () => {
  assert.equal(fallbackRoleOf(new FakeInput({ type: 'password', name: 'billingAddress1' })), null);
});

test('autocompleteRoleOf reads WHATWG identity tokens through prefix chains', () => {
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'street-address' })), 'street');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'billing postal-code' })), 'postalCode');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'shipping given-name' })), 'firstName');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'on' })), null); // useless hint
  assert.equal(autocompleteRoleOf(new FakeInput({})), null);
});

// --- LD2: the scope anchor, proven at the pipeline level -------------------

test('the motivating Jostens-shaped scope anchors and admits every field, autocomplete="on" everywhere (useless)', () => {
  const fields = {
    firstName: new FakeInput({ name: 'billingFirstName', autocomplete: 'on' }),
    lastName: new FakeInput({ name: 'billingLastName', autocomplete: 'on' }),
    email: new FakeInput({ name: 'billingEmail', autocomplete: 'on', type: 'email' }),
    phone: new FakeInput({ name: 'billingPhone', autocomplete: 'on', type: 'tel' }),
    street: new FakeInput({ name: 'billingAddress1', autocomplete: 'on' }),
    city: new FakeInput({ name: 'billingCity', autocomplete: 'on' }),
    postalCode: new FakeInput({ name: 'billingPostalCode', autocomplete: 'on' }),
    country: new FakeInput({ name: 'billingCountry', autocomplete: 'on' })
  };
  const doc = docOf(fields);
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.anchor, fields.street);
  assert.equal(entry.firstName, fields.firstName);
  assert.equal(entry.lastName, fields.lastName);
  assert.equal(entry.email, fields.email);
  assert.equal(entry.phone, fields.phone);
  assert.equal(entry.street, fields.street);
  assert.equal(entry.city, fields.city);
  assert.equal(entry.postalCode, fields.postalCode);
  assert.equal(entry.country, fields.country);
});

test('a scope with no postal role at all admits nothing, even with name + email present (newsletter)', () => {
  const doc = docOf({ name: new FakeInput({ name: 'name' }), email: new FakeInput({ name: 'email', type: 'email' }) });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('a scope with a bare, unprefixed city and nothing else postal does not anchor (job application)', () => {
  const doc = docOf({
    applicantName: new FakeInput({ name: 'applicantName' }),
    applicantEmail: new FakeInput({ name: 'applicantEmail', type: 'email' }),
    city: new FakeInput({ name: 'city' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('a scope with no vocabulary match at all does not anchor (flight search destination)', () => {
  const doc = docOf({
    origin: new FakeInput({ name: 'origin' }),
    destination: new FakeInput({ name: 'destination' }),
    passengerName: new FakeInput({ name: 'passengerName' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('a postal anchor with no non-postal role is refused — shipping-cost estimator (LD4 amendment 2)', () => {
  const doc = docOf({ zip: new FakeInput({ name: 'zip' }), country: new FakeInput({ name: 'country' }) });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('an address-only scope (street + city + postalCode, no name/email/phone) is refused — same rule, address-only edge case', () => {
  const doc = docOf({
    street: new FakeInput({ name: 'address1' }),
    city: new FakeInput({ name: 'billingCity' }),
    postalCode: new FakeInput({ name: 'zip' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('bare single-field "Name" checkout is refused: no postal field anywhere means the anchor never forms', () => {
  const doc = docOf({ name: new FakeInput({ name: 'name' }) });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('the anonymous field1/field2/field3 shape (name-only, placeholder text only) never anchors', () => {
  const doc = docOf({
    field1: new FakeInput({ name: 'field1', id: 'field1', placeholder: '123 Main St' }),
    field2: new FakeInput({ name: 'field2', id: 'field2', placeholder: 'Springfield' }),
    field3: new FakeInput({ name: 'field3', id: 'field3', placeholder: '00000' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test("ACCEPTED, NAMED false positive: a third-party incident address plus the reporter's own name/email is admitted", () => {
  // See flight.md DD1/LD4 decision 3 and this leg's own fixture header for
  // the full rationale: DD1's "nothing inferred from shape/position/value"
  // forbids the only signal (label proximity) that could tell these two
  // field groups apart, so this is accepted rather than pretended away.
  const fields = {
    reporterName: new FakeInput({ name: 'reporterName' }),
    reporterEmail: new FakeInput({ name: 'reporterEmail', type: 'email' }),
    incidentAddress1: new FakeInput({ name: 'incidentAddress1' }),
    incidentCity: new FakeInput({ name: 'incidentCity' }),
    incidentZip: new FakeInput({ name: 'incidentZip' })
  };
  const doc = docOf(fields);
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fullName, fields.reporterName);
  assert.equal(entries[0].email, fields.reporterEmail);
  assert.equal(entries[0].street, fields.incidentAddress1);
  assert.equal(entries[0].city, fields.incidentCity);
  assert.equal(entries[0].postalCode, fields.incidentZip);
});

// --- prefix-qualification: per-field, never aggregated across the scope ----

test('a stray prefixed field plus an unrelated bare city do NOT jointly anchor the scope', () => {
  // billing_department carries "billing" but no postal token at all; a bare
  // "city" elsewhere is not anchor-eligible on its own. Neither, nor both
  // together, may satisfy the anchor — prefix-qualification is evaluated on
  // ONE field's own haystack only.
  const doc = docOf({
    dept: new FakeInput({ name: 'billing_department' }),
    city: new FakeInput({ name: 'city' }),
    name: new FakeInput({ name: 'name' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('every named prefix qualifies city for the anchor', () => {
  for (const prefix of PREFIXES) {
    const doc = docOf({
      city: new FakeInput({ name: `${prefix}City` }),
      email: new FakeInput({ name: 'email', type: 'email' })
    });
    const entries = findAllIdentityFields(doc);
    assert.equal(entries.length, 1, `prefix "${prefix}" did not anchor via city`);
  }
});

test('an unlisted prefix does not qualify city for the anchor (the prefix list is closed, not fuzzy)', () => {
  const doc = docOf({
    city: new FakeInput({ name: 'officeCity' }),
    email: new FakeInput({ name: 'email', type: 'email' })
  });
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('once a scope is otherwise anchored, a BARE city/country field is still admitted (the anchor replaces the missing structural signal)', () => {
  const fields = {
    street: new FakeInput({ name: 'address1' }),
    email: new FakeInput({ name: 'email', type: 'email' }),
    city: new FakeInput({ name: 'city' }),
    country: new FakeInput({ name: 'country' })
  };
  const doc = docOf(fields);
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].city, fields.city);
  assert.equal(entries[0].country, fields.country);
});

// --- per-spelling admission pins, isolated via the minimal anchored scope --

test('addr2 / address2 admit as street2 once the scope is otherwise anchored', () => {
  for (const name of ['addr2', 'address2']) {
    const doc = anchoredWith(new FakeInput({ name }));
    const entries = findAllIdentityFields(doc);
    assert.equal(entries.length, 1, name);
    assert.equal(entries[0].street2.name, name);
  }
});

test('mobile admits as phone once the scope is otherwise anchored', () => {
  const doc = anchoredWith(new FakeInput({ name: 'mobile' }));
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].phone.name, 'mobile');
});

// --- LD3: login wins a contested field, proven against the REAL detector ---

test('LD3: a non-anchor identity field preceding a password is claimed by login; identity loses just that role', () => {
  // Two non-postal candidates (`name`, `phone`) so the scope's own >=1
  // non-postal requirement survives the contest via `name` even though
  // `phone` is the one taken by login — proving identity loses ONLY the
  // contested role, not the whole scope (that is the NEXT test).
  const street = new FakeInput({ name: 'billingAddress1' });
  const name = new FakeInput({ name: 'name' });
  const phone = new FakeInput({ name: 'billingPhone', type: 'tel' });
  const pw = new FakeInput({ type: 'password', name: 'password' });
  // Document order: street, name, phone, password — phone is the
  // CLOSEST-preceding text/email/tel input, so `resolveLoginEntry` claims it
  // (last-qualifying-wins over the preceding slice), not street or name.
  const form = new FakeForm([street, name, phone, pw]);
  const doc = makeDoc([form]);

  // Login claims `phone` positionally — the LAST text/email/tel field
  // preceding the password field.
  const loginEntries = findAllLoginFields(doc);
  assert.equal(loginEntries.length, 1);
  assert.equal(loginEntries[0].username, phone);
  assert.equal(isClaimedByLogin(phone, doc), true);
  assert.equal(isClaimedByLogin(street, doc), false);
  assert.equal(isClaimedByLogin(name, doc), false);

  // Identity still anchors (street + name survive) but never claims the
  // login-claimed phone field.
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].phone, null);
  assert.equal(entries[0].street, street);
  assert.equal(entries[0].fullName, name);
});

test('LD3: a contested field that would have been the ONLY anchor takes the anchor down with it', () => {
  // "the anchor itself can be contested" — street is the scope's only
  // postal-eligible field and sits immediately before the password, so login
  // claims it and the scope never anchors at all, despite a perfectly good
  // non-postal `email` field remaining.
  const street = new FakeInput({ name: 'billingAddress1' });
  const email = new FakeInput({ name: 'billingEmail', type: 'email' });
  const pw = new FakeInput({ type: 'password', name: 'password' });
  const form = new FakeForm([email, street, pw]);
  const doc = makeDoc([form]);

  assert.equal(isClaimedByLogin(street, doc), true);
  assert.deepEqual(findAllIdentityFields(doc), []);
});

test('isClaimedByLogin is false for a field in a document with no password field at all', () => {
  const email = new FakeInput({ name: 'billingEmail', type: 'email' });
  const doc = docOf({ email });
  assert.equal(isClaimedByLogin(email, doc), false);
});

// --- misc pipeline shape --------------------------------------------------

test('findIdentityFields returns the first entry, or null', () => {
  assert.equal(findIdentityFields(docOf({ name: new FakeInput({ name: 'name' }) })), null);
  const fields = {
    street: new FakeInput({ name: 'address1' }),
    email: new FakeInput({ name: 'email', type: 'email' })
  };
  const entry = findIdentityFields(docOf(fields));
  assert.ok(entry);
  assert.equal(entry.street, fields.street);
});

test('two anchored scopes (billing + shipping forms) each produce their own entry', () => {
  const billing = new FakeForm([
    new FakeInput({ name: 'billingAddress1' }),
    new FakeInput({ name: 'billingEmail', type: 'email' })
  ]);
  const shipping = new FakeForm([
    new FakeInput({ name: 'shippingAddress1' }),
    new FakeInput({ name: 'shippingFirstName' })
  ]);
  const doc = makeDoc([billing, shipping]);
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 2);
});

test('a <select> country field is identity-capable', () => {
  class FakeSelect {
    constructor(name) {
      this.tagName = 'SELECT';
      this.name = name;
      this.id = '';
      this.placeholder = '';
      this.form = null;
    }
    getAttribute() {
      return null;
    }
  }
  const fields = {
    street: new FakeInput({ name: 'address1' }),
    email: new FakeInput({ name: 'email', type: 'email' }),
    country: new FakeSelect('billingCountry')
  };
  const doc = docOf(fields);
  const entries = findAllIdentityFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].country, fields.country);
});
