'use strict';

// The dev-only `--insecure-tls-fixtures` launch-flag decision (M14 F1 L3,
// flight DD6) — the AC pin: Chromium's `ignore-certificate-errors` switch is
// reachable ONLY via the explicit flag on the dev/automation launch script; no
// flag → no switch. Pure helper (the decideOzonePlatform shape), tested via
// Node's synchronous require(esm). A source pin additionally asserts the
// switch literal lives ONLY in the helper — dev-launch.mjs composes its args
// exclusively from the helper's output, so there is no second path to it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { decideInsecureTlsFixtures, INSECURE_TLS_FLAG } = require('../../scripts/insecure-tls-flag.mjs');

test('no flag → argv forwarded untouched (fresh copy) and NO electron switches', () => {
  const argv = ['--automation-dev', '--ozone-platform=wayland'];
  const res = decideInsecureTlsFixtures(argv);
  assert.deepEqual(res.forwardArgs, argv);
  assert.notEqual(res.forwardArgs, argv, 'a copy — the helper never aliases caller state');
  assert.deepEqual(res.electronSwitches, []);
});

test('flag present → flag STRIPPED from the forwarded argv and exactly the ignore-certificate-errors switch unlocked', () => {
  const res = decideInsecureTlsFixtures(['--automation-dev', INSECURE_TLS_FLAG, '--foo']);
  assert.deepEqual(res.forwardArgs, ['--automation-dev', '--foo'], 'the flag never reaches Electron (unknown-switch noise)');
  assert.deepEqual(res.electronSwitches, ['--ignore-certificate-errors']);
});

test('duplicate flags are all stripped; empty/absent argv is tolerated', () => {
  const res = decideInsecureTlsFixtures([INSECURE_TLS_FLAG, INSECURE_TLS_FLAG]);
  assert.deepEqual(res.forwardArgs, []);
  assert.deepEqual(res.electronSwitches, ['--ignore-certificate-errors']);
  assert.deepEqual(decideInsecureTlsFixtures([]), { forwardArgs: [], electronSwitches: [] });
  assert.deepEqual(decideInsecureTlsFixtures(/** @type {any} */ (undefined)), { forwardArgs: [], electronSwitches: [] });
});

test('source pin: the switch literal lives ONLY in the helper — dev-launch.mjs has no independent path to it, and no production code carries it', () => {
  const repoRoot = path.join(__dirname, '../..');
  const devLaunch = fs.readFileSync(path.join(repoRoot, 'scripts/dev-launch.mjs'), 'utf8');
  assert.equal(
    devLaunch.includes('ignore-certificate-errors'),
    false,
    'dev-launch.mjs must compose args from decideInsecureTlsFixtures — never append the switch itself'
  );
  assert.equal(
    devLaunch.includes('decideInsecureTlsFixtures'),
    true,
    'dev-launch.mjs must route argv through the gated helper'
  );
  // No main-process involvement by construction (leg guidance step 5): the
  // switch appears nowhere under src/.
  const srcDirs = ['src/main', 'src/shared', 'src/renderer', 'src/preload'];
  for (const dir of srcDirs) {
    const stack = [path.join(repoRoot, dir)];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, entry.name);
        if (entry.isDirectory()) stack.push(p);
        else if (/\.(js|mjs|cjs|ts|html)$/.test(entry.name)) {
          assert.equal(
            fs.readFileSync(p, 'utf8').includes('ignore-certificate-errors'),
            false,
            `${path.relative(repoRoot, p)} must not reference the TLS-bypass switch (dev-script-only by construction)`
          );
        }
      }
    }
  }
});
