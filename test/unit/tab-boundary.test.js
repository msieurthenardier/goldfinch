'use strict';

// Unit tests for src/shared/tab-boundary.js (M17 Flight 1 Leg 1, AC1).
//
// tabBoundary(doc, direction) is pure and CJS-by-design (no DOM globals beyond
// the passed-in `doc`), so it is exercised here with a minimal hand-rolled
// FakeElement/FakeDocument pair — the style used by test/unit/tab-controller.js's
// fakes (a small mutable tree + Map-backed attributes), not a real DOM.
//
// `getClientRects().length === 0` is how the module detects display:none —
// the fake exposes a settable `visible` flag per element standing in for
// that live-DOM getClientRects() result, since a fake tree has no real
// layout engine to consult. Separately, `getComputedStyle(el).visibility`
// (own or INHERITED from an ancestor — visibility inherits, unlike display)
// is how the module detects visibility:hidden: a visibility:hidden element
// still lays out and reports non-empty client rects, so `visible` alone
// can't stand in for it. The fake models this with a settable `style.
// visibility` per element plus a `parent` link (set by appendChild) that
// FakeDocument#defaultView.getComputedStyle walks up, mirroring real
// inheritance.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tabBoundary, tabSequence, isFocusable } = require('../../src/shared/tab-boundary');

class FakeElement {
  constructor(tag, attrs = {}) {
    this.tag = tag.toLowerCase();
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.parent = null;
    this.visible = true; // stands in for the live getClientRects() result
    this.style = { visibility: 'visible' };
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getClientRects() {
    return this.visible ? [{}] : [];
  }
}

// Computed `visibility`, walking up the `parent` chain — visibility inherits
// in real CSS, so a `visibility:hidden` ancestor hides a descendant even
// when the descendant's own style says nothing about it.
function computedVisibility(el) {
  let node = el;
  while (node) {
    if (node.style && node.style.visibility === 'hidden') return 'hidden';
    node = node.parent;
  }
  return 'visible';
}

// Matches the exact FOCUSABLE_SELECTOR token set the module queries —
// `a[href], area[href], button, input, select, textarea, iframe,
// [contenteditable="true"], [tabindex]` — against one fake element.
function matchesToken(el, token) {
  const tagAttrEq = token.match(/^(\w+)\[(\w+)="([^"]*)"\]$/);
  if (tagAttrEq) return el.tag === tagAttrEq[1] && el.getAttribute(tagAttrEq[2]) === tagAttrEq[3];
  const tagAttr = token.match(/^(\w+)\[(\w+)\]$/);
  if (tagAttr) return el.tag === tagAttr[1] && el.hasAttribute(tagAttr[2]);
  const attrEq = token.match(/^\[(\w+)="([^"]*)"\]$/);
  if (attrEq) return el.getAttribute(attrEq[1]) === attrEq[2];
  const attrOnly = token.match(/^\[(\w+)\]$/);
  if (attrOnly) return el.hasAttribute(attrOnly[1]);
  return el.tag === token; // bare tag name
}

class FakeDocument {
  constructor(root) {
    this.root = root;
    this.activeElement = null;
    this.defaultView = {
      getComputedStyle: (el) => ({ visibility: computedVisibility(el) })
    };
  }
  querySelectorAll(selectorList) {
    const tokens = selectorList.split(',').map((s) => s.trim());
    const all = [];
    const walk = (el) => {
      if (el !== this.root) all.push(el);
      for (const c of el.children) walk(c);
    };
    walk(this.root);
    return all.filter((el) => tokens.some((t) => matchesToken(el, t)));
  }
}

function docWith(...children) {
  const root = new FakeElement('body');
  for (const c of children) root.appendChild(c);
  return new FakeDocument(root);
}

// ---------------------------------------------------------------------------
// tabSequence / isFocusable — selection + filters
// ---------------------------------------------------------------------------

test('tabSequence collects the focusable selector set in DOM order', () => {
  const a = new FakeElement('a', { href: '/x' });
  const btn = new FakeElement('button');
  const inp = new FakeElement('input');
  const doc = docWith(a, btn, inp);
  assert.deepEqual(tabSequence(doc), [a, btn, inp]);
});

test('an <a> with no href is not tabbable', () => {
  const a = new FakeElement('a');
  assert.equal(tabSequence(docWith(a)).length, 0);
});

test('disabled is excluded', () => {
  const btn = new FakeElement('button', { disabled: '' });
  assert.equal(isFocusable(btn), false);
  assert.equal(tabSequence(docWith(btn)).length, 0);
});

test('hidden is excluded', () => {
  const inp = new FakeElement('input', { hidden: '' });
  assert.equal(isFocusable(inp), false);
});

test('tabindex="-1" is excluded even on an otherwise-focusable tag', () => {
  const btn = new FakeElement('button', { tabindex: '-1' });
  assert.equal(isFocusable(btn), false);
  const div = new FakeElement('div', { tabindex: '-1' });
  assert.equal(isFocusable(div), false, 'discovered via [tabindex], then dropped by the -1 filter');
});

test('a positive/zero tabindex on a non-natively-focusable tag is tabbable', () => {
  const div = new FakeElement('div', { tabindex: '0' });
  assert.equal(isFocusable(div), true);
  assert.deepEqual(tabSequence(docWith(div)), [div]);
});

test('display:none / visibility:hidden (getClientRects().length === 0) is excluded — including via an invisible ancestor', () => {
  const btn = new FakeElement('button');
  btn.visible = false; // stands in for a hidden ancestor collapsing this element's rects
  assert.equal(isFocusable(btn), false);
});

test('computed visibility:hidden (own style) is excluded even though getClientRects() is non-empty', () => {
  // Post-review defect fix: a visibility:hidden element still lays out its
  // box and reports non-empty client rects (it's just not painted), so the
  // getClientRects()-only check was counting it as tabbable.
  const btn = new FakeElement('button');
  btn.style.visibility = 'hidden';
  assert.equal(btn.getClientRects().length > 0, true, 'sanity: rects are non-empty despite visibility:hidden');
  const doc = docWith(btn);
  assert.equal(isFocusable(btn, doc), false);
  assert.equal(tabSequence(doc).length, 0);
});

test('a control whose ANCESTOR is visibility:hidden is excluded — visibility inherits', () => {
  const wrapper = new FakeElement('div');
  const btn = new FakeElement('button');
  wrapper.appendChild(btn);
  wrapper.style.visibility = 'hidden';
  const doc = docWith(wrapper);
  assert.equal(isFocusable(btn, doc), false);
  assert.deepEqual(tabSequence(doc), []);
});

test('contenteditable="true" is tabbable', () => {
  const div = new FakeElement('div', { contenteditable: 'true' });
  assert.equal(isFocusable(div), true);
  assert.deepEqual(tabSequence(docWith(div)), [div]);
});

test('contenteditable="false" (or any other value) is NOT matched by the selector', () => {
  const div = new FakeElement('div', { contenteditable: 'false' });
  assert.equal(tabSequence(docWith(div)).length, 0);
});

test('iframe is treated as one opaque tabbable', () => {
  const iframe = new FakeElement('iframe');
  assert.equal(isFocusable(iframe), true);
  assert.deepEqual(tabSequence(docWith(iframe)), [iframe]);
});

// ---------------------------------------------------------------------------
// tabBoundary — both directions, edge cases
// ---------------------------------------------------------------------------

test('zero tabbables: atBoundary true for BOTH directions, count 0', () => {
  const doc = docWith();
  doc.activeElement = doc.root;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: true, count: 0 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: true, count: 0 });
});

