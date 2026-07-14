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

// DD8 (M06 F3 Leg 4, FD ruling): Ctrl+Shift+T is intentionally NOT 'new-tab' —
// only lowercase 't' matches. This is the classifier fact the guest-focus
// forwarder's parity depends on (unifying the guest capture onto this same
// classifier intentionally drops shifted-T under guest focus, where the OLD
// handleGuestNewTab one-off used to match BOTH cases — see
// guest-forward-allowlist.test.js for the end-to-end pin). Ctrl+Shift+T is
// conventionally "reopen closed tab" — reserved unassigned for that future
// feature, not a bug.
test('Ctrl+Shift+t (uppercase T) -> null, NOT new-tab (intentional — reserved for a future "reopen closed tab")', () => {
  assert.equal(keydownToAction(desc({ key: 'T', ctrl: true, shift: true })), null);
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

// ---------------------------------------------------------------------------
// Tab-cycle / tab-jump (M09 F3 Leg 1, DD1 + i18n rulings)
// ---------------------------------------------------------------------------

test('Ctrl+Tab -> tab-next; Ctrl+Shift+Tab -> tab-prev', () => {
  assert.equal(keydownToAction(desc({ key: 'Tab', ctrl: true })), 'tab-next');
  assert.equal(keydownToAction(desc({ key: 'Tab', ctrl: true, shift: true })), 'tab-prev');
});

test('Cmd+Tab (meta) -> tab-next (meta is equivalent to ctrl)', () => {
  assert.equal(keydownToAction(desc({ key: 'Tab', meta: true })), 'tab-next');
});

test('Ctrl+PageDown -> tab-next; Ctrl+PageUp -> tab-prev', () => {
  assert.equal(keydownToAction(desc({ key: 'PageDown', ctrl: true })), 'tab-next');
  assert.equal(keydownToAction(desc({ key: 'PageUp', ctrl: true })), 'tab-prev');
});

test('Ctrl+Tab / Ctrl+PageDown / Ctrl+PageUp with lightbox open -> still fire (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: 'Tab', ctrl: true, lightboxOpen: true })), 'tab-next');
  assert.equal(keydownToAction(desc({ key: 'PageDown', ctrl: true, lightboxOpen: true })), 'tab-next');
  assert.equal(keydownToAction(desc({ key: 'PageUp', ctrl: true, lightboxOpen: true })), 'tab-prev');
});

test('Ctrl+1..8 -> tab-jump-1..tab-jump-8; Ctrl+9 -> tab-jump-last', () => {
  for (let n = 1; n <= 8; n++) {
    assert.equal(keydownToAction(desc({ key: String(n), ctrl: true })), `tab-jump-${n}`);
  }
  assert.equal(keydownToAction(desc({ key: '9', ctrl: true })), 'tab-jump-last');
});

test('Ctrl+7 with lightbox open -> tab-jump-7 (NOT lightbox-gated)', () => {
  assert.equal(keydownToAction(desc({ key: '7', ctrl: true, lightboxOpen: true })), 'tab-jump-7');
});

// i18n ruling (a): AltGr digits report ctrl+alt and must never produce a
// tab-jump — the guard is scoped to digits only.
test('Ctrl+Alt+7 -> null (AltGr guard — digit gated on !alt)', () => {
  assert.equal(keydownToAction(desc({ key: '7', ctrl: true, alt: true })), null);
});

test('Ctrl+Alt+9 -> null (AltGr guard applies to the "last" digit too)', () => {
  assert.equal(keydownToAction(desc({ key: '9', ctrl: true, alt: true })), null);
});

// i18n ruling (b): the digit match is on `key` alone, regardless of shift
// (AZERTY needs Shift to produce digit characters).
test('Ctrl+Shift+7 (shifted digit, AZERTY) -> tab-jump-7 (shift-tolerant match)', () => {
  assert.equal(keydownToAction(desc({ key: '7', ctrl: true, shift: true })), 'tab-jump-7');
});

test('alt defaults to false when omitted (existing pins unaffected)', () => {
  assert.equal(keydownToAction({ key: '7', ctrl: true, meta: false, shift: false, lightboxOpen: false }), 'tab-jump-7');
});
