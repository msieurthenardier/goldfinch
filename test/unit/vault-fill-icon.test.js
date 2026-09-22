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
  createVaultIconController
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
  getBoundingClientRect() {
    return this._rect;
  }
}

class FakeForm extends FakeElement {
  constructor(inputs) {
    super('form');
    this.inputs = inputs;
    for (const input of inputs) input.form = this;
  }
  querySelectorAll(selector) {
    return selector === 'input' ? this.inputs.slice() : [];
  }
}

function makeDoc(forms) {
  const all = forms.flatMap((f) => f.inputs);
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
      if (selector === 'input') return all.slice();
      return [];
    }
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
    getEnabled: () => true
  });
}

// The single icon currently attached to the fake body (or null).
function bodyIcon(doc) {
  return doc.body.children.find((c) => c.getAttribute(ICON_ATTR) !== null) || null;
}

// --- buildVaultLockIcon: SVG glyph, not emoji -----------------------------

// The expected structural child list for buildVaultLockIcon's output, per
// Mission 21 Flight 4 Leg 5 HAT (the toggle-switch redesign, superseding Leg
// 4's round disc+corner-overlay shape): a native-tooltip `<title>` first
// (same HAT, operator ruling), then track, lock shackle, lock body, knob
// (the Goldfinch disc), then the bird's cap/mask/beak/eye.
const EXPECTED_CHILD_TAGS = ['title', 'rect', 'path', 'rect', 'circle', 'path', 'path', 'path', 'circle'];

// The overlay shackle is the `path` whose `stroke` is `currentColor` — NOT
// "the first path" (that's now the bird's cap, AC3).
const shackleOf = (icon) =>
  icon.children.find((c) => c.tagName === 'path' && c.getAttribute('stroke') === 'currentColor');

test('buildVaultLockIcon: an inline SVG element (not an emoji), correctly labelled', () => {
  const doc = makeDoc([]);
  const icon = buildVaultLockIcon(doc); // default: locked

  assert.equal(icon.tagName, 'svg');
  assert.equal(icon.namespaceURI, SVG_NS, 'built in the SVG namespace via createElementNS');
  assert.equal(icon.getAttribute(ICON_ATTR), '', 'carries the data-goldfinch-vault-lock marker');
  assert.equal(icon.getAttribute('role'), 'img');
  assert.equal(icon.getAttribute('aria-label'), 'Unlock vault to fill login', 'the locked default label');
  assert.equal(icon.getAttribute('data-locked'), 'true');
  assert.equal(icon.getAttribute('width'), '30');
  // No emoji / tofu glyph anywhere.
  assert.equal(icon.textContent, '', 'no text glyph — the lock is drawn, never typed');
  assert.ok(!/🔒|□/.test(icon.textContent));
  // Drawn from real SVG child shapes, all in the SVG namespace.
  assert.ok(icon.children.length >= 2, 'has shape children (the mark + the lock overlay)');
  for (const child of icon.children) assert.equal(child.namespaceURI, SVG_NS);
});

test('buildVaultLockIcon: overlay shackle carries lock state (AC3, renamed from the old first-path shackle test)', () => {
  const doc = makeDoc([]);

  const locked = buildVaultLockIcon(doc, true);
  assert.equal(locked.getAttribute('data-locked'), 'true');
  assert.equal(locked.getAttribute('aria-label'), 'Unlock vault to fill login');
  assert.ok(/V7\.2$/.test(shackleOf(locked).getAttribute('d')), 'closed shackle: both legs reach the body (…V7.2)');

  const unlocked = buildVaultLockIcon(doc, false);
  assert.equal(unlocked.getAttribute('data-locked'), 'false');
  assert.equal(unlocked.getAttribute('aria-label'), 'Fill login from vault');
  assert.ok(
    !/V7\.2$/.test(shackleOf(unlocked).getAttribute('d')),
    'open shackle: the right leg lifts free (no trailing …V7.2)'
  );
});

