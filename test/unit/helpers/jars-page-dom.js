'use strict';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.id = '';
    this.className = '';
    this._textContent = '';
    const values = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !values.has(name) : !!force;
        if (enabled) values.add(name); else values.delete(name);
        return enabled;
      },
      contains: (name) => values.has(name)
    };
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  get options() { return this.children; }
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
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(candidate) {
    for (let node = candidate; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatch(name, event = {}) {
    for (const fn of this.listeners.get(name) || []) fn(event);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      if (selector === '.swatch-btn' && node.className.split(' ').includes('swatch-btn')) found.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return found;
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; this.focused = true; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null; }
  scrollIntoView(options) { this.scrolledWith = options; }
}

function createDocument() {
  const document = {
    activeElement: null,
    createElement(tag) { const el = new Element(tag); el.ownerDocument = document; return el; },
    createElementNS(_namespace, tag) { return document.createElement(tag); },
    createTextNode(text) { const node = document.createElement('#text'); node.textContent = text; return node; },
    getElementById() { return null; }
  };
  return document;
}

module.exports = { Element, createDocument };
