'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-nav-controller.js')).href;

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.id = '';
    this.className = '';
    this._textContent = '';
  }
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
  const document = { activeElement: null, createElement: (tag) => new El(tag) };
  const sections = new Map();
  return {
    document,
    navEl,
    sections,
    deps: {
      document,
      Node: El,
      navEl,
      IntersectionObserver: Observer,
      isSafeColor: (color) => color.startsWith('#'),
      fallbackColor: '#000000',
      getSectionRefs: (id) => sections.get(id),
      sectionSetKey: (rows) => rows.map((row) => row.id).join('|')
    }
  };
}

async function create(harnessValue) {
  const { createJarsNav } = await import(moduleUrl);
  return createJarsNav(harnessValue.deps);
}

test('focused nav entries are patched and reordered without replacing their nodes', async () => {
  const h = harness();
  const nav = await create(h);
  nav.render([{ id: 'a', name: 'Alpha', color: '#111111', isDefault: false }]);
  const original = h.navEl.firstChild;
  h.document.activeElement = original.children[0];
  nav.render([{ id: 'a', name: 'Renamed', color: '#222222', isDefault: true }]);
  assert.equal(h.navEl.firstChild, original);
  assert.equal(original.children[0].children[1].textContent, 'Renamed');
  assert.equal(original.children[0].children[2].hidden, false);
});

test('scroll observer is stable for an unchanged section set and activates history/current nav', async () => {
  const h = harness();
  const nav = await create(h);
  const historyCalls = [];
  const root = new El('section'); root.id = 'jar-work';
  h.sections.set('work', { root, historyPanel: { onExpanded: () => historyCalls.push('work') } });
  const rows = [{ id: 'work', name: 'Work', color: '#123456', isDefault: false }];
  nav.render(rows);
  nav.observeSectionsIfChanged(rows);
  nav.observeSectionsIfChanged([{ ...rows[0] }]);
  assert.equal(Observer.instances.length, 1);
  assert.deepEqual(Observer.instances[0].observed, [root]);
  Observer.instances[0].callback([{ target: root, isIntersecting: true }]);
  assert.deepEqual(historyCalls, ['work']);
  assert.equal(h.navEl.firstChild.children[0].attributes.get('aria-current'), 'true');
  nav.destroy();
  assert.equal(Observer.instances[0].disconnected, true);
});
