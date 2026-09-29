'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultBrowserRowModel: model, COPY } = require('../../src/shared/default-browser-row-model');

const sup = (platform, isDefault) => ({ supported: true, reason: null, isDefault, platform });
const unsup = (reason) => ({ supported: false, reason, isDefault: null, platform: 'linux' });

test('dev: copy + disabled button', () => {
  const m = model({ status: unsup('dev') });
  assert.equal(m.text, 'Available in installed builds only.');
  assert.equal(m.buttonDisabled, true);
  assert.equal(m.buttonHidden, false);
});

test('appimage: mentions integrating or the .deb, disabled', () => {
  const m = model({ status: unsup('appimage') });
  assert.match(m.text, /AppImage/);
  assert.match(m.text, /\.deb/);
  assert.equal(m.buttonDisabled, true);
});

test('unknown platform: disabled', () => {
  const m = model({ status: unsup('platform') });
  assert.equal(m.text, COPY.platform);
  assert.equal(m.buttonDisabled, true);
});

test('linux/darwin default true hides the button; false shows it', () => {
  for (const p of ['linux', 'darwin']) {
    const yes = model({ status: sup(p, true) });
    assert.equal(yes.text, 'Goldfinch is your default browser.');
    assert.equal(yes.buttonHidden, true);
    const no = model({ status: sup(p, false) });
    assert.equal(no.text, 'Goldfinch is not your default browser.');
    assert.equal(no.buttonHidden, false);
    assert.equal(no.buttonDisabled, false);
  }
});

test('win32 supported: Default apps copy, button shown with its own label', () => {
  const m = model({ status: sup('win32', null) });
  assert.equal(m.text, 'Choose Goldfinch under Windows Default apps.');
  assert.equal(m.buttonHidden, false);
  assert.equal(m.buttonLabel, 'Open Default apps');
});

test('failure line on supported linux/darwin only', () => {
  assert.equal(model({ status: sup('linux', false), lastResult: { ok: false } }).failureText, COPY.failure);
  assert.equal(model({ status: sup('linux', false), lastResult: { ok: true } }).failureText, '');
  assert.equal(model({ status: unsup('dev'), lastResult: { ok: false } }).failureText, '');
});

test('in flight disables the button', () => {
  assert.equal(model({ status: sup('linux', false), inFlight: true }).buttonDisabled, true);
  assert.equal(model({ status: sup('win32', null), inFlight: true }).buttonDisabled, true);
});

test('null/garbage input never throws', () => {
  for (const input of [undefined, null, {}, { status: 5 }, { status: null }, { status: { supported: true } }, 'x']) {
    const m = model(/** @type {any} */ (input));
    assert.equal(typeof m.text, 'string');
  }
  assert.equal(model({ status: null }).buttonDisabled, true);
});
