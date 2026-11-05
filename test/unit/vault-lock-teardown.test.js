'use strict';

// Sortie 06 Leg 1 (AC15): the vault-lock teardown ORDER - every window's save prompt closes
// `vault-lock` BEFORE dropAllCaptures (no "expired" flash), then the credential sheets close,
// then the lock state broadcasts. Plus the source pin that main.js's onLock really calls it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runVaultLockTeardown } = require('../../src/main/vault-lock-teardown');
const { maskComments } = require('../helpers/source-scan');
const { makeHarness, presentShown } = require('../helpers/save-prompt-fakes');

test('AC15: prompts close vault-lock in EVERY window BEFORE dropAllCaptures, then sheets, then broadcast', () => {
  const order = [];
  const records = [
    { savePrompt: { close: (r) => order.push(['close', 'A', r]) } },
    { savePrompt: null },
    { savePrompt: { close: (r) => order.push(['close', 'B', r]) } }
  ];
  runVaultLockTeardown({
    records: () => records,
    vaultHuman: { dropAllCaptures: () => order.push(['dropAll']) },
    closeSheets: () => order.push(['sheets']),
    broadcast: () => order.push(['broadcast'])
  });
  assert.deepEqual(order, [
    ['close', 'A', 'vault-lock'],
    ['close', 'B', 'vault-lock'],
    ['dropAll'],
    ['sheets'],
    ['broadcast']
  ]);
});

test('AC15: a throwing prompt close never skips the capture drop; an absent vaultHuman is tolerated', () => {
  const order = [];
  runVaultLockTeardown({
    records: () => [
      {
        savePrompt: {
          close: () => {
            throw new Error('x');
          }
        }
      }
    ],
    vaultHuman: { dropAllCaptures: () => order.push('dropAll') },
    closeSheets: () => order.push('sheets'),
    broadcast: () => order.push('broadcast')
  });
  assert.deepEqual(order, ['dropAll', 'sheets', 'broadcast']);
  assert.doesNotThrow(() =>
    runVaultLockTeardown({ records: () => [], vaultHuman: null, closeSheets() {}, broadcast() {} })
  );
});

test('AC15 (real manager): with the prompt SHOWN, the lock closes it `vault-lock` and the following drop does NOT flash expired', () => {
  const h = makeHarness();
  presentShown(h);
  const results = [];
  h.views[0].webContents.send = (c) => results.push(c);
  runVaultLockTeardown({
    records: () => [{ savePrompt: h.manager }],
    vaultHuman: { dropAllCaptures: () => h.manager.onCaptureDropped({ captureId: 'cap1' }) },
    closeSheets() {},
    broadcast() {}
  });
  assert.equal(results.includes('save-prompt:result'), false, 'no expired result state');
  assert.deepEqual(
    h.chromeSends.map(([, p]) => p.reason),
    ['vault-lock']
  );
  assert.deepEqual(h.dismisses, []);
});

test('AC15 source pin: main.js onLock calls runVaultLockTeardown (regex-target, wrap-insensitive, mutation-guarded)', () => {
  const src = maskComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8'));
  const re = /onLock:\s*\(\)\s*=>\s*\{[\s\S]*?runVaultLockTeardown\(\{[\s\S]*?\}\);\s*\},\s*onUnlock/;
  assert.ok(re.test(src), 'onLock must delegate to runVaultLockTeardown');
  // assertMutated: removing the call must make the pin fail (a no-op replace would pass vacuously).
  const mutated = src.replace(/runVaultLockTeardown\(\{/, 'noopTeardown({');
  assert.notEqual(mutated, src, 'the mutation actually changed the source');
  assert.equal(re.test(mutated), false, 'the pin fails on the neutered source');
  // and the retired direct call is gone from onLock
  assert.equal(/onLock:\s*\(\)\s*=>\s*\{[\s\S]*?_vaultHuman\?\.dropAllCaptures\(\)[\s\S]*?onUnlock/.test(src), false);
});
