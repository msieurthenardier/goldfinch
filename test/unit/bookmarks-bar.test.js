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

// The 4th argument is the bar's flex gap (M15 F2 Leg 4). These cases were
// written pre-gap and so read as gap-0; they now pass the REAL 2px gap
// explicitly. Their expectations are unchanged because each one is
// gap-invariant at these numbers — they had slack, which is exactly why the
// original defect survived them (see the regression case at the end).
test('partitionOverflow — everything fits, nothing overflows', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // 120 of items + 2 gaps (4) = 124 <= 200.
  assert.deepEqual(partitionOverflow([40, 40, 40], 200, 24, 2), { visibleCount: 3, overflowing: false });
});

test('partitionOverflow — zero items never overflows (empty-state AC)', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  assert.deepEqual(partitionOverflow([], 200, 24, 2), { visibleCount: 0, overflowing: false });
});

test('partitionOverflow — trailing items collapse, chevron footprint reserved', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // One item costs 40 + the gap before the chevron (2) + the chevron (24) = 66
  // <= 100. Two cost 40+2+40 + 2 + 24 = 108 > 100, so only the first fits.
  assert.deepEqual(partitionOverflow([40, 40, 40], 100, 24, 2), { visibleCount: 1, overflowing: true });
});

test('partitionOverflow — window too narrow for even one item: all collapse (Edge Case)', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // 80 + 2 + 24 = 106 > 50 — nothing is admitted; the chevron alone remains.
  assert.deepEqual(partitionOverflow([80, 40], 50, 24, 2), { visibleCount: 0, overflowing: true });
});

test('partitionOverflow — gap defaults to the bar\'s own 2px when omitted', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // Pins the default: 3×33 = 99 fits a 100 run only with gaps ignored;
  // with the real gaps (99 + 4 = 103) it does not.
  assert.deepEqual(partitionOverflow([33, 33, 33], 100), { visibleCount: 2, overflowing: true });
});

test('partitionOverflow — REGRESSION (M15 F2 Leg 4): the no-overflow branch prices gaps too', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // Items sum to EXACTLY the available run, so the old gap-free test
  // (`total <= availableWidth` → 100 <= 100) declared "all four fit" and the
  // trailing item was laid out past the `overflow: hidden` edge. With gaps
  // priced, the set genuinely overflows and only what really fits stays.
  assert.deepEqual(partitionOverflow([25, 25, 25, 25], 100, 24, 2), { visibleCount: 2, overflowing: true });
  // 1: 25 +2+24 = 51 ✓ | 2: 25+2+25 = 52, +2+24 = 78 ✓ | 3: 79, +2+24 = 105 ✗.
});

test('partitionOverflow — REGRESSION (M15 F2 Leg 4): the chevron\'s footprint stays inside the bar on a full row', async () => {
  const { partitionOverflow } = await import(moduleUrl);
  // The shipped defect at its observed scale: a 1398px bar (content run 1386
  // after 2×6px padding) on a full row. The OLD math summed raw item widths
  // against a `availableWidth - chevron` budget and never paid for the 2px
  // between children, so it admitted one item too many and laid the chevron
  // out past the bar's content edge, where `overflow: hidden` ate it — DOM
  // present, Tab-focusable, nothing rendered.
  const widths = Array.from({ length: 14 }, () => 136);
  const available = 1398 - 12;
  const { visibleCount, overflowing } = partitionOverflow(widths, available, 24, 2);
  assert.equal(overflowing, true);
  // Old budget 1386-24 = 1362 admitted 10 (10×136 = 1360 <= 1362); their real
  // footprint is 1360 + 10 gaps + 24 = 1404 > 1386 — the chevron overhangs by
  // 18px. Paying for gaps admits 9 (1224 + 18 + 24 = 1266).
  assert.equal(visibleCount, 9, 'the gap-blind budget admitted 10 — the 10th pushed the chevron out');

  // The invariant the defect broke, asserted directly rather than by number:
  // the row's REAL laid-out width — items, the gaps between them, the gap
  // before the chevron, and the chevron — must fit the available run.
  const laidOut = widths.slice(0, visibleCount).reduce((a, b) => a + b, 0)
    + 2 * visibleCount // (visibleCount - 1) inter-item gaps + 1 before the chevron
    + 24;
  assert.ok(laidOut <= available, `chevron would be clipped: ${laidOut} > ${available}`);
  // …and it is a TIGHT fit — admitting one more item would have clipped it.
  assert.ok(laidOut + 2 + widths[visibleCount] > available, 'partition is not maximal');
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
    // M15 F3 Leg 3: geometry gained an x/y origin. The drag's slot assembly and
    // drop classification read `left`/`top`/`right`/`bottom`; every pre-drag
    // test read only `width`, so the extra fields are additive.
    this._left = 0;
    this._top = 0;
    this.title = '';
    this.textContent = '';
    this.style = {};
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
  getBoundingClientRect() {
    // display:none reads as a ZERO-WIDTH rect AT LEFT 0 — the exact browser
    // behaviour the drag's hidden-item filtering exists for (DD3), reproduced
    // here rather than assumed.
    const hidden = this.classList.contains('hidden');
    const left = hidden ? 0 : this._left;
    const width = hidden ? 0 : this._width;
    return { left, width, top: this._top, height: this._height, right: left + width, bottom: this._top + this._height };
  }
  fire(name, evt = {}) { const fn = this.listeners.get(name); if (fn) fn({ preventDefault() {}, ...evt }); }
}

class FakeDocument {
  constructor() { this.listeners = new Map(); }
  createElement(tag) { return new FakeElement(tag); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  fire(name, evt = {}) { const fn = this.listeners.get(name); if (fn) fn({ preventDefault() {}, ...evt }); }
}

/** A minimal `dataTransfer` that records what dragstart wrote and answers
 * `types` from it — enough to assert the DD2 three-type payload and to gate the
 * document-level handlers the way a real one does. */
function fakeDataTransfer(seed = {}) {
  const data = { ...seed };
  return {
    data,
    effectAllowed: null,
    dropEffect: null,
    setData(type, value) { data[type] = value; },
    getData(type) { return data[type] || ''; },
    get types() { return Object.keys(data); },
  };
}

const BOOKMARK_MIME = 'application/x-goldfinch-bookmark';

class FakeResizeObserver {
  constructor(cb) { this.cb = cb; FakeResizeObserver.instances.push(this); }
  observe(el) { this.target = el; }
}
FakeResizeObserver.instances = [];

// M15 F2 Leg 3: bookmarksClient is now jar-scoped (`listFor(jarId)`). These
// bar-level tests aren't exercising the CACHE's jar-scoping (that's
// bookmarks-client.test.js's job) — the fixture's `listFor` ignores jarId and
// always serves the one seeded `list`, so every pre-existing single-jar
// assertion stays valid; tests that care which jarId the bar passed through
// (render/contextmenu/open-in-new-tab) assert on it explicitly.
function harness({ list = [] } = {}) {
  FakeResizeObserver.instances = [];
  const document = new FakeDocument();
  const bookmarksBar = new FakeElement('div');
  bookmarksBar._width = 1000; // roomy by default — tests narrow it explicitly
  const bookmarksOverflow = new FakeElement('button');
  bookmarksBar.appendChild(bookmarksOverflow); // the one fixed child, like the real markup
  const els = { bookmarksBar, bookmarksOverflow };

  const calls = [];
  // M15 F3 Leg 5a: `list` is a LET so a test can swap the cache's answer mid-drag
  // (the temporally-unsafe-derivation case AC4 exists to prevent).
  let live = list;
  const bookmarksClient = {
    listFor: () => live,
    // M15 F3 Leg 3: the drag commit lives in bookmarks-client.js (DD12's budget
    // discipline); the bar only calls it. Recorded, never executed here —
    // bookmarks-client.test.js owns the DD6b fresh-read behaviour.
    commitReorder: (...args) => { calls.push(['commitReorder', ...args]); return Promise.resolve(true); },
    // M15 F3 Leg 5a: the bar → overflow commit. Recorded, never executed —
    // bookmarks-client.test.js owns the ruled index formula's literal-order pins.
    commitOverflowDrop: (...args) => { calls.push(['commitOverflowDrop', ...args]); return Promise.resolve(true); },
  };
  const overlayMenuState = { open: false };
  const overlayMenuClient = {
    open: (...args) => calls.push(['open', ...args]),
    close: (reason) => calls.push(['close', reason]),
    trigger: (menuType, openFn) => { calls.push(['trigger', menuType]); openFn(); },
  };
  const activeContainer = { id: 'active-jar' };
  const clock = { t: 0 };

  const deps = {
    document, ResizeObserver: FakeResizeObserver, els,
    bookmarksClient,
    navigate: (url) => calls.push(['navigate', url]),
    createTab: (...args) => calls.push(['createTab', ...args]),
    openBookmarkEditOverlay: (bookmark, anchorEl, jarId) => calls.push(['edit', bookmark, anchorEl === bookmarksOverflow ? 'chevron' : 'item', jarId]),
    activeContainer: () => activeContainer,
    overlayMenuClient,
    overlayMenuState,
    rightAnchorOf: (el) => ({ alignRight: 0, from: el === bookmarksOverflow ? 'chevron' : 'other' }),
    // M15 F3 Leg 4 (drag onto page): the per-wcId navigation form (`navigate` is
    // active-tab-only and so cannot serve AC9) plus the bare bookend sends.
    tabNavigate: (payload) => calls.push(['tabNavigate', payload]),
    bookmarkDragStarted: (...args) => calls.push(['bookmarkDragStarted', ...args]),
    bookmarkDragEnded: (...args) => calls.push(['bookmarkDragEnded', ...args]),
    // M15 F3 Leg 5a: the spring-load dwell's injected clock — advanced explicitly
    // by `clock.t`, so the dwell is pinned by arithmetic rather than by a sleep.
    now: () => clock.t,
  };

  return {
    els, calls, bookmarksClient, overlayMenuState, activeContainer, list, deps, clock,
    /** Swap what the cache answers, WITHOUT re-rendering — the mid-drag
     * broadcast-updated-cache case (`render()` is suppressed by dragActive). */
    setLive(next) { live = next; },
  };
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
  bar.render('jar-a'); // M15 F2 Leg 3: render() takes the jarId to render for

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
  // warnings). The 100px bar is a 88px content run (2×6px padding); one 40px
  // item plus the 2px gap and the 24px chevron is 66 ✓, two is 108 ✗.
  h.els.bookmarksBar._width = 100;
  FakeResizeObserver.instances[0].cb();

  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(items[0].classList.contains('hidden'), false);
  assert.equal(items[1].classList.contains('hidden'), true);
  assert.equal(items[2].classList.contains('hidden'), true);
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), false, 'chevron appears once anything overflows');
});

