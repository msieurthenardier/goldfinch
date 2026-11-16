'use strict';

// The automation page's moved-port line (Mission 23 Flight 2, leg `port-and-permissions`, DD5 / AC6) against a
// fake element, with the REAL shared line builder injected exactly as automation.js does.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderPortMoved } = require('../../src/renderer/pages/automation-port-moved.js');
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
