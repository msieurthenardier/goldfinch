'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/window-factory-harness');

test('tear-off overlay uses the per-window manager and is torn down in lifecycle order', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  assert.equal(rec.tearoffOverlay, h.managers.tearoff, 'record owns the manager instance');
  assert.equal(typeof h.managerDeps.tearoff.createOverlayView, 'function', 'manager receives the lazy view constructor');

  h.log.length = 0;
  rec.win.emit('close');
  assert.deepEqual(h.log.slice(0, 4), [
    'find-teardown',
    'tearoff-teardown',
    'sheet-close:teardown',
    'sheet-teardown'
  ]);
  assert.equal(rec.tearoffOverlay, null, 'record path is nulled across close to closed');
});

test('missing registry record cannot skip tear-off teardown', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  h.records.delete(rec.win.id);
  h.log.length = 0;
  rec.win.emit('close');
  assert.ok(h.log.includes('tearoff-teardown'));
});

test('tear-off view stays preload-free, sandboxed, transparent, and lazy', () => {
  const h = createHarness();
  h.factory.createWindow();
  assert.equal(h.viewOptions.length, 1, 'only chrome is constructed at window creation');
  const view = h.managerDeps.tearoff.createOverlayView();
  assert.deepEqual(view.opts.webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  });
  assert.equal(view.backgroundColor, '#00000000');
  assert.deepEqual(view.webContents.loadedFiles, ['/app/renderer/tearoff-overlay.html']);
});