test('a single tabbable is simultaneously first and last', () => {
  const only = new FakeElement('button');
  const doc = docWith(only);
  doc.activeElement = only;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: true, count: 1 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: true, count: 1 });
});

test('active element on the FIRST of several: not a forward boundary, IS a backward boundary', () => {
  const f1 = new FakeElement('input');
  const f2 = new FakeElement('input');
  const f3 = new FakeElement('button');
  const doc = docWith(f1, f2, f3);
  doc.activeElement = f1;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: false, count: 3 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: true, count: 3 });
});

test('active element in the MIDDLE: not a boundary in either direction', () => {
  const f1 = new FakeElement('input');
  const f2 = new FakeElement('input');
  const f3 = new FakeElement('button');
  const doc = docWith(f1, f2, f3);
  doc.activeElement = f2;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: false, count: 3 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: false, count: 3 });
});

test('active element on the LAST of several: IS a forward boundary, not a backward boundary', () => {
  const f1 = new FakeElement('input');
  const f2 = new FakeElement('input');
  const f3 = new FakeElement('button');
  const doc = docWith(f1, f2, f3);
  doc.activeElement = f3;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: true, count: 3 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: false, count: 3 });
});

test('activeElement on body (not in the sequence) with tabbables present: not a boundary either way', () => {
  const f1 = new FakeElement('input');
  const doc = docWith(f1);
  doc.activeElement = doc.root; // body
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: false, count: 1 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: false, count: 1 });
});

test('a visibility:hidden control at the END of the sequence is excluded — the previous visible control is the forward boundary', () => {
  const f1 = new FakeElement('input');
  const f2 = new FakeElement('button');
  const hiddenLast = new FakeElement('button');
  hiddenLast.style.visibility = 'hidden';
  const doc = docWith(f1, f2, hiddenLast);
  assert.deepEqual(tabSequence(doc), [f1, f2]);
  doc.activeElement = f2;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: true, count: 2 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: false, count: 2 });
});

test('a visibility:hidden control at the START of the sequence is excluded — the next visible control is the backward boundary', () => {
  const hiddenFirst = new FakeElement('button');
  hiddenFirst.style.visibility = 'hidden';
  const f1 = new FakeElement('input');
  const f2 = new FakeElement('button');
  const doc = docWith(hiddenFirst, f1, f2);
  assert.deepEqual(tabSequence(doc), [f1, f2]);
  doc.activeElement = f1;
  assert.deepEqual(tabBoundary(doc, 'forward'), { atBoundary: false, count: 2 });
  assert.deepEqual(tabBoundary(doc, 'backward'), { atBoundary: true, count: 2 });
});
