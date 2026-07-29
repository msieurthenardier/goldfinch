'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/bookmarks-bar.js')).href;

// ---------------------------------------------------------------------------
// Pure-function truth tables (no DOM).
// ---------------------------------------------------------------------------

test('monogramLetter — first char uppercased, falls back to "#" for empty', async () => {
  const { monogramLetter } = await import(moduleUrl);
  assert.equal(monogramLetter('example'), 'E');
  assert.equal(monogramLetter('  lowercase'), 'L');
  assert.equal(monogramLetter(''), '#');
  assert.equal(monogramLetter(undefined), '#');
});

test('tooltipFor — "{title}\\n{url}", title falls back to the url', async () => {
  const { tooltipFor } = await import(moduleUrl);
  assert.equal(tooltipFor({ title: 'Example', url: 'https://example.com/' }), 'Example\nhttps://example.com/');
  assert.equal(tooltipFor({ url: 'https://example.com/' }), 'https://example.com/\nhttps://example.com/');
  assert.equal(tooltipFor({}), '\n');
});

test('partitionOverflow — everything fits, nothing overflows', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  assert.deepEqual(partitionOverflow([40, 40, 40], 200, 24), { visibleCount: 3, overflowing: false });
});

test('partitionOverflow — zero items never overflows (empty-state AC)', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  assert.deepEqual(partitionOverflow([], 200, 24), { visibleCount: 0, overflowing: false });
});

test('partitionOverflow — trailing items collapse, chevron footprint reserved', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // budget = 100 - 24 = 76; items 40+40=80 > 76, so only the first fits.
  assert.deepEqual(partitionOverflow([40, 40, 40], 100, 24), { visibleCount: 1, overflowing: true });
});

test('partitionOverflow — window too narrow for even one item: all collapse (Edge Case)', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  assert.deepEqual(partitionOverflow([80, 40], 50, 24), { visibleCount: 0, overflowing: true });
});

test('overflowSheetModel — snapshot-local index ids, label falls back to url', async () => {
  const { overflowSheetModel } = await import(moduleUrl);
  const model = overflowSheetModel([{ title: 'A', url: 'https://a.test/' }, { url: 'https://b.test/' }]);
  assert.deepEqual(model, [
    { id: 'bookmark:0', label: 'A' },
    { id: 'bookmark:1', label: 'https://b.test/' },
  ]);
});

test('resolveOverflowRowId — VALIDATED-NO-OP: malformed/out-of-range ids resolve null, never throw', async () => {
  const { resolveOverflowRowId } = await import(moduleUrl);
  const snapshot = [{ url: 'https://a.test/' }, { url: 'https://b.test/' }];
  assert.deepEqual(resolveOverflowRowId('bookmark:0', snapshot), { kind: 'bookmark', index: 0, bookmark: snapshot[0] });
  assert.deepEqual(resolveOverflowRowId('bookmark-edit:1', snapshot), { kind: 'bookmark-edit', index: 1, bookmark: snapshot[1] });
  assert.equal(resolveOverflowRowId('bookmark:2', snapshot), null); // out of bounds
  assert.equal(resolveOverflowRowId('bookmark:-1', snapshot), null);
  assert.equal(resolveOverflowRowId('sug:0', snapshot), null); // foreign id family
  assert.equal(resolveOverflowRowId(undefined, snapshot), null);
  assert.equal(resolveOverflowRowId('bookmark:x', snapshot), null);
});

