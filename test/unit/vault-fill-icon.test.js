'use strict';

// Unit test for the guest-preload decorative fill-icon core (Mission 12,
// Flight 2 / Flight 5 HAT). Zero-dep: a hand-rolled fake DOM (the
// vault-fill-fields.test.js precedent) models exactly the surface the icon
// controller touches — createElementNS/createElement, setAttribute, style,
// addEventListener, appendChild/remove, getBoundingClientRect, offsetParent,
// isConnected. No jsdom, no browser. Node 22 provides global Event/timers.
//
// Covers the F5 HAT redesign + the preserved F2 invariants:
//   - the glyph is an INLINE SVG (not the busted emoji), role=img + aria-label
//     + the data-goldfinch-vault-lock marker;
//   - an icon is placed on BOTH the username and password field;
//   - the icon appears ONLY while its field is focused, and hides on blur
//     (deferred so a click is never eaten; mousedown preventDefault keeps focus);
//   - click / contextmenu stay isTrusted-guarded and send the BARE IPCs;
//   - the icon is decorative — it carries no credential value/text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SVG_NS,
  ICON_ATTR,
  buildVaultLockIcon,
  createVaultIconController,
} = require('../../src/preload/vault-fill-icon');
const { findAllLoginFields } = require('../../src/preload/vault-fill-fields');

// --- Fake DOM -------------------------------------------------------------

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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
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
  // Fire every registered listener for a synthetic event object.
  dispatch(type, evt) {
    for (const fn of this.listeners[type] || []) fn(evt);
  }
}

// A login <input> with a live rect so isFieldVisible() accepts it.
class FakeInput extends FakeElement {
  constructor(type, name) {
    super('input');
    this.type = type === undefined ? 'text' : type;
    this.name = name || '';
    this.value = '';
    this.form = null;
    this.offsetParent = {}; // non-null → visible
    this._rect = { top: 100, left: 200, width: 180, height: 24 };
  }
  getBoundingClientRect() { return this._rect; }
}

class FakeForm extends FakeElement {
  constructor(inputs) {
    super('form');
    this.inputs = inputs;
    for (const input of inputs) input.form = this;
  }
  querySelectorAll(selector) { return selector === 'input' ? this.inputs.slice() : []; }
}

function makeDoc(forms) {
  const all = forms.flatMap((f) => f.inputs);
  const body = new FakeElement('body');
  body.isConnected = true;
  return {
    body,
    documentElement: body,
    createElement(tag) { return new FakeElement(tag); },
    createElementNS(ns, tag) { return new FakeElement(tag, ns); },
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return all.filter((i) => i.type === 'password');
      if (selector === 'input') return all.slice();
      return [];
    },
  };
}

function makeController(doc, sends) {
  return createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send: (channel, payload) => sends.push({ channel, payload }) },
    // Model the captured getter: honour the event's own isTrusted flag.
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => true,
  });
}

// The single icon currently attached to the fake body (or null).
function bodyIcon(doc) {
  return doc.body.children.find((c) => c.getAttribute(ICON_ATTR) !== null) || null;
}

// --- buildVaultLockIcon: SVG glyph, not emoji -----------------------------

test('buildVaultLockIcon: an inline SVG element (not an emoji), correctly labelled', () => {
  const doc = makeDoc([]);
  const icon = buildVaultLockIcon(doc); // default: locked

  assert.equal(icon.tagName, 'svg');
  assert.equal(icon.namespaceURI, SVG_NS, 'built in the SVG namespace via createElementNS');
  assert.equal(icon.getAttribute(ICON_ATTR), '', 'carries the data-goldfinch-vault-lock marker');
  assert.equal(icon.getAttribute('role'), 'img');
  assert.equal(icon.getAttribute('aria-label'), 'Unlock vault to fill login', 'the locked default label');
  assert.equal(icon.getAttribute('data-locked'), 'true');
  assert.equal(icon.getAttribute('width'), '16');
  // No emoji / tofu glyph anywhere.
  assert.equal(icon.textContent, '', 'no text glyph — the lock is drawn, never typed');
  assert.ok(!/🔒|□/.test(icon.textContent));
  // Drawn from real SVG child shapes, all in the SVG namespace.
  assert.ok(icon.children.length >= 2, 'has shape children (shackle + body)');
  for (const child of icon.children) assert.equal(child.namespaceURI, SVG_NS);
});

test('buildVaultLockIcon: locked vs unlocked glyph + label + marker', () => {
  const doc = makeDoc([]);
  const shackleD = (icon) => icon.children.find((c) => c.tagName === 'path').getAttribute('d');

  const locked = buildVaultLockIcon(doc, true);
  assert.equal(locked.getAttribute('data-locked'), 'true');
  assert.equal(locked.getAttribute('aria-label'), 'Unlock vault to fill login');
  assert.ok(/V11$/.test(shackleD(locked)), 'closed shackle: both legs reach the body (…V11)');

  const unlocked = buildVaultLockIcon(doc, false);
  assert.equal(unlocked.getAttribute('data-locked'), 'false');
  assert.equal(unlocked.getAttribute('aria-label'), 'Fill login from vault');
  assert.ok(!/V11$/.test(shackleD(unlocked)), 'open shackle: the right leg lifts free (no trailing …V11)');
});

