'use strict';

// Unit tests for src/renderer/pages/vault-filter-controller.js (Mission 22, Flight 1),
// mirroring test/unit/vault-nav-controller.test.js's hand-rolled mock-DOM precedent (no
// jsdom dependency in this repo). These pin the controller's own reconciliation logic —
// row/subsection/section hiding, late registration, reset, clear, and the nav-clears-
// hidden-target behavior — independent of the live app's real DOM/async timing, which the
// `vault-filter` behavior test covers instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/vault-filter-controller.js')).href;
const pageModelUrl = pathToFileURL(path.join(__dirname, '../../src/shared/vault-page-model.js')).href;

const HIDE_CLASS = 'vault-filter-out';

// ── Minimal mock DOM (El) ─────────────────────────────────────────────────────────────
// Extends the vault-nav-controller.test.js El shape with classList add/remove/contains/
// toggle, contains(), isConnected (walks to a `_isRoot`-marked ancestor — real DOM's own
// definition, mirrored: a node reachable from the document root is connected; one that
// isn't (e.g. detached by a prior render's `root.textContent = ''`) is not), a small
// addEventListener/dispatchEvent pair (capture + bubble, event.type-keyed — enough to
// exercise the controller's ONE capture-phase nav listener), and value/focus/blur for the
// filter's own input/button.

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.id = '';
    this.value = '';
    this.type = '';
    this.title = '';
    this._isRoot = false;
    this._textContent = '';
    this._listeners = new Map(); // 'type:capture'|'type:bubble' -> handler[]
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      }
    };
  }
  get isConnected() {
    let n = this;
    while (n) {
      if (n._isRoot) return true;
      n = n.parentNode;
    }
    return false;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(value) {
    this._textContent = String(value);
    if (value === '') {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
    }
  }
  appendChild(child) {
    return this.insertBefore(child, null);
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    const index = before == null ? this.children.length : this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentNode = this;
    return child;
  }
  contains(candidate) {
    for (let node = candidate; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  focus() {
    El.activeElement = this;
  }
  blur() {
    if (El.activeElement === this) El.activeElement = null;
  }
  addEventListener(type, handler, capture) {
    const key = `${type}:${capture ? 'capture' : 'bubble'}`;
    if (!this._listeners.has(key)) this._listeners.set(key, []);
    this._listeners.get(key).push(handler);
  }
  removeEventListener(type, handler, capture) {
    const key = `${type}:${capture ? 'capture' : 'bubble'}`;
    const list = this._listeners.get(key);
    if (list) {
      const i = list.indexOf(handler);
      if (i !== -1) list.splice(i, 1);
    }
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    /** @type {El[]} */
    const path = [];
    for (let n = this; n; n = n.parentNode) path.unshift(n);
    const fire = (node, phase) => {
      const list = node._listeners.get(`${event.type}:${phase}`);
      if (list) for (const h of list.slice()) h(event);
    };
    for (const node of path) fire(node, 'capture'); // capture: root → target (inclusive)
    fire(this, 'bubble'); // target phase (bubble-registered listeners fire at target too)
    for (let i = path.length - 2; i >= 0; i--) fire(path[i], 'bubble'); // bubble: target → root
  }
}
El.activeElement = null;

function makeDocument() {
  El.activeElement = null;
  return {
    get activeElement() {
      return El.activeElement;
    },
    createElement: (tag) => new El(tag)
  };
}

/** A root container standing in for #vault-root's ancestry — anything reachable from it is isConnected. */
function makeRoot() {
  const root = new El('div');
  root._isRoot = true;
  return root;
}

// Injects the REAL matcher/status-copy functions from vault-page-model.js (the same module
// vault.js imports them from) — the controller itself takes them as deps rather than
// importing './vault-page-model.js' directly (see the controller's own header comment on
// why), so a live dynamic import of the controller needs no shimming.
async function create(deps) {
  const { createVaultFilter } = await import(moduleUrl);
  const { itemMatchesFilter, filterStatusText } = await import(pageModelUrl);
  return createVaultFilter({ itemMatchesFilter, filterStatusText, ...deps });
}

/** Build one `.vault-type-subsection` with an item list, matching vault.js's buildTypeSubsection shape. */
function buildSubsection() {
  const subsection = new El('section');
  subsection.classList.add('vault-subsection');
  subsection.classList.add('vault-type-subsection');
  const list = new El('ul');
  subsection.appendChild(list);
  return { subsection, list };
}

/** Append a registered item row (li.vault-item-row) to `list`, returning its { row, meta } pair. */
function addRow(list, meta) {
  const row = new El('li');
  row.classList.add('vault-item-row');
  list.appendChild(row);
  return { row, meta };
}

/**
 * Build one vault section: section.vault-child-section containing a Logins and a Cards
 * `.vault-type-subsection`, plus a jar-only `.vault-accesskeys` subsection (a DIFFERENT
 * class — never a filter target). Returns the section plus each subsection's list, for
 * the test to populate with rows.
 */
function buildVaultSection(id) {
  const section = new El('section');
  section.id = `vault-${id}`;
  section.classList.add('vault-section');
  section.classList.add('vault-child-section');

  const login = buildSubsection();
  const card = buildSubsection();
  section.appendChild(login.subsection);
  section.appendChild(card.subsection);

  const accessKeys = new El('section');
  accessKeys.classList.add('vault-accesskeys');
  const akRow = new El('li'); // an access-key row — must never be filtered on its own
  accessKeys.appendChild(akRow);
  section.appendChild(accessKeys);

  return { section, login, card, accessKeys, akRow };
}

/**
 * Locate the field's label/input/clear-button/status/box from buildField()'s returned
 * wrapper. HAT H1 fix: the input and clear button now share a positioned `.vault-filter-
 * box` sibling of the label (no longer input-inside-label) — see vault-filter-controller.js.
 */
function fieldParts(wrap) {
  const label = wrap.children[0];
  const box = wrap.children[1];
  return { label, box, input: box.children[0], clearBtn: box.children[1], status: wrap.children[2] };
}

function typeQuery(input, value) {
  input.value = value;
  input.dispatchEvent({ type: 'input' });
}

// ── AC3: field shape + naming ────────────────────────────────────────────────

test('buildField: input#vault-filter, button#vault-filter-clear (hidden, aria-label "Clear filter"), #vault-filter-status role=status — all empty at build', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { label, box, input, clearBtn, status } = fieldParts(wrap);

  assert.equal(input.tagName, 'INPUT');
  assert.equal(input.type, 'text');
  assert.equal(input.id, 'vault-filter');
  assert.equal(input.value, '');

  assert.equal(clearBtn.tagName, 'BUTTON');
  assert.equal(clearBtn.id, 'vault-filter-clear');
  assert.equal(clearBtn.getAttribute('aria-label'), 'Clear filter');
  assert.equal(clearBtn.hidden, true);

  assert.equal(status.id, 'vault-filter-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.textContent, '');

  // HAT H1 fix: the input and clear button share the SAME wrapper (the box the × is
  // positioned inside), and the button is never a descendant of the <label> — the label
  // instead carries an explicit `for` pointing at the input's id.
  assert.equal(input.parentNode, box, 'input lives in the box');
  assert.equal(clearBtn.parentNode, box, 'clear button lives in the SAME box as the input');
  assert.equal(label.getAttribute('for'), 'vault-filter', 'explicit label association');
  assert.equal(label.children.indexOf(input), -1, 'input is not a descendant of the label');
  assert.equal(label.children.indexOf(clearBtn), -1, 'button is not a descendant of the label');
});

test('buildField: no "search" anywhere — id, class, aria-label, or input type', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input, clearBtn } = fieldParts(wrap);
  assert.notEqual(input.type, 'search');
  for (const s of [input.id, clearBtn.id, clearBtn.getAttribute('aria-label') || '', input.type]) {
    assert.equal(/search/i.test(s), false, `unexpected "search" in "${s}"`);
  }
});