// ---------------------------------------------------------------------------
// DOM-level render/overflow/dispatch (fake DOM harness, the tab-controller.js
// precedent — dynamic import + hand-rolled fakes, no real browser).
// ---------------------------------------------------------------------------

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((n) => this.values.add(n)); }
  remove(...names) { names.forEach((n) => this.values.delete(n)); }
  contains(n) { return this.values.has(n); }
  toggle(n, force) {
    const next = force === undefined ? !this.values.has(n) : !!force;
    if (next) this.values.add(n); else this.values.delete(n);
    return next;
  }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this._width = 0;
    this._height = 0;
    this.title = '';
    this.textContent = '';
  }
  set className(value) { value.split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n)); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  appendChild(el) { el.parent = this; this.children.push(el); return el; }
  insertBefore(el, ref) {
    el.parent = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this.children.push(el); else this.children.splice(idx, 0, el);
    return el;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  getBoundingClientRect() { return { width: this.classList.contains('hidden') ? 0 : this._width, height: this._height }; }
  fire(name, evt = {}) { const fn = this.listeners.get(name); if (fn) fn({ preventDefault() {}, ...evt }); }
}

class FakeDocument {
  createElement(tag) { return new FakeElement(tag); }
}

class FakeResizeObserver {
  constructor(cb) { this.cb = cb; FakeResizeObserver.instances.push(this); }
  observe(el) { this.target = el; }
}
FakeResizeObserver.instances = [];

function harness({ list = [] } = {}) {
  FakeResizeObserver.instances = [];
  const document = new FakeDocument();
  const bookmarksBar = new FakeElement('div');
  bookmarksBar._width = 1000; // roomy by default — tests narrow it explicitly
  const bookmarksOverflow = new FakeElement('button');
  bookmarksBar.appendChild(bookmarksOverflow); // the one fixed child, like the real markup
  const els = { bookmarksBar, bookmarksOverflow };

  const calls = [];
  const bookmarksClient = { list };
  const overlayMenuState = { open: false };
  const overlayMenuClient = {
    open: (...args) => calls.push(['open', ...args]),
    close: (reason) => calls.push(['close', reason]),
    trigger: (menuType, openFn) => { calls.push(['trigger', menuType]); openFn(); },
  };

  const deps = {
    document, ResizeObserver: FakeResizeObserver, els,
    bookmarksClient,
    navigate: (url) => calls.push(['navigate', url]),
    createTab: (...args) => calls.push(['createTab', ...args]),
    openBookmarkEditOverlay: (bookmark, anchorEl) => calls.push(['edit', bookmark, anchorEl === bookmarksOverflow ? 'chevron' : 'item']),
    overlayMenuClient,
    overlayMenuState,
    leftAnchorOf: (el) => ({ alignLeft: 0, from: el === bookmarksOverflow ? 'chevron' : 'other' }),
  };

  return { els, calls, bookmarksClient, overlayMenuState, deps };
}

async function create(h) {
  const { createBookmarksBar } = await import(moduleUrl);
  return createBookmarksBar(h.deps);
}

test('render() builds one button per bookmark, ahead of the chevron, in list order', async () => {
  const h = harness({ list: [
    { id: 'b1', title: 'Alpha', url: 'https://alpha.test/', icon: null },
    { id: 'b2', title: 'Beta', url: 'https://beta.test/', icon: 'data:image/png;base64,AAAA' },
  ] });
  h.els.bookmarksBar._width = 1000; // roomy — default 0-width fake items trivially fit
  const bar = await create(h);
  bar.render();

  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(items.length, 2);
  assert.equal(h.els.bookmarksBar.children.at(-1), h.els.bookmarksOverflow, 'chevron stays the last child');
  assert.equal(items[0].title, 'Alpha\nhttps://alpha.test/');
  assert.equal(items[1].title, 'Beta\nhttps://beta.test/');
  // Icon vs monogram fallback.
  assert.equal(items[0].children.some((c) => c.tag === 'img'), false);
  assert.equal(items[1].children.some((c) => c.tag === 'img'), true);
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), true, 'everything fits — chevron stays hidden');
});

test('render() with zero bookmarks: no items, chevron stays hidden (Edge Case)', async () => {
  const h = harness({ list: [] });
  const bar = await create(h);
  bar.render();
  assert.equal(h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item')).length, 0);
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), true);
});

