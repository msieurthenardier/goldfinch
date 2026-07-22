'use strict';

// Unit tests for src/renderer/pages/vault-nav-controller.js (M12 F5 HAT hat-page-sidebar;
// two-level per the M12 F5 HAT batch), mirroring test/unit/jars-nav-controller.test.js. The
// vault nav is heterogeneous AND two-level — a fixed Settings gear entry, then a "Vaults" group
// parent whose indented children are a globe Global entry and one color-dot entry per jar —
// driven by the pure `vaultNavEntries` model; these tests cover the nested render/patch, marker
// selection, dot color, and the scroll-spy aria-current wiring (including indented children)
// without a real DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/vault-nav-controller.js')).href;

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.id = '';
    this.href = '';
    this._className = '';
    this._classes = new Set();
    this._textContent = '';
    this.classList = { add: (c) => { this._classes.add(c); } };
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value); this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] || null;
  }
  get textContent() { return this._textContent; }
  set textContent(value) {
    this._textContent = String(value);
    if (value === '') {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
    }
  }
  appendChild(child) { return this.insertBefore(child, null); }
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}

class Observer {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = [];
    this.disconnected = false;
    Observer.instances.push(this);
  }
  observe(target) { this.observed.push(target); }
  disconnect() { this.disconnected = true; }
}

function harness() {
  Observer.instances = [];
  const navEl = new El('ul');
  const document = {
    activeElement: null,
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag)
  };
  return {
    document,
    navEl,
    deps: {
      document,
      Node: El,
      navEl,
      IntersectionObserver: Observer,
      isSafeColor: (color) => typeof color === 'string' && color.startsWith('#'),
      fallbackColor: '#9aa0ac'
    }
  };
}

async function create(h) {
  const { createVaultNav } = await import(moduleUrl);
  return createVaultNav(h.deps);
}

const ENTRIES = [
  { id: 'settings', kind: 'settings', label: 'Settings' },
  {
    id: 'vaults', kind: 'group', label: 'Vaults', children: [
      { id: 'global', kind: 'global', label: 'Global' },
      { id: 'personal', kind: 'jar', label: 'Personal', color: '#4caf50' }
    ]
  }
];

// li → a → [marker?, nameSpan]. The group's li is a → nameSpan, then a nested <ul> sublist.
const anchorOf = (li) => li.children[0];
const markerOf = (li) => anchorOf(li).children[0];
// nameSpan is always the anchor's LAST child (present with or without a leading marker).
const nameOf = (li) => { const a = anchorOf(li); return a.children[a.children.length - 1]; };
const sublistOf = (groupLi) => groupLi.children[1];

test('renders a Settings gear at top, then a Vaults group with indented globe/dot children', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render(ENTRIES);
  // Two top-level entries: Settings and the Vaults group.
  assert.equal(h.navEl.children.length, 2);

  const [settings, group] = h.navEl.children;
  assert.equal(markerOf(settings).tagName, 'SVG'); // gear icon, not a dot
  assert.equal(nameOf(settings).textContent, 'Settings');
  assert.equal(anchorOf(settings).href, '#vault-settings');

  // The group is a header anchor (no marker) + a nested sublist.
  assert.equal(nameOf(group).textContent, 'Vaults');
  assert.equal(anchorOf(group).href, '#vault-vaults');
  const sublist = sublistOf(group);
  assert.equal(sublist.tagName, 'UL');
  assert.equal(sublist.attributes.get('role'), 'list');
  assert.equal(sublist.children.length, 2);

  const [global, jar] = sublist.children;
  assert.equal(markerOf(global).tagName, 'SVG'); // globe icon
  assert.equal(anchorOf(global).href, '#vault-global');

  assert.equal(markerOf(jar).className, 'vault-nav-dot');
  assert.equal(markerOf(jar).style.background, '#4caf50'); // safe color applied
  assert.equal(anchorOf(jar).href, '#vault-personal');
});

test('an unsafe jar color falls back; a null color falls back', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render([
    { id: 'settings', kind: 'settings', label: 'Settings' },
    {
      id: 'vaults', kind: 'group', label: 'Vaults', children: [
        { id: 'bad', kind: 'jar', label: 'Bad', color: 'url(x)' },
        { id: 'none', kind: 'jar', label: 'None', color: null }
      ]
    }
  ]);
  const sublist = sublistOf(h.navEl.children[1]);
  assert.equal(markerOf(sublist.children[0]).style.background, '#9aa0ac');
  assert.equal(markerOf(sublist.children[1]).style.background, '#9aa0ac');
});

test('a focused indented child is patched in place (label rewritten), never replaced', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render(ENTRIES);
  const originalJar = sublistOf(h.navEl.children[1]).children[1]; // Personal
  h.document.activeElement = anchorOf(originalJar);
  nav.render([
    ENTRIES[0],
    {
      id: 'vaults', kind: 'group', label: 'Vaults', children: [
        { id: 'global', kind: 'global', label: 'Global' },
        { id: 'personal', kind: 'jar', label: 'Renamed', color: '#123456' }
      ]
    }
  ]);
  const sublistAfter = sublistOf(h.navEl.children[1]);
  assert.equal(sublistAfter.children[1], originalJar); // same node
  assert.equal(nameOf(originalJar).textContent, 'Renamed');
  assert.equal(markerOf(originalJar).style.background, '#123456');
});

test('setActive sets aria-current on exactly the matching entry, including indented children', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render(ENTRIES);
  const [settings, group] = h.navEl.children;
  const sublist = sublistOf(group);

  nav.setActive('vault-global');
  assert.equal(anchorOf(settings).attributes.get('aria-current'), undefined);
  assert.equal(anchorOf(group).attributes.get('aria-current'), undefined);
  assert.equal(anchorOf(sublist.children[0]).attributes.get('aria-current'), 'true'); // Global

  nav.setActive('vault-personal');
  assert.equal(anchorOf(sublist.children[0]).attributes.get('aria-current'), undefined);
  assert.equal(anchorOf(sublist.children[1]).attributes.get('aria-current'), 'true'); // Personal

  nav.setActive('vault-vaults'); // the group parent itself
  assert.equal(anchorOf(sublist.children[1]).attributes.get('aria-current'), undefined);
  assert.equal(anchorOf(group).attributes.get('aria-current'), 'true');

  nav.setActive('vault-settings');
  assert.equal(anchorOf(group).attributes.get('aria-current'), undefined);
  assert.equal(anchorOf(settings).attributes.get('aria-current'), 'true');
});

test('observe drives aria-current from the topmost visible section (incl. indented children) and disconnects on re-observe/destroy', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render(ENTRIES);
  const secSettings = Object.assign(new El('section'), { id: 'vault-settings' });
  const secVaults = Object.assign(new El('section'), { id: 'vault-vaults' });
  const secGlobal = Object.assign(new El('section'), { id: 'vault-global' });
  nav.observe([secSettings, secVaults, secGlobal]);
  assert.equal(Observer.instances.length, 1);
  assert.deepEqual(Observer.instances[0].observed, [secSettings, secVaults, secGlobal]);

  Observer.instances[0].callback([{ target: secGlobal, isIntersecting: true }]);
  const sublist = sublistOf(h.navEl.children[1]);
  assert.equal(anchorOf(sublist.children[0]).attributes.get('aria-current'), 'true'); // Global child

  nav.observe([secSettings]); // re-observe disconnects the prior observer
  assert.equal(Observer.instances[0].disconnected, true);
  nav.destroy();
  assert.equal(Observer.instances[1].disconnected, true);
});
