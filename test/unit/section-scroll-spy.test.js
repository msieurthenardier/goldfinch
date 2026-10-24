'use strict';

// Sortie 05 (AC16): section-scroll-spy.js against a mock DOM + IntersectionObserver.

const { test } = require('node:test');
const assert = require('node:assert/strict');

function makeEnv(ids) {
  const sections = ids.map((id) => ({ id }));
  const links = ids.map((id) => {
    const attrs = new Map();
    return {
      getAttribute: (n) => (n === 'href' ? '#' + id : (attrs.get(n) ?? null)),
      setAttribute: (n, v) => attrs.set(n, v),
      removeAttribute: (n) => attrs.delete(n),
      current: () => attrs.get('aria-current') ?? null
    };
  });
  const queries = [];
  const document = {
    querySelectorAll: (sel) => {
      queries.push(sel);
      if (sel === 'main section[id]') return sections;
      if (sel === 'nav.section-nav a[href^="#"]') return links;
      return [];
    }
  };
  const observed = [];
  let ctorArgs = null;
  class FakeIO {
    constructor(cb, opts) {
      ctorArgs = { cb, opts };
      this.cb = cb;
    }
    observe(el) {
      observed.push(el);
    }
  }
  return { sections, links, document, queries, observed, FakeIO, getCtor: () => ctorArgs };
}

async function load() {
  return import('../../src/renderer/pages/section-scroll-spy.js');
}

test('observes every section with the midpoint rootMargin and selects nav.section-nav links', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b', 'c']);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO });
  assert.deepEqual(env.observed, env.sections);
  assert.deepEqual(env.getCtor().opts, { rootMargin: '0px 0px -50% 0px', threshold: 0 });
  assert.ok(env.queries.includes('nav.section-nav a[href^="#"]'));
});

test('first visible section in document order gets aria-current; others are cleared', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b', 'c']);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO });
  const { cb } = env.getCtor();
  cb([
    { target: env.sections[2], isIntersecting: true },
    { target: env.sections[1], isIntersecting: true }
  ]);
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, 'true', null]
  );
  cb([{ target: env.sections[1], isIntersecting: false }]);
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, null, 'true']
  );
});

test('nothing visible leaves the last active link as-is', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b']);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO });
  const { cb } = env.getCtor();
  cb([{ target: env.sections[0], isIntersecting: true }]);
  cb([{ target: env.sections[0], isIntersecting: false }]);
  assert.deepEqual(
    env.links.map((l) => l.current()),
    ['true', null]
  );
});

test('no sections or no links: no observer is constructed', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv([]);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO });
  assert.equal(env.getCtor(), null);
});

// Squawk 0157: bottom-of-page rule (geometry-aware).
function makeWin(env) {
  const listeners = [];
  const win = {
    innerHeight: 500,
    scrollY: 0,
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    fire: () => listeners.filter((l) => l.type === 'scroll').forEach((l) => l.fn())
  };
  env.document.documentElement = { scrollHeight: 1500 }; // max scroll = 1000
  return win;
}

test('at bottom with an earlier section still visible: LAST section is current', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b', 'c']);
  const win = makeWin(env);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO, window: win });
  const { cb } = env.getCtor();
  win.scrollY = 600;
  cb([{ target: env.sections[1], isIntersecting: true }]);
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, 'true', null]
  );
  win.scrollY = 999; // within slack of 1000, no intersection change
  win.fire();
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, null, 'true']
  );
  cb([{ target: env.sections[1], isIntersecting: true }]); // b still visible
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, null, 'true']
  );
});

test('mid-page keeps the first-visible rule; non-scrollable page never forces last', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b', 'c']);
  const win = makeWin(env);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO, window: win });
  const { cb } = env.getCtor();
  win.scrollY = 400;
  cb([
    { target: env.sections[2], isIntersecting: true },
    { target: env.sections[1], isIntersecting: true }
  ]);
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, 'true', null]
  );
  env.document.documentElement.scrollHeight = 500; // fits: maxScroll 0
  win.scrollY = 0;
  win.fire();
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, 'true', null]
  );
});

test('scrolling back up from bottom returns to first-visible', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b', 'c']);
  const win = makeWin(env);
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO, window: win });
  const { cb } = env.getCtor();
  cb([{ target: env.sections[1], isIntersecting: true }]);
  win.scrollY = 1000;
  win.fire();
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, null, 'true']
  );
  win.scrollY = 700;
  win.fire();
  assert.deepEqual(
    env.links.map((l) => l.current()),
    [null, 'true', null]
  );
});

test('scroll listener is passive', async () => {
  const { initSectionScrollSpy } = await load();
  const env = makeEnv(['a', 'b']);
  const seen = [];
  const win = { innerHeight: 1, scrollY: 0, addEventListener: (t, f, o) => seen.push([t, o]) };
  env.document.documentElement = { scrollHeight: 1 };
  initSectionScrollSpy({ document: env.document, IntersectionObserver: env.FakeIO, window: win });
  assert.deepEqual(seen, [['scroll', { passive: true }]]);
});
