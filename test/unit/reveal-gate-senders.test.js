'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGateSenderResolvers } = require('../../src/main/reveal-gate-senders');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const chrome = { id: 42 };
const winA = { id: 'A' };
const winC = { id: 'C' };
const registry = {
  getWindowForGuest: (id) =>
    id === 7 ? { win: winA, activeTabWcId: 7 } : id === 8 ? { win: winA, activeTabWcId: 7 } : null,
  getWindowForChrome: (s) => (s === chrome ? { win: winC } : null)
};
const r = createGateSenderResolvers(registry);

test('a guest in front resolves its window and is active; a guest behind is not', () => {
  assert.equal(r.windowFor({ id: 7 }), winA);
  assert.equal(r.isActive({ id: 7 }), true);
  assert.equal(r.windowFor({ id: 8 }), winA);
  assert.equal(r.isActive({ id: 8 }), false);
});

test('a chrome sender resolves its own window and is active', () => {
  assert.equal(r.windowFor(chrome), winC);
  assert.equal(r.isActive(chrome), true);
});

test('an unknown sender is null / false', () => {
  assert.equal(r.windowFor({ id: 99 }), null);
  assert.equal(r.isActive({ id: 99 }), false);
  assert.equal(r.windowFor(null), null);
  assert.equal(r.isActive(undefined), false);
});

test('a throwing registry is null / false', () => {
  const t = createGateSenderResolvers({
    getWindowForGuest: () => {
      throw new Error('x');
    },
    getWindowForChrome: () => {
      throw new Error('x');
    }
  });
  assert.equal(t.windowFor({ id: 1 }), null);
  assert.equal(t.isActive({ id: 1 }), false);
});

test('main.js builds the gate from the shared resolvers and defines none inline (source-scan, neuter-verified)', () => {
  const src = maskComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8'));
  const block = (s) => {
    const i = s.indexOf('createRevealGate({');
    assert.ok(i >= 0);
    const open = s.indexOf('(', i);
    return s.slice(open, findMatchingBracket(s, open, '(', ')') + 1);
  };
  const ok = (b) => /\.\.\.createGateSenderResolvers\(registry\)/.test(b) && !/\b(windowFor|isActive)\s*:/.test(b);
  assert.ok(ok(block(src)));
  const mut = src.replace('...createGateSenderResolvers(registry)', 'windowFor: (s) => null');
  assert.notEqual(mut, src);
  assert.ok(!ok(block(mut)));
});
