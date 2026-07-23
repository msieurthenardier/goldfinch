'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDownloadsController } = require('../../src/renderer/chrome/downloads-controller');

function fakeElement(initialClasses = []) {
  const classes = new Set(initialClasses);
  const listeners = new Map();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
    },
    attrs: new Map(),
    textContent: '',
    title: '',
    focused: false,
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatch(name, event = {}) { listeners.get(name)?.(event); },
    focus() { this.focused = true; },
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20 }),
  };
}

function harness(snapshot = []) {
  const progressHandlers = [];
  const doneHandlers = [];
  const frames = [];
  const timers = [];
  const opens = [];
  const closes = [];
  let clock = 1_000_000;
  const indicator = fakeElement(['hidden']);
  const els = {
    downloadsIndicator: indicator,
    downloadsIndicatorBadge: fakeElement(['hidden']),
    webviews: fakeElement(),
    address: fakeElement(),
  };
  const bridge = {
    downloadsSnapshot: async () => snapshot,
    onDownloadProgress: (cb) => progressHandlers.push(cb),
    onDownloadDone: (cb) => doneHandlers.push(cb),
    openDownloadedFile() {},
    revealDownloadedFile() {},
  };
  let controller;
  controller = createDownloadsController({
    els,
    goldfinch: bridge,
    openOverlayMenu: (_type, model, _anchor, _start, opts) => {
      opens.push({ model, opts });
      return true;
    },
    closeOverlayMenu: (reason) => closes.push(reason),
    triggerOverlayMenu: (_type, open) => {
      controller.overlayState.open = true;
      open();
    },
    openDownloadsPage() {},
    rightSheetAnchor: () => ({ alignRight: 100, y: 0 }),
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame() {},
    scheduleTimeout: (cb, delay) => { timers.push({ cb, delay }); return timers.length; },
    cancelTimeout() {},
    now: () => clock,
  });
  return {
    controller, indicator, progressHandlers, doneHandlers, frames, timers, opens, closes,
    setNow: (value) => { clock = value; },
  };
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('a new window hydrates app-scoped active and recent download state', async () => {
  const h = harness([
    { id: 1, filename: 'active.bin', state: 'progressing', active: true },
    { id: 2, filename: 'recent.bin', state: 'completed', active: false, endTime: 999_999 },
  ]);
  await flushPromises();
  assert.equal(h.indicator.classList.contains('hidden'), false);
  assert.equal(h.indicator.attrs.get('aria-label'), 'Downloading — 1 in progress');
  h.indicator.dispatch('click');
  assert.deepEqual(h.opens.at(-1).model.map((row) => [row.id, row.completed]), [[1, false], [2, true]]);
});

test('download-done schedules an open popup repaint and makes the row actionable', async () => {
  const h = harness();
  await flushPromises();
  h.progressHandlers[0]({ id: 4, filename: 'file.bin', state: 'progressing', received: 1, total: 2 });
  h.indicator.dispatch('click');
  assert.equal(h.opens.at(-1).model[0].completed, false);

  h.doneHandlers[0]({ id: 4, filename: 'file.bin', state: 'completed', savePath: '/trusted/file.bin' });
  assert.equal(h.frames.length, 1);
  h.frames.shift()();
  assert.equal(h.opens.at(-1).model[0].completed, true);
  assert.deepEqual(h.opens.at(-1).opts, { noFocus: true });
});

test('a cancelled terminal event disappears instead of claiming completion', async () => {
  const h = harness();
  await flushPromises();
  h.progressHandlers[0]({ id: 5, filename: 'cancel.bin', state: 'progressing' });
  h.indicator.dispatch('click');
  h.doneHandlers[0]({ id: 5, filename: 'cancel.bin', state: 'cancelled', savePath: null });
  assert.equal(h.indicator.classList.contains('hidden'), true);
  assert.equal(h.indicator.attrs.get('aria-label'), 'Downloads');
  h.frames.shift()();
  assert.deepEqual(h.closes, ['input-empty']);
});

test('expiry closes an open popup instead of leaving stale actionable rows', async () => {
  const h = harness();
  await flushPromises();
  h.doneHandlers[0]({ id: 6, filename: 'done.bin', state: 'completed', savePath: '/trusted/done.bin' });
  h.indicator.dispatch('click');
  h.setNow(1_000_000 + 5 * 60 * 1000);
  h.timers.at(-1).cb();
  assert.equal(h.indicator.classList.contains('hidden'), true);
  h.frames.shift()();
  assert.deepEqual(h.closes, ['input-empty']);
});
