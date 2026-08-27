'use strict';

// Characterization tests for the extracted modal-card controller (M12 Flight 3 Leg 4
// first-run-setup, DD5 template-registry / modal-card refactor). These encode the EXACT
// behavior of the landed F2 vault-unlock / vault-capture inline wiring — Tab-cycle,
// Escape / backdrop dismiss, and the one-report-per-token discipline — BEFORE
// menu-overlay.js was re-expressed onto this module, and stay green after. They are the
// only real net for that landed master-password unlock UI (menu-overlay.js is an IIFE
// with no controller test; a11y won't run headless).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const {
  createSheetReport,
  attachModalCard,
  attachBackdropPressGate
} = require('../../src/shared/modal-card-controller.js');

// ---------------------------------------------------------------------------
// createSheetReport — the one-report-per-open-token machine.
// ---------------------------------------------------------------------------

function makeBridge() {
  const activated = [];
  const dismissed = [];
  return {
    activated,
    dismissed,
    sendActivated: (p) => activated.push(p),
    sendDismissed: (p) => dismissed.push(p)
  };
}

test('createSheetReport: begin adopts the token and resets the once-guard + flavor', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  assert.equal(report.token, null);
  report.begin(7);
  assert.equal(report.token, 7);
  assert.equal(report.sent, false);
  assert.equal(report.lastStimulus, 'blur');
});

test('createSheetReport: adoptToken swaps the token WITHOUT resetting the once-guard or flavor', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  report.begin(7);
  report.lastStimulus = 'escape';
  // The in-place downloads-repaint path: a superseding token arrives while the sheet
  // stays open — unlike begin, sent + lastStimulus carry forward.
  report.adoptToken(11);
  assert.equal(report.token, 11);
  assert.equal(report.lastStimulus, 'escape', 'flavor is preserved (not reset to blur)');
  // A subsequent dismissal reports against the ADOPTED token, not the superseded one.
  report.reportDismissed();
  assert.deepEqual(bridge.dismissed, [{ reason: 'escape', token: 11 }]);
});

test('createSheetReport: exactly one of activated/dismissed per token — activation wins', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  report.begin(7);

  assert.equal(report.sendActivatedOnce({ id: 'ack' }), true);
  assert.deepEqual(bridge.activated, [{ id: 'ack', token: 7 }]);
  // A second activated is suppressed (first send wins).
  assert.equal(report.sendActivatedOnce({ id: 'again' }), false);
  // The trailing dismissed the onClose would send is suppressed (already sent).
  report.reportDismissed();
  assert.deepEqual(bridge.dismissed, []);
});

test('createSheetReport: reportDismissed sends the live flavor once, then resets to blur', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  report.begin(9);
  report.lastStimulus = 'escape';
  report.reportDismissed();
  assert.deepEqual(bridge.dismissed, [{ reason: 'escape', token: 9 }]);
  assert.equal(report.lastStimulus, 'blur', 'flavor resets after every send');
  // A second dismissed is suppressed (sent guard).
  report.reportDismissed();
  assert.deepEqual(bridge.dismissed, [{ reason: 'escape', token: 9 }]);
});

test('createSheetReport: no token live → neither report fires (silent rebuild path)', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  report.silence();
  assert.equal(report.sendActivatedOnce({ id: 'x' }), false);
  report.reportDismissed();
  assert.deepEqual(bridge.activated, []);
  assert.deepEqual(bridge.dismissed, []);
});

test('createSheetReport: sendActivatedOnce passes value through with the live token', () => {
  const bridge = makeBridge();
  const report = createSheetReport(bridge);
  report.begin(3);
  report.sendActivatedOnce({ id: 'create', value: 'Shopping' });
  assert.deepEqual(bridge.activated, [{ id: 'create', value: 'Shopping', token: 3 }]);
});

// ---------------------------------------------------------------------------
// attachModalCard — dialog-local Tab-cycle + Escape / backdrop dismiss + dismissibility.
// ---------------------------------------------------------------------------

// Wire a fake card: a backdrop `node` + three focusable `cycle` refs. `close` records
// the (stimulus) calls exactly as the caller's { report.lastStimulus = s; close(entry) }.
function makeCard(document, { dismissible } = {}) {
  const node = document.createElement('div');
  const a = document.createElement('input');
  const b = document.createElement('button');
  const c = document.createElement('button');
  node.appendChild(a);
  node.appendChild(b);
  node.appendChild(c);
  const closes = [];
  attachModalCard({
    node,
    getCycle: () => [a, b, c],
    dismissible,
    close: (s) => closes.push(s),
    activeElement: () => document.activeElement
  });
  return { node, a, b, c, closes };
}

test('attachModalCard: Tab cycles forward a→b→c→a; Shift+Tab wraps backward', () => {
  const document = createDocument();
  const { node, a, b, c } = makeCard(document);

  a.focus();
  node.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(document.activeElement, b, 'Tab from a focuses b');
  node.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(document.activeElement, c, 'Tab from b focuses c');
  node.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(document.activeElement, a, 'Tab from c wraps to a');

  node.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(document.activeElement, c, 'Shift+Tab from a wraps to c');
});

