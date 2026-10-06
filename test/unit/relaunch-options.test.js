'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relaunchOptions } = require('../../src/main/relaunch-options');

test('APPIMAGE becomes execPath; nothing else is read', () => {
  assert.deepEqual(relaunchOptions({ env: { APPIMAGE: '/a/b.AppImage', OTHER: 'x' } }), {
    execPath: '/a/b.AppImage'
  });
});

test('absent/empty APPIMAGE yields {} and never an env key', () => {
  for (const env of [{}, { APPIMAGE: '' }, { GOLDFINCH_AUTOMATION_DEV_MINT: '1' }, undefined]) {
    const out = relaunchOptions({ env });
    assert.deepEqual(out, {});
    assert.equal('env' in out, false);
  }
  assert.deepEqual(relaunchOptions(), {});
});
