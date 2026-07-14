'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keydownToAction } = require('../../src/shared/keydown-action');

// Helper: build a descriptor with sensible defaults (Ctrl modifier, no shift,
// lightbox closed) so each test states only what differs.
function desc(over) {
  return {
    key: '',
    ctrl: false,
    meta: false,
    shift: false,
    lightboxOpen: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// One case per action (Ctrl modifier)
// ---------------------------------------------------------------------------
test('F12 (no modifier) -> devtools', () => {
  assert.equal(keydownToAction(desc({ key: 'F12' })), 'devtools');
});

test('Ctrl+= -> zoom-in', () => {
  assert.equal(keydownToAction(desc({ key: '=', ctrl: true })), 'zoom-in');
});

test('Ctrl++ -> zoom-in', () => {
  assert.equal(keydownToAction(desc({ key: '+', ctrl: true })), 'zoom-in');
});

test('Ctrl+- -> zoom-out', () => {
  assert.equal(keydownToAction(desc({ key: '-', ctrl: true })), 'zoom-out');
});

test('Ctrl+0 -> zoom-reset', () => {
  assert.equal(keydownToAction(desc({ key: '0', ctrl: true })), 'zoom-reset');
});

test('Ctrl+f -> find', () => {
  assert.equal(keydownToAction(desc({ key: 'f', ctrl: true })), 'find');
});

test('Ctrl+F (capital) -> find', () => {
  assert.equal(keydownToAction(desc({ key: 'F', ctrl: true })), 'find');
});

test('Ctrl+t -> new-tab', () => {
  assert.equal(keydownToAction(desc({ key: 't', ctrl: true })), 'new-tab');
});

test('Ctrl+Shift+T -> reopen-closed', () => {
  assert.equal(keydownToAction(desc({ key: 'T', ctrl: true, shift: true })), 'reopen-closed');
});

test('standard tab navigation, direct selection, and keyboard reorder shortcuts classify', () => {
  assert.equal(keydownToAction(desc({ key: 'Tab', ctrl: true })), 'next-tab');
  assert.equal(keydownToAction(desc({ key: 'Tab', ctrl: true, shift: true })), 'previous-tab');
  assert.equal(keydownToAction(desc({ key: 'PageDown', ctrl: true })), 'next-tab');
  assert.equal(keydownToAction(desc({ key: 'PageUp', ctrl: true })), 'previous-tab');
  assert.equal(keydownToAction(desc({ key: '1', ctrl: true })), 'tab-1');
  assert.equal(keydownToAction(desc({ key: '9', ctrl: true })), 'tab-last');
  assert.equal(keydownToAction(desc({ key: 'ArrowLeft', ctrl: true, shift: true })), 'move-tab-left');
  assert.equal(keydownToAction(desc({ key: 'ArrowRight', ctrl: true, shift: true })), 'move-tab-right');
});

test('Ctrl+w -> close-tab', () => {
  assert.equal(keydownToAction(desc({ key: 'w', ctrl: true })), 'close-tab');
});

test('Ctrl+l -> focus-address', () => {
  assert.equal(keydownToAction(desc({ key: 'l', ctrl: true })), 'focus-address');
});

test('Ctrl+m -> toggle-panel', () => {
  assert.equal(keydownToAction(desc({ key: 'm', ctrl: true })), 'toggle-panel');
});

test('Ctrl+Shift+P -> toggle-privacy', () => {
  assert.equal(keydownToAction(desc({ key: 'P', ctrl: true, shift: true })), 'toggle-privacy');
});

test('Ctrl+Shift+p (lowercase) -> toggle-privacy', () => {
  assert.equal(keydownToAction(desc({ key: 'p', ctrl: true, shift: true })), 'toggle-privacy');
});

test('Ctrl+Shift+I -> devtools', () => {
  assert.equal(keydownToAction(desc({ key: 'I', ctrl: true, shift: true })), 'devtools');
});

test('Ctrl+Shift+i (lowercase) -> devtools', () => {
  assert.equal(keydownToAction(desc({ key: 'i', ctrl: true, shift: true })), 'devtools');
});

test('Ctrl+r -> reload', () => {
  assert.equal(keydownToAction(desc({ key: 'r', ctrl: true })), 'reload');
});

test('Ctrl+J (capital) -> downloads', () => {
  assert.equal(keydownToAction(desc({ key: 'J', ctrl: true })), 'downloads');
});

test('Ctrl+j (lowercase) -> downloads', () => {
  assert.equal(keydownToAction(desc({ key: 'j', ctrl: true })), 'downloads');
});

test('Cmd+J (meta) -> downloads (meta is equivalent to ctrl)', () => {
  assert.equal(keydownToAction(desc({ key: 'J', meta: true })), 'downloads');
});

test('j without modifier -> null (modifier-required key, no modifier)', () => {
  assert.equal(keydownToAction(desc({ key: 'j' })), null);
});

// ---------------------------------------------------------------------------
// Meta (Cmd) equivalence — mod = ctrl || meta
// ---------------------------------------------------------------------------
test('Cmd+t (meta) -> new-tab (meta is equivalent to ctrl)', () => {
  assert.equal(keydownToAction(desc({ key: 't', meta: true })), 'new-tab');
});

test('Cmd+= (meta) -> zoom-in', () => {
  assert.equal(keydownToAction(desc({ key: '=', meta: true })), 'zoom-in');
});

// ---------------------------------------------------------------------------
// null / no-match
// ---------------------------------------------------------------------------
test('Ctrl+z (unmapped key with modifier) -> null', () => {
  assert.equal(keydownToAction(desc({ key: 'z', ctrl: true })), null);
});

test('f without modifier -> null (modifier-required key, no modifier)', () => {
  assert.equal(keydownToAction(desc({ key: 'f' })), null);
});

test('t without modifier -> null', () => {
  assert.equal(keydownToAction(desc({ key: 't' })), null);
});

test('Shift+P without ctrl/meta -> null (modifier required)', () => {
  assert.equal(keydownToAction(desc({ key: 'P', shift: true })), null);
});

// ---------------------------------------------------------------------------
// lightboxOpen gating
// ---------------------------------------------------------------------------
test('F12 with lightbox open -> null (deferred)', () => {
  assert.equal(keydownToAction(desc({ key: 'F12', lightboxOpen: true })), null);
});

test('Ctrl+= with lightbox open -> null (zoom deferred)', () => {
  assert.equal(keydownToAction(desc({ key: '=', ctrl: true, lightboxOpen: true })), null);
});

test('Ctrl+- with lightbox open -> null (zoom deferred)', () => {
  assert.equal(keydownToAction(desc({ key: '-', ctrl: true, lightboxOpen: true })), null);
});

test('Ctrl+0 with lightbox open -> null (zoom deferred)', () => {
  assert.equal(keydownToAction(desc({ key: '0', ctrl: true, lightboxOpen: true })), null);
});

test('Ctrl+f with lightbox open -> null (find deferred)', () => {
  assert.equal(keydownToAction(desc({ key: 'f', ctrl: true, lightboxOpen: true })), null);
});

test('Ctrl+Shift+I with lightbox open -> null (devtools-via-Ctrl+Shift+I is lightbox-guarded)', () => {
  assert.equal(keydownToAction(desc({ key: 'I', ctrl: true, shift: true, lightboxOpen: true })), null);
});

test('Ctrl+t with lightbox open -> new-tab (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 't', ctrl: true, lightboxOpen: true })), 'new-tab');
});

test('Ctrl+w with lightbox open -> close-tab (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 'w', ctrl: true, lightboxOpen: true })), 'close-tab');
});

