'use strict';

// Unit test for the guest-preload payment-card field-selection + fill helpers
// (issue #152). Zero-dep: a hand-rolled fake `document` in the same discipline as
// vault-fill-fields.test.js, modeling EXACTLY the DOM surface the helper pins —
// `querySelectorAll('input, select')`, `.form`, `.getAttribute('autocomplete')`,
// `.value`, `.options`, `.maxLength`, and `.dispatchEvent`. Node 22 provides
// global `Event`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  autocompleteRoleOf,
  fallbackRoleOf,
  findCardFields,
  findAllCardFields,
  isLiveCardNumberField,
  parseExpiry,
  fillCardForm
} = require('../../src/preload/vault-card-fields');

class FakeInput {
  constructor({ type = 'text', name = '', autocomplete = null, id = '', placeholder = '', maxLength = -1 } = {}) {
    this.tagName = 'INPUT';
    this.type = type;
    this.name = name;
    this.id = id;
    this.placeholder = placeholder;
    this.maxLength = maxLength;
    this._autocomplete = autocomplete;
    this.value = '';
    this.form = null;
    this.events = [];
  }
  getAttribute(attr) {
    if (attr === 'autocomplete') return this._autocomplete;
    return null;
  }
  dispatchEvent(evt) {
    this.events.push({ type: evt.type, bubbles: !!evt.bubbles });
    return true;
  }
}

class FakeSelect {
  constructor({ name = '', autocomplete = null, options = [] } = {}) {
    this.tagName = 'SELECT';
    this.name = name;
    this.id = '';
    this.placeholder = '';
    this._autocomplete = autocomplete;
    this.options = options.map((o) => (typeof o === 'string' ? { value: o, textContent: o } : o));
    this.value = '';
    this.form = null;
    this.events = [];
  }
  getAttribute(attr) {
    if (attr === 'autocomplete') return this._autocomplete;
    return null;
  }
  dispatchEvent(evt) {
    this.events.push({ type: evt.type, bubbles: !!evt.bubbles });
    return true;
  }
}

class FakeForm {
  constructor(fields) {
    this.tagName = 'FORM';
    this.fields = fields;
    for (const f of fields) f.form = this;
  }
  querySelectorAll(selector) {
    return selector === 'input, select' ? this.fields.slice() : [];
  }
}

// A document over an ordered list of forms plus optional form-less fields.
function makeDoc(forms, loose = []) {
  const all = forms.flatMap((f) => f.fields).concat(loose);
  return {
    tagName: undefined,
    querySelectorAll(selector) {
      return selector === 'input, select' ? all.slice() : [];
    }
  };
}

function cardForm() {
  return {
    number: new FakeInput({ autocomplete: 'cc-number', name: 'cardnumber' }),
    name: new FakeInput({ autocomplete: 'cc-name', name: 'ccname' }),
    exp: new FakeInput({ autocomplete: 'cc-exp', name: 'ccexp' }),
    csc: new FakeInput({ autocomplete: 'cc-csc', name: 'cvc' })
  };
}

// --- role resolution -------------------------------------------------------

test('autocompleteRoleOf reads the cc-* token through section/billing prefixes', () => {
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'cc-number' })), 'number');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'billing cc-number' })), 'number');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'section-payment shipping cc-csc' })), 'csc');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'CC-EXP-MONTH' })), 'expMonth');
  assert.equal(autocompleteRoleOf(new FakeInput({ autocomplete: 'username' })), null);
  assert.equal(autocompleteRoleOf(new FakeInput({})), null);
});

test('a password field is never a card field even with a card-ish name', () => {
  const pw = new FakeInput({ type: 'password', name: 'card-number' });
  const doc = makeDoc([new FakeForm([pw])]);
  assert.deepEqual(findAllCardFields(doc), []);
});

// --- detection -------------------------------------------------------------

test('detects a full autocomplete-hinted card form', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number, f.name, f.exp, f.csc])]);

  const entries = findAllCardFields(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, f.number);
  assert.equal(entries[0].cardholder, f.name);
  assert.equal(entries[0].expiry, f.exp);
  assert.equal(entries[0].csc, f.csc);
});

test('detects split month/year selects', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const month = new FakeSelect({ autocomplete: 'cc-exp-month', options: ['01', '02', '12'] });
  const year = new FakeSelect({ autocomplete: 'cc-exp-year', options: ['2027', '2028'] });
  const doc = makeDoc([new FakeForm([number, month, year])]);

  const entry = findCardFields(doc);
  assert.equal(entry.expMonth, month);
  assert.equal(entry.expYear, year);
  assert.equal(entry.expiry, null);
});