test('overflow REGRESSION (M15 F2 Leg 4): the bar\'s own horizontal padding is excluded from the budget', async () => {
  const h = harness({ list: [
    { id: 'b1', title: 'One', url: 'https://one.test/' },
    { id: 'b2', title: 'Two', url: 'https://two.test/' },
    { id: 'b3', title: 'Three', url: 'https://three.test/' },
  ] });
  h.els.bookmarksBar._width = 1000;
  const bar = await create(h);
  bar.render();
  for (const el of h.els.bookmarksBar.children) if (el.classList.contains('bm-item')) el._width = 40;
  // getBoundingClientRect() reports the BORDER box. Three 40px items plus their
  // two 2px gaps lay out to 124 — which fits a 130px measured box but NOT the
  // 118px content run left after #bookmarks-bar's 2×6px padding. The old
  // caller passed the border-box width straight through, so this row read as
  // "everything fits", the chevron stayed hidden, and the third item was
  // clipped by `overflow: hidden` with no way to reach it.
  h.els.bookmarksBar._width = 130;
  FakeResizeObserver.instances[0].cb();

  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(items[0].classList.contains('hidden'), false);
  assert.equal(items[1].classList.contains('hidden'), false); // 82 + 2 + 24 = 108 <= 118
  assert.equal(items[2].classList.contains('hidden'), true, 'the third item does not fit the content run');
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), false, 'chevron must be shown, not clipped');
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
  h.els.bookmarksBar._width = 100; // 88px content run; 60+2+24 = 86 fits, a second 60 doesn't
  FakeResizeObserver.instances[0].cb(); // only "One" fits; "Two" overflows

  h.els.bookmarksOverflow.fire('click');
  const openCall = h.calls.find((c) => c[0] === 'open');
  assert.ok(openCall, 'chevron click opens the sheet');
  assert.equal(openCall[1], 'bookmarks-overflow');
  assert.deepEqual(openCall[2], [{ id: 'bookmark:0', label: 'Two' }]);
  // HAT fix regression pin (Leg 5): the far-right chevron must anchor via
  // rightAnchorOf (kebab idiom — right edge pinned, grows leftward), never
  // leftAnchorOf (which bled the sheet past the viewport's right edge).
  assert.deepEqual(openCall[3], { alignRight: 0, from: 'chevron' });

  bar.dispatch('bookmark:0');
  assert.deepEqual(h.calls.at(-1), ['navigate', 'https://two.test/']);

  bar.dispatch('bookmark-edit:0');
  // M15 F2 Leg 3, L3-DD-E: the popover's captured jar is the BAR'S OWN
  // rendered jar — null here since this test's render() call never passed
  // one (defaults to the un-set `currentJarId`); the render() test above
  // pins the real pass-through value.
  assert.deepEqual(h.calls.at(-1), ['edit', h.list[1], 'chevron', null]);

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

test('item click: plain click navigates; Ctrl/Cmd+click and middle-click open a BACKGROUND tab via the three-arg createTab form, IN THE ACTIVE TAB\'S CONTAINER', async () => {
  const h = harness({ list: [{ id: 'b1', title: 'One', url: 'https://one.test/' }] });
  const bar = await create(h);
  bar.render('jar-a');
  const item = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-item'));

  item.fire('click', { ctrlKey: false, metaKey: false });
  assert.deepEqual(h.calls.at(-1), ['navigate', 'https://one.test/']);

  // M15 F2 Leg 3 DD7b: the container is `activeContainer()` — NEVER `null`
  // (which would resolve the current default jar / a fresh burner instead
  // of the bookmark's own jar).
  item.fire('click', { ctrlKey: true });
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', h.activeContainer, { background: true }]);

  item.fire('auxclick', { button: 1 });
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', h.activeContainer, { background: true }]);

  item.fire('auxclick', { button: 2 }); // not middle — must NOT open
  assert.deepEqual(h.calls.at(-1), ['createTab', 'https://one.test/', h.activeContainer, { background: true }]);

  item.fire('contextmenu');
  // L3-DD-E: the popover's captured jar is the bar's OWN rendered jar ('jar-a').
  assert.deepEqual(h.calls.at(-1), ['edit', h.list[0], 'item', 'jar-a']);
});

// ---------------------------------------------------------------------------
// Drag reorder (M15 F3 "Drag Interactions" Leg 3 — DD2/DD3/DD6b, AC3-AC9).
//
// Every layout number below is asserted by the author, not derived by a layout
// engine: there is no jsdom harness in this repo, so the fake reports exactly
// the geometry each test states. The RENDERED half (does the indicator look
// right, does the gesture feel right) is operator-verified at HAT.
// ---------------------------------------------------------------------------

