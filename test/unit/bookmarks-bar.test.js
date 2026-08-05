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
  const bookmarksClient = { listFor: () => list };
  const overlayMenuState = { open: false };
  const overlayMenuClient = {
    open: (...args) => calls.push(['open', ...args]),
    close: (reason) => calls.push(['close', reason]),
    trigger: (menuType, openFn) => { calls.push(['trigger', menuType]); openFn(); },
  };
  const activeContainer = { id: 'active-jar' };

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
  };

  return { els, calls, bookmarksClient, overlayMenuState, activeContainer, list, deps };
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
