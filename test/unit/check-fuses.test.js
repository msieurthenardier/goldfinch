'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EXPECTED_FUSES, RUNTIME_FUSES, decideFuses } = require('../../scripts/check-fuses.mjs');

const pkg = require('../../package.json');

const toStates = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v ? 'Enabled' : 'Disabled']));

// package.json electronFuses key -> fuse name in the wire
const KEY_TO_FUSE = {
  runAsNode: 'RunAsNode',
  enableCookieEncryption: 'EnableCookieEncryption',
  enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable',
  enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments'
};

test('package.json electronFuses is exactly the agreed setting and agrees with the table', () => {
  const cfg = pkg.build && pkg.build.electronFuses;
  assert.ok(cfg, 'package.json build.electronFuses is missing');
  assert.deepEqual(cfg, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    resetAdHocDarwinSignature: true
  });
  for (const [key, value] of Object.entries(cfg)) {
    if (key === 'resetAdHocDarwinSignature') continue;
    const fuse = KEY_TO_FUSE[key];
    assert.ok(fuse, `unmapped electronFuses key ${key}`);
    assert.equal(EXPECTED_FUSES[fuse], value, `${key} disagrees with EXPECTED_FUSES.${fuse}`);
  }
  for (const name of RUNTIME_FUSES) assert.equal(EXPECTED_FUSES[name], false);
});

test('@electron/fuses is an explicit exact dev dependency', () => {
  assert.match(pkg.devDependencies['@electron/fuses'], /^\d+\.\d+\.\d+$/);
});

test('decideFuses passes the expected table', () => {
  assert.deepEqual(decideFuses(toStates(EXPECTED_FUSES)), { ok: true, problems: [] });
});

test('decideFuses fails on each runtime fuse being on, one at a time', () => {
  for (const name of RUNTIME_FUSES) {
    const v = decideFuses({ ...toStates(EXPECTED_FUSES), [name]: 'Enabled' });
    assert.equal(v.ok, false, name);
    assert.ok(v.problems.some((p) => p.includes(name) && p.includes('RUNTIME FUSE ON')));
  }
});

test('decideFuses fails on any other fuse changing, a missing fuse, and an unknown fuse', () => {
  for (const name of Object.keys(EXPECTED_FUSES)) {
    if (RUNTIME_FUSES.includes(name)) continue;
    const flipped = EXPECTED_FUSES[name] ? 'Disabled' : 'Enabled';
    assert.equal(decideFuses({ ...toStates(EXPECTED_FUSES), [name]: flipped }).ok, false, name);
  }
  const missing = toStates(EXPECTED_FUSES);
  delete missing.OnlyLoadAppFromAsar;
  assert.equal(decideFuses(missing).ok, false);
  assert.equal(decideFuses({ ...toStates(EXPECTED_FUSES), Index99: 'Enabled' }).ok, false);
});

test('the script exits non-zero for a missing path and a non-Electron file', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, '..', '..', 'scripts', 'check-fuses.mjs');
  const a = spawnSync(process.execPath, [script, path.join(__dirname, 'no-such-file')]);
  assert.notEqual(a.status, 0);
  const b = spawnSync(process.execPath, [script, __filename]);
  assert.notEqual(b.status, 0);
  assert.match(String(b.stderr), /not an Electron binary/);
});