/** A three-item bar at viewport y 100..130, items 100px wide at x 0/100/200. */
async function dragHarness({ overflowTail = 0 } = {}) {
  const list = [
    { id: 'b1', title: 'One', url: 'https://one.test/' },
    { id: 'b2', title: 'Two', url: 'https://two.test/' },
    { id: 'b3', title: 'Three', url: 'https://three.test/' },
  ];
  for (let i = 0; i < overflowTail; i++) {
    list.push({ id: `x${i}`, title: `Extra ${i}`, url: `https://extra${i}.test/` });
  }
  const h = harness({ list });
  h.els.bookmarksBar._width = 400;
  h.els.bookmarksBar._left = 0;
  h.els.bookmarksBar._top = 100;
  h.els.bookmarksBar._height = 30; // -> bottom 130, right 400
  const bar = await create(h);
  bar.render('jar-a');
  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  items.forEach((el, i) => { el._width = 100; el._left = i * 100; el._top = 100; el._height = 24; });
  // The overflow tail is display:none — the fake reports it zero-width at
  // left 0, exactly as a browser does.
  for (let i = 0; i < overflowTail; i++) items[3 + i].classList.add('hidden');
  return { h, bar, items, list };
}

/** Fire a full dragstart on `item` and return the dataTransfer it wrote. */
function startDrag(item, dt = fakeDataTransfer()) {
  item.fire('dragstart', { dataTransfer: dt, clientX: 50, clientY: 115 });
  return dt;
}

test('AC3: bar items are draggable and dragstart writes the DD2 three-type payload', async () => {
  const { h, items } = await dragHarness();
  assert.equal(items[0].draggable, true, 'this is the codebase\'s FIRST draggable <button> — buttons are not draggable by default');
  assert.ok(items.every((el) => el.draggable === true));

  const dt = startDrag(items[0]);
  assert.equal(dt.getData(BOOKMARK_MIME), 'b1', 'the custom type carries the bookmark ID — the chrome\'s dispatch key');
  assert.equal(dt.getData('text/uri-list'), 'https://one.test/');
  assert.equal(dt.getData('text/plain'), 'https://one.test/');
  assert.equal(dt.effectAllowed, 'move');
  assert.deepEqual(dt.types.sort(), [BOOKMARK_MIME, 'text/plain', 'text/uri-list'].sort());
  // The session ARMED — asserted directly, because a source that never arms is
  // indistinguishable downstream from "nothing happened" (the ambiguity that
  // produced this flight's withdrawn axis-(b) verdict).
  h.els.bookmarksBar.getBoundingClientRect();
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 250, clientY: 115 });
  assert.equal(dt.dropEffect, 'move', 'the session is live: dragover ran its body');
});

test('AC3: dragstart REFUSES rather than arming a session it could never commit', async () => {
  const { h, items } = await dragHarness();
  let prevented = false;
  items[0].fire('dragstart', { dataTransfer: null, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'no dataTransfer — refuse');
  // …and with no session armed, a drop is inert.
  h.deps.document.fire('drop', { dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: 'b1' }), clientX: 250, clientY: 115 });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('dragover: dropEffect is MANDATORY, and a foreign drag is ignored entirely', async () => {
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 150, clientY: 115 });
  assert.equal(dt.dropEffect, 'move', 'without dropEffect the drop is SILENTLY rejected (tab-controller.js "spike probe3")');

  // A drag carrying neither of our types must not be preventDefaulted or
  // previewed — otherwise every file/link drag on the chrome gets swallowed.
  const foreign = fakeDataTransfer({ 'text/html': '<b>x</b>' });
  let prevented = false;
  h.deps.document.fire('dragover', { dataTransfer: foreign, clientX: 150, clientY: 115, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(foreign.dropEffect, null);
});

test('AC5: the insertion indicator tracks the drop position, is NOT a flex item, and never enters the item set', async () => {
  const { h, items } = await dragHarness();
  const indicator = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-drop-indicator'));
  assert.ok(indicator, 'the indicator exists');
  assert.equal(indicator.classList.contains('hidden'), true, 'hidden until a drag');
  assert.equal(h.els.bookmarksBar.children.at(-1), h.els.bookmarksOverflow, 'the chevron is still the bar\'s LAST child');
  assert.equal(items.includes(indicator), false, 'itemEls() never sees it — the partition math is unaffected');

  const dt = startDrag(items[0]);
  // Dragging item 0; the remaining run is items 1 and 2. A pointer at 150 is
  // past item 1's midpoint (150 is NOT strictly greater than 150 — ties resolve
  // "before"), so the drop index is 0 -> the indicator sits at item 1's left
  // edge, x=100, and the bar's own left edge is 0.
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 150, clientY: 115 });
  assert.equal(indicator.classList.contains('hidden'), false);
  assert.equal(indicator.style.left, '100px');

  // Past item 2's midpoint (250) -> drop index 2 -> past the end of the
  // remaining run -> item 2's right edge, x=300.
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 260, clientY: 115 });
  assert.equal(indicator.style.left, '300px');

  // Out of the bar (below it, over the page): retracted, not parked.
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 260, clientY: 400 });
  assert.equal(indicator.classList.contains('hidden'), true);
});

test('AC4/AC8: a drop inside the bar commits ONE reorder, against the jar captured at dragstart', async () => {
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 260, clientY: 115 });
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });

  const commits = h.calls.filter((c) => c[0] === 'commitReorder');
  assert.equal(commits.length, 1);
  // (jarId captured at dragstart, bookmark id from the SNAPSHOT, drop index).
  assert.deepEqual(commits[0], ['commitReorder', 'jar-a', 'b1', 2]);
});

test('AC8: `dropHandled` is set synchronously — dragend after a drop cannot double-commit', async () => {
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });
  items[0].fire('dragend');
  // dragend clears the session, so a stray later drop finds nothing to act on.
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });
  assert.equal(h.calls.filter((c) => c[0] === 'commitReorder').length, 1, 'exactly one commit per release');
});

test('AC8: Escape mid-drag folds into dragend with NO drop — no commit, order unchanged', async () => {
  const { h, items } = await dragHarness();
  const before = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item')).map((el) => el.title);
  const dt = startDrag(items[0]);
  h.deps.document.fire('dragover', { dataTransfer: dt, clientX: 260, clientY: 115 });
  items[0].fire('dragend'); // the browser aborts an Escape-cancelled drag straight into dragend
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
  const after = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item')).map((el) => el.title);
  assert.deepEqual(after, before);
  const indicator = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-drop-indicator'));
  assert.equal(indicator.classList.contains('hidden'), true, 'the indicator is removed on every ending');
});

test('a drop OUTSIDE the bar issues no reorder (drag-onto-page owns that zone, Edge Case)', async () => {
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 500 }); // over the guest region
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('AC2 integration: an OVERFLOWED tail never inflates the drop index', async () => {
  // Three visible items plus two display:none ones. A careless implementation
  // feeds all five rects in; the two hidden ones read zero-width AT LEFT 0 and
  // add exactly 2 to every index past the bar's left edge.
  const { h, items } = await dragHarness({ overflowTail: 2 });
  assert.equal(items.length, 5);
  const dt = startDrag(items[0]);
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });
  const commit = h.calls.find((c) => c[0] === 'commitReorder');
  assert.deepEqual(commit, ['commitReorder', 'jar-a', 'b1', 2], 'index 2, not 4 — the hidden tail is filtered out');
});

test('AC7: BOTH rebuild paths are suppressed mid-session, with a SINGLE flush on dragend', async () => {
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  const source = items[0];

  // (1) A same-jar `bookmarks-changed` re-query -> the onChanged closure calls
  // render(). Reachable with NO tab switch at all (another window's edit).
  bar.render('jar-a');
  const during = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(during[0], source, 'render() must NOT have clearItems()-ed the live drag source');
  assert.equal(during.length, 3);

  // (2) The ResizeObserver re-partition — the path that gets missed. It
  // rebuilds nothing but re-hides items, moving the geometry under the session.
  h.els.bookmarksBar._width = 100;
  FakeResizeObserver.instances[0].cb();
  assert.equal(during.every((el) => !el.classList.contains('hidden')), true, 're-partition suppressed too');

  // The flush: exactly one rebuild, and it reconciles the suppressed resize.
  h.els.bookmarksBar._width = 400;
  source.fire('dragend');
  const after = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(after.length, 3);
  assert.notEqual(after[0], source, 'dragend flushed one real rebuild');
});

