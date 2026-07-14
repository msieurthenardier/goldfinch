'use strict';

// Unit tests for src/shared/sheet-accelerator.js (M05 Flight 8, DD13/AC8).
//
// The mapper is pure and dual-export, so these run under plain `node --test`.
// It decides which accelerators the menu-overlay sheet's before-input-event
// forwards while a menu holds keyboard focus: the UNION of the guest-captured
// set and the chrome keydownToAction set — and NOTHING else (the APG menu keys
// must stay with the sheet page).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sheetAcceleratorAction, isGuestActionAllowed } = require('../../src/shared/sheet-accelerator');

const k = (key, { control = false, meta = false, shift = false } = {}) =>
  sheetAcceleratorAction({ key, control, meta, shift });
const ctrl = (key, mods = {}) => k(key, { control: true, ...mods });

// ---------------------------------------------------------------------------
// The full union — guest-class
// ---------------------------------------------------------------------------

test('F12 → guest devtools, NO modifier required, autoRepeat-guarded', () => {
  assert.deepEqual(k('F12'), { scope: 'guest', action: 'devtools', autoRepeatGuard: true });
});

test('Ctrl+Shift+I / Ctrl+Shift+i → guest devtools, autoRepeat-guarded', () => {
  assert.deepEqual(ctrl('I', { shift: true }), { scope: 'guest', action: 'devtools', autoRepeatGuard: true });
  assert.deepEqual(ctrl('i', { shift: true }), { scope: 'guest', action: 'devtools', autoRepeatGuard: true });
});

test('Ctrl+= / Ctrl++ → zoom-in; shift-tolerant `=` (US-layout Ctrl+Shift+= zooms in)', () => {
  assert.deepEqual(ctrl('='), { scope: 'guest', action: 'zoom-in' });
  assert.deepEqual(ctrl('+'), { scope: 'guest', action: 'zoom-in' });
  assert.deepEqual(ctrl('=', { shift: true }), { scope: 'guest', action: 'zoom-in' });
  assert.deepEqual(ctrl('+', { shift: true }), { scope: 'guest', action: 'zoom-in' });
});

test('Ctrl+- → zoom-out; Ctrl+0 → zoom-reset (no autoRepeat guard — held zoom repeats, parity)', () => {
  assert.deepEqual(ctrl('-'), { scope: 'guest', action: 'zoom-out' });
  assert.deepEqual(ctrl('0'), { scope: 'guest', action: 'zoom-reset' });
  assert.equal(ctrl('-').autoRepeatGuard, undefined);
  assert.equal(ctrl('0').autoRepeatGuard, undefined);
});

test('Ctrl+P / Ctrl+p (UNSHIFTED) → guest print — deliberately NO autoRepeat guard (the guest branch has none today; replicated, not "fixed")', () => {
  assert.deepEqual(ctrl('p'), { scope: 'guest', action: 'print' });
  assert.deepEqual(ctrl('P'), { scope: 'guest', action: 'print' });
  assert.equal(ctrl('p').autoRepeatGuard, undefined, 'print parity: unguarded');
});

test('Ctrl+F / Ctrl+f → guest find', () => {
  assert.deepEqual(ctrl('f'), { scope: 'guest', action: 'find' });
  assert.deepEqual(ctrl('F'), { scope: 'guest', action: 'find' });
});

test('Ctrl+J / Ctrl+j → guest downloads, autoRepeat-guarded (held chord must not stack tabs)', () => {
  assert.deepEqual(ctrl('j'), { scope: 'guest', action: 'downloads', autoRepeatGuard: true });
  assert.deepEqual(ctrl('J'), { scope: 'guest', action: 'downloads', autoRepeatGuard: true });
});

// ---------------------------------------------------------------------------
// The full union — chrome-class
// ---------------------------------------------------------------------------

test('Ctrl+T/W/L/M/R → chrome new-tab/close-tab/focus-address/toggle-panel/reload', () => {
  assert.deepEqual(ctrl('t'), { scope: 'chrome', action: 'new-tab' });
  assert.deepEqual(ctrl('w'), { scope: 'chrome', action: 'close-tab' });
  assert.deepEqual(ctrl('l'), { scope: 'chrome', action: 'focus-address' });
  assert.deepEqual(ctrl('m'), { scope: 'chrome', action: 'toggle-panel' });
  assert.deepEqual(ctrl('r'), { scope: 'chrome', action: 'reload' });
});