// ── AC4: filtering (rows, subsections, sections) ─────────────────────────────

test('register-then-apply: filters rows, collapses emptied subsections and the section, and clears on an empty query', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input, status } = fieldParts(wrap);

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const loginPair = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  const cardPair = addRow(v.card.list, {
    type: 'card',
    title: 'Filter Card',
    cardholder: 'Pat',
    brand: 'Visa',
    last4: '1'
  });
  filter.registerVault(v.section, [loginPair, cardPair]);

  // No query yet: nothing hidden.
  assert.equal(loginPair.row.classList.contains(HIDE_CLASS), false);
  assert.equal(cardPair.row.classList.contains(HIDE_CLASS), false);
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);

  typeQuery(input, 'filter');
  assert.equal(loginPair.row.classList.contains(HIDE_CLASS), true, 'Alpha does not match "filter"');
  assert.equal(cardPair.row.classList.contains(HIDE_CLASS), false, 'Filter Card matches');
  assert.equal(v.login.subsection.classList.contains(HIDE_CLASS), true, 'Logins has no visible row');
  assert.equal(v.card.subsection.classList.contains(HIDE_CLASS), false, 'Cards has a visible row');
  assert.equal(v.section.classList.contains(HIDE_CLASS), false, 'the section still has a match');
  assert.equal(status.textContent, '1 item matches');

  typeQuery(input, 'zq7marker-nothing-matches-this');
  assert.equal(loginPair.row.classList.contains(HIDE_CLASS), true);
  assert.equal(cardPair.row.classList.contains(HIDE_CLASS), true);
  assert.equal(v.login.subsection.classList.contains(HIDE_CLASS), true);
  assert.equal(v.card.subsection.classList.contains(HIDE_CLASS), true);
  assert.equal(v.section.classList.contains(HIDE_CLASS), true, 'zero matches — the whole section collapses');
  assert.equal(status.textContent, 'No items match');

  typeQuery(input, '');
  assert.equal(loginPair.row.classList.contains(HIDE_CLASS), false);
  assert.equal(cardPair.row.classList.contains(HIDE_CLASS), false);
  assert.equal(v.login.subsection.classList.contains(HIDE_CLASS), false);
  assert.equal(v.card.subsection.classList.contains(HIDE_CLASS), false);
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);
  assert.equal(status.textContent, '');
});

