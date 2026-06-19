'use strict';

// Unit tests for src/main/devtools.js — the SHARED main-side DevTools open/close
// mechanics (Flight-3 DD1). One code path called by BOTH the M03 MCP ops
// (observe.js) and the human-path IPC handlers (main.js).
//
// Electron-free: devtools.js does NOT require('electron') — it only calls methods
// on a passed wc — so these run under plain `node --test` with a fake wc. The
// helper assumes a PRE-GUARDED wc (the caller applies isInternalContents with its
// contract-appropriate response), so there is no internal-session test here; that
// belongs with each caller (observe.js op tests + the IPC handler).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { setDevTools, toggleDevTools } = require('../../src/main/devtools');

// A fake wc tracking open/close calls and the DevTools open state, so toggle's
// read-flip-read can be asserted against a real state transition.
function makeWc({ open = false } = {}) {
  return {
    _openCalls: /** @type {any[]} */ ([]),
    _closeCount: 0,
    _devToolsOpen: open,
    openDevTools(/** @type {any} */ opts) { this._openCalls.push(opts); this._devToolsOpen = true; },
    closeDevTools() { this._closeCount += 1; this._devToolsOpen = false; },
    isDevToolsOpened() { return this._devToolsOpen; },
  };
}

// --- setDevTools ---

test('setDevTools(wc, true): calls openDevTools({mode:"detach"}) exactly once, no close', () => {
  const wc = makeWc();
  const result = setDevTools(wc, true);
  assert.equal(result, undefined, 'setDevTools is void');
  assert.equal(wc._openCalls.length, 1, 'openDevTools called once');
  assert.deepEqual(wc._openCalls[0], { mode: 'detach' }, 'must pass {mode:"detach"} (detached window)');
  assert.equal(wc._closeCount, 0, 'closeDevTools must not be called');
});

test('setDevTools(wc, false): calls closeDevTools() exactly once, no open', () => {
  const wc = makeWc({ open: true });
  const result = setDevTools(wc, false);
  assert.equal(result, undefined, 'setDevTools is void');
  assert.equal(wc._closeCount, 1, 'closeDevTools called once');
  assert.equal(wc._openCalls.length, 0, 'openDevTools must not be called');
});

// --- toggleDevTools ---

test('toggleDevTools: when CLOSED → opens (detached) and returns true (post-toggle state)', () => {
  const wc = makeWc({ open: false });
  const result = toggleDevTools(wc);
  assert.equal(result, true, 'returns the POST-toggle isDevToolsOpened() (now open)');
  assert.equal(wc._openCalls.length, 1, 'opened once');
  assert.deepEqual(wc._openCalls[0], { mode: 'detach' });
  assert.equal(wc._closeCount, 0, 'must not close when it was closed');
});

test('toggleDevTools: when OPEN → closes and returns false (post-toggle state)', () => {
  const wc = makeWc({ open: true });
  const result = toggleDevTools(wc);
  assert.equal(result, false, 'returns the POST-toggle isDevToolsOpened() (now closed)');
  assert.equal(wc._closeCount, 1, 'closed once');
  assert.equal(wc._openCalls.length, 0, 'must not open when it was open');
});

test('toggleDevTools: returns the AUTHORITATIVE post-state read, not an assumed flip', () => {
  // A wc whose isDevToolsOpened() does NOT reflect the requested action (e.g. open
  // silently failed). toggleDevTools must return what isDevToolsOpened() actually
  // reports AFTER the action — the authoritative value the renderer button trusts.
  const wc = {
    _openCalls: /** @type {any[]} */ ([]),
    openDevTools(/** @type {any} */ opts) { this._openCalls.push(opts); /* but stays "closed" */ },
    closeDevTools() {},
    isDevToolsOpened() { return false; }, // never reports open
  };
  const result = toggleDevTools(wc);
  assert.equal(wc._openCalls.length, 1, 'it attempted to open (was reported closed)');
  assert.equal(result, false, 'returns the authoritative isDevToolsOpened()=false, not an assumed true');
});

// --- two consecutive toggles round-trip via the real state ---

test('toggleDevTools: two consecutive toggles round-trip open→closed→open', () => {
  const wc = makeWc({ open: false });
  assert.equal(toggleDevTools(wc), true, 'first toggle opens');
  assert.equal(toggleDevTools(wc), false, 'second toggle closes');
  assert.equal(toggleDevTools(wc), true, 'third toggle opens again');
  assert.equal(wc._openCalls.length, 2);
  assert.equal(wc._closeCount, 1);
});