test('no cc-number field → nothing detected (an address form is not a card form)', () => {
  const street = new FakeInput({ autocomplete: 'street-address', name: 'street' });
  const zip = new FakeInput({ autocomplete: 'postal-code', name: 'zip' });
  const doc = makeDoc([new FakeForm([street, zip])]);

  assert.deepEqual(findAllCardFields(doc), []);
  assert.equal(findCardFields(doc), null);
});

test('two card forms on one page yield two entries, each scoped to its own form', () => {
  const a = cardForm();
  const b = cardForm();
  const doc = makeDoc([new FakeForm([a.number, a.exp]), new FakeForm([b.number, b.csc])]);

  const entries = findAllCardFields(doc);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].number, a.number);
  assert.equal(entries[0].expiry, a.exp);
  assert.equal(entries[0].csc, null, "form A has no csc — B's must not leak across");
  assert.equal(entries[1].number, b.number);
  assert.equal(entries[1].csc, b.csc);
});

test('form-less card fields resolve against the document scope', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const csc = new FakeInput({ autocomplete: 'cc-csc' });
  const doc = makeDoc([], [number, csc]);

  const entry = findCardFields(doc);
  assert.equal(entry.number, number);
  assert.equal(entry.csc, csc);
  assert.equal(entry.form, null);
});

// --- the name/id fallback and its containment ------------------------------

test('fallback: an unhinted checkout is detected from name/id', () => {
  const number = new FakeInput({ name: 'card_number' });
  const exp = new FakeInput({ name: 'expiration_date' });
  const cvv = new FakeInput({ name: 'cvv' });
  const doc = makeDoc([new FakeForm([number, exp, cvv])]);

  const entry = findCardFields(doc);
  assert.equal(entry.number, number);
  assert.equal(entry.expiry, exp);
  assert.equal(entry.csc, cvv);
});

test('fallback does NOT fire on a form that carries any cc-* hint', () => {
  // The number is hinted; a stray "expiry"-named field is NOT adopted, because a
  // form that hints once is trusted to hint completely.
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const stray = new FakeInput({ name: 'membership_expiry' });
  const doc = makeDoc([new FakeForm([number, stray])]);

  const entry = findCardFields(doc);
  assert.equal(entry.number, number);
  assert.equal(entry.expiry, null, 'no fallback adoption on a hinted form');
});

test('fallback ignores number-ish fields that are not card numbers', () => {
  for (const name of ['phone_number', 'house_number', 'quantity', 'order_number', 'account']) {
    const doc = makeDoc([new FakeForm([new FakeInput({ name })])]);
    assert.deepEqual(findAllCardFields(doc), [], `"${name}" must not read as a card number`);
  }
});

// --- squawk 0087: camelCase role names ------------------------------------
// FALLBACK_PATTERNS anchor on \b, which never fires at a camelCase hump (a
// letter-to-letter transition, regardless of case) — only a role word landing
// at the very start or end of the name reached an existing string boundary.
// splitCamelHumps (internal, exercised here through fallbackRoleOf/
// findCardFields) inserts a space at each hump so the SAME regexes can match
// mid-name.

test('squawk 0087: camelCase role names are now detected by name alone', () => {
  const cases = [
    ['ccExpMonth', 'expMonth'],
    ['ccExpYear', 'expYear'],
    ['creditCardExpirationMonth', 'expMonth'],
    ['creditCardExpirationYear', 'expYear'],
    ['cardNumberDisplay', 'number'],
    ['ccNumberInput', 'number'],
    ['cardSecurityCode', 'csc'],
    ['cvvNumber', 'csc'],
    ['cardholderName', 'cardholder'],
    // The real-world Jostens spellings that motivated this squawk.
    ['card_cardExpMonth', 'expMonth'],
    ['card_cardExpYear', 'expYear']
  ];
  for (const [name, expected] of cases) {
    assert.equal(fallbackRoleOf(new FakeInput({ name })), expected, `"${name}" must resolve to "${expected}"`);
  }
});

test('squawk 0087: the real Jostens field set now detects a complete card entry', () => {
  // Zero autocomplete attributes anywhere — exactly the captured markup — so the
  // fallback is the only detection path, matching the live investigation. Number/
  // month/year are name-only (the underscore-joined `card_cardExpMonth` spelling
  // this squawk fixes); cardholder/csc carry the placeholder copy a real payment
  // page ships, which is what made them already-detected before this fix — this
  // test's new coverage is the previously-missed expMonth/expYear pair.
  const number = new FakeInput({ name: 'card_cardNumber' });
  const cardholder = new FakeInput({ name: 'card_nameOnCard', placeholder: 'Name on Card' });
  const csc = new FakeInput({ name: 'card_securityCode', placeholder: 'Security Code' });
  const expMonth = new FakeInput({ name: 'card_cardExpMonth' });
  const expYear = new FakeInput({ name: 'card_cardExpYear' });
  const doc = makeDoc([new FakeForm([number, cardholder, csc, expMonth, expYear])]);

  const entry = findCardFields(doc);
  assert.equal(entry.number, number);
  assert.equal(entry.cardholder, cardholder);
  assert.equal(entry.csc, csc);
  assert.equal(entry.expMonth, expMonth, 'previously missed — left the stored expiry with a null month');
  assert.equal(entry.expYear, expYear, 'previously missed — left the stored expiry with a null year');
});

