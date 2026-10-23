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
