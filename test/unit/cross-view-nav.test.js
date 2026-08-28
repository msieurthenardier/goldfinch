'use strict';

// Unit tests for src/shared/cross-view-nav.js (M05 Flight 5 Leg 2).
//
// The decision is pure and dual-export, so these run under plain `node --test`.
// It decides which of the TWO cross-view keyboard-bridge keys (Ctrl/Cmd+L,
// unmodified Tab) a focused guest hands back to the chrome view — and NOTHING
// else. The critical regression guard is the negative half: every EXISTING guest
// accelerator (F12/zoom/print/find/downloads/devtools) must return null here, so
// the new capture never shadows the untouched guest branches.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { crossViewNavAction } = require('../../src/shared/cross-view-nav');

const k = (key, { control = false, meta = false, shift = false, alt = false } = {}) =>
  crossViewNavAction({ key, control, meta, shift, alt });

// ---------------------------------------------------------------------------
// Ctrl/Cmd+L → focus-address
// ---------------------------------------------------------------------------

test('Ctrl+L / Ctrl+l → focus-address (both cases, per leg spec)', () => {
  assert.equal(k('l', { control: true }), 'focus-address');
  assert.equal(k('L', { control: true }), 'focus-address');
});

test('Cmd+L (meta) → focus-address — macOS parity', () => {
  assert.equal(k('l', { meta: true }), 'focus-address');
  assert.equal(k('L', { meta: true }), 'focus-address');
});

test('Ctrl+Shift+L still resolves to focus-address (shifted L, control set)', () => {
  assert.equal(k('L', { control: true, shift: true }), 'focus-address');
});

test('bare l (no modifier) → null — a plain letter must reach the page', () => {
  assert.equal(k('l'), null);
  assert.equal(k('L'), null);
});

// ---------------------------------------------------------------------------
// Unmodified Tab → null (M17 F1 L1, DD3); any modifier → null
// ---------------------------------------------------------------------------

// INVERTED, not deleted-and-re-added (M17 F1 L1, DD3/AC2): the pinned
// 'unmodified Tab → tab-handoff' expectation from M05 F5 L2 is retired.
// `crossViewNavAction` no longer ejects on every mid-page Tab — the
// guest-tab-boundary signal (src/shared/tab-boundary.js, wired from both
// guest preloads) now decides per-press whether Tab is actually leaving the
// page's tabbable sequence, and only a genuine boundary reaches the chrome
// via a different, payload-minimal channel. This module's Tab case is gone.
test('unmodified Tab → null (handled by the guest-tab-boundary signal, M17 F1)', () => {
  assert.equal(k('Tab'), null);
});

test('Shift+Tab → null (out of scope — Chromium default)', () => {
  assert.equal(k('Tab', { shift: true }), null);
});

test('Ctrl+Tab / Alt+Tab / Cmd+Tab → null (modified Tab is not the handoff path)', () => {
  assert.equal(k('Tab', { control: true }), null);
  assert.equal(k('Tab', { alt: true }), null);
  assert.equal(k('Tab', { meta: true }), null);
});

// ---------------------------------------------------------------------------
// F6 / Shift+F6 (M17 F1 L2, DD6): the guest-side half of the chrome↔content
// focus cycle Leg 1 wired chrome→guest. Unmodified F6 → 'focus-address'
// (Chrome's own F6 contract); Shift+F6 → 'focus-chrome-end' (the chrome's
// last visible tabbable); any of ctrl/meta/alt held → null (parity with the
// chrome-side keydownToAction gate).
// ---------------------------------------------------------------------------

test('unmodified F6 → focus-address', () => {
  assert.equal(k('F6'), 'focus-address');
});

test('Shift+F6 → focus-chrome-end', () => {
  assert.equal(k('F6', { shift: true }), 'focus-chrome-end');
});

test('Ctrl+F6 / Meta+F6 / Alt+F6 → null (parity gate — modified F6 is a no-op on both sides)', () => {
  assert.equal(k('F6', { control: true }), null);
  assert.equal(k('F6', { meta: true }), null);
  assert.equal(k('F6', { alt: true }), null);
});

test('Ctrl+Shift+F6 → null (a held ctrl/meta/alt wins over shift)', () => {
  assert.equal(k('F6', { control: true, shift: true }), null);
});

// ---------------------------------------------------------------------------
// Regression guard: EXISTING guest accelerators must all return null so the
// cross-view capture never shadows the untouched guest before-input-event branches.
// ---------------------------------------------------------------------------

test('existing guest accelerators are NOT intercepted (all → null)', () => {
  // DevTools
  assert.equal(k('F12'), null, 'F12 devtools untouched');
  assert.equal(k('I', { control: true, shift: true }), null, 'Ctrl+Shift+I devtools untouched');
  assert.equal(k('i', { control: true, shift: true }), null);
  // Zoom
  assert.equal(k('=', { control: true }), null, 'Ctrl+= zoom-in untouched');
  assert.equal(k('+', { control: true }), null);
  assert.equal(k('-', { control: true }), null, 'Ctrl+- zoom-out untouched');
  assert.equal(k('0', { control: true }), null, 'Ctrl+0 zoom-reset untouched');
  // Print / Find / Downloads
  assert.equal(k('p', { control: true }), null, 'Ctrl+P print untouched');
  assert.equal(k('P', { control: true }), null);
  assert.equal(k('f', { control: true }), null, 'Ctrl+F find untouched');
  assert.equal(k('F', { control: true }), null);
  assert.equal(k('j', { control: true }), null, 'Ctrl+J downloads untouched');
  assert.equal(k('J', { control: true }), null);
});

test('chrome-class accelerators not owned by the guest capture (all → null)', () => {
  // These are handled by the chrome keydown handler / sheet mapper, never by the
  // guest before-input-event — the cross-view helper must not claim them either.
  assert.equal(k('t', { control: true }), null, 'Ctrl+T new-tab');
  assert.equal(k('w', { control: true }), null, 'Ctrl+W close-tab');
  assert.equal(k('m', { control: true }), null, 'Ctrl+M toggle-panel');
  assert.equal(k('r', { control: true }), null, 'Ctrl+R reload — must stay the guest native reload');
  assert.equal(k('P', { control: true, shift: true }), null, 'Ctrl+Shift+P toggle-privacy');
});

test('unmodified APG / navigation keys → null (stay with the page)', () => {
  assert.equal(k('Enter'), null);
  assert.equal(k('Escape'), null);
  assert.equal(k('ArrowDown'), null);
  assert.equal(k(' '), null);
  assert.equal(k('a'), null);
});