test('AC7 + DD13: a jar switch mid-drag is recorded but not painted; the commit uses the CAPTURED jar', async () => {
  const { h, bar, items } = await dragHarness();
  const source = items[0];
  const dt = startDrag(source); // captured jar: 'jar-a'

  // A tab switch mid-drag routes through refreshBookmarksSurfaces -> render().
  bar.render('jar-b');
  const during = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(during[0], source, 'suppressed — the live drag source survives');

  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b1', 2],
    'the jar is captured at dragstart (the DD13 TOCTOU discipline), never resolved at drop time');

  // …and the dragend flush paints the CURRENT jar, not the captured one.
  source.fire('dragend');
  const fresh = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'))[0];
  assert.notEqual(fresh, source);
  fresh.fire('contextmenu');
  assert.deepEqual(h.calls.at(-1), ['edit', h.list[0], 'item', 'jar-b']);
});

test('AC9: NO click-suppression flag — the bar item\'s click handler stays unconditional', async () => {
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 });
  items[0].fire('dragend');
  // Native DnD fires no trailing click, so this can only be a real click — and
  // it must navigate. A suppression flag (which this codebase deliberately
  // removed once already, per CLAUDE.md's tab-activation invariant) would eat it.
  h.calls.length = 0;
  items[0].fire('click', { ctrlKey: false, metaKey: false });
  assert.deepEqual(h.calls.at(-1), ['navigate', 'https://one.test/']);
});

test('AC9: the source carries no drag-suppression flag reachable from the click path', () => {
  const fs = require('node:fs');
  const { maskComments } = require('../helpers/source-scan.js');
  const code = maskComments(fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/bookmarks-bar.js'), 'utf8'));
  assert.equal(/suppressClick|clickSuppress|justDragged|wasDragged|ignoreNextClick/.test(code), false,
    'AC9: native DnD fires no trailing click — a suppression flag here is dead code that reads as load-bearing');
  // The click handler's body must not consult the drag session at all.
  const clickBody = /addEventListener\('click',[\s\S]*?\n {4}\}\);/.exec(code);
  assert.ok(clickBody, 'the click handler is still there');
  assert.equal(/dnd|dragActive|dropHandled/.test(clickBody[0]), false, 'the click handler is unconditional');
});

test('AC11: on a suppressed (burner/internal) tab the STALE items remain in the DOM — the bar\'s own .hidden is what makes no drag source reachable', async () => {
  const { h, items } = await dragHarness();
  // refreshBookmarksSurfaces SKIPS render() when suppressed, so the previous
  // jar's .bm-item children are still here. A test asserting "no .bm-item
  // exists on a burner tab" would be asserting something false.
  h.els.bookmarksBar.classList.add('hidden'); // what window-controller.js's applyBarVisibility does
  const still = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.equal(still.length, 3, 'items are NOT cleared — the operative claim is the bar\'s .hidden, not their absence');
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.ok(items.every((el) => el.draggable === true), 'they are still draggable elements — just inside a display:none row');
  // No extra guard was added for this: no new inertness branch exists in the bar.
  const fs = require('node:fs');
  const { maskComments } = require('../helpers/source-scan.js');
  const code = maskComments(fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/bookmarks-bar.js'), 'utf8'));
  assert.equal(/burner|isInternal/.test(code), false,
    'AC11: no new suppression guard belongs here — window-controller.js already hides the whole row');
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 4 (`drag-onto-page`) — the chrome half: declare at dragstart, HOLD
// the resolved url past dragend, navigate the tab main names (DD5/DD6;
// AC5/AC6/AC6b/AC7/AC8/AC9/AC10).
// ---------------------------------------------------------------------------

const navCalls = (h) => h.calls.filter((c) => c[0] === 'tabNavigate');

test('AC7 (the PRIMARY path): dragend fires BEFORE the drop signal and the navigation still happens', async (t) => {
  // ⚠ This ordering is the DEFAULT, not a rare race. The drop is in the GUEST
  // process while dragend fires in the chrome essentially at release, and the
  // signal has to cross a setTimeout(…,0) macrotask plus guest→main→chrome —
  // two processes, two IPC pipes, no ordering guarantee. dragend wins on
  // virtually every drop, so the holder is load-bearing on the happy path.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');            // …the chrome tears its session down first
  bar.handleDropSignal({ targetWcId: 77 }); // …and only then does the signal land

  assert.deepEqual(navCalls(h), [['tabNavigate', { wcId: 77, verb: 'loadURL', args: ['https://one.test/'] }]],
    'without the holder this resolves to nothing — INTERMITTENTLY, the worst available failure shape');
});

test('AC7: the hold is BOUNDED — a signal arriving after the window navigates nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');
  t.mock.timers.tick(1999);
  t.mock.timers.tick(2); // past DRAG_HOLD_MS
  bar.handleDropSignal({ targetWcId: 77 });
  assert.deepEqual(navCalls(h), []);
});

test('AC9: the navigation targets the wcId MAIN named — the guest that received the drop, not the active tab', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[1]);
  bar.handleDropSignal({ targetWcId: 404 }); // a background tab's guest
  assert.deepEqual(navCalls(h), [['tabNavigate', { wcId: 404, verb: 'loadURL', args: ['https://two.test/'] }]]);
  // …and it rides the per-wcId form of the untrusted path, never the
  // active-tab-only `navigate` dep (which is what contradicted AC9).
  assert.equal(h.calls.some((c) => c[0] === 'navigate'), false);
});

test('AC5/DD6: the url comes from the chrome\'s OWN session — nothing in the signal payload can aim it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  // A payload carrying a url is the shape DD6 exists to make impossible. Even
  // if one appeared on this wire, it is not read: the navigation resolves to
  // the bookmark the operator actually dragged.
  bar.handleDropSignal({ targetWcId: 5, url: 'https://evil.test/', id: 'b3' });
  assert.deepEqual(navCalls(h)[0][1].args, ['https://one.test/']);
});

test('AC6: a signal with no drag in flight navigates nothing (the fabricated-DragEvent case, chrome half)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar } = await dragHarness();
  bar.handleDropSignal({ targetWcId: 77 });
  assert.deepEqual(navCalls(h), [], 'no live drag → no held url → nothing to navigate to');
});

test('AC6b (chrome half): the hold is CONSUMED on the first navigation — one navigation per drag', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');
  bar.handleDropSignal({ targetWcId: 77 });
  bar.handleDropSignal({ targetWcId: 77 });
  bar.handleDropSignal({ targetWcId: 88 }); // a different tab, same drag
  assert.equal(navCalls(h).length, 1, 'main consumes its declaration on the same forward; this is the chrome\'s half');
});

test('the drop signal is VALIDATED-NO-OP on every malformed payload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  startDrag(items[0]);
  for (const payload of [undefined, null, {}, { targetWcId: null }, { targetWcId: '77' }, { targetWcId: 1.5 }]) {
    bar.handleDropSignal(payload);
  }
  assert.deepEqual(navCalls(h), []);
  bar.handleDropSignal({ targetWcId: 77 }); // …and a well-formed one still works after
  assert.equal(navCalls(h).length, 1);
});

test('AC10: a drop on the BAR reorders and does NOT also navigate — no double-handling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, items } = await dragHarness();
  const dt = startDrag(items[0]);
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 260, clientY: 115 }); // inside the bar
  items[0].fire('dragend');
  assert.equal(h.calls.filter((c) => c[0] === 'commitReorder').length, 1);
  assert.deepEqual(navCalls(h), [],
    'the guest is a separate WebContentsView — it never sees this drop, so AC10 holds by construction');
});

test('the bookend sends are BARE and bracket the gesture', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, items } = await dragHarness();
  startDrag(items[0]);
  assert.deepEqual(h.calls.filter((c) => c[0].startsWith('bookmarkDrag')), [['bookmarkDragStarted']],
    'the declaration says a bookmark drag is in flight and NOTHING else — no id, no url');
  items[0].fire('dragend');
  assert.deepEqual(h.calls.filter((c) => c[0].startsWith('bookmarkDrag')), [['bookmarkDragStarted'], ['bookmarkDragEnded']]);
});