test('tab-management shortcuts remain available while a sheet owns focus', () => {
  assert.deepEqual(ctrl('T', { shift: true }), { scope: 'chrome', action: 'reopen-closed' });
  assert.deepEqual(ctrl('Tab'), { scope: 'chrome', action: 'next-tab' });
  assert.deepEqual(ctrl('Tab', { shift: true }), { scope: 'chrome', action: 'previous-tab' });
  assert.deepEqual(ctrl('PageDown'), { scope: 'chrome', action: 'next-tab' });
  assert.deepEqual(ctrl('PageUp'), { scope: 'chrome', action: 'previous-tab' });
  assert.deepEqual(ctrl('ArrowLeft', { shift: true }), { scope: 'chrome', action: 'move-tab-left' });
  assert.deepEqual(ctrl('1'), { scope: 'chrome', action: 'tab-1' });
  assert.deepEqual(ctrl('9'), { scope: 'chrome', action: 'tab-last' });
});

test('Ctrl+Shift+P → chrome toggle-privacy (shift disambiguates from guest print)', () => {
  assert.deepEqual(ctrl('P', { shift: true }), { scope: 'chrome', action: 'toggle-privacy' });
  assert.deepEqual(ctrl('p', { shift: true }), { scope: 'chrome', action: 'toggle-privacy' });
});

test('meta works as the modifier wherever control does (mac chords)', () => {
  assert.deepEqual(k('t', { meta: true }), { scope: 'chrome', action: 'new-tab' });
  assert.deepEqual(k('f', { meta: true }), { scope: 'guest', action: 'find' });
  assert.deepEqual(k('=', { meta: true }), { scope: 'guest', action: 'zoom-in' });
});

test('uppercase W/L/M/R (shifted chords) do NOT match — mirrors keydownToAction case discipline', () => {
  // keydownToAction matches these lowercase-only; the union must not widen them.
  for (const key of ['W', 'L', 'M', 'R']) {
    assert.equal(ctrl(key, { shift: true }), null, `Ctrl+Shift+${key} must not match`);
  }
});

// ---------------------------------------------------------------------------
// APG-key exclusions (by construction: control||meta required except F12)
// ---------------------------------------------------------------------------

test('unmodified APG keys stay with the sheet page (null)', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab']) {
    assert.equal(k(key), null, `unmodified ${key} must stay with the sheet`);
  }
});

test('unmodified letters/symbols are null (no accidental forwarding)', () => {
  for (const key of ['t', 'w', 'f', 'p', 'j', '=', '-', '0', 'a']) {
    assert.equal(k(key), null, `unmodified ${key} must not match`);
  }
});

test('modified NON-union keys are null (e.g. Ctrl+A, Ctrl+S, Ctrl+ArrowDown)', () => {
  for (const key of ['a', 's', 'd', 'q', 'ArrowDown', 'Escape', 'Enter']) {
    assert.equal(ctrl(key), null, `Ctrl+${key} must not match`);
  }
});

test('shift alone is NOT a modifier (Shift+F is typing, not find)', () => {
  assert.equal(k('F', { shift: true }), null);
  assert.equal(k('P', { shift: true }), null);
});

// ---------------------------------------------------------------------------
// The internal-tab guard decision (AC8 — DD13 guest-class dispatch)
// ---------------------------------------------------------------------------

test('isGuestActionAllowed: guest actions BLOCKED over an internal active tab (F12/zoom/print/devtools/find inert on goldfinch://)', () => {
  for (const action of ['devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'print', 'find']) {
    assert.equal(isGuestActionAllowed(action, true), false, `${action} must no-op on internal`);
  }
});

test('isGuestActionAllowed: guest actions allowed over a web active tab', () => {
  for (const action of ['devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'print', 'find', 'downloads']) {
    assert.equal(isGuestActionAllowed(action, false), true, `${action} allowed on web`);
  }
});

test('isGuestActionAllowed: downloads (Ctrl+J) is tab-independent and EXEMPT from the internal guard', () => {
  assert.equal(isGuestActionAllowed('downloads', true), true);
});