// HAT H3 (2026-09-23, superseding the original FD ruling): while a filter query is active,
// every LOADED vault's Access-keys subsection hides directly — never as a match target, and
// regardless of whether that same vault has item matches. Renamed from the pre-H3 test
// ("the Access-keys subsection is never itself toggled; it disappears only via its ancestor
// section collapsing") to make the behavior shift visible in history rather than silently
// dropping the old pin.
test('HAT H3: Access-keys hides directly whenever the query is active, even when its vault HAS matches, and shows again once the query clears', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const only = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [only]);

  // A query with a MATCH: the section stays visible, but Access-keys hides anyway.
  typeQuery(input, 'alpha');
  assert.equal(v.section.classList.contains(HIDE_CLASS), false, 'the section still has a match');
  assert.equal(
    v.accessKeys.classList.contains(HIDE_CLASS),
    true,
    'Access-keys hides while filtering, regardless of matches'
  );

  // A query with NO match: the section hides too (unchanged), and Access-keys stays hidden.
  typeQuery(input, 'zzz-no-match');
  assert.equal(v.section.classList.contains(HIDE_CLASS), true);
  assert.equal(v.accessKeys.classList.contains(HIDE_CLASS), true);

  // Clearing the query restores everything, Access-keys included.
  typeQuery(input, '');
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);
  assert.equal(
    v.accessKeys.classList.contains(HIDE_CLASS),
    false,
    'Access-keys is visible again once the query is empty'
  );
  assert.equal(v.akRow.classList.contains(HIDE_CLASS), false, 'the filter never touches the access-key row itself');
});