test('a refused dragstart declares nothing — no session, no hold, no navigation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await dragHarness();
  items[0].fire('dragstart', { dataTransfer: null, preventDefault() {} });
  assert.deepEqual(h.calls.filter((c) => c[0].startsWith('bookmarkDrag')), []);
  bar.handleDropSignal({ targetWcId: 77 });
  assert.deepEqual(navCalls(h), []);
});

test('AC8: a hostile url reaches the gate UNCHANGED — the chrome deliberately does not pre-filter', async (t) => {
  // The url is injected at the HOLDER layer (a bookmark carrying it could never
  // be STORED — bookmarks-store's validUrl refuses it — so a store-level test
  // here would be vacuous). The enforcing gate is main's `tab-navigate` handler
  // (ownsTab + the trust-branched isSafeTabUrl / isInternalPageUrl), pinned in
  // register-tab-ipc.test.js; a second chrome-side copy of that rule would only
  // drift from it.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ list: [{ id: 'b1', title: 'Bad', url: 'javascript:alert(1)' }] });
  h.els.bookmarksBar._width = 400;
  h.els.bookmarksBar._top = 100;
  h.els.bookmarksBar._height = 30;
  const bar = await create(h);
  bar.render('jar-a');
  const item = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-item'));
  startDrag(item);
  bar.handleDropSignal({ targetWcId: 77 });
  assert.deepEqual(navCalls(h), [['tabNavigate', { wcId: 77, verb: 'loadURL', args: ['javascript:alert(1)'] }]],
    'it rides the SAME untrusted path a bar click rides, and dies where that path is actually gated');
});

test('Edge Case: a bookmark deleted mid-drag still navigates to what the operator dragged', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items, list } = await dragHarness();
  startDrag(items[0]);
  list.shift();          // another window removed it…
  items[0].fire('dragend'); // …and the dragend flush re-renders without it
  bar.handleDropSignal({ targetWcId: 77 });
  assert.deepEqual(navCalls(h)[0][1].args, ['https://one.test/'],
    'the url is captured at dragstart — they asked for that page');
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5a — bar → OVERFLOW SHEET.
//
// Spring-loading, the two-indicator rule, the snapshot↔rendered-rows lockstep,
// and the commit that has to survive `dragend`. The sheet's own half (its drop
// target, its placement indicator, its gating to `bookmarks-overflow`) is
// pinned in overflow-drop-target.test.js — this file owns the chrome half.
// ---------------------------------------------------------------------------

/**
 * A 6-bookmark bar narrowed until exactly 3 fit, so the overflow snapshot holds
 * THREE rows and `visibleCount` is a real, non-zero, partition-derived number.
 *
 * Geometry: bar x 0..412 / y 100..130 (content run 400 after 2×6 padding);
 * items 100px wide at x 0/100/…; chevron x 380..404 inside the bar's y band.
 * With gap 2 and chevron 24: three items lay out to 100+2+100+2+100 = 304,
 * +2+24 = 330 <= 400 ✓; a fourth would need 432 ✗.
 */
async function overflowDragHarness() {
  const list = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `b${n}`, title: `Item ${n}`, url: `https://item${n}.test/`,
  }));
  const h = harness({ list });
  h.els.bookmarksBar._left = 0;
  h.els.bookmarksBar._top = 100;
  h.els.bookmarksBar._height = 30;
  h.els.bookmarksBar._width = 1000; // roomy for the first render
  h.els.bookmarksOverflow._left = 380;
  h.els.bookmarksOverflow._width = 24;
  h.els.bookmarksOverflow._top = 100;
  h.els.bookmarksOverflow._height = 24;
  // Item geometry is DERIVED from the element's live position in the bar rather
  // than stamped once after render(). That matters here and nowhere else: this
  // leg's flush path (`dragend` → render()) REBUILDS every `.bm-item`, and
  // widths stamped on the old nodes would come back as 0 — a fake-only "the
  // partition changed" that would mask the very race the AC6b tests measure.
  const origCreate = h.deps.document.createElement.bind(h.deps.document);
  h.deps.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag !== 'button') return el;
    el.getBoundingClientRect = function () {
      // display:none reads zero-width at left 0, exactly as a browser does.
      const isHidden = this.classList.contains('hidden');
      const siblings = this.parent ? this.parent.children.filter((c) => c.classList.contains('bm-item')) : [];
      const left = isHidden ? 0 : Math.max(0, siblings.indexOf(this)) * 100;
      const width = isHidden ? 0 : 100;
      return { left, width, top: 100, height: 24, right: left + width, bottom: 124 };
    };
    return el;
  };
  const bar = await create(h);
  bar.render('jar-a');
  h.els.bookmarksBar._width = 412; // -> 400px content run -> visibleCount 3
  FakeResizeObserver.instances[0].cb();
  const items = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  return { h, bar, items, list };
}

/** Pointer coordinates inside / outside the chevron's rect. */
const ON_CHEVRON = { clientX: 390, clientY: 112 };
const ON_BAR = { clientX: 150, clientY: 115 };

/** One `dragover` at `pt`, carrying our MIME. */
function dragOver(h, pt) {
  h.deps.document.fire('dragover', { dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: 'b1' }), ...pt });
}

test('Leg 5a AC4: the partition stores visibleCount ALONGSIDE the snapshot, and dragstart captures that pair', async () => {
  const { h, bar, items } = await overflowDragHarness();
  assert.equal(items.filter((el) => !el.classList.contains('hidden')).length, 3);
  h.els.bookmarksOverflow.fire('click');
  const openCall = h.calls.find((c) => c[0] === 'open');
  assert.deepEqual(openCall[2].map((r) => r.label), ['Item 4', 'Item 5', 'Item 6'],
    'three overflow rows — enough to exercise the clamp at k=last');

  startDrag(items[0]);
  items[0].fire('dragend');
  bar.handleOverflowDrop({ index: 1 });
  assert.deepEqual(h.calls.at(-1), ['commitOverflowDrop', 'jar-a', 'b1', 3, 1],
    'visibleCount 3 rides the hold — the value paired with the snapshot the sheet rendered');
});

test('Leg 5a AC4: visibleCount is STORED, so a cache that grows mid-drag cannot shift it (the deleted derive option)', async () => {
  const { h, bar, items, list } = await overflowDragHarness();
  startDrag(items[0]);
  // Another window adds a bookmark. The broadcast path updates the cache BEFORE
  // onChanged fires, and render() is suppressed by dragActive — so a derived
  // `listFor(jar).length - snapshot.length` would now read 4 while the sheet is
  // still rendering the 3-visible partition, and the commit would write the item
  // one slot too deep.
  h.setLive([...list, { id: 'b7', title: 'Item 7', url: 'https://item7.test/' }]);
  items[0].fire('dragend');
  bar.handleOverflowDrop({ index: 0 });
  const call = h.calls.at(-1);
  assert.equal(call[3], 3, 'the STORED count, not one derived from the live cache read');
});

test('Leg 5a AC4b: `dragend` fires FIRST — the default case — and the commit still lands', async () => {
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  items[0].fire('dragend'); // leg 4 measured that this wins on virtually every drop
  assert.equal(h.calls.some((c) => c[0] === 'commitOverflowDrop'), false);
  bar.handleOverflowDrop({ index: 2 });
  assert.deepEqual(h.calls.at(-1), ['commitOverflowDrop', 'jar-a', 'b1', 3, 2],
    'the bookmark id, the jar AND the snapshot\'s visibleCount all survived dragend');
});

test('Leg 5a AC4b: the hold is BOUNDED and CONSUMED once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');
  bar.handleOverflowDrop({ index: 0 });
  bar.handleOverflowDrop({ index: 0 });
  assert.equal(h.calls.filter((c) => c[0] === 'commitOverflowDrop').length, 1, 'one commit per gesture');

  startDrag(items[1]);
  items[1].fire('dragend');
  t.mock.timers.tick(2500); // past DRAG_HOLD_MS
  bar.handleOverflowDrop({ index: 0 });
  assert.equal(h.calls.filter((c) => c[0] === 'commitOverflowDrop').length, 1, 'an expired hold resolves to nothing');
});