test('overflow: trailing items collapse behind the chevron when the bar narrows', async () => {
  const h = harness({ list: [
    { id: 'b1', title: 'One', url: 'https://one.test/' },
    { id: 'b2', title: 'Two', url: 'https://two.test/' },
    { id: 'b3', title: 'Three', url: 'https://three.test/' },
  ] });
  h.els.bookmarksBar._width = 1000; // roomy at first — render() fits everything
  const bar = await create(h);
  bar.render();
  for (const el of h.els.bookmarksBar.children) if (el.classList.contains('bm-item')) el._width = 40;
  // Simulate the window narrowing: the bar's OWN measured size must change for
  // the ResizeObserver callback to re-partition (the re-entrancy guard skips
  // an unchanged size — design-review-adopted, defends against loop-limit
  // warnings). budget = 100 - 24(chevron) = 76; 40+40=80 > 76, so only one fits.
  h.els.bookmarksBar._width = 100;
  FakeResizeObserver.instances[0].cb();

  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(items[0].classList.contains('hidden'), false);
  assert.equal(items[1].classList.contains('hidden'), true);
  assert.equal(items[2].classList.contains('hidden'), true);
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), false, 'chevron appears once anything overflows');
});

test('chevron click opens the overflow sheet with the overflowed-items snapshot; row dispatch navigates', async () => {
  const h = harness({ list: [
    { id: 'b1', title: 'One', url: 'https://one.test/' },
    { id: 'b2', title: 'Two', url: 'https://two.test/' },
  ] });
  h.els.bookmarksBar._width = 1000;
  const bar = await create(h);
  bar.render();
  for (const el of h.els.bookmarksBar.children) if (el.classList.contains('bm-item')) el._width = 60;
  h.els.bookmarksBar._width = 100; // total 120 > 100 (overflows); budget = 100-24(chevron) = 76; 60 fits, 60+60 doesn't
  FakeResizeObserver.instances[0].cb(); // only "One" fits; "Two" overflows

  h.els.bookmarksOverflow.fire('click');
  const openCall = h.calls.find((c) => c[0] === 'open');
  assert.ok(openCall, 'chevron click opens the sheet');
  assert.equal(openCall[1], 'bookmarks-overflow');
  assert.deepEqual(openCall[2], [{ id: 'bookmark:0', label: 'Two' }]);

  bar.dispatch('bookmark:0');
  assert.deepEqual(h.calls.at(-1), ['navigate', 'https://two.test/']);

  bar.dispatch('bookmark-edit:0');
  assert.deepEqual(h.calls.at(-1), ['edit', h.bookmarksClient.list[1], 'chevron']);

  // Out-of-range / malformed ids are validated no-ops.
  const before = h.calls.length;
  bar.dispatch('bookmark:99');
  bar.dispatch('not-an-id');
  assert.equal(h.calls.length, before);
});

test('DD9 cache freshness: closeOverflowIfOpen only closes when the sheet state reports open', async () => {
  const h = harness({ list: [] });
  const bar = await create(h);
  bar.closeOverflowIfOpen();
  assert.equal(h.calls.length, 0, 'no-op while closed');

  h.overlayMenuState.open = true;
  bar.closeOverflowIfOpen();
  assert.deepEqual(h.calls.at(-1), ['close', 'superseded']);
});

test('item click: plain click navigates; Ctrl/Cmd+click and middle-click open a BACKGROUND tab via the three-arg createTab form', async () => {
  const h = harness({ list: [{ id: 'b1', title: 'One', url: 'https://one.test/' }] });
  const bar = await create(h);
  bar.render();
  const item = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-item'));

  item.fire('click', { ctrlKey: false, metaKey: false });
  assert.deepEqual(h.calls.at(-1), ['navigate', 'https://one.test/']);

  item.fire('click', { ctrlKey: true });
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', null, { background: true }]);

  item.fire('auxclick', { button: 1 });
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', null, { background: true }]);

  item.fire('auxclick', { button: 2 }); // not middle — must NOT open
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', null, { background: true }]);

  item.fire('contextmenu');
  assert.deepEqual(h.calls.at(-1), ['edit', h.bookmarksClient.list[0], 'item']);
});