test("HAT H3: an unloaded (never-registered) vault's Access-keys is left untouched by an active query", async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const v = buildVaultSection('unloaded');
  root.appendChild(v.section); // attached, but NEVER registered

  typeQuery(input, 'anything');
  assert.equal(
    v.accessKeys.classList.contains(HIDE_CLASS),
    false,
    'an unloaded vault is never touched, access keys included'
  );
});

test('an empty vault (zero items in every subsection) collapses whole once loaded under an active query', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const v = buildVaultSection('empty');
  root.appendChild(v.section);
  filter.registerVault(v.section, []); // zero items — no pairs at all

  typeQuery(input, 'anything');
  assert.equal(v.login.subsection.classList.contains(HIDE_CLASS), true);
  assert.equal(v.card.subsection.classList.contains(HIDE_CLASS), true);
  assert.equal(v.section.classList.contains(HIDE_CLASS), true);

  typeQuery(input, '');
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);
});

test('the filter never writes the `hidden` attribute — "Other items"\' own hidden survives a filter/clear cycle', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const v = buildVaultSection('personal');
  const unknown = buildSubsection();
  unknown.subsection.classList.add('vault-unknown-subsection');
  unknown.subsection.hidden = true; // renderUnknownItems's own "hidden while empty" state
  v.section.appendChild(unknown.subsection);
  root.appendChild(v.section);

  const only = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [only]); // "Other items" contributes zero pairs (empty)

  typeQuery(input, 'zzz-no-match');
  assert.equal(unknown.subsection.classList.contains(HIDE_CLASS), true, 'zero visible rows inside it');
  assert.equal(unknown.subsection.hidden, true, 'the filter never wrote `hidden` — it was already true');

  typeQuery(input, '');
  assert.equal(unknown.subsection.classList.contains(HIDE_CLASS), false);
  assert.equal(unknown.subsection.hidden, true, 'still true — the filter never touched it either way');
});

// ── AC5: late registration + the isConnected stale guard ────────────────────

test('late registration under an active query: an unloaded section is untouched; once registered it is filtered immediately', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const a = buildVaultSection('alpha');
  root.appendChild(a.section);
  const aRow = addRow(a.login.list, { type: 'login', title: 'Alpha Item', username: 'a', origin: 'https://a.example' });
  filter.registerVault(a.section, [aRow]);

  const b = buildVaultSection('beta');
  root.appendChild(b.section); // built and attached, but NEVER registered yet

  typeQuery(input, 'alpha');
  assert.equal(aRow.row.classList.contains(HIDE_CLASS), false);
  // B is entirely untouched while unloaded — never hidden, regardless of the live query.
  assert.equal(b.section.classList.contains(HIDE_CLASS), false);
  assert.equal(b.login.subsection.classList.contains(HIDE_CLASS), false);

  // B loads a non-matching row and a matching one.
  const bMiss = addRow(b.login.list, { type: 'login', title: 'Beta Item', username: 'b', origin: 'https://b.example' });
  const bHit = addRow(b.card.list, {
    type: 'card',
    title: 'Has Alpha In It',
    cardholder: 'x',
    brand: 'Visa',
    last4: '9'
  });
  filter.registerVault(b.section, [bMiss, bHit]);

  assert.equal(bMiss.row.classList.contains(HIDE_CLASS), true, 'Beta Item doesn\'t match "alpha"');
  assert.equal(bHit.row.classList.contains(HIDE_CLASS), false, 'title contains "Alpha"');
  assert.equal(b.login.subsection.classList.contains(HIDE_CLASS), true, 'Logins emptied of matches');
  assert.equal(b.card.subsection.classList.contains(HIDE_CLASS), false, 'Cards has the match');
  assert.equal(b.section.classList.contains(HIDE_CLASS), false, 'B has a match — stays visible');
});

