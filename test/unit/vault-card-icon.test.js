'use strict';

// Unit test for the fill-icon controller's CARD anchoring (issue #152) — the card
// half of vault-fill-icon.test.js, which keeps its own harness because the card
// detector queries `'input, select'` where the login detector queries
// `'input[type=password]'`. Same zero-dep hand-rolled fake DOM discipline.
//
// Covers:
//   - an icon is placed on card fields (number / cardholder / expiry / csc) and
//     NOT on the split month/year selects;
//   - the accessible name says "card", not "login";
//   - a trusted click still sends the BARE guest-vault-gesture IPC (the F2
//     invariant is unchanged by the card path);
//   - the gesture fill-target is KIND-TAGGED, so a login fill can never consume a
//     card binding and vice versa;
//   - an omitted findAllCardFields injection yields no card anchors at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ICON_ATTR, createVaultIconController } = require('../../src/preload/vault-fill-icon');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');
const { findAllCardFields } = require('../../src/preload/vault-card-fields');

class FakeStyle {}

class FakeElement {
  constructor(tagName, namespaceURI) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI || null;
    this.attributes = {};
    this.style = new FakeStyle();
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.isConnected = false;
    this._parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  appendChild(child) {
    this.children.push(child);
    child._parent = this;
    child.isConnected = true;
    return child;
  }
  remove() {
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
    }
    this._parent = null;
    this.isConnected = false;
  }
  dispatch(type, evt) {
    for (const fn of this.listeners[type] || []) fn(evt);
  }
}

class FakeInput extends FakeElement {
  constructor({ type = 'text', name = '', autocomplete = null } = {}) {
    super('input');
    this.type = type;
    this.name = name;
    this.value = '';
    this.form = null;
    this.maxLength = -1;
    this.offsetParent = {};
    this._rect = { top: 100, left: 200, width: 180, height: 24 };
    if (autocomplete != null) this.setAttribute('autocomplete', autocomplete);
  }
  getBoundingClientRect() {
    return this._rect;
  }
}

class FakeSelect extends FakeElement {
  constructor({ name = '', autocomplete = null, options = [] } = {}) {
    super('select');
    this.name = name;
    this.value = '';
    this.form = null;
    this.options = options.map((o) => ({ value: o, textContent: o }));
    this.offsetParent = {};
    this._rect = { top: 140, left: 200, width: 80, height: 24 };
    if (autocomplete != null) this.setAttribute('autocomplete', autocomplete);
  }
  getBoundingClientRect() {
    return this._rect;
  }
}

class FakeForm extends FakeElement {
  constructor(fields) {
    super('form');
    this.fields = fields;
    for (const f of fields) f.form = this;
  }
  querySelectorAll(selector) {
    if (selector === 'input, select') return this.fields.slice();
    if (selector === 'input') return this.fields.filter((f) => f.tagName === 'input');
    return [];
  }
}

function makeDoc(forms) {
  const all = forms.flatMap((f) => f.fields);
  const body = new FakeElement('body');
  body.isConnected = true;
  return {
    body,
    documentElement: body,
    createElement(tag) {
      return new FakeElement(tag);
    },
    createElementNS(ns, tag) {
      return new FakeElement(tag, ns);
    },
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return all.filter((i) => i.type === 'password');
      if (selector === 'input, select') return all.slice();
      if (selector === 'input') return all.filter((f) => f.tagName === 'input');
      return [];
    }
  };
}

function makeController(doc, sends, { withCards = true } = {}) {
  return createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send: (channel, payload) => sends.push({ channel, payload }) },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    ...(withCards ? { findAllCardFields } : {}),
    getEnabled: () => true,
    getVaultLocked: () => false
  });
}

function bodyIcon(doc) {
  return doc.body.children.find((c) => c.getAttribute(ICON_ATTR) !== null) || null;
}

function makeCardForm() {
  return {
    number: new FakeInput({ autocomplete: 'cc-number', name: 'cardnumber' }),
    holder: new FakeInput({ autocomplete: 'cc-name', name: 'ccname' }),
    exp: new FakeInput({ autocomplete: 'cc-exp', name: 'ccexp' }),
    csc: new FakeInput({ autocomplete: 'cc-csc', name: 'cvc' })
  };
}

// --- placement -------------------------------------------------------------

