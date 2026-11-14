'use strict';

// The per-tab witness of real pointer input and the admission of the two gesture messages against it
// (Mission 23 Flight 1, leg `vault-fill-trust`): what is recorded, what is ignored on the first line,
// consumption on acceptance ONLY, the rate clock, per-tab isolation, `forget`, and the trace lines.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGestureWitness } = require('../../src/main/vault/gesture-witness');

const ORIGIN = 'https://example.com';
const BOX = { box: { x: 100, y: 50, width: 30, height: 16 } };

function make() {
  let t = 10000;
  const lines = [];
  const w = createGestureWitness({ now: () => t, trace: (l) => lines.push(l) });
  return {
    w,
    lines,
    advance: (ms) => {
      t += ms;
    },
    click: (wcId, x = 115, y = 58, gap = 60) => {
      w.onInput(wcId, { type: 'mouseDown', button: 'left', x, y });
      t += gap;
      w.onInput(wcId, { type: 'mouseUp', button: 'left', x, y });
    },
    admit: (wcId, over = {}) => w.admit({ kind: 'gesture', wcId, message: BOX, zoom: 1, origin: ORIGIN, ...over })
  };
}

test('only a left press, a left release and a right press are recorded; every other event is ignored on the first line', () => {
  const m = make();
  for (const input of [
    { type: 'mouseMove', x: 1, y: 1 },
    { type: 'mouseWheel', x: 1, y: 1 },
    { type: 'keyDown', keyCode: 'A' },
    { type: 'char', keyCode: 'a' },
    { type: 'rawKeyDown' },
    { type: 'mouseUp', button: 'right', x: 115, y: 58 }, // a right RELEASE is not recorded
    { type: 'mouseDown', button: 'middle', x: 115, y: 58 },
    { type: 'mouseDown', button: 'left', x: NaN, y: 1 },
    { type: 'mouseDown', button: 'left', x: 1 },
    null,
    undefined
  ]) {
    m.w.onInput(7, input);
  }
  assert.equal(m.w._size(), 0, 'nothing recorded, no per-tab state even created');
  m.click(7);
  assert.equal(m.w._size(), 1);
});

test('a real click inside the box is accepted, traced as accepted, and CONSUMED (one click raises at most one sheet)', () => {
  const m = make();
  m.click(5);
  m.advance(100);
  assert.deepEqual(m.admit(5), { ok: true });
  assert.deepEqual(m.lines, ['[vault-gesture] accepted']);
  // The same click again (past the rate interval so only consumption can refuse it).
  m.advance(1500);
  assert.deepEqual(m.admit(5), { ok: false, reason: 'no-real-input' });
  assert.equal(m.lines.at(-1), '[vault-gesture] refused reason=no-real-input');
  // A second real click is a new witness.
  m.click(5);
  assert.deepEqual(m.admit(5), { ok: true });
});

test("a REFUSAL consumes nothing: a bogus message sent first does not burn the operator's real click", () => {
  const m = make();
  m.click(5);
  // A page's message with a box nowhere near the click: refused...
  assert.deepEqual(m.admit(5, { message: { box: { x: 900, y: 900, width: 30, height: 16 } } }), {
    ok: false,
    reason: 'outside-box'
  });
  // ...a malformed one: refused...
  assert.deepEqual(m.admit(5, { message: {} }), { ok: false, reason: 'bad-box' });
  // ...a wrong-origin one: refused...
  assert.deepEqual(m.admit(5, { origin: null }), { ok: false, reason: 'origin' });
  // ...and the real icon message that follows still gets the click.
  assert.deepEqual(m.admit(5), { ok: true });
});

test('the rate clock starts on acceptance: a second accepted gesture inside the interval is refused, with its own click', () => {
  const m = make();
  m.click(5);
  assert.deepEqual(m.admit(5), { ok: true });
  m.click(5, 115, 58, 10); // a second real click right away
  assert.deepEqual(m.admit(5), { ok: false, reason: 'rate' });
  assert.equal(m.lines.at(-1), '[vault-gesture] refused reason=rate');
  // A refused-for-rate message did not consume the second click: after the interval it is accepted.
  m.advance(1000);
  assert.deepEqual(m.admit(5), { ok: true });
});

test('no input at all, or input on another tab: no-real-input (state is strictly per tab)', () => {
  const m = make();
  assert.deepEqual(m.admit(5), { ok: false, reason: 'no-real-input' });
  m.click(6);
  assert.deepEqual(m.admit(5), { ok: false, reason: 'no-real-input' }, "tab 6's click is not tab 5's");
  assert.deepEqual(m.admit(6), { ok: true });
  // Accepting for tab 6 starts tab 6's rate clock only.
  m.click(5);
  assert.deepEqual(m.admit(5), { ok: true });
});

test('icon menu: a right press admits it with its own trace prefix, consumed on acceptance, with an independent rate clock', () => {
  const m = make();
  m.w.onInput(5, { type: 'mouseDown', button: 'right', x: 115, y: 58 });
  const iconMenu = (over = {}) =>
    m.w.admit({ kind: 'icon-menu', wcId: 5, message: BOX, zoom: 1, origin: ORIGIN, ...over });
  assert.deepEqual(iconMenu({ message: {} }), { ok: false, reason: 'bad-box' });
  assert.equal(m.lines.at(-1), '[vault-icon-menu] refused reason=bad-box');
  assert.deepEqual(iconMenu(), { ok: true });
  assert.equal(m.lines.at(-1), '[vault-icon-menu] accepted');
  assert.deepEqual(iconMenu(), { ok: false, reason: 'no-real-input' }, 'consumed');
  // A left click does not satisfy the icon menu, and the icon menu did not consume it.
  m.click(5);
  assert.deepEqual(iconMenu(), { ok: false, reason: 'no-real-input' });
  assert.deepEqual(m.admit(5), { ok: true }, 'the gesture kind has its own rate clock');
});

test('zoom: the live factor scales the box when admitting', () => {
  const m = make();
  m.click(5, 172.5, 87); // the icon centre at zoom 1.5
  assert.deepEqual(m.admit(5, { zoom: 1 }), { ok: false, reason: 'outside-box' });
  assert.deepEqual(m.admit(5, { zoom: 1.5 }), { ok: true });
});

test("forget clears a tab's record (tab destroyed); a later gesture has no witnessed input", () => {
  const m = make();
  m.click(5);
  m.w.forget(5);
  assert.equal(m.w._size(), 0);
  assert.deepEqual(m.admit(5), { ok: false, reason: 'no-real-input' });
  m.w.forget(999); // unknown id: a no-op
});

test('the trace carries a decision only: no URL, coordinate, title or box', () => {
  const m = make();
  m.click(5, 115.5, 58.25);
  m.admit(5);
  m.admit(5, { origin: null });
  m.admit(5, { message: {} });
  for (const line of m.lines) {
    assert.match(
      line,
      /^\[vault-(gesture|icon-menu)\] (accepted|refused reason=(origin|no-real-input|bad-box|outside-box|rate))$/
    );
    assert.ok(!/https?:|115|58|example/.test(line), line);
  }
});