test('attachModalCard (dismissible): Escape closes with the escape flavor', () => {
  const document = createDocument();
  const { node, closes } = makeCard(document, { dismissible: true });
  node.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.deepEqual(closes, ['escape']);
});

test('attachModalCard (dismissible): backdrop click closes with outside-click; in-card click does not', () => {
  const document = createDocument();
  const { node, a, closes } = makeCard(document, { dismissible: true });
  node.dispatch('click', { target: a }); // inside the card — ignored
  assert.deepEqual(closes, []);
  // HAT FIX 2 (M15 F2 Leg 4 HAT fixes — H6): backdrop dismiss is now
  // press-gated — a real backdrop click starts its press ON the backdrop too.
  node.dispatch('pointerdown', { target: node });
  node.dispatch('click', { target: node }); // the backdrop itself
  assert.deepEqual(closes, ['outside-click']);
});

// HAT FIX 2 (M15 F2 Leg 4 HAT fixes — H6): the primary regression case — a
// text-selection drag that STARTS inside the card and RELEASES on the
// backdrop synthesizes a click whose target resolves to the backdrop (the
// nearest common ancestor). Must NOT dismiss: the press did not start there.
test('attachModalCard (dismissible): a press starting INSIDE the card and releasing on the backdrop does NOT dismiss', () => {
  const document = createDocument();
  const { node, a, closes } = makeCard(document, { dismissible: true });
  node.dispatch('pointerdown', { target: a }); // press starts inside the card
  node.dispatch('click', { target: node }); // synthesized click resolves to the backdrop
  assert.deepEqual(closes, [], 'the press did not start on the backdrop — must not dismiss');
  // A subsequent GENUINE backdrop press+click still dismisses (the gate resets).
  node.dispatch('pointerdown', { target: node });
  node.dispatch('click', { target: node });
  assert.deepEqual(closes, ['outside-click']);
});

test('attachModalCard (dismissible:false): Escape and backdrop click do NOT close', () => {
  const document = createDocument();
  const { node, closes } = makeCard(document, { dismissible: false });
  node.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  node.dispatch('click', { target: node });
  assert.deepEqual(closes, [], 'a non-dismissible card swallows Escape + backdrop');
});

test('attachModalCard (dismissible:false): Tab still traps focus (cycle never leaks)', () => {
  const document = createDocument();
  const { node, a, b } = makeCard(document, { dismissible: false });
  a.focus();
  node.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(document.activeElement, b, 'Tab cycles even when non-dismissible');
});

// ---------------------------------------------------------------------------
// attachBackdropPressGate — the shared HAT FIX 2 (M15 F2 Leg 4 HAT fixes,
// H6) helper. Exercised directly here since it is the SAME logic wired at
// all four backdrop sites (attachModalCard above, and menu-overlay.js's
// three hand-rolled siblings — new-container dialog, vault-picker,
// cert-picker — which deliberately do NOT go through attachModalCard). A
// direct unit test of the helper is the practical net for all four: those
// three sites live in menu-overlay.js, an IIFE with no controller test.
// ---------------------------------------------------------------------------

function makeBackdropCard(document) {
  const node = document.createElement('div');
  const inner = document.createElement('button');
  node.appendChild(inner);
  const dismissals = [];
  attachBackdropPressGate({ node, dismiss: () => dismissals.push('dismiss') });
  return { node, inner, dismissals };
}

test('attachBackdropPressGate: press AND click both on the backdrop dismisses', () => {
  const document = createDocument();
  const { node, dismissals } = makeBackdropCard(document);
  node.dispatch('pointerdown', { target: node });
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, ['dismiss']);
});

test('attachBackdropPressGate: a click with no preceding pointerdown does NOT dismiss', () => {
  const document = createDocument();
  const { node, dismissals } = makeBackdropCard(document);
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, []);
});

test('attachBackdropPressGate: press inside, click target resolving to the backdrop (drag-release) does NOT dismiss', () => {
  const document = createDocument();
  const { node, inner, dismissals } = makeBackdropCard(document);
  node.dispatch('pointerdown', { target: inner });
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, [], 'the press started inside the card, not on the backdrop');
});

test('attachBackdropPressGate: press on the backdrop, click target resolving inside does NOT dismiss', () => {
  const document = createDocument();
  const { node, inner, dismissals } = makeBackdropCard(document);
  node.dispatch('pointerdown', { target: node });
  node.dispatch('click', { target: inner });
  assert.deepEqual(dismissals, [], 'the click itself must also land on the backdrop');
});

test('attachBackdropPressGate: the gate resets after every click, both dismiss and no-dismiss branches', () => {
  const document = createDocument();
  const { node, inner, dismissals } = makeBackdropCard(document);
  // No-dismiss branch (press inside) resets the flag...
  node.dispatch('pointerdown', { target: inner });
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, []);
  // ...so a bare click with no fresh pointerdown still does not dismiss.
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, []);
  // Dismiss branch resets it too — a stale flag must not survive to the NEXT click.
  node.dispatch('pointerdown', { target: node });
  node.dispatch('click', { target: node });
  assert.deepEqual(dismissals, ['dismiss']);
  node.dispatch('click', { target: node }); // no fresh pointerdown — must not dismiss again
  assert.deepEqual(dismissals, ['dismiss']);
});