test('buildVaultLockIcon: AC4 — every shape except the lock shackle is IDENTICAL between locked and unlocked builds', () => {
  const doc = makeDoc([]);
  const locked = buildVaultLockIcon(doc, true);
  const unlocked = buildVaultLockIcon(doc, false);

  // The shackle is the ONLY child whose shape may differ between the two
  // builds (track, lock body, knob, and the whole bird never change) —
  // filtered out by the same predicate shackleOf uses, not by a hardcoded
  // index, so the comparison doesn't silently go stale if child order shifts.
  const nonShackleOf = (icon) =>
    icon.children
      .filter((c) => !(c.tagName === 'path' && c.getAttribute('stroke') === 'currentColor'))
      .map((c) => ({ tagName: c.tagName, attrs: { ...c.attributes }, textContent: c.textContent }));

  assert.deepEqual(
    nonShackleOf(locked),
    nonShackleOf(unlocked),
    'everything but the shackle never changes with lock state'
  );
  // Sanity: the shackle DOES differ (proves the comparison above isn't vacuous).
  assert.notEqual(shackleOf(locked).getAttribute('d'), shackleOf(unlocked).getAttribute('d'));
});

test('buildVaultLockIcon: AC7 — all three kinds, both lock states, build the same structural child list', () => {
  const doc = makeDoc([]);
  for (const kind of ['login', 'card', 'identity']) {
    for (const locked of [true, false]) {
      const icon = buildVaultLockIcon(doc, locked, kind);
      assert.deepEqual(
        icon.children.map((c) => c.tagName),
        EXPECTED_CHILD_TAGS,
        `kind=${kind} locked=${locked}`
      );
    }
  }
});

test('buildVaultLockIcon: AC1 — every shape child carries only geometry/paint attributes (no innerHTML/text/href), plus exactly one bare <title> tooltip', () => {
  const ALLOWED_SHAPE_ATTRS = new Set([
    'cx',
    'cy',
    'r',
    'd',
    'x',
    'y',
    'width',
    'height',
    'rx',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin'
  ]);
  const doc = makeDoc([]);
  for (const kind of ['login', 'card', 'identity']) {
    for (const locked of [true, false]) {
      const icon = buildVaultLockIcon(doc, locked, kind);
      // Exactly one <title> child (the native hover tooltip, Flight 4 Leg 5
      // HAT), carrying no attributes and only the literal tooltip text.
      const titles = icon.children.filter((c) => c.tagName === 'title');
      assert.equal(titles.length, 1, 'exactly one title element');
      assert.equal(titles[0].textContent, 'Open Vault', 'fixed tooltip text');
      assert.deepEqual(Object.keys(titles[0].attributes), [], 'title carries no attributes');

      for (const child of icon.children) {
        if (child.tagName === 'title') continue; // covered above
        assert.ok(['circle', 'path', 'rect'].includes(child.tagName), `unexpected child tag ${child.tagName}`);
        assert.equal(child.textContent, '', 'no text content on any child');
        for (const attr of Object.keys(child.attributes)) {
          assert.ok(ALLOWED_SHAPE_ATTRS.has(attr), `disallowed attribute "${attr}" on ${child.tagName}`);
        }
        // No href/xlink:href (no <use>/<image>-style external reference) and no style attribute.
        assert.equal(child.getAttribute('href'), null);
        assert.equal(child.getAttribute('xlink:href'), null);
        assert.equal(child.getAttribute('style'), null);
      }
    }
  }
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
  assert.equal(
    doc.body.children.filter((c) => c.getAttribute(ICON_ATTR) !== null).length,
    1,
    'only the focused field shows an icon at a time (no stacking)'
  );
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
  icon.dispatch('mousedown', {
    preventDefault: () => {
      prevented = true;
    }
  });
  assert.ok(prevented, 'icon mousedown calls preventDefault → field keeps focus through the click');
});

// --- F2 invariants: isTrusted guard + bare IPCs ---------------------------

test('click: a trusted gesture sends the guest-vault-gesture IPC (no secret, wcId derived by main); a scripted click is ignored', () => {
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

  // Genuine user gesture on a resolved login target → the AC7 { generate }
  // payload (Mission 21, Flight 4, Leg 3 — generate-in-picker); this single
  // sign-in-shaped field (no autocomplete/tokens) classifies 'sign-in', so
  // `generate.passwordRole` is null — still no secret, no password, no DOM
  // value anywhere on the wire.
  icon.dispatch('click', { isTrusted: true });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-gesture');
  assert.deepEqual(
    sends[0].payload,
    { generate: { passwordRole: null, constraints: null } },
    'a resolved login target always carries a generate payload — main degrades a non-"new" role to bare {wcId} (AC8)'
  );
});