test('squawk 0087: previously-working non-camelCase and boundary-adjacent names are unaffected', () => {
  const cases = [
    ['creditCardNumber', 'number'],
    ['cardNumber', 'number'],
    ['ccNumber', 'number'],
    ['cc_number', 'number'],
    ['card-number', 'number'],
    ['cardNo', 'number'],
    ['CCNumber', 'number'],
    ['payment.cardNumber', 'number'],
    ['cvv', 'csc'],
    ['securityCode', 'csc'],
    ['expirationMonth', 'expMonth'],
    ['nameOnCard', 'cardholder']
  ];
  for (const [name, expected] of cases) {
    assert.equal(fallbackRoleOf(new FakeInput({ name })), expected, `"${name}" must still resolve to "${expected}"`);
  }
});

test('squawk 0087: camelCase splitting introduces no new false positives', () => {
  // The point of normalizing the haystack instead of loosening the regexes: none
  // of these should start matching just because they now carry internal spaces.
  for (const name of ['pan', 'acctNum', 'tenderNumber', 'paymentNumber', 'creditCard', 'number']) {
    assert.equal(fallbackRoleOf(new FakeInput({ name })), null, `"${name}" must stay undetected`);
  }
});

// --- expiry parsing --------------------------------------------------------

test('parseExpiry accepts the shapes operators actually type', () => {
  assert.deepEqual(parseExpiry('12/28'), { month: '12', year: '2028' });
  assert.deepEqual(parseExpiry('12/2028'), { month: '12', year: '2028' });
  assert.deepEqual(parseExpiry('12-28'), { month: '12', year: '2028' });
  assert.deepEqual(parseExpiry('12 28'), { month: '12', year: '2028' });
  assert.deepEqual(parseExpiry('1228'), { month: '12', year: '2028' });
  assert.deepEqual(parseExpiry('01/27'), { month: '01', year: '2027' });
  // Separator-less exact-width forms still parse exactly as before (squawk 0086
  // touches only the reader's month width, not these already-unambiguous forms).
  assert.deepEqual(parseExpiry('0429'), { month: '04', year: '2029' });
  assert.deepEqual(parseExpiry('042029'), { month: '04', year: '2029' });
  assert.deepEqual(parseExpiry('04/2029'), { month: '04', year: '2029' });
});

test('squawk 0086: a single-digit month with a separator now parses, zero-padded', () => {
  assert.deepEqual(parseExpiry('2/27'), { month: '02', year: '2027' });
  assert.deepEqual(parseExpiry('4/29'), { month: '04', year: '2029' });
  assert.deepEqual(parseExpiry('2/2027'), { month: '02', year: '2027' });
  assert.deepEqual(parseExpiry('2-27'), { month: '02', year: '2027' });
  assert.deepEqual(parseExpiry('2 27'), { month: '02', year: '2027' });
});

test('parseExpiry rejects nonsense rather than filling a wrong date', () => {
  for (const bad of [
    '',
    null,
    undefined,
    'soon',
    '13/28',
    '00/28',
    '1/2',
    '123456789',
    '13/27', // out-of-range month, single-digit-month path
    '0/27' // month 0 is invalid even once zero-padded to '00'
  ]) {
    assert.equal(parseExpiry(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
});

test('squawk 0086: a separator-less 3-digit run is ambiguous and is rejected, not guessed', () => {
  // `227` could be read as `2/27` (1-digit month) or `22/7` (2-digit month, 1-digit
  // year — itself not a supported year width). With no separator to disambiguate,
  // this stays rejected exactly as it was before this fix; only the separated form
  // (`2/27`) gained support.
  assert.equal(parseExpiry('227'), null);
  assert.equal(parseExpiry('429'), null);
});

// --- filling ---------------------------------------------------------------

const CARD = {
  number: '4242 4242 4242 4242',
  cardholder: 'A Lovelace',
  expiry: '12/28',
  cvv: '123'
};

test('fills every detected field and dispatches input+change', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number, f.name, f.exp, f.csc])]);

  assert.deepEqual(fillCardForm(doc, CARD), {
    filled: true,
    fields: [
      { field: f.number, value: '4242424242424242' },
      { field: f.name, value: 'A Lovelace' },
      { field: f.csc, value: '123' },
      { field: f.exp, value: '12/28' }
    ]
  });
  assert.equal(f.number.value, '4242424242424242', 'formatting stripped to digits');
  assert.equal(f.name.value, 'A Lovelace');
  assert.equal(f.exp.value, '12/28');
  assert.equal(f.csc.value, '123');
  for (const field of [f.number, f.name, f.exp, f.csc]) {
    assert.deepEqual(field.events, [
      { type: 'input', bubbles: true },
      { type: 'change', bubbles: true }
    ]);
  }
});