test('focusing a card field shows the icon, labelled for a CARD', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.holder, f.exp, f.csc])]);
  const ctl = makeController(doc, []);

  ctl.placeVaultIcons();
  assert.equal(bodyIcon(doc), null, 'nothing focused → no icon');

  ctl.handleFocusIn({ target: f.number });
  const icon = bodyIcon(doc);
  assert.ok(icon, 'focusing the card-number field shows an icon');
  assert.equal(icon.getAttribute('aria-label'), 'Fill card from vault');
});

test('every card field of the entry is anchorable', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.holder, f.exp, f.csc])]);
  const ctl = makeController(doc, []);

  for (const field of [f.number, f.holder, f.exp, f.csc]) {
    ctl.handleFocusIn({ target: field });
    assert.ok(bodyIcon(doc), `${field.name} should anchor an icon`);
  }
});

test('split month/year selects are NOT anchored (they fight the native dropdown)', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const month = new FakeSelect({ autocomplete: 'cc-exp-month', options: ['01', '12'] });
  const year = new FakeSelect({ autocomplete: 'cc-exp-year', options: ['2027', '2028'] });
  const doc = makeDoc([new FakeForm([number, month, year])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: month });
  assert.equal(bodyIcon(doc), null, 'the month select gets no icon');
  ctl.handleFocusIn({ target: year });
  assert.equal(bodyIcon(doc), null, 'the year select gets no icon');
  ctl.handleFocusIn({ target: number });
  assert.ok(bodyIcon(doc), 'the number field still anchors');
});

test('a non-card, non-login field anchors nothing', () => {
  const number = new FakeInput({ autocomplete: 'cc-number' });
  const street = new FakeInput({ autocomplete: 'street-address', name: 'street' });
  const doc = makeDoc([new FakeForm([number, street])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: street });
  assert.equal(bodyIcon(doc), null);
});

test('without the findAllCardFields injection there are no card anchors at all', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const ctl = makeController(doc, [], { withCards: false });

  ctl.handleFocusIn({ target: f.number });
  assert.equal(bodyIcon(doc), null, 'pre-card callers keep their exact prior behavior');
});

// --- the F2 invariants, unchanged on the card path -------------------------

test('a trusted click on a card icon still sends the BARE guest-vault-gesture IPC', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: f.number });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: true, currentTarget: icon });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-gesture');
  assert.deepEqual(sends[0].payload, {}, 'bare payload — no field kind, no secret');
});

test('a scripted click on a card icon is ignored', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: f.number });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: false, currentTarget: icon });

  assert.deepEqual(sends, [], 'synthetic dispatch never raises the prompt');
});

// --- kind-tagged fill target ----------------------------------------------

test('a card gesture binds a CARD target: a login fill cannot consume it', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: f.number });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: true, currentTarget: icon });

  assert.equal(ctl.consumeFillTarget('login'), null, 'a login fill must not redirect into a card form');
});

test('a card gesture binds the clicked card-number field for a card fill', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const ctl = makeController(doc, []);

  // Focus the CSC — the bound target is still the entry's number field (the anchor).
  ctl.handleFocusIn({ target: f.csc });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: true, currentTarget: icon });

  assert.equal(ctl.consumeFillTarget('card'), f.number);
});

test('a login gesture binds a LOGIN target: a card fill cannot consume it', () => {
  const user = new FakeInput({ type: 'text', name: 'username' });
  const pass = new FakeInput({ type: 'password', name: 'password' });
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: user });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: true, currentTarget: icon });

  assert.equal(ctl.consumeFillTarget('card'), null);
});

test('the fill target is single-use even across a kind mismatch', () => {
  const f = makeCardForm();
  const doc = makeDoc([new FakeForm([f.number, f.csc])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: f.number });
  const icon = bodyIcon(doc);
  icon.dispatch('click', { isTrusted: true, currentTarget: icon });

  assert.equal(ctl.consumeFillTarget('login'), null, 'mismatched consume returns nothing');
  assert.equal(ctl.consumeFillTarget('card'), null, '...and still burns the single-use binding');
});

test('a login field wins when a page somehow claims a field for both families', () => {
  // A password-typed field named like a card number: the login detector claims it,
  // the card detector structurally cannot (CARD_INPUT_TYPES excludes `password`).
  const pass = new FakeInput({ type: 'password', name: 'card_number' });
  const doc = makeDoc([new FakeForm([pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: pass });
  const icon = bodyIcon(doc);
  assert.ok(icon);
  assert.equal(icon.getAttribute('aria-label'), 'Fill login from vault');
});