test("a trusted gesture binds the clicked form's password as the single-use, TTL-bound fill target (PR#112 finding 9)", () => {
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
    now: () => clock
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
  icon.dispatch('contextmenu', {
    isTrusted: false,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation() {}
  });
  assert.deepEqual(sends, [], 'a synthetic contextmenu raises no native menu');
  assert.equal(prevented, false);

  // Genuine right-click → bare IPC (no payload) + default/page-menu suppression.
  let prevented2 = false;
  let stopped = false;
  icon.dispatch('contextmenu', {
    isTrusted: true,
    preventDefault: () => {
      prevented2 = true;
    },
    stopPropagation: () => {
      stopped = true;
    }
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
  assert.deepEqual(
    attrKeys,
    ['aria-label', 'data-locked', 'focusable', 'height', 'role', 'viewBox', 'width', ICON_ATTR].sort()
  );
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
  assert.equal(icon.style.color, '#e8a33d', 'locked → amber');

  // Main pushes an unlock → the shown icon is re-rendered open/green.
  ctl.setVaultLocked(false);
  icon = bodyIcon(doc);
  assert.ok(icon, 'an icon is still shown for the focused field');
  assert.equal(icon.getAttribute('data-locked'), 'false', 'now unlocked (open)');
  assert.equal(icon.style.color, '#34c46a', 'unlocked → green');

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
    getEnabled: () => false
  });

  ctl.handleFocusIn({ target: pass });
  ctl.placeVaultIcons();
  assert.equal(bodyIcon(doc), null, 'no icon when the controller is disabled');
});

// --- in-tree placement (squawk 0072) ---------------------------------------

test("the icon is inserted inside the focused field's parent element, not <body>, and positioned relative to the nearest positioned ancestor", () => {
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([pass])]);

  // Field parent chain: pass -> innerDiv (static) -> positionedDiv (relative) -> body.
  // A site's dismiss-on-outside-pointerdown drawer treats a body-appended icon as
  // an outside click (squawk 0072) — the icon must land INSIDE the field's own
  // subtree instead, positioned relative to the nearest non-static ancestor.
  const positionedDiv = new FakeElement('div');
  positionedDiv._rect = { top: 50, left: 20, width: 1000, height: 800 };
  positionedDiv.getBoundingClientRect = () => positionedDiv._rect;
  positionedDiv.clientTop = 2;
  positionedDiv.clientLeft = 3;
  positionedDiv.parentElement = doc.body;

  const innerDiv = new FakeElement('div');
  innerDiv.parentElement = positionedDiv;

  pass._rect = { top: 230, left: 1052, width: 336, height: 32 };
  pass.parentElement = innerDiv;

  const styles = new Map([
    [innerDiv, { position: 'static' }],
    [positionedDiv, { position: 'relative' }]
  ]);

  const ctl = createVaultIconController({
    document: doc,
    window: {
      scrollX: 0,
      scrollY: 0,
      getComputedStyle: (el) => styles.get(el) || { position: 'static' }
    },
    ipcRenderer: { send() {} },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => true
  });

  ctl.handleFocusIn({ target: pass });

  // Not on <body> — inside the field's own parentElement instead.
  assert.equal(bodyIcon(doc), null, 'no icon lands on <body> when the field has an in-tree parent');
  const icon = innerDiv.children.find((c) => c.getAttribute(ICON_ATTR) !== null);
  assert.ok(icon, "the icon is appended inside the field's parentElement");

  // top = fieldRect.top - ancestorRect.top - ancestor.clientTop + (fieldRect.height - ICON_HEIGHT) / 2
  //     = 230 - 50 - 2 + (32 - 16) / 2 = 186
  // left = fieldRect.left - ancestorRect.left - ancestor.clientLeft + fieldRect.width - ICON_WIDTH - 4
  //      = 1052 - 20 - 3 + 336 - 30 - 4 = 1331
  assert.equal(icon.style.top, '186px', 'top relative to the nearest positioned ancestor');
  assert.equal(icon.style.left, '1331px', 'left relative to the nearest positioned ancestor');
});