// --- placement: both fields, focus-gated ----------------------------------

test('no icon until a login field is focused; focusing a field shows exactly one icon', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.scheduleIconPlacement(0);
  ctl.placeVaultIcons();
  assert.equal(bodyIcon(doc), null, 'nothing focused → no icon');

  ctl.handleFocusIn({ target: user });
  const icon = bodyIcon(doc);
  assert.ok(icon, 'focusing the username field shows an icon');
  assert.equal(icon.tagName, 'svg');
  assert.equal(doc.body.children.filter((c) => c.getAttribute(ICON_ATTR) !== null).length, 1);
});

test('the icon is placed on BOTH the username and the password field (moves with focus)', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  // Username focus → its icon, positioned at the username field's right edge.
  ctl.handleFocusIn({ target: user });
  let icon = bodyIcon(doc);
  assert.ok(icon, 'username field gets an icon');
  const userLeft = icon.style.left;

  // Move focus to the password field → the icon follows (single icon, new anchor).
  pass._rect = { top: 140, left: 200, width: 180, height: 24 };
  ctl.handleFocusIn({ target: pass });
  icon = bodyIcon(doc);
  assert.ok(icon, 'password field gets an icon too');
  assert.equal(doc.body.children.filter((c) => c.getAttribute(ICON_ATTR) !== null).length, 1,
    'only the focused field shows an icon at a time (no stacking)');
  assert.notEqual(icon.style.top, undefined);
  assert.ok(userLeft, 'username icon had been positioned');
});

test('blur hides the icon (deferred), and a non-login focus target shows none', async () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: user });
  assert.ok(bodyIcon(doc), 'icon shown on focus');

  ctl.handleFocusOut({ target: user });
  // Deferred: still present synchronously (so an in-flight click isn't eaten)...
  assert.ok(bodyIcon(doc), 'icon still present synchronously right after blur');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bodyIcon(doc), null, 'icon hidden after the deferred blur settles');

  // Focus a non-login element → still no icon.
  const other = new FakeInput('text', 'search');
  ctl.handleFocusIn({ target: other });
  assert.equal(bodyIcon(doc), null, 'focusing a non-login field shows no icon');
});

test('click on the icon keeps field focus (mousedown preventDefault) so the click is never eaten', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: pass });
  const icon = bodyIcon(doc);

  let prevented = false;
  icon.dispatch('mousedown', { preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'icon mousedown calls preventDefault → field keeps focus through the click');
});

// --- F2 invariants: isTrusted guard + bare IPCs ---------------------------

test('click: a trusted gesture sends the BARE guest-vault-gesture IPC; a scripted click is ignored', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: pass });
  const icon = bodyIcon(doc);

  // Scripted iconEl.click() → isTrusted:false → ignored.
  icon.dispatch('click', { isTrusted: false });
  assert.deepEqual(sends, [], 'a synthetic/scripted click raises nothing');

  // Genuine user gesture → bare IPC, empty payload, NO secret.
  icon.dispatch('click', { isTrusted: true });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-gesture');
  assert.deepEqual(sends[0].payload, {}, 'bare payload — main derives the wcId from the sender');
});

test('a trusted gesture binds the clicked form\'s password as the single-use, TTL-bound fill target (PR#112 finding 9)', () => {
  const userA = new FakeInput('text', 'user-a');
  const passA = new FakeInput('password', 'pass-a');
  const userB = new FakeInput('email', 'user-b');
  const passB = new FakeInput('password', 'pass-b');
  const doc = makeDoc([new FakeForm([userA, passA]), new FakeForm([userB, passB])]);
  const sends = [];
  let clock = 1000;
  const ctl = createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send: (channel, payload) => sends.push({ channel, payload }) },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => true,
    now: () => clock,
  });

  // Nothing gestured yet → no bound target.
  assert.equal(ctl.consumeFillTarget(), null, 'no gesture → no target');

  // Focus form B's username, click its icon → bind form B's PASSWORD field.
  ctl.handleFocusIn({ target: userB });
  bodyIcon(doc).dispatch('click', { isTrusted: true });
  assert.equal(sends.at(-1).channel, 'guest-vault-gesture');

  // The consumed target is form B's password (not the document-first passA).
  assert.equal(ctl.consumeFillTarget(), passB, 'the clicked form B password is bound');
  // Single-use: a second consume is null.
  assert.equal(ctl.consumeFillTarget(), null, 'the binding is single-use');

  // A scripted click binds nothing (isTrusted:false ignored).
  ctl.handleFocusIn({ target: passA });
  bodyIcon(doc).dispatch('click', { isTrusted: false });
  assert.equal(ctl.consumeFillTarget(), null, 'a scripted click never binds a target');

  // TTL: a gesture whose binding has aged past the window is dropped → first-field fallback.
  ctl.handleFocusIn({ target: passA });
  bodyIcon(doc).dispatch('click', { isTrusted: true });
  clock += 61 * 1000; // past the 60s TTL
  assert.equal(ctl.consumeFillTarget(), null, 'an expired binding is not returned');
});

