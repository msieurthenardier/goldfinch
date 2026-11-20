'use strict';

// The automation page's moved-port line (Mission 23 Flight 2, leg `port-and-permissions`, DD5 / AC6) against a
// fake element, with the REAL shared line builder injected exactly as automation.js does.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderPortMoved, portFieldState, savedPortOf } = require('../../src/renderer/pages/automation-port-moved.js');
const { portMovedLine } = require('../../src/shared/automation-port-note.js');

const fakeEl = () => ({ textContent: '', hidden: true });
const run = (el, status) => renderPortMoved({ el, status, portMovedLine });

test('shows the line when bound differs from configured, and unhides the element', () => {
  const el = fakeEl();
  run(el, { bound: true, port: 49708, configuredPort: 49707 });
  assert.equal(el.textContent, 'Listening on 49708 — 49707 was in use');
  assert.equal(el.hidden, false);
});

test('clears and hides when the ports match (a re-bind back to the configured port)', () => {
  const el = fakeEl();
  run(el, { bound: true, port: 49708, configuredPort: 49707 });
  run(el, { bound: true, port: 49707, configuredPort: 49707 });
  assert.equal(el.textContent, '');
  assert.equal(el.hidden, true);
});

test('says nothing when not bound (failed bind, or automation off), and with a status lacking configuredPort', () => {
  for (const status of [
    { bound: false, port: 49707, configuredPort: 49707 },
    { bound: false, port: 49707, configuredPort: 50000 },
    { bound: true, port: 49708 },
    null,
    undefined
  ]) {
    const el = fakeEl();
    el.textContent = 'stale';
    el.hidden = false;
    assert.equal(run(el, status), null);
    assert.equal(el.textContent, '');
    assert.equal(el.hidden, true);
  }
});

test('a missing element is tolerated', () => {
  assert.equal(run(null, { bound: true, port: 2, configuredPort: 1 }), 'Listening on 2 — 1 was in use');
});

test('automation.js wires it into renderStatus and the page has the element', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '../../src/renderer/pages');
  const js = fs.readFileSync(path.join(dir, 'automation.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'automation.html'), 'utf8');
  assert.match(js, /renderPortMoved\(\{\s*el:\s*portMovedEl,\s*status,\s*portMovedLine\s*\}\)/);
  assert.match(html, /id="automation-port-moved"/);
});

// Squawk 0160: the hint and Save's dirty state both compare the field with the SAVED port, never the bound one.
test('bound != saved, field equal to the saved port: no unsaved hint, Save disabled', () => {
  const r = portFieldState({ value: '49153', savedPort: 49153, bound: true });
  assert.equal(r.hint, '');
  assert.equal(r.saveDisabled, true);
});

test('bound != saved, field edited to another value: hint shown, Save enabled', () => {
  const r = portFieldState({ value: '49200', savedPort: 49153, bound: true });
  assert.equal(r.hint, '(unsaved — applies on Save)');
  assert.equal(r.saveDisabled, false);
});

test('the field equal to the BOUND port while differing from the saved one is unsaved', () => {
  const r = portFieldState({ value: '49707', savedPort: 49153, bound: true });
  assert.equal(r.hint, '(unsaved — applies on Save)');
});

test('not bound: no hint; invalid or empty values never enable Save', () => {
  assert.equal(portFieldState({ value: '49200', savedPort: 49153, bound: false }).hint, '');
  for (const value of ['', '80', '70000', 'abc', '1.5']) {
    assert.equal(portFieldState({ value, savedPort: 49153, bound: true }).saveDisabled, true);
  }
});

test('after Save with bound != saved the field is seeded with the submitted (saved) port and reads clean', () => {
  // automation.js seeds from the submitted value: under an env pin status.configuredPort is the env port.
  const saved = 49153;
  const r = portFieldState({ value: String(saved), savedPort: saved, bound: true });
  assert.deepEqual(r, { hint: '', saveDisabled: true });
});

test('savedPortOf is the boot fallback only: configuredPort, else port, else null', () => {
  assert.equal(savedPortOf({ port: 49707, configuredPort: 49153 }), 49153);
  assert.equal(savedPortOf({ port: 5000 }), 5000);
  assert.equal(savedPortOf(null), null);
});