test('no window.getComputedStyle (a plain test double) falls back to body placement wholesale, even with an in-tree parentElement', () => {
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([pass])]);

  const innerDiv = new FakeElement('div');
  innerDiv.parentElement = doc.body;
  pass.parentElement = innerDiv;
  pass._rect = { top: 100, left: 200, width: 180, height: 24 };

  // makeController's window has no getComputedStyle — the original body-relative
  // behavior must be preserved wholesale (append target AND math), not a
  // half-migrated in-tree-append-with-wrong-math state.
  const ctl = makeController(doc, []);
  ctl.handleFocusIn({ target: pass });

  assert.equal(innerDiv.children.length, 0, 'no icon appended into the in-tree parent');
  const icon = bodyIcon(doc);
  assert.ok(icon, 'falls back to appending on <body>');
  assert.equal(icon.style.top, `${100 + (24 - 16) / 2}px`, 'body-relative top math unchanged');
  assert.equal(
    icon.style.left,
    `${200 + 180 - 30 - 4}px`,
    'body-relative left math unchanged (ICON_WIDTH=30, 4px inset)'
  );
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

// --- identity (M21 F3 Leg 3, DD8): the third icon kind ----------------------

function makeControllerWithFinders(doc, sends, extra = {}) {
  return createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send: (channel, payload) => sends.push({ channel, payload }) },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => true,
    ...extra
  });
}

test('AC13: the identity postal anchor field gets its own icon, aria-labeled "identity"', () => {
  const street = new FakeInput('text', 'street');
  const email = new FakeInput('text', 'email');
  const doc = makeDoc([new FakeForm([street, email])]);
  const identityEntry = { anchor: street, nonPostalAnchor: email };
  const ctl = makeControllerWithFinders(doc, [], { findAllIdentityFields: () => [identityEntry] });

  ctl.handleFocusIn({ target: street });
  const icon = bodyIcon(doc);
  assert.ok(icon, 'the postal anchor gets an icon');
  assert.equal(icon.getAttribute('aria-label'), 'Unlock vault to fill identity');
});

test('AC13: the non-postal anchor field ALSO gets an identity icon (two icons per entry, DD8)', () => {
  const street = new FakeInput('text', 'street');
  const email = new FakeInput('text', 'email');
  const doc = makeDoc([new FakeForm([street, email])]);
  const identityEntry = { anchor: street, nonPostalAnchor: email };
  const ctl = makeControllerWithFinders(doc, [], { findAllIdentityFields: () => [identityEntry] });

  ctl.handleFocusIn({ target: email });
  const icon = bodyIcon(doc);
  assert.ok(icon, 'the non-postal anchor also gets an icon');
  assert.equal(icon.getAttribute('aria-label'), 'Unlock vault to fill identity');
});

test('AC13/AC14: the identity icon carries no extra attribute — the attribute-set pin is unaffected', () => {
  const street = new FakeInput('text', 'street');
  const email = new FakeInput('text', 'email');
  const doc = makeDoc([new FakeForm([street, email])]);
  const identityEntry = { anchor: street, nonPostalAnchor: email };
  const ctl = makeControllerWithFinders(doc, [], { findAllIdentityFields: () => [identityEntry] });

  ctl.handleFocusIn({ target: street });
  const icon = bodyIcon(doc);
  const attrKeys = Object.keys(icon.attributes).sort();
  assert.deepEqual(
    attrKeys,
    ['aria-label', 'data-locked', 'focusable', 'height', 'role', 'viewBox', 'width', ICON_ATTR].sort(),
    'no data-kind — the kind rides the accessible name only'
  );
});

test('DD5 precedence: login wins a field an injected (pathological) identity entry also claims', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const ctl = makeControllerWithFinders(doc, [], {
    findAllIdentityFields: () => [{ anchor: user, nonPostalAnchor: null }]
  });

  ctl.handleFocusIn({ target: user });
  const icon = bodyIcon(doc);
  assert.equal(icon.getAttribute('aria-label'), 'Unlock vault to fill login', 'login wins the contested field');
});