test('Ctrl+m with lightbox open -> toggle-panel (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 'm', ctrl: true, lightboxOpen: true })), 'toggle-panel');
});

test('Ctrl+Shift+P with lightbox open -> toggle-privacy (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 'P', ctrl: true, shift: true, lightboxOpen: true })), 'toggle-privacy');
});

test('Ctrl+r with lightbox open -> reload (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 'r', ctrl: true, lightboxOpen: true })), 'reload');
});

test('Ctrl+J with lightbox open -> downloads (NOT lightbox-gated, app-level like new-tab)', () => {
  assert.equal(keydownToAction(desc({ key: 'J', ctrl: true, lightboxOpen: true })), 'downloads');
});

// ---------------------------------------------------------------------------
// F12 before the modifier gate
// ---------------------------------------------------------------------------
test('F12 with ctrl:false, meta:false -> devtools (decided before the modifier gate)', () => {
  assert.equal(keydownToAction(desc({ key: 'F12', ctrl: false, meta: false })), 'devtools');
});

// ---------------------------------------------------------------------------
// Ctrl+Shift+I vs Ctrl+Shift+P disambiguation by key letter
// ---------------------------------------------------------------------------
test('Ctrl+Shift+I and Ctrl+Shift+P map distinctly (key-letter disambiguation)', () => {
  assert.equal(keydownToAction(desc({ key: 'I', ctrl: true, shift: true })), 'devtools');
  assert.equal(keydownToAction(desc({ key: 'P', ctrl: true, shift: true })), 'toggle-privacy');
});
