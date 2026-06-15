'use strict';

// Unit tests for src/main/automation/automation-auth.js
//
// Pure + Electron-free: requires only node:crypto, so it tests in isolation with
// no Electron, no settings store, no HTTP. Covers hashKey/generateKey/hashEquals
// and the validateKey identity resolver across its jarId / 'admin' / null paths,
// including the admin env-gate-off and empty-hash edges and empty-Bearer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { hashKey, generateKey, validateKey, hashEquals } = require('../../src/main/automation/automation-auth');

const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// hashKey
// ---------------------------------------------------------------------------
test('hashKey — produces a 64-char lowercase hex SHA-256 digest', () => {
  const h = hashKey('hello');
  assert.match(h, HEX64);
  // Matches node:crypto SHA-256 exactly.
  const expected = crypto.createHash('sha256').update('hello', 'utf8').digest('hex');
  assert.equal(h, expected);
});

test('hashKey — deterministic and distinct per input', () => {
  assert.equal(hashKey('abc'), hashKey('abc'));
  assert.notEqual(hashKey('abc'), hashKey('abd'));
});

// ---------------------------------------------------------------------------
// generateKey
// ---------------------------------------------------------------------------
test('generateKey — URL-safe, high-entropy, unique', () => {
  const a = generateKey();
  const b = generateKey();
  assert.equal(typeof a, 'string');
  assert.notEqual(a, b, 'two CSPRNG keys must differ');
  // base64url alphabet only (no +, /, or = padding).
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  // 32 bytes base64url-encoded → 43 chars (no padding). At least 32 bytes of entropy.
  assert.ok(a.length >= 43, 'key should encode >= 32 bytes of entropy');
});

// ---------------------------------------------------------------------------
// hashEquals (constant-time hex compare)
// ---------------------------------------------------------------------------
test('hashEquals — true for identical hex digests, false for differing', () => {
  const h = hashKey('x');
  assert.equal(hashEquals(h, h), true);
  assert.equal(hashEquals(hashKey('x'), hashKey('y')), false);
});

test('hashEquals — false on malformed / non-hex / wrong-length inputs (no throw)', () => {
  const h = hashKey('x');
  assert.equal(hashEquals(h, 'not-hex'), false);
  assert.equal(hashEquals(h, ''), false);
  assert.equal(hashEquals(h, h.slice(0, 63)), false);
  assert.equal(hashEquals(/** @type {any} */ (null), h), false);
  assert.equal(hashEquals(h, /** @type {any} */ (undefined)), false);
  assert.equal(hashEquals('G'.repeat(64), h), false); // uppercase/non-hex char
});

// ---------------------------------------------------------------------------
// validateKey — jar resolution
// ---------------------------------------------------------------------------
test('validateKey — returns the matching jarId for a valid jar key', () => {
  const key = 'jar-secret-1';
  const ctx = { keyHashes: { work: hashKey(key) }, adminKeyHash: '', adminEnabled: false };
  assert.equal(validateKey(key, ctx), 'work');
});

test('validateKey — returns the correct jarId among several', () => {
  const ctx = {
    keyHashes: { a: hashKey('ka'), b: hashKey('kb'), c: hashKey('kc') },
    adminKeyHash: '',
    adminEnabled: false,
  };
  assert.equal(validateKey('kb', ctx), 'b');
});

test('validateKey — null for an unknown key (no match)', () => {
  const ctx = { keyHashes: { work: hashKey('right') }, adminKeyHash: '', adminEnabled: false };
  assert.equal(validateKey('wrong', ctx), null);
});

test('validateKey — null for empty/missing presented key', () => {
  const ctx = { keyHashes: { work: hashKey('x') }, adminKeyHash: '', adminEnabled: false };
  assert.equal(validateKey('', ctx), null);
  assert.equal(validateKey(/** @type {any} */ (undefined), ctx), null);
  assert.equal(validateKey(/** @type {any} */ (null), ctx), null);
});

test('validateKey — null when no keys minted (enabled but empty map)', () => {
  assert.equal(validateKey('anything', { keyHashes: {}, adminKeyHash: '', adminEnabled: false }), null);
});

// ---------------------------------------------------------------------------
// validateKey — admin tier (DD6)
// ---------------------------------------------------------------------------
test("validateKey — returns 'admin' when gate set + non-empty hash + key matches", () => {
  const adminKey = 'admin-secret';
  const ctx = { keyHashes: {}, adminKeyHash: hashKey(adminKey), adminEnabled: true };
  assert.equal(validateKey(adminKey, ctx), 'admin');
});

test('validateKey — admin NEVER matches when env gate is off (even with a valid hash)', () => {
  const adminKey = 'admin-secret';
  const ctx = { keyHashes: {}, adminKeyHash: hashKey(adminKey), adminEnabled: false };
  assert.equal(validateKey(adminKey, ctx), null);
});

test('validateKey — admin NEVER matches when adminKeyHash is empty (no empty-Bearer accept)', () => {
  // Gate on, but no admin hash minted: an empty-string admin hash must not match.
  assert.equal(validateKey('', { keyHashes: {}, adminKeyHash: '', adminEnabled: true }), null);
  assert.equal(validateKey('anything', { keyHashes: {}, adminKeyHash: '', adminEnabled: true }), null);
});

test('validateKey — admin-disabled falls through to the jar check', () => {
  const jarKey = 'jar-key';
  const ctx = {
    keyHashes: { team: hashKey(jarKey) },
    adminKeyHash: hashKey('admin-key'),
    adminEnabled: false, // gate off → admin branch skipped, jar branch still runs
  };
  assert.equal(validateKey(jarKey, ctx), 'team');
});

test('validateKey — a jar key never resolves to admin', () => {
  // A jar key, with admin enabled and an admin hash present that does NOT match it.
  const jarKey = 'jar-key';
  const ctx = {
    keyHashes: { team: hashKey(jarKey) },
    adminKeyHash: hashKey('different-admin-key'),
    adminEnabled: true,
  };
  assert.equal(validateKey(jarKey, ctx), 'team');
});

// ---------------------------------------------------------------------------
// validateKey — defensive / never-throws
// ---------------------------------------------------------------------------
test('validateKey — never throws on malformed ctx', () => {
  assert.equal(validateKey('k', /** @type {any} */ (null)), null);
  assert.equal(validateKey('k', /** @type {any} */ (undefined)), null);
  assert.equal(validateKey('k', { keyHashes: /** @type {any} */ (null) }), null);
  assert.equal(validateKey('k', { keyHashes: /** @type {any} */ ([]) }), null);
  assert.equal(validateKey('k', { keyHashes: { bad: /** @type {any} */ ('not-hex') } }), null);
  assert.equal(validateKey('k', {}), null);
});