test('registerVault ignores a section that is not isConnected (a stale read from a superseded render)', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });

  const v = buildVaultSection('stale');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });

  // Simulate render()'s `root.textContent = ''` detaching every prior child BEFORE this
  // stale vaultList().then() resolves.
  root.textContent = '';
  assert.equal(v.section.isConnected, false);

  assert.doesNotThrow(() => filter.registerVault(v.section, [{ row: row.row, meta: row.meta }]));
  // Nothing was registered — apply() over an active query must not touch the detached row.
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);
  typeQuery(input, 'alpha');
  assert.equal(row.row.classList.contains(HIDE_CLASS), false, 'never touched — the section was refused');
});

// ── AC10: live region ─────────────────────────────────────────────────────────

test('registerVault scopes aria-live="off" onto the vault section (the leg\'s primary AC10 mechanism); a never-registered section is untouched', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  assert.equal(v.section.getAttribute('aria-live'), null, 'unset before registration');

  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);
  assert.equal(v.section.getAttribute('aria-live'), 'off');

  // A never-registered (e.g. locked, or unloaded) section is left entirely alone.
  const locked = new El('section');
  locked.id = 'vault-locked-example';
  assert.equal(locked.getAttribute('aria-live'), null);
});

test('registerVault re-declares aria-live="polite" on non-filter-managed direct children (review finding 1) — Access-keys stays announced, type subsections stay covered by "off"', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);

  // The Access-keys subsection (never a filter target, but renders content asynchronously
  // after registration via its own mint/revoke refreshes) must stay in a live region.
  assert.equal(v.accessKeys.getAttribute('aria-live'), 'polite');

  // Every `.vault-type-subsection` (filter-managed) must NOT carry its own aria-live — it
  // stays covered by the section's "off" via inheritance.
  assert.equal(v.login.subsection.getAttribute('aria-live'), null);
  assert.equal(v.card.subsection.getAttribute('aria-live'), null);
});

// ── AC6: status text ──────────────────────────────────────────────────────────

test('status text: empty while inactive, singular/plural while active, worded at zero — updates on every apply, including a late registerVault', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input, status } = fieldParts(wrap);

  assert.equal(status.textContent, '');

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const r1 = addRow(v.login.list, { type: 'login', title: 'One', username: 'u', origin: 'https://one.example' });
  filter.registerVault(v.section, [r1]);

  typeQuery(input, 'one');
  assert.equal(status.textContent, '1 item matches');

  const r2 = addRow(v.card.list, { type: 'card', title: 'One Card', cardholder: 'x', brand: 'Visa', last4: '1' });
  filter.registerVault(v.section, [r1, r2]); // re-registration with the query still active
  assert.equal(status.textContent, '2 items match');

  typeQuery(input, 'zzz');
  assert.equal(status.textContent, 'No items match');

  typeQuery(input, '');
  assert.equal(status.textContent, '');
});

// ── AC7: clear button ─────────────────────────────────────────────────────────

test('clear button: empties the field, unhides everything, empties the status, hides the button, and focuses the input', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input, clearBtn, status } = fieldParts(wrap);

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);

  typeQuery(input, 'zzz-no-match');
  assert.equal(clearBtn.hidden, false);
  assert.equal(row.row.classList.contains(HIDE_CLASS), true);

  El.activeElement = null;
  clearBtn.dispatchEvent({ type: 'click' });

  assert.equal(input.value, '');
  assert.equal(row.row.classList.contains(HIDE_CLASS), false);
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);
  assert.equal(status.textContent, '');
  assert.equal(clearBtn.hidden, true);
  assert.equal(El.activeElement, input, 'focus returns to the field');
});

