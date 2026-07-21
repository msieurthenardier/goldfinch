'use strict';

// Unit tests for the M12 Flight 3 Leg 3 TOTP enrollment primitives in
// src/main/vault/vault-crypto.js: normalizeTotpField (canonical-string enrollment +
// range validation) and totpSecondsRemaining (the countdown math). Pure, Electron-free.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const vc = require('../../src/main/vault/vault-crypto');

const { normalizeTotpField, totpSecondsRemaining, parseOtpauth, totp, VaultFormatError } = vc;

// A valid base32 secret (RFC 6238 test-vector seed 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' = 20 bytes).
const B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('normalizeTotpField returns a CANONICAL otpauth:// URI STRING (not an object)', () => {
  const out = normalizeTotpField(`otpauth://totp/ACME:alice?secret=${B32}&issuer=ACME`);
  assert.equal(typeof out, 'string');
  assert.ok(out.startsWith('otpauth://totp/'), `expected canonical otpauth uri, got ${out}`);
});

test('a bare base32 secret normalizes to a canonical otpauth:// string that round-trips', () => {
  const out = normalizeTotpField(B32);
  assert.equal(typeof out, 'string');
  assert.ok(out.startsWith('otpauth://totp/'));
  const p = parseOtpauth(out);
  assert.equal(p.secret, B32);
  assert.equal(p.digits, 6);
  assert.equal(p.period, 30);
  assert.equal(p.algorithm, 'SHA1');
});

test('an otpauth URI with non-default params round-trips through the canonical string', () => {
  const raw = `otpauth://totp/ACME:bob?secret=${B32}&algorithm=SHA256&digits=8&period=60&issuer=ACME`;
  const canonical = normalizeTotpField(raw);
  const p = parseOtpauth(canonical);
  assert.equal(p.secret, B32);
  assert.equal(p.algorithm, 'SHA256');
  assert.equal(p.digits, 8);
  assert.equal(p.period, 60);
  assert.equal(p.issuer, 'ACME');
});

test('the canonical string computes the SAME code as the raw input (totp round-trip)', () => {
  const raw = `otpauth://totp/ACME:alice?secret=${B32}`;
  const canonical = normalizeTotpField(raw);
  const at = 59_000; // RFC 6238 t=59s
  const pRaw = parseOtpauth(raw);
  const pCanon = parseOtpauth(canonical);
  assert.equal(totp(pCanon.secret, pCanon, at), totp(pRaw.secret, pRaw, at));
});

test('garbage / undecodable input throws VaultFormatError (nothing normalizes)', () => {
  assert.throws(() => normalizeTotpField('not a secret!!! 1'), VaultFormatError);
  assert.throws(() => normalizeTotpField('otpauth://totp/x?secret=@@@invalid'), VaultFormatError);
  assert.throws(() => normalizeTotpField('http://example.com'), VaultFormatError);
  assert.throws(() => normalizeTotpField(''), VaultFormatError);
});

test('OUT-OF-RANGE params throw — period=0, digits=99, bad algorithm (÷0 / overflow guard)', () => {
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&period=0`), VaultFormatError);
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&period=-1`), VaultFormatError);
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&digits=99`), VaultFormatError);
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&digits=0`), VaultFormatError);
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&digits=5`), VaultFormatError);
  assert.throws(() => normalizeTotpField(`otpauth://totp/x?secret=${B32}&algorithm=MD5`), VaultFormatError);
});

test('in-range boundary values (digits 6/7/8, all three algorithms) are accepted', () => {
  for (const digits of [6, 7, 8]) {
    const out = normalizeTotpField(`otpauth://totp/x?secret=${B32}&digits=${digits}`);
    assert.equal(parseOtpauth(out).digits, digits);
  }
  for (const algo of ['SHA1', 'SHA256', 'SHA512']) {
    const out = normalizeTotpField(`otpauth://totp/x?secret=${B32}&algorithm=${algo}`);
    assert.equal(parseOtpauth(out).algorithm, algo);
  }
});

test('totpSecondsRemaining: countdown math (period - (⌊now/1000⌋ mod period)), always in [1, period]', () => {
  // period 30: at t=0s the window is fresh → full 30 remaining.
  assert.equal(totpSecondsRemaining(30, 0), 30);
  // at t=1s → 29 remaining.
  assert.equal(totpSecondsRemaining(30, 1_000), 29);
  // at t=29s → 1 remaining.
  assert.equal(totpSecondsRemaining(30, 29_000), 1);
  // at t=30s the next window is fresh → full 30 again (never 0).
  assert.equal(totpSecondsRemaining(30, 30_000), 30);
  // sub-second is floored: t=29.9s → still 1.
  assert.equal(totpSecondsRemaining(30, 29_900), 1);
  // a different period.
  assert.equal(totpSecondsRemaining(60, 61_000), 59);
  // never returns 0 across a full window.
  for (let s = 0; s < 30; s += 1) {
    const r = totpSecondsRemaining(30, s * 1000);
    assert.ok(r >= 1 && r <= 30, `remaining ${r} out of [1,30] at s=${s}`);
  }
});

test('totpSecondsRemaining rejects a bad period / non-finite clock', () => {
  assert.throws(() => totpSecondsRemaining(0, 1000), VaultFormatError);
  assert.throws(() => totpSecondsRemaining(-1, 1000), VaultFormatError);
  assert.throws(() => totpSecondsRemaining(30, Infinity), VaultFormatError);
});