test('a combined expiry field honors maxLength for the 4-digit year', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const exp = new FakeInput({ autocomplete: 'cc-exp', maxLength: 7 });
  const doc = makeDoc([new FakeForm([number, exp])]);

  fillCardForm(doc, CARD);
  assert.equal(exp.value, '12/2028');
});

test('squawk 0086: a stored single-digit-month expiry now fills back (the reported symptom)', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const exp = new FakeInput({ autocomplete: 'cc-exp', maxLength: 7 });
  const doc = makeDoc([new FakeForm([number, exp])]);

  const result = fillCardForm(doc, { ...CARD, expiry: '2/27' });
  assert.equal(result.filled, true);
  assert.equal(exp.value, '02/2027', 'the field previously stayed blank for a hand-typed 2/27');
});

test('split month/year selects match on option value, including the short year', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const month = new FakeSelect({ autocomplete: 'cc-exp-month', options: ['01', '12'] });
  const year = new FakeSelect({ autocomplete: 'cc-exp-year', options: ['27', '28'] });
  const doc = makeDoc([new FakeForm([number, month, year])]);

  fillCardForm(doc, CARD);
  assert.equal(month.value, '12');
  assert.equal(year.value, '28', 'falls back from YYYY to YY against the options');
});

test('an unpadded month select still matches', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const month = new FakeSelect({ autocomplete: 'cc-exp-month', options: ['1', '2', '12'] });
  const doc = makeDoc([new FakeForm([number, month])]);

  fillCardForm(doc, { ...CARD, expiry: '02/28' });
  assert.equal(month.value, '2');
});

test('a select with no matching option is left untouched, never forced', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const year = new FakeSelect({ autocomplete: 'cc-exp-year', options: ['2030', '2031'] });
  const doc = makeDoc([new FakeForm([number, year])]);

  fillCardForm(doc, CARD);
  assert.equal(year.value, '', 'no invalid value forced onto the select');
  assert.deepEqual(year.events, []);
});

test('an unparseable stored expiry leaves the expiry fields alone but still fills the number', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number, f.exp, f.csc])]);

  assert.deepEqual(fillCardForm(doc, { ...CARD, expiry: 'whenever' }), {
    filled: true,
    fields: [
      { field: f.number, value: '4242424242424242' },
      { field: f.csc, value: '123' }
    ]
  });
  assert.equal(f.number.value, '4242424242424242');
  assert.equal(f.exp.value, '', 'a bad expiry must not write garbage into the form');
});

test('no card form → fills nothing', () => {
  const search = new FakeInput({ name: 'q' });
  const doc = makeDoc([new FakeForm([search])]);

  assert.deepEqual(fillCardForm(doc, CARD), { filled: false, fields: [] });
  assert.equal(search.value, '');
});

test('a null card is a no-op', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number])]);
  assert.deepEqual(fillCardForm(doc, null), { filled: false, fields: [] });
  assert.equal(f.number.value, '');
});

// --- gesture-bound targeting (the finding-9 discipline, card twin) ---------

test('the gesture target selects ITS form on a multi-card page', () => {
  const a = cardForm();
  const b = cardForm();
  const doc = makeDoc([new FakeForm([a.number, a.csc]), new FakeForm([b.number, b.csc])]);

  fillCardForm(doc, CARD, b.number);
  assert.equal(b.number.value, '4242424242424242');
  assert.equal(a.number.value, '', 'the first form must not be filled when form B was clicked');
});

test('a stale/foreign gesture target falls back to the first detected entry', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const detached = new FakeInput({ autocomplete: 'cc-number' });

  fillCardForm(doc, CARD, detached);
  assert.equal(f.number.value, '4242424242424242');
  assert.equal(detached.value, '', 'a detached node is never filled');
});

test('isLiveCardNumberField only accepts a live detected number field', () => {
  const f = cardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);

  assert.equal(isLiveCardNumberField(doc, f.number), true);
  assert.equal(isLiveCardNumberField(doc, f.csc), false, 'the csc is not a fill anchor');
  assert.equal(isLiveCardNumberField(doc, new FakeInput({ autocomplete: 'cc-number' })), false);
  assert.equal(isLiveCardNumberField(doc, null), false);
});