test('Leg 5a AC4b: ONE shared hold — whichever surface consumes the release, the other resolves to nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');
  bar.handleOverflowDrop({ index: 0 });          // the sheet won this release
  bar.handleDropSignal({ targetWcId: 77 });      // …so leg 4's consumer finds nothing
  assert.equal(h.calls.filter((c) => c[0] === 'tabNavigate').length, 0,
    'a single physical release produces a single outcome — the invariant is structural, not commented');
});

test('Leg 5a AC4b: the overflow drop report is VALIDATED-NO-OP on every malformed payload', async () => {
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  items[0].fire('dragend');
  const before = h.calls.length;
  for (const bad of [undefined, null, {}, { index: -1 }, { index: 1.5 }, { index: '1' }, { index: null }]) {
    bar.handleOverflowDrop(bad);
  }
  assert.equal(h.calls.length, before, 'nothing commits');
  bar.handleOverflowDrop({ index: 0 }); // …and a good one still works
  assert.equal(h.calls.at(-1)[0], 'commitOverflowDrop');
});

test('Leg 5a AC4b: a report with NO drag in flight commits nothing', async () => {
  const { h, bar } = await overflowDragHarness();
  const before = h.calls.length;
  bar.handleOverflowDrop({ index: 0 });
  assert.equal(h.calls.length, before);
});

test('Leg 5a AC2: the chevron springs the menu only after the DWELL, and via `open` — never `trigger`', async () => {
  const { h, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.calls.length = 0;

  h.clock.t = 1000; dragOver(h, ON_CHEVRON);            // first sighting — arms the dwell
  assert.equal(h.calls.length, 0, 'no open on arrival');
  h.clock.t = 1200; dragOver(h, ON_CHEVRON);            // 200ms < 250ms
  assert.equal(h.calls.length, 0, 'still dwelling');
  h.clock.t = 1260; dragOver(h, ON_CHEVRON);            // 260ms >= 250ms
  assert.deepEqual(h.calls.map((c) => c[0]), ['open'], 'sprung');
  assert.equal(h.calls[0][1], 'bookmarks-overflow');
  assert.deepEqual(h.calls[0][2].map((r) => r.label), ['Item 4', 'Item 5', 'Item 6']);
  // ⚠ `trigger` refuses to re-open within BLUR_REOPEN_SUPPRESS_MS of a blur
  // close, and the sheet is blur-closed at drag start — so the chevron's own
  // CLICK path is the wrong thing to copy and would silently never spring.
  assert.equal(h.calls.some((c) => c[0] === 'trigger'), false);

  h.overlayMenuState.open = true;
  h.clock.t = 2000; dragOver(h, ON_CHEVRON);
  assert.equal(h.calls.filter((c) => c[0] === 'open').length, 1, 'already open — no second spring');
});

test('Leg 5a AC2 (Edge Case): a drag PASSING OVER the chevron never springs it — the dwell restarts', async () => {
  const { h, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.calls.length = 0;
  h.clock.t = 1000; dragOver(h, ON_CHEVRON);
  h.clock.t = 1100; dragOver(h, ON_BAR);      // passed through
  h.clock.t = 1200; dragOver(h, ON_CHEVRON);  // 200ms since re-entry, 1200 since first sighting
  h.clock.t = 1400; dragOver(h, ON_CHEVRON);  // 200ms since re-entry — still under the dwell
  assert.equal(h.calls.some((c) => c[0] === 'open'), false,
    'the dwell measures continuous residence, not total time in the gesture');
  h.clock.t = 1500; dragOver(h, ON_CHEVRON);  // now 300ms since re-entry
  assert.equal(h.calls.some((c) => c[0] === 'open'), true);
});

test('Leg 5a AC2 (Edge Case): a hidden chevron / empty overflow is INERT, not an error', async () => {
  // Roomy bar — nothing overflows, so the chevron is display:none (0-area rect).
  const { h, items } = await dragHarness();
  startDrag(items[0]);
  h.calls.length = 0;
  for (const t of [1000, 1500, 2000]) { h.clock.t = t; dragOver(h, { clientX: 0, clientY: 0 }); }
  assert.equal(h.calls.some((c) => c[0] === 'open'), false,
    'a zero-area rect never hits — the viewport origin must not spring an empty menu');
});

test('Leg 5a AC2a: over the chevron the BAR indicator retracts — never two contradictory indicators', async () => {
  const { h, items } = await overflowDragHarness();
  const indicator = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-drop-indicator'));
  startDrag(items[0]);

  dragOver(h, ON_BAR);
  assert.equal(indicator.classList.contains('hidden'), false, 'inside the bar run, the bar indicator draws');

  h.clock.t = 1000; dragOver(h, ON_CHEVRON);
  assert.equal(indicator.classList.contains('hidden'), true,
    'the chevron sits INSIDE barRect, so without the rule leg 3 would paint over it while the sheet springs');
});

test('Leg 5a (Edge Case): a release ON the chevron writes nothing — nothing was drawn for it', async () => {
  const { h, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.calls.length = 0;
  h.deps.document.fire('drop', { dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: 'b1' }), ...ON_CHEVRON });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false,
    'leg 3 would classify this `reorder` (the chevron is inside barRect) and commit an unpreviewed move');
  assert.equal(h.calls.some((c) => c[0] === 'commitOverflowDrop'), false);
});

test('Leg 5a AC6: a RESIZE that changes the snapshot closes the open sheet — the pre-existing desync', async () => {
  const { h } = await overflowDragHarness();
  h.overlayMenuState.open = true;
  h.calls.length = 0;

  // Same size -> the re-entrancy guard skips entirely; no snapshot write at all.
  FakeResizeObserver.instances[0].cb();
  assert.equal(h.calls.length, 0);

  // Narrower -> visibleCount drops to 2, so the snapshot gains a row. Before this
  // leg `onResize` rewrote it under the live sheet's rows with no close partner,
  // and a subsequent row click dispatched `bookmark:<i>` into the NEW snapshot.
  h.els.bookmarksBar._width = 240; // 228px run: 100+2+24 = 126 ✓, 202+2+24 = 228 ✓, 304+26 ✗
  FakeResizeObserver.instances[0].cb();
  assert.deepEqual(h.calls.at(-1), ['close', 'superseded']);
});

test('Leg 5a AC6: a re-partition that lands on the SAME snapshot does NOT close the sheet', async () => {
  const { h } = await overflowDragHarness();
  h.overlayMenuState.open = true;
  h.calls.length = 0;
  // A width change that does not move the visible/overflow boundary.
  h.els.bookmarksBar._width = 420; // 408px run — still exactly 3 visible
  FakeResizeObserver.instances[0].cb();
  assert.equal(h.calls.some((c) => c[0] === 'close'), false,
    'lockstep is about the snapshot, not about every pass — an unconditional close would ' +
    'race the sheet\'s in-flight drop report and refuse the operator\'s own drop');
});

test('Leg 5a AC6b: `dragend`\'s render() closes a sheet it would otherwise leave over a rewritten snapshot', async () => {
  const { h, items, list } = await overflowDragHarness();
  startDrag(items[0]);
  h.overlayMenuState.open = true; // sprung mid-drag
  h.calls.length = 0;
  // Another window's edit lands mid-drag: the cache is updated, render() is
  // suppressed, and dragend's unconditional flush is what finally rewrites the
  // snapshot — with no close partner of its own before this leg.
  h.setLive(list.slice(0, 5));
  items[0].fire('dragend');
  assert.equal(h.calls.some((c) => c[0] === 'close'), true,
    'the sheet cannot be left rendering rows against a snapshot render() just replaced');
});

