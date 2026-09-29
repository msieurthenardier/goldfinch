'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDefaultBrowser, WIN_DEFAULT_APPS_URL } = require('../../src/main/default-browser');
const { maskComments, collectSources } = require('../helpers/source-scan');

function make({ isPackaged = true, platform = 'linux', env = {}, defaults = [true, true], throwOn = null } = {}) {
  const calls = [];
  const app = {
    isPackaged,
    isDefaultProtocolClient(s) {
      calls.push(['is', s]);
      if (throwOn === 'is') throw new Error('boom');
      return defaults[s === 'http' ? 0 : 1];
    },
    setAsDefaultProtocolClient(s) {
      calls.push(['set', s]);
      if (throwOn === 'set') throw new Error('boom');
      return defaults[s === 'http' ? 0 : 1];
    }
  };
  const shell = {
    async openExternal(u) {
      calls.push(['open', u]);
      if (throwOn === 'open') throw new Error('nohandler');
    }
  };
  const logs = [];
  const db = createDefaultBrowser({ app, shell, platform, env, logger: { warn: (m) => logs.push(m) } });
  return { db, calls, logs };
}

test('dev is unsupported and makes no calls', async () => {
  const { db, calls } = make({ isPackaged: false });
  assert.deepEqual(db.getStatus(), { supported: false, reason: 'dev', isDefault: null, platform: 'linux' });
  assert.deepEqual((await db.makeDefault()).ok, false);
  assert.deepEqual(calls, []);
});

test('AppImage is unsupported and makes no calls', async () => {
  const { db, calls } = make({ env: { APPIMAGE: '/x.AppImage' } });
  assert.equal(db.getStatus().reason, 'appimage');
  assert.equal((await db.makeDefault()).ok, false);
  assert.deepEqual(calls, []);
});

test('unknown platform is unsupported and makes no calls', async () => {
  const { db, calls } = make({ platform: 'freebsd' });
  assert.equal(db.getStatus().reason, 'platform');
  assert.equal((await db.makeDefault()).ok, false);
  assert.deepEqual(calls, []);
});

test('APPIMAGE only matters on linux', () => {
  const { db } = make({ platform: 'win32', env: { APPIMAGE: '1' } });
  assert.equal(db.getStatus().supported, true);
});

test('linux both true: isDefault true and make-default ok', async () => {
  const { db } = make();
  assert.deepEqual(db.getStatus(), { supported: true, reason: null, isDefault: true, platform: 'linux' });
  const r = await db.makeDefault();
  assert.equal(r.ok, true);
  assert.equal(r.status.isDefault, true);
});

test('linux one false: isDefault false, ok false, both schemes still attempted', async () => {
  const { db, calls } = make({ defaults: [false, true] });
  assert.equal(db.getStatus().isDefault, false);
  calls.length = 0;
  const r = await db.makeDefault();
  assert.equal(r.ok, false);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'set'),
    [
      ['set', 'http'],
      ['set', 'https']
    ]
  );
});

test('darwin uses the same protocol-client path', async () => {
  const { db } = make({ platform: 'darwin' });
  assert.equal(db.getStatus().isDefault, true);
  assert.equal((await db.makeDefault()).ok, true);
});

test('win32: literal to openExternal, isDefault null, setAsDefaultProtocolClient never called', async () => {
  const { db, calls } = make({ platform: 'win32' });
  assert.equal(db.getStatus().isDefault, null);
  const r = await db.makeDefault();
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [['open', 'ms-settings:defaultapps?registeredAppUser=Goldfinch']]);
  assert.equal(WIN_DEFAULT_APPS_URL, 'ms-settings:defaultapps?registeredAppUser=Goldfinch');
});

test('unsupported states never call isDefaultProtocolClient', () => {
  for (const o of [{ isPackaged: false }, { env: { APPIMAGE: '1' } }, { platform: 'sunos' }]) {
    const { db, calls } = make(o);
    db.getStatus();
    assert.equal(calls.length, 0);
  }
});

test('throwing deps yield ok:false and one log line, never throw', async () => {
  for (const [throwOn, platform] of [
    ['set', 'linux'],
    ['open', 'win32']
  ]) {
    const { db, logs } = make({ throwOn, platform });
    const r = await db.makeDefault();
    assert.equal(r.ok, false);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /ms-settings|http/);
  }
  const { db } = make({ throwOn: 'is' });
  assert.equal(db.getStatus().isDefault, false);
});

test('exactly one openExternal( call site in src/**, in default-browser.js, with the module constant', () => {
  const root = path.join(__dirname, '..', '..', 'src');
  const hits = [];
  for (const file of collectSources(root)) {
    const masked = maskComments(fs.readFileSync(file, 'utf8'));
    for (const m of masked.matchAll(/openExternal\(([^)]*)\)/g)) hits.push([path.basename(file), m[1].trim()]);
  }
  assert.deepEqual(hits, [['default-browser.js', 'WIN_DEFAULT_APPS_URL']]);
});
