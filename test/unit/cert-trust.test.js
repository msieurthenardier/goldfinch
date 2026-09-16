'use strict';

// Mission 20 Flight 2 Leg 2 (DD1/DD2): cert-trust.js — the certificate-error
// trust decision. Behavior matrix + the AC1/AC7/AC8 source-scan pins.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan');
const { createCertTrust, NO_PARTITION, keyFor } = require('../../src/main/cert-trust');

const MODULE_PATH = path.join(__dirname, '../../src/main/cert-trust.js');

function fakeRegistry(records) {
  return {
    getWindowForGuest(wcId) {
      return records.get(wcId) || null;
    }
  };
}

function makeCallback() {
  const calls = [];
  return { calls, fn: (v) => calls.push(v) };
}

// ---------------------------------------------------------------------------
// AC1 — answered exactly once, synchronously, never throws
// ---------------------------------------------------------------------------

test('AC1: refusal answers callback(false) exactly once', () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 1 },
    'https://bad.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [false]);
});

test('AC1: a remembered key answers callback(true) exactly once', () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const key = keyFor(NO_PARTITION, 'ok.test', 443, 'AA');
  trust.allow(key);
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 1 },
    'https://ok.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [true]);
});

test('AC1: handleCertificateError never throws when `has` throws — callback still fires exactly once with false', () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, logger: { error() {} } });
  // Monkey-patch the returned object's own `has` — handleCertificateError
  // calls it through `api.has`, not a private closure, so this override is
  // actually observed (the design that makes this test possible at all).
  trust.has = () => {
    throw new Error('boom');
  };
  const cb = makeCallback();
  assert.doesNotThrow(() =>
    trust.handleCertificateError(
      { id: 1 },
      'https://bad.test/',
      'net::ERR_CERT_AUTHORITY_INVALID',
      { fingerprint: 'AA' },
      cb.fn,
      true
    )
  );
  assert.deepEqual(cb.calls, [false]);
});

test('AC1: handleCertificateError never throws when the stamp block throws (a poisoned registry entry)', () => {
  const entry = { partition: 'persist:jar-a' };
  Object.defineProperty(entry, 'certFailure', {
    set() {
      throw new Error('stamp exploded');
    }
  });
  const rec = { tabViews: new Map([[1, entry]]) };
  const registry = fakeRegistry(new Map([[1, rec]]));
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const cb = makeCallback();
  assert.doesNotThrow(() =>
    trust.handleCertificateError(
      { id: 1 },
      'https://bad.test/',
      'net::ERR_CERT_AUTHORITY_INVALID',
      { fingerprint: 'AA' },
      cb.fn,
      true
    )
  );
  assert.deepEqual(cb.calls, [false]);
});

test('AC1: a malformed url never throws — resolves to refuse', () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const cb = makeCallback();
  assert.doesNotThrow(() =>
    trust.handleCertificateError(
      { id: 1 },
      'not a url',
      'net::ERR_CERT_AUTHORITY_INVALID',
      { fingerprint: 'AA' },
      cb.fn,
      true
    )
  );
  assert.deepEqual(cb.calls, [false]);
});

// ---------------------------------------------------------------------------
// AC2 — refuse-or-remember; stamps; popups; subframes; non-tab contents
// ---------------------------------------------------------------------------

test('AC2: an unremembered key refuses and stamps entry.certFailure on a main-frame tab entry', () => {
  const entry = { partition: 'persist:jar-a' };
  const rec = { tabViews: new Map([[1, entry]]) };
  const registry = fakeRegistry(new Map([[1, rec]]));
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 1 },
    'https://bad.test/path',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA:BB', data: '' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [false]);
  assert.deepEqual(entry.certFailure, {
    url: 'https://bad.test/path',
    host: 'bad.test',
    port: 443,
    error: 'ERR_CERT_AUTHORITY_INVALID',
    fingerprint: 'AA:BB',
    summary: entry.certFailure.summary
  });
  assert.equal(typeof entry.certFailure.summary, 'object');
  assert.equal(entry.certOverride, undefined);
});

test('AC2: a remembered key allows and stamps entry.certOverride, never certFailure', () => {
  const entry = { partition: 'persist:jar-a' };
  const rec = { tabViews: new Map([[1, entry]]) };
  const registry = fakeRegistry(new Map([[1, rec]]));
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const key = keyFor('persist:jar-a', 'ok.test', 443, 'AA:BB');
  trust.allow(key);
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 1 },
    'https://ok.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA:BB' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [true]);
  assert.equal(entry.certOverride.host, 'ok.test');
  assert.equal(entry.certOverride.port, 443);
  assert.equal(entry.certOverride.fingerprint, 'AA:BB');
  assert.equal(entry.certOverride.error, 'ERR_CERT_AUTHORITY_INVALID');
  // HAT F5: the override needs its OWN summary (this load's actual
  // certificate) — never falls back to the observer's hostname-keyed entry.
  assert.equal(typeof entry.certOverride.summary, 'object');
  assert.equal(entry.certOverride.summary.status, 'overridden');
  assert.equal(entry.certOverride.summary.error, 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(entry.certFailure, undefined);
});

test('AC2: a subframe error is answered but stamps nothing', () => {
  const entry = { partition: 'persist:jar-a' };
  const rec = { tabViews: new Map([[1, entry]]) };
  const registry = fakeRegistry(new Map([[1, rec]]));
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 1 },
    'https://bad.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA' },
    cb.fn,
    false
  );
  assert.deepEqual(cb.calls, [false]);
  assert.equal(entry.certFailure, undefined);
  assert.equal(entry.certOverride, undefined);
});