test('Leg 5a AC6b: the HAPPY path\'s dragend leaves the sprung sheet alone — no close to race the drop', async () => {
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.overlayMenuState.open = true;
  h.calls.length = 0;
  items[0].fire('dragend'); // nothing changed — the store mutation has not landed yet
  assert.equal(h.calls.some((c) => c[0] === 'close'), false);
  bar.handleOverflowDrop({ index: 0 });
  assert.equal(h.calls.at(-1)[0], 'commitOverflowDrop', 'the drop report still resolves');
});

test('Leg 5a AC7: closeOverflowIfOpen is SUPPRESSED mid-drag and FLUSHED at dragend', async () => {
  const { h, bar, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.overlayMenuState.open = true;
  h.calls.length = 0;

  bar.closeOverflowIfOpen(); // the cache's onChanged, mid-gesture
  assert.equal(h.calls.some((c) => c[0] === 'close'), false,
    'closing here would destroy the spring-loaded DROP TARGET — leg 3\'s render() problem, other end');

  items[0].fire('dragend');
  assert.equal(h.calls.some((c) => c[0] === 'close'), true,
    'the flush is the deferred CLOSE, not only the deferred render()');
});

test('Leg 5a AC9: a release below the bar (the sheet\'s region) is handled by NEITHER chrome-document commit', async () => {
  const { h, items } = await overflowDragHarness();
  startDrag(items[0]);
  h.calls.length = 0;
  // The sheet covers the guest region, which begins below the bar. A drop
  // dispatched there in the SHEET's document never reaches this document at all
  // (separate WebContentsViews) — asserted rather than guarded, per the AC. What
  // is assertable offline is the complement: this document's own handler treats
  // that region as `outside` and writes nothing.
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: 'b1' }), clientX: 150, clientY: 400,
  });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
  assert.equal(h.calls.some((c) => c[0] === 'commitOverflowDrop'), false);
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5b — the FOREIGN-DRAG SESSION: overflow sheet → bar.
//
// The direction leg 3 built nothing for. Its handlers `return` on `!dnd`, and
// slot geometry was only ever captured inside a LOCAL `dragstart` — which never
// fires for a drag whose source is a row in another WebContentsView. Everything
// below therefore starts from `handleSheetDrag`, the main-forwarded lifecycle
// bracket that is the whole of what this document ever learns about the gesture.
//
// Geometry (overflowDragHarness): six items, three visible at x 0/100/200 (100px
// each, midpoints 50/150/250), the bar 0..412 × 100..130, the chevron 380..404.
// The overflow snapshot is therefore [Item 4, Item 5, Item 6] = ids b4/b5/b6.
// ---------------------------------------------------------------------------

/** Open a foreign session the way main's forward does. */
function sheetDragStart(bar, index = 0, token = 11) {
  bar.handleSheetDrag({ phase: 'start', token, index });
}

test('Leg 5b AC4/AC5/AC8: an overflow row dropped on the bar reorders to the drop slot, against the jar captured at START', async () => {
  const { h, bar } = await overflowDragHarness();
  h.els.bookmarksOverflow.fire('click'); // the sheet the operator is dragging out of
  h.calls.length = 0;

  sheetDragStart(bar, 0); // snapshot row 0 = Item 4 = b4
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });

  const commits = h.calls.filter((c) => c[0] === 'commitReorder');
  assert.equal(commits.length, 1, 'one commit per gesture');
  // x=150 is past slot 0's midpoint (50) and exactly ON slot 1's (150 — ties
  // resolve "before"), so the drop index is 1 among the VISIBLE slots — and
  // because the overflow hide is a strict tail, 1 is the full-list index too.
  assert.deepEqual(commits[0], ['commitReorder', 'jar-a', 'b4', 1]);
  // …and it is the ORDINARY commit path, so DD6b's fresh read and the
  // moveIndex/same-reference no-op come along unchanged (bookmarks-client.test.js
  // owns those). No second client entry point exists for this direction.
  assert.equal(h.calls.some((c) => c[0] === 'commitOverflowDrop'), false);
});

test('Leg 5b AC5: the CLAMP — a release past the last visible slot lands ON the bar, where the indicator drew', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 1); // Item 5 = b5
  h.calls.length = 0;
  // x=350: past all three midpoints -> plain insertion index 3, which UNCLAMPED
  // is full-list position 3 — the first OVERFLOW row, i.e. the item would not
  // join the bar at all and the gesture would read as "nothing happened".
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '1' }), clientX: 350, clientY: 115,
  });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b5', 2],
    'clamped to the last VISIBLE position — DD4\'s boundary displacement, and what the indicator showed');
});

test('Leg 5b AC4: the foreign session filters the HIDDEN tail — a six-item bar does not inflate the index', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 2); // Item 6 = b6
  h.calls.length = 0;
  // Three of the six items are display:none, reading zero-width AT LEFT 0. Feed
  // all six rects in and every index past the bar's left edge gains exactly 3.
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '2' }), clientX: 10, clientY: 115,
  });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b6', 0],
    'index 0, not 3');
});

test('Leg 5b AC6: the bar DOES draw a drop indicator for the reverse direction', async (t) => {
  // Mock setTimeout as the AC3 sibling below does: `sheetDragStart` arms
  // FOREIGN_DRAG_MAX_MS (15 s) and this test never delivers `end` nor a
  // committing drop, so the real timer would hold the event loop open for the
  // whole 15 s after the assertions finish. Debrief finding (M15 F3).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar } = await overflowDragHarness();
  const indicator = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-drop-indicator'));
  sheetDragStart(bar, 0);

  // Without this the reverse direction would have no drop feedback at all —
  // which is the defect the operator reported for the forward direction.
  dragOver(h, { clientX: 150, clientY: 115 });
  assert.equal(indicator.classList.contains('hidden'), false);
  assert.equal(indicator.style.left, '100px', 'drop index 1 -> the left edge of the second slot');

  dragOver(h, { clientX: 350, clientY: 115 });
  assert.equal(indicator.style.left, '300px', 'past the end -> the right edge of the last visible slot');

  // Out of the bar: retracted, not parked.
  dragOver(h, { clientX: 150, clientY: 400 });
  assert.equal(indicator.classList.contains('hidden'), true);
});

test('Leg 5b: the chevron SWALLOWS a foreign release too, and never springs for this direction', async (t) => {
  // Mock setTimeout — this release is deliberately SWALLOWED, so no commit path
  // clears the foreign latch and the real 15 s timer would leak. See the AC6
  // test above and the AC3 sibling below. Debrief finding (M15 F3).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar } = await overflowDragHarness();
  const indicator = h.els.bookmarksBar.children.find((el) => el.classList.contains('bm-drop-indicator'));
  sheetDragStart(bar, 0);
  h.calls.length = 0;

  h.clock.t = 1000; dragOver(h, ON_CHEVRON);
  h.clock.t = 5000; dragOver(h, ON_CHEVRON); // well past SPRING_DWELL_MS
  assert.equal(h.calls.some((c) => c[0] === 'open'), false,
    'spring-loading is the bar -> overflow direction only: this drag is coming OUT of that menu');
  assert.equal(indicator.classList.contains('hidden'), true, 'and no indicator is drawn over the chevron');

  h.deps.document.fire('drop', { dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), ...ON_CHEVRON });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false,
    'a write with no preview is exactly what the forward direction refuses here too');
});

test('Leg 5b AC7: BOTH rebuild paths and the overflow close are suppressed for the foreign drag, and FLUSHED at `end`', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0);
  const during = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  h.overlayMenuState.open = true;
  h.calls.length = 0;

  // (1) render() — another window's edit, or the sheet's own close re-deriving.
  bar.render('jar-a');
  assert.deepEqual(h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item')), during,
    'render() must not rebuild the bar the foreign session measured');
  // (2) the ResizeObserver re-partition — the path that moves the geometry.
  h.els.bookmarksBar._width = 212;
  FakeResizeObserver.instances[0].cb();
  assert.equal(during.every((el, i) => el.classList.contains('hidden') === (i >= 3)), true,
    're-partition suppressed too — the slot rects stay the ones the session snapshotted');
  // (3) the deferred CLOSE.
  bar.closeOverflowIfOpen();
  assert.equal(h.calls.some((c) => c[0] === 'close'), false);

  bar.handleSheetDrag({ phase: 'end', token: 11 });
  const after = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  assert.notEqual(after[0], during[0], 'the single flush ran one real rebuild');
  assert.equal(h.calls.some((c) => c[0] === 'close'), true,
    'and the flush is the deferred CLOSE, not only the deferred render()');
});