test('contextmenu: a trusted right-click sends the BARE guest-vault-icon-menu IPC and suppresses defaults; scripted is ignored', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: user });
  const icon = bodyIcon(doc);

  // Scripted contextmenu → ignored (no menu, no default suppression needed).
  let prevented = false;
  icon.dispatch('contextmenu', { isTrusted: false, preventDefault: () => { prevented = true; }, stopPropagation() {} });
  assert.deepEqual(sends, [], 'a synthetic contextmenu raises no native menu');
  assert.equal(prevented, false);

  // Genuine right-click → bare IPC (no payload) + default/page-menu suppression.
  let prevented2 = false;
  let stopped = false;
  icon.dispatch('contextmenu', {
    isTrusted: true,
    preventDefault: () => { prevented2 = true; },
    stopPropagation: () => { stopped = true; },
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-icon-menu');
  assert.equal(sends[0].payload, undefined, 'no payload — bare signal');
  assert.ok(prevented2 && stopped, 'suppresses the OS/page menu and stops propagation');
});

// --- decorative: no secret rides on the icon ------------------------------

test('the icon is decorative: it holds no credential value or text a hostile page could read', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: pass });
  const icon = bodyIcon(doc);

  assert.equal(icon.textContent, '', 'no text content');
  assert.equal(icon.value, undefined, 'not a form control — no .value');
  // The only attributes are presentational/marker — none carries a secret.
  const attrKeys = Object.keys(icon.attributes).sort();
  assert.deepEqual(attrKeys, ['aria-label', 'data-locked', 'focusable', 'height', 'role', 'viewBox', 'width', ICON_ATTR].sort());
});

test('setVaultLocked flips the shown icon glyph + color live (no reload)', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  // Start LOCKED (the safe default when getVaultLocked is absent).
  const ctl = makeController(doc, []);
  ctl.handleFocusIn({ target: pass });

  let icon = bodyIcon(doc);
  assert.equal(icon.getAttribute('data-locked'), 'true', 'starts locked (amber/closed)');
  assert.equal(icon.style.color, '#b06000', 'locked → amber');

  // Main pushes an unlock → the shown icon is re-rendered open/green.
  ctl.setVaultLocked(false);
  icon = bodyIcon(doc);
  assert.ok(icon, 'an icon is still shown for the focused field');
  assert.equal(icon.getAttribute('data-locked'), 'false', 'now unlocked (open)');
  assert.equal(icon.style.color, '#137333', 'unlocked → green');

  // A repeat of the same state is a no-op (no re-render churn).
  const before = icon;
  ctl.setVaultLocked(false);
  assert.equal(bodyIcon(doc), before, 'same-state setVaultLocked does not rebuild the icon');
});

// --- media-observer feedback guard ----------------------------------------

test('isIconOnlyMutation: an icon append/style mutation is recognised (media rescan must skip it)', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: pass });
  const icon = bodyIcon(doc);

  // An attribute mutation targeting the icon is icon-only.
  assert.equal(ctl.isIconOnlyMutation({ type: 'attributes', target: icon }), true);
  // A childList mutation adding the icon is icon-only.
  assert.equal(ctl.isIconOnlyMutation({ type: 'childList', addedNodes: [icon], removedNodes: [] }), true);
  // A page mutation (non-icon node) is NOT icon-only.
  assert.equal(ctl.isIconOnlyMutation({ type: 'attributes', target: pass }), false);
  assert.equal(ctl.isIconOnlyMutation({ type: 'childList', addedNodes: [pass], removedNodes: [] }), false);
});

// --- eligibility / honeypot gating ----------------------------------------

test('disabled controller (not eligible / not top-frame) never injects an icon', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send() {} },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => false,
  });

  ctl.handleFocusIn({ target: pass });
  ctl.placeVaultIcons();
  assert.equal(bodyIcon(doc), null, 'no icon when the controller is disabled');
});

test('honeypot / zero-rect focused field gets NO icon', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  pass._rect = { top: 0, left: 0, width: 0, height: 0 }; // zero-size honeypot
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeController(doc, []);

  ctl.handleFocusIn({ target: pass });
  assert.equal(bodyIcon(doc), null, 'a zero-rect field is never anchored');
});
