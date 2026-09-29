'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../../src/renderer/chrome/external-urls-controller.js');
}

async function tick() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

async function setup() {
  const { createExternalUrlsController } = await load();
  let listener = null;
  const calls = [];
  const controller = createExternalUrlsController({
    onOpenExternalUrls: (cb) => {
      listener = cb;
    },
    createTab: (...args) => {
      calls.push(args);
      return {};
    },
    logger: { warn: () => {} }
  });
  return { controller, calls, emit: (urls) => listener(urls) };
}

test('subscribes at construction; arrivals before releaseBoot are held', async () => {
  const { calls, emit } = await setup();
  emit(['https://a.test/']);
  await tick();
  assert.equal(calls.length, 0);
});

test('held arrivals drain in arrival order after releaseBoot; later arrivals are immediate', async () => {
  const { controller, calls, emit } = await setup();
  emit(['https://a.test/']);
  emit(['https://b.test/']);
  controller.releaseBoot();
  await tick();
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['https://a.test/', 'https://b.test/'],
    'two separate arrivals both open (no collapse), in order'
  );
  emit(['https://c.test/']);
  await tick();
  assert.equal(calls.length, 3);
});

test('releaseBoot is idempotent', async () => {
  const { controller, calls, emit } = await setup();
  controller.releaseBoot();
  controller.releaseBoot();
  emit(['https://a.test/']);
  await tick();
  assert.equal(calls.length, 1);
});

test('N=1: createTab(url, null) with no opts; N=3: first two background, last activates', async () => {
  const one = await setup();
  one.controller.releaseBoot();
  one.emit(['https://a.test/']);
  await tick();
  assert.deepEqual(one.calls, [['https://a.test/', null]]);

  const three = await setup();
  three.controller.releaseBoot();
  three.emit(['https://a.test/', 'https://b.test/', 'https://c.test/']);
  await tick();
  assert.deepEqual(three.calls, [
    ['https://a.test/', null, { background: true }],
    ['https://b.test/', null, { background: true }],
    ['https://c.test/', null]
  ]);
});

test('never passes trusted or a container', async () => {
  const { controller, calls, emit } = await setup();
  controller.releaseBoot();
  emit(['https://a.test/', 'https://b.test/']);
  await tick();
  for (const [, container, opts] of calls) {
    assert.equal(container, null);
    assert.equal(opts !== undefined && 'trusted' in opts, false);
  }
});

test('ignores non-array / empty payloads and non-string entries', async () => {
  const { controller, calls, emit } = await setup();
  controller.releaseBoot();
  emit(undefined);
  emit(null);
  emit('https://a.test/');
  emit([]);
  emit({ urls: ['https://a.test/'] });
  emit([5, null]);
  await tick();
  assert.equal(calls.length, 0);
});

test('a throwing createTab does not stop the remaining URLs', async () => {
  const { createExternalUrlsController } = await load();
  let listener;
  const opened = [];
  const controller = createExternalUrlsController({
    onOpenExternalUrls: (cb) => {
      listener = cb;
    },
    createTab: (url) => {
      if (url.includes('bad')) throw new Error('boom');
      opened.push(url);
    },
    logger: { warn: () => {} }
  });
  controller.releaseBoot();
  listener(['https://bad.test/', 'https://ok.test/']);
  await tick();
  assert.deepEqual(opened, ['https://ok.test/']);
});