// ── AC8: lifetime — reset() ────────────────────────────────────────────────────

test('reset(): clears the query and the row registry — a fresh registerVault after reset starts from zero', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  const root = makeRoot();
  const filter = await create({ document, navEl });
  let wrap = filter.buildField();
  let parts = fieldParts(wrap);

  const v = buildVaultSection('personal');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);
  typeQuery(parts.input, 'alpha');
  assert.equal(parts.status.textContent, '1 item matches');

  filter.reset();
  assert.equal(filter.query(), '');

  // A fresh build after reset; nothing is registered yet, and typing must report zero
  // matches — proof the OLD registry entry did not survive reset().
  wrap = filter.buildField();
  parts = fieldParts(wrap);
  assert.equal(parts.input.value, '');
  assert.equal(parts.clearBtn.hidden, true);
  typeQuery(parts.input, 'alpha');
  assert.equal(parts.status.textContent, 'No items match');
});

// ── AC9: nav capture-phase click clears a filter that hides its target ──────────

function buildNavAnchor(navEl, targetId) {
  const li = new El('li');
  const a = new El('a');
  a.setAttribute('href', `#${targetId}`);
  const marker = new El('span'); // a nested element — clicks land here, must bubble to the <a>
  a.appendChild(marker);
  li.appendChild(a);
  navEl.appendChild(li);
  return { li, a, marker };
}

test('nav click: clears the filter (no focus move) when the target section is currently filtered out; the hash navigation is left unprevented', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  navEl._isRoot = true; // the nav is its own connected tree in this test
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input, status } = fieldParts(wrap);

  const v = buildVaultSection('alpha');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);

  const anchor = buildNavAnchor(navEl, 'vault-alpha');

  typeQuery(input, 'zzz-no-match');
  assert.equal(v.section.classList.contains(HIDE_CLASS), true);

  let defaultPrevented = false;
  El.activeElement = null;
  anchor.marker.dispatchEvent({ type: 'click', preventDefault: () => (defaultPrevented = true) });

  assert.equal(input.value, '', 'the filter cleared');
  assert.equal(v.section.classList.contains(HIDE_CLASS), false, 'the target is visible again');
  assert.equal(status.textContent, '');
  assert.equal(defaultPrevented, false, 'the default hash navigation is left unprevented');
  assert.equal(El.activeElement, null, 'the nav path never moves focus (unlike the clear button)');
});

test('nav click: a click on a visible target leaves the filter unchanged', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  navEl._isRoot = true;
  const root = makeRoot();
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);

  const v = buildVaultSection('alpha');
  root.appendChild(v.section);
  const row = addRow(v.login.list, { type: 'login', title: 'Alpha', username: 'a', origin: 'https://a.example' });
  filter.registerVault(v.section, [row]);

  const anchor = buildNavAnchor(navEl, 'vault-alpha');

  typeQuery(input, 'alpha'); // matches — the section stays visible
  assert.equal(v.section.classList.contains(HIDE_CLASS), false);

  anchor.a.dispatchEvent({ type: 'click' });
  assert.equal(input.value, 'alpha', 'unchanged — the target was never hidden');
});

test('nav click: a non-vault anchor, or a target the filter has never loaded, is a no-op', async () => {
  const document = makeDocument();
  const navEl = new El('ul');
  navEl._isRoot = true;
  const filter = await create({ document, navEl });
  const wrap = filter.buildField();
  const { input } = fieldParts(wrap);
  typeQuery(input, 'anything');

  const settingsLi = new El('li');
  const settingsA = new El('a');
  settingsA.setAttribute('href', '#vault-settings'); // never registered — not a vault section
  settingsLi.appendChild(settingsA);
  navEl.appendChild(settingsLi);

  settingsA.dispatchEvent({ type: 'click' });
  assert.equal(input.value, 'anything', 'unchanged — vault-settings is never a registered section');
});
