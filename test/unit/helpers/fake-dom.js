'use strict';

// Squawk 0077 / Mission 20 Flight 2 Leg 1: the shared fake-DOM test harness,
// the UNION of the two divergent copies this replaces
// (tab-controller.test.js's FakeElement had an `innerHTML` setter that
// auto-populates `_parts` with `.tab-title`/`.tab-close`/`.tab-fav`/
// `.tab-status` — load-bearing for tab-controller.js's `innerHTML`-built strip
// button — plus `style`/`disabled`/`value`/`tabIndex`/`parent`/`insertBefore`/
// `remove()`/`getBoundingClientRect()`; load-failure-controller.test.js's had
// no `innerHTML` setter (a `makeBtn()` helper pre-assigned `_parts`) but
// carried `textContent` get/set, `focus()`/`focused`, `click()`) — every
// feature from both is kept. The `innerHTML` auto-populate selector set is a
// constructor option (`innerHTMLParts`), not tab-strip-specific, so a future
// consumer can supply its own set (or none). Named `helpers/fake-dom.js` per
// the `helpers/jars-page-dom.js` precedent — NOT the `support/`/
// `makeFakeDocument` names squawk 0077's original draft used.

const DEFAULT_INNER_HTML_PARTS = ['.tab-title', '.tab-close', '.tab-fav', '.tab-status'];

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  /**
   * @param {string} [name]
   * @param {{ innerHTMLParts?: string[] }} [opts] innerHTMLParts — the
   *   selector set an `innerHTML` write auto-populates into `_parts` (the
   *   tab-controller.js `innerHTML`-built strip-button idiom); defaults to
   *   the tab-strip set, pass `[]` to disable auto-population entirely.
   */
  constructor(name = 'div', opts = {}) {
    this.name = name;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.parent = null;
    this.disabled = false;
    this.value = '';
    this.tabIndex = 0;
    this._parts = new Map();
    this._text = '';
    this.focused = false;
    this._innerHTMLParts = opts.innerHTMLParts || DEFAULT_INNER_HTML_PARTS;
  }
  set className(value) {
    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((name) => this.classList.add(name));
  }
  set innerHTML(value) {
    // Squawk 0020: keep the raw markup so tests can assert on the jar-color
    // dot's style attribute (isSafeColor guard), same as every real innerHTML sink.
    this._rawHTML = value;
    for (const selector of this._innerHTMLParts) this._parts.set(selector, new FakeElement(selector));
  }
  get innerHTML() {
    return this._rawHTML || '';
  }
  set textContent(value) {
    this._text = value;
  }
  get textContent() {
    return this._text;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(name, fn) {
    this.listeners.set(name, fn);
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, reference) {
    this.children = this.children.filter((item) => item !== child);
    const index = reference == null ? -1 : this.children.indexOf(reference);
    child.parent = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
    this.parent = null;
  }
  querySelector(selector) {
    return this._parts.get(selector) || null;
  }
  getBoundingClientRect() {
    return { x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 };
  }
  click() {
    const fn = this.listeners.get('click');
    if (fn) fn();
  }
  focus() {
    this.focused = true;
  }
}

/**
 * @param {{ activeElement?: any, body?: any, elementOptions?: { innerHTMLParts?: string[] } }} [opts]
 */
function createFakeDocument(opts = {}) {
  const created = [];
  const listeners = new Map();
  return {
    activeElement: opts.activeElement !== undefined ? opts.activeElement : null,
    body: opts.body !== undefined ? opts.body : { isBody: true },
    createElement(name) {
      const el = new FakeElement(name, opts.elementOptions);
      created.push(el);
      return el;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    __created: created,
    __listeners: listeners
  };
}

module.exports = { FakeClassList, FakeElement, createFakeDocument };