test("AC13: clicking either identity icon binds the entry's POSTAL anchor as the fill target", () => {
  const street = new FakeInput('text', 'street');
  const email = new FakeInput('text', 'email');
  const doc = makeDoc([new FakeForm([street, email])]);
  const sends = [];
  const identityEntry = { anchor: street, nonPostalAnchor: email };
  const ctl = makeControllerWithFinders(doc, sends, { findAllIdentityFields: () => [identityEntry] });

  // Focus the NON-postal anchor and click its icon — the fill target must
  // still resolve to the entry's postal anchor (DD8).
  ctl.handleFocusIn({ target: email });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-gesture');
  assert.equal(
    ctl.consumeFillTarget('identity'),
    street,
    'the fill target is the postal anchor, not the clicked field'
  );
});

test('consumeFillTarget("identity") is null for a login-bound gesture, and vice versa (kind isolation)', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const sends = [];
  const ctl = makeControllerWithFinders(doc, sends, {});

  ctl.handleFocusIn({ target: pass });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.equal(ctl.consumeFillTarget('identity'), null, 'a login-bound target does not satisfy an identity consume');
});

// --- Generate-in-picker gesture payload (Mission 21, Flight 4, Leg 3, AC7) ---

test('AC7: a classified new-password field sends the login/new generate payload', () => {
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  pass.setAttribute('autocomplete', 'new-password');
  pass.setAttribute('minlength', '10');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: pass });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].channel, 'guest-vault-gesture');
  assert.deepEqual(sends[0].payload, {
    generate: { passwordRole: 'new', constraints: { minLength: 10, maxLength: null, passwordRules: null } }
  });
});

test('AC7: a sign-in field sends a generate payload with a null passwordRole (no secret either way)', () => {
  const pass = new FakeInput('password', 'signin-password');
  const doc = makeDoc([new FakeForm([pass])]);
  const sends = [];
  const ctl = makeController(doc, sends);

  ctl.handleFocusIn({ target: pass });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.deepEqual(sends[0].payload, { generate: { passwordRole: null, constraints: null } });
});

test('AC7: a card gesture stays bare — {} — never a generate payload', () => {
  const number = new FakeInput('text', 'cc-number');
  const doc = makeDoc([new FakeForm([number])]);
  const sends = [];
  const cardEntry = { number, cardholder: null, expiry: null, csc: null };
  const ctl = makeControllerWithFinders(doc, sends, { findAllCardFields: () => [cardEntry] });

  ctl.handleFocusIn({ target: number });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].payload, {});
});

test('AC7: an identity gesture stays bare — {} — never a generate payload', () => {
  const street = new FakeInput('text', 'street');
  const doc = makeDoc([new FakeForm([street])]);
  const sends = [];
  const identityEntry = { anchor: street, nonPostalAnchor: null };
  const ctl = makeControllerWithFinders(doc, sends, { findAllIdentityFields: () => [identityEntry] });

  ctl.handleFocusIn({ target: street });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.deepEqual(sends[0].payload, {});
});

test('AC7: an unresolved anchor (targetForAnchor returns null) stays bare — {}', () => {
  // A stale/foreign anchor that no detector recognises — resolveTarget always
  // returns null — models the "unresolved" branch (AC7's third listed case).
  const user = new FakeInput('text', 'username');
  const pass = new FakeInput('password', 'password');
  const doc = makeDoc([new FakeForm([user, pass])]);
  const sends = [];
  const ctl = createVaultIconController({
    document: doc,
    window: { scrollX: 0, scrollY: 0 },
    ipcRenderer: { send: (channel, payload) => sends.push({ channel, payload }) },
    isTrustedGet: { call: (e) => !!e.isTrusted },
    findAllLoginFields,
    getEnabled: () => true,
    resolveTarget: () => null
  });

  ctl.handleFocusIn({ target: pass });
  bodyIcon(doc).dispatch('click', { isTrusted: true });

  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].payload, {});
});