test('AC2: a popup contents resolves its partition from popupRegistry and never stamps (no tab entry)', () => {
  const registry = fakeRegistry(new Map());
  const popupRegistry = {
    getByWcId: (wcId) => (wcId === 5 ? { partition: 'persist:jar-b' } : null)
  };
  const trust = createCertTrust({ registry, popupRegistry, logger: { error() {} } });
  const key = keyFor('persist:jar-b', 'ok.test', 443, 'AA');
  trust.allow(key);
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 5 },
    'https://ok.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [true], "the jar-wide override applies to the jar's popups too");
});

test('AC2/edge case: a non-tab, non-popup contents (chrome/sheet/find/DevTools/internal guest) resolves NO_PARTITION, is refused, and stamps nothing', () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, popupRegistry: { getByWcId: () => null }, logger: { error() {} } });
  const cb = makeCallback();
  trust.handleCertificateError(
    { id: 99 },
    'https://bad.test/',
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint: 'AA' },
    cb.fn,
    true
  );
  assert.deepEqual(cb.calls, [false], 'NO_PARTITION is never remembered');
});

test('key shape: keyFor is partition\\nhost:port\\nfingerprint', () => {
  assert.equal(keyFor('persist:jar-a', 'x.test', 443, 'FF'), 'persist:jar-a\nx.test:443\nFF');
});

// ---------------------------------------------------------------------------
// clearPartition
// ---------------------------------------------------------------------------

test("clearPartition drops only that partition's remembered keys", () => {
  const registry = fakeRegistry(new Map());
  const trust = createCertTrust({ registry, logger: { error() {} } });
  const keyA = keyFor('persist:jar-a', 'x.test', 443, 'AA');
  const keyB = keyFor('persist:jar-b', 'x.test', 443, 'AA');
  trust.allow(keyA);
  trust.allow(keyB);
  trust.clearPartition('persist:jar-a');
  assert.equal(trust.has(keyA), false);
  assert.equal(trust.has(keyB), true);
});

// ---------------------------------------------------------------------------
// AC7 — nothing persists (grep-AC)
// ---------------------------------------------------------------------------

test('source-scan: cert-trust.js imports no fs/app-db/settings-store', () => {
  // Masked — the module's OWN prose describes this very invariant ("no
  // fs/app-db/settings-store imports"), which would otherwise trip the scan
  // on itself.
  const source = maskComments(fs.readFileSync(MODULE_PATH, 'utf8'));
  assert.ok(!/require\(['"]fs['"]\)/.test(source));
  assert.ok(!/app-db/.test(source));
  assert.ok(!/settings-store/.test(source));
});

// ---------------------------------------------------------------------------
// AC1 — exactly one callback( call site
// ---------------------------------------------------------------------------

test('source-scan: exactly one `callback(` call site, in a finally guarded by a catch', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const masked = maskComments(source);
  const occurrences = (masked.match(/callback\s*\(/g) || []).length;
  assert.equal(occurrences, 1, 'exactly one callback( call site');
  const callIdx = masked.search(/callback\s*\(/);
  const finallyIdx = masked.lastIndexOf('finally', callIdx);
  const catchIdx = masked.lastIndexOf('catch', callIdx);
  assert.ok(finallyIdx !== -1 && finallyIdx < callIdx, 'the call site is inside a finally block');
  assert.ok(catchIdx !== -1 && catchIdx < finallyIdx, 'the try/finally is guarded by a preceding catch');
});

// ---------------------------------------------------------------------------
// AC2/AC8 — allow() has exactly one caller: the cert-override-proceed handler
// (INVERTED from leg 2's "allow() has no caller yet" pin — the proceed leg,
// Mission 20 Flight 2 Leg 3, is now the first and only caller; git blame on
// this test documents the shift).
// ---------------------------------------------------------------------------

test('allow() has exactly one caller: the cert-override-proceed handler (grep -rn "\\.allow\\(" src/)', () => {
  const srcDir = path.join(__dirname, '../../src');
  const REGISTER_OVERLAY_PATH = path.join(__dirname, '../../src/main/register-overlay-ipc.js');
  /** @type {string[]} */
  const hits = [];
  (function walk(dir) {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) walk(full);
      else if (dirent.name.endsWith('.js')) {
        const text = maskComments(fs.readFileSync(full, 'utf8'));
        // Exclude this module's OWN definition site (`allow(key) {`) — the pin
        // is about CALLERS, not the method definition.
        if (full === MODULE_PATH) continue;
        if (/\.allow\s*\(/.test(text)) hits.push(full);
      }
    }
  })(srcDir);
  assert.deepEqual(
    hits,
    [REGISTER_OVERLAY_PATH],
    'certTrust.allow() must have EXACTLY one caller in src/: register-overlay-ipc.js — the ' +
      "proceed leg's cert-override-proceed handler"
  );

  // The single call site must sit inside the cert-override-proceed handler's
  // registration, not some other channel accidentally sharing the file.
  const masked = maskComments(fs.readFileSync(REGISTER_OVERLAY_PATH, 'utf8'));
  const handlerIdx = masked.indexOf("ipcMain.handle('menu-overlay:cert-override-proceed'");
  assert.notEqual(handlerIdx, -1, 'the cert-override-proceed handler must exist');
  const allowIdx = masked.indexOf('.allow(');
  assert.notEqual(allowIdx, -1, 'exactly one .allow( call must exist in the file');
  assert.equal(masked.indexOf('.allow(', allowIdx + 1), -1, 'no second .allow( call site in the file');
  assert.ok(
    allowIdx > handlerIdx,
    'the .allow( call must sit inside (textually after) the cert-override-proceed handler registration'
  );
});