test('Leg 5b AC3: the gate is TIMER-BOUNDED — a session whose `end` NEVER arrives cannot latch the bar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0);
  const during = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));

  // Operator session 4 measured that the sheet DOES receive its own `dragend`,
  // so this is defence-in-depth against a path that fails to clear (a sheet
  // render-process-gone, a teardown mid-gesture) rather than the primary
  // recovery. An unbounded latch would freeze both rebuild paths — and the
  // overflow close — for the rest of the session, with no way back.
  t.mock.timers.tick(15000);
  bar.render('jar-a');
  assert.notEqual(h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'))[0], during[0],
    'the bar rebuilds again — the suppression expired with the session');

  // …and the expiry is NON-DESTRUCTIVE: a drop arriving after it commits nothing.
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('Leg 5b AC3: `end` is token-matched CHROME-SIDE — main cannot check it, so a stale one must not cancel a live session', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0, 11);
  bar.handleSheetDrag({ phase: 'end', token: 10 }); // a previous gesture's token
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b4', 1],
    'the stale `end` was ignored — the session is still live');

  // …and the MATCHING one ends it, so a later drop resolves to nothing.
  sheetDragStart(bar, 0, 12);
  bar.handleSheetDrag({ phase: 'end', token: 12 });
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('Leg 5b AC8 + DD13: a jar switch mid-foreign-drag is recorded but not painted; the commit uses the jar captured at START', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0);
  bar.render('jar-b'); // a tab switch mid-gesture, via refreshBookmarksSurfaces
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 10, clientY: 115,
  });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b4', 0],
    'never resolved at drop time');
});

test('Leg 5b: ONE outcome per release — the session is CONSUMED at commit', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0);
  h.calls.length = 0;
  const drop = () => h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });
  drop();
  drop();
  bar.handleSheetDrag({ phase: 'end', token: 11 }); // the real ending, arriving after
  assert.equal(h.calls.filter((c) => c[0] === 'commitReorder').length, 1);
});

test('Leg 5b: `handleSheetDrag` is VALIDATED-NO-OP on every malformed payload and every out-of-snapshot index', async () => {
  const { h, bar } = await overflowDragHarness();
  const before = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  for (const bad of [
    undefined, null, {}, { phase: 'start' }, { token: 11 }, { phase: 'start', token: '11', index: 0 },
    { phase: 'start', token: 11 }, { phase: 'start', token: 11, index: -1 },
    { phase: 'start', token: 11, index: 1.5 }, { phase: 'start', token: 11, index: '0' },
    { phase: 'start', token: 11, index: 3 }, // one past the live snapshot's last row
    { phase: 'start', token: 11, index: 99 },
    { phase: 'cancel', token: 11 }, { phase: 0, token: 11 },
  ]) {
    bar.handleSheetDrag(/** @type {any} */ (bad));
  }
  // No session was armed by any of them: the bar still rebuilds on demand…
  bar.render('jar-a');
  assert.notEqual(h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'))[0], before[0]);
  // …and a drop resolves to nothing.
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 150, clientY: 115,
  });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('Leg 5b: with NO overflow snapshot (nothing overflowing) a `start` arms nothing', async () => {
  const h = harness({ list: [{ id: 'b1', title: 'One', url: 'https://one.test/' }] });
  h.els.bookmarksBar._width = 1000;
  h.els.bookmarksBar._top = 100;
  h.els.bookmarksBar._height = 30;
  const bar = await create(h);
  bar.render('jar-a');
  bar.handleSheetDrag({ phase: 'start', token: 11, index: 0 });
  h.calls.length = 0;
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 10, clientY: 115,
  });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('Leg 5b: a LOCAL drag owns the gate — a `start` cannot clobber it, and a latched foreign session cannot survive one', async () => {
  const { h, bar, items } = await overflowDragHarness();
  const dt = startDrag(items[0]); // a bar item is being dragged
  sheetDragStart(bar, 2);         // …and a sheet `start` arrives anyway
  h.calls.length = 0;
  h.deps.document.fire('drop', { dataTransfer: dt, clientX: 150, clientY: 115 });
  // Index 0, not 1 — and the difference is the assertion. A LOCAL session
  // excludes its own slot (`draggedIndex` 0), so x=150 sits exactly on the
  // midpoint of the only preceding remaining slot and resolves "before"; the
  // FOREIGN session excludes nothing and would have answered 1. The number
  // itself names which session drove the commit.
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b1', 0],
    'the LOCAL session committed — the foreign `start` was refused, not merged');
  items[0].fire('dragend');

  // The other order: a foreign session latched (its `end` lost) must not share
  // the one suppression gate with a new local drag.
  sheetDragStart(bar, 0);
  const fresh = h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'));
  const dt2 = startDrag(fresh[0]);
  h.calls.length = 0;
  h.deps.document.fire('drop', { dataTransfer: dt2, clientX: 150, clientY: 115 });
  assert.deepEqual(h.calls.find((c) => c[0] === 'commitReorder'), ['commitReorder', 'jar-a', 'b1', 0],
    'the local session again — the latched foreign one was discarded, not consulted');
  fresh[0].fire('dragend');
  bar.render('jar-a');
  assert.notEqual(h.els.bookmarksBar.children.filter((el) => el.classList.contains('bm-item'))[0], fresh[0],
    'the local dragend lifted the gate for good — no latched foreign session left holding it');
});

test('Leg 5b (Edge Case): a drop that never happens leaves the store untouched — no commit without a release on the bar', async () => {
  const { h, bar } = await overflowDragHarness();
  sheetDragStart(bar, 0);
  h.calls.length = 0;
  // The operator dropped back INSIDE the sheet: the release is dispatched in the
  // sheet's own document and this one never sees a `drop` at all — only the
  // lifecycle `end`. A no-op, not a reorder-to-self.
  bar.handleSheetDrag({ phase: 'end', token: 11 });
  assert.equal(h.calls.some((c) => c[0] === 'commitReorder'), false);
});

test('Leg 5b (Edge Case/DD4): the reverse commit displaces the last visible item into overflow', async () => {
  const { h, bar, list } = await overflowDragHarness();
  h.els.bookmarksOverflow.fire('click');
  assert.deepEqual(h.calls.find((c) => c[0] === 'open')[2].map((r) => r.label), ['Item 4', 'Item 5', 'Item 6']);

  sheetDragStart(bar, 0); // Item 4
  h.deps.document.fire('drop', {
    dataTransfer: fakeDataTransfer({ [BOOKMARK_MIME]: '0' }), clientX: 10, clientY: 115,
  });
  // The store round trip the commit issues, played back through the cache the way
  // the `bookmarks-changed` broadcast does: Item 4 to position 0.
  const next = [list[3], ...list.filter((b) => b.id !== 'b4')];
  h.setLive(next);
  bar.render('jar-a');

  const visible = h.els.bookmarksBar.children
    .filter((el) => el.classList.contains('bm-item') && !el.classList.contains('hidden'));
  assert.deepEqual(visible.map((el) => el.title.split('\n')[0]), ['Item 4', 'Item 1', 'Item 2'],
    'the dragged row is on the bar, at the slot the indicator drew');
  // The bar\'s capacity did not change, so something had to go — DD4\'s
  // consequence, correct and (per the flight) surprising the first time.
  h.calls.length = 0;
  h.els.bookmarksOverflow.fire('click');
  assert.deepEqual(h.calls.find((c) => c[0] === 'open')[2].map((r) => r.label), ['Item 3', 'Item 5', 'Item 6']);
  assert.equal(h.els.bookmarksOverflow.classList.contains('hidden'), false,
    'the chevron\'s visibility follows the re-partition, as it does on every render');
});
