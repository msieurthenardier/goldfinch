'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHarness } = require('./helpers/jar-ipc-harness');

// Registration surface
// ---------------------------------------------------------------------------
test('registers exactly the fourteen chrome + fourteen internal jar channels, no others', (t) => {
  const h = makeHarness(t);
  assert.deepEqual(
    [...h.handlers.keys()].sort(),
    [
      'internal-jars-add',
      'internal-jars-clear-data',
      'internal-jars-cookies-list',
      'internal-jars-cookies-remove',
      'internal-jars-cookies-value',
      'internal-jars-get-default',
      'internal-jars-list',
      'internal-jars-remove',
      'internal-jars-rename',
      'internal-jars-set-default',
      'internal-jars-set-retention',
      'internal-jars-sitedata-list',
      'internal-jars-sitedata-remove-origin',
      'internal-jars-wipe',
      'jars-add',
      'jars-clear-data',
      'jars-cookies-list',
      'jars-cookies-remove',
      'jars-cookies-value',
      'jars-get-default',
      'jars-list',
      'jars-remove',
      'jars-rename',
      'jars-set-default',
      'jars-set-retention',
      'jars-sitedata-list',
      'jars-sitedata-remove-origin',
      'jars-wipe'
    ]
  );
});
// ---------------------------------------------------------------------------

test('the returned broadcastJarsChanged emits the same { containers, defaultId } payload', (t) => {
  const h = makeHarness(t);
  h.broadcastJarsChanged();
  const b = h.broadcasts();
  assert.equal(b.length, 1);
  assert.equal(b[0].channel, 'jars-changed');
  assert.deepEqual(b[0].payload.containers.map((x) => x.id), ['personal', 'work']);
  assert.equal(b[0].payload.defaultId, 'personal');
});
