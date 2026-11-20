'use strict';
// Squawk 0220: a successful chrome-welcome-set writes the renderer's cache
// synchronously and settles from it — no `{search}`/`{home}` override.
// Behavioural: the real welcome-controller module against a minimal fake DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js');

function makeEl() {
  const listeners = {};
  const el = {
    children: [],
    attrs: {},
    listeners,
    value: '',
    checked: false,
    textContent: '',
    className: '',
    classList: {
      s: new Set(),
      add(c) {
        this.s.add(c);
      },
      remove(c) {
        this.s.delete(c);
      },
      toggle(c, on) {
        if (on) this.s.add(c);
        else this.s.delete(c);
      }
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(t, fn) {
      (listeners[t] = listeners[t] || []).push(fn);
    }
  };
  return el;
}

async function setup({ reply = { ok: true }, home = null, engine = null } = {}) {
  const { createWelcomeController } = await import(SRC);
  const cache = { home, engine };
  const all = [];
  const attached = [];
  let changed = null;
  const document = { createElement: () => (all.push(makeEl()), all[all.length - 1]), activeElement: null };
  const ctl = createWelcomeController({
    document,
    els: { welcomeSurface: makeEl() },
    attachView: (tab, url) => attached.push(url),
    welcomeSetPreference: async () => reply,
    onSettingsChanged: (fn) => {
      changed = fn;
    },
    SEARCH_ENGINES: [
      { id: 'ddg', label: 'DDG', description: 'd' },
      { id: 'brave', label: 'Brave', description: 'b' }
    ],
    buildSearchUrl: (id, q) => `https://${id}/?q=${q}`,
    currentSearchEngine: () => cache.engine,
    currentHomePage: () => cache.home,
    setSearchEngine: (v) => {
      cache.engine = v;
    },
    setHomePage: (v) => {
      cache.home = v;
    },
    normalizeHomePageInput: (v) => v
  });
  const byId = (id) => all.find((e) => e.id === id);
  const tab = { welcome: { reasons: new Set(['home', 'search']), pendingQuery: null } };
  ctl.show(tab);
  return { ctl, cache, attached, byId, tab, fireChanged: (v) => changed(v), all };
}

// A real selection sets .checked, then `change` fires (submitEngine is not
// awaited by the listener, so let its continuation run).
async function pick(radio) {
  radio.checked = true;
  radio.listeners.change[0]();
  await new Promise((r) => setImmediate(r));
}

test('home: a successful set writes the cache synchronously and renders from it', async () => {
  const s = await setup();
  s.byId('welcome-home-input').value = 'https://example.com';
  await s.byId('welcome-home-set').listeners.click[0]();
  assert.equal(s.cache.home, 'https://example.com');
  assert.match(s.byId('welcome-home-status').textContent, /Saved/);
  assert.equal(s.byId('welcome-home-input').value, 'https://example.com');
});

test('home: clearing writes null (meaningful, not skipped)', async () => {
  const s = await setup({ home: 'https://old.example' });
  s.byId('welcome-home-input').value = '';
  await s.byId('welcome-home-set').listeners.click[0]();
  assert.equal(s.cache.home, null);
  assert.match(s.byId('welcome-home-status').textContent, /cleared/);
});

test('home: a failed set leaves the cache untouched', async () => {
  const s = await setup({ reply: { ok: false, error: 'bad' }, home: 'https://old.example' });
  s.byId('welcome-home-input').value = 'https://new.example';
  await s.byId('welcome-home-set').listeners.click[0]();
  assert.equal(s.cache.home, 'https://old.example');
  assert.equal(s.byId('welcome-home-status').textContent, 'Enter a valid address.');
});

test('engine: a successful pick writes the cache and settles the pending search from it', async () => {
  const s = await setup();
  s.tab.welcome.pendingQuery = 'cats';
  const radio = s.all.find((e) => e.id === 'welcome-engine-brave');
  await pick(radio);
  assert.equal(s.cache.engine, 'brave');
  assert.deepEqual(s.attached, ['https://brave/?q=cats']);
});

test('engine: success with no pending query re-renders the radios from the cache', async () => {
  const s = await setup();
  const radio = s.all.find((e) => e.id === 'welcome-engine-brave');
  await pick(radio);
  assert.equal(s.cache.engine, 'brave');
  assert.equal(radio.checked, true);
  assert.match(s.byId('welcome-engine-status').textContent, /Saved/);
});

test('engine: a failed pick leaves the cache untouched and attaches nothing', async () => {
  const s = await setup({ reply: { ok: false }, engine: 'ddg' });
  s.tab.welcome.pendingQuery = 'cats';
  await pick(s.all.find((e) => e.id === 'welcome-engine-brave'));
  assert.equal(s.cache.engine, 'ddg');
  assert.deepEqual(s.attached, []);
  assert.match(s.byId('welcome-engine-status').textContent, /Could not save/);
});

test('a later settings-changed broadcast with the same value is harmless', async () => {
  const s = await setup();
  s.byId('welcome-home-input').value = 'https://example.com';
  await s.byId('welcome-home-set').listeners.click[0]();
  const before = s.byId('welcome-home-status').textContent;
  s.fireChanged({ homePage: 'https://example.com' });
  assert.equal(s.cache.home, 'https://example.com');
  assert.equal(s.byId('welcome-home-status').textContent, before);
  assert.deepEqual(s.attached, []);
});

test('the override parameter is gone from the source', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /opts\.(home|search)|'(home|search)' in opts|settle\(tab,\s*\{/);
  assert.match(src, /setHomePage\(value\);\s*settle\(tab\);/);
});
