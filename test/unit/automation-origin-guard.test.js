'use strict';
// Unit tests for the SC7 loopback Origin/Host allow-list predicate
// (src/main/automation/origin-guard.js). The guard is pure, so it is exhaustively
// unit-tested here; the live 403 path (curl against the running server) is an
// integration check deferred to Leg 6 verify-integration (needs the live GUI).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowed,
  isLoopbackHostname,
  bareHost,
  originHost,
} = require('../../src/main/automation/origin-guard');

// Convenience: a fully-loopback request the matrix mutates one field at a time.
const LOOPBACK_REQ = { host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777', peerAddress: '127.0.0.1' };

describe('bareHost', () => {
  it('strips a trailing port from an IPv4 authority', () => {
    assert.equal(bareHost('127.0.0.1:7777'), '127.0.0.1');
  });
  it('returns a bare IPv4 unchanged', () => {
    assert.equal(bareHost('127.0.0.1'), '127.0.0.1');
  });
  it('unwraps a bracketed IPv6 with port', () => {
    assert.equal(bareHost('[::1]:7777'), '::1');
  });
  it('unwraps a bracketed IPv6 without port', () => {
    assert.equal(bareHost('[::1]'), '::1');
  });
  it('returns a bare unbracketed IPv6 literal unchanged (no port to strip)', () => {
    assert.equal(bareHost('::1'), '::1');
    assert.equal(bareHost('::ffff:127.0.0.1'), '::ffff:127.0.0.1');
  });
  it('lowercases the localhost name', () => {
    assert.equal(bareHost('LOCALHOST:7777'), 'localhost');
  });
  it('trims surrounding whitespace', () => {
    assert.equal(bareHost('  127.0.0.1  '), '127.0.0.1');
  });
  it('returns null for non-strings, empty string, and malformed bracket', () => {
    assert.equal(bareHost(undefined), null);
    assert.equal(bareHost(null), null);
    assert.equal(bareHost(42), null);
    assert.equal(bareHost(''), null);
    assert.equal(bareHost('   '), null);
    assert.equal(bareHost('[::1'), null); // unterminated bracket
  });
});

describe('isLoopbackHostname', () => {
  // --- loopback (true) ---
  it('treats 127.0.0.1 as loopback (with and without port)', () => {
    assert.equal(isLoopbackHostname('127.0.0.1'), true);
    assert.equal(isLoopbackHostname('127.0.0.1:7777'), true);
  });
  it('treats ::1 as loopback (bare and bracketed)', () => {
    assert.equal(isLoopbackHostname('::1'), true);
    assert.equal(isLoopbackHostname('[::1]'), true);
    assert.equal(isLoopbackHostname('[::1]:7777'), true);
  });
  it('treats the IPv6-mapped IPv4 loopback ::ffff:127.0.0.1 as loopback', () => {
    assert.equal(isLoopbackHostname('::ffff:127.0.0.1'), true);
  });
  it('treats localhost as loopback (any case, with port)', () => {
    assert.equal(isLoopbackHostname('localhost'), true);
    assert.equal(isLoopbackHostname('localhost:7777'), true);
    assert.equal(isLoopbackHostname('LocalHost'), true);
  });

  // --- non-loopback (false) ---
  it('rejects a public IP and a public name', () => {
    assert.equal(isLoopbackHostname('203.0.113.5'), false);
    assert.equal(isLoopbackHostname('evil.example'), false);
    assert.equal(isLoopbackHostname('evil.example:7777'), false);
  });
  it('rejects 0.0.0.0 and a non-loopback private IP', () => {
    assert.equal(isLoopbackHostname('0.0.0.0'), false);
    assert.equal(isLoopbackHostname('192.168.1.10'), false);
  });
  it('rejects a hostname that merely contains localhost', () => {
    assert.equal(isLoopbackHostname('notlocalhost'), false);
    assert.equal(isLoopbackHostname('localhost.evil.example'), false);
  });
  it('rejects nullish / non-string / empty input (fail-closed)', () => {
    assert.equal(isLoopbackHostname(undefined), false);
    assert.equal(isLoopbackHostname(null), false);
    assert.equal(isLoopbackHostname(''), false);
    assert.equal(isLoopbackHostname(7777), false);
  });
});

describe('originHost', () => {
  it('extracts the host authority from a loopback origin', () => {
    assert.equal(originHost('http://127.0.0.1:7777'), '127.0.0.1:7777');
    assert.equal(originHost('http://localhost'), 'localhost');
    assert.equal(originHost('http://[::1]:7777'), '[::1]:7777');
  });
  it('extracts the host authority from a public origin', () => {
    assert.equal(originHost('https://evil.example'), 'evil.example');
  });
  it('returns the literal "null" opaque origin as-is (not loopback)', () => {
    assert.equal(originHost('null'), 'null');
    assert.equal(isLoopbackHostname(originHost('null')), false);
  });
  it('returns null for an unparseable origin', () => {
    assert.equal(originHost('not a url'), null);
  });
});

describe('isAllowed — DD3 reject/pass matrix', () => {
  // ---------- ALLOW cases ----------

  it('allows a fully-loopback request (IPv4 host + loopback origin + loopback peer)', () => {
    assert.equal(isAllowed(LOOPBACK_REQ), true);
  });

  it('allows the no-Origin + loopback-Host rule (origin absent)', () => {
    assert.equal(isAllowed({ host: '127.0.0.1:7777', peerAddress: '127.0.0.1' }), true);
    assert.equal(isAllowed({ host: '127.0.0.1:7777', origin: undefined, peerAddress: '127.0.0.1' }), true);
  });

  it('treats an empty-string Origin as absent (allowed with loopback Host)', () => {
    assert.equal(isAllowed({ host: '127.0.0.1:7777', origin: '', peerAddress: '127.0.0.1' }), true);
  });

  it('allows ::1 host/origin/peer (IPv6 loopback)', () => {
    assert.equal(isAllowed({ host: '[::1]:7777', origin: 'http://[::1]:7777', peerAddress: '::1' }), true);
  });

  it('allows localhost host/origin', () => {
    assert.equal(isAllowed({ host: 'localhost:7777', origin: 'http://localhost:7777', peerAddress: '127.0.0.1' }), true);
  });

  it('allows an IPv6-mapped-IPv4 loopback peer (::ffff:127.0.0.1)', () => {
    assert.equal(isAllowed({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777', peerAddress: '::ffff:127.0.0.1' }), true);
  });

  it('ALLOWS a deliberate Host-port mismatch — DD3 keys on loopback-ness, not port', () => {
    // Host: 127.0.0.1:9999 while the server is bound to 7777 → still loopback → allow.
    assert.equal(isAllowed({ host: '127.0.0.1:9999', peerAddress: '127.0.0.1' }), true);
  });

  // ---------- DENY cases ----------

  it('denies a non-loopback Host', () => {
    assert.equal(isAllowed({ host: 'evil.example', peerAddress: '127.0.0.1' }), false);
    assert.equal(isAllowed({ host: 'evil.example:7777', origin: 'http://127.0.0.1:7777', peerAddress: '127.0.0.1' }), false);
  });

  it('fails closed on a MISSING Host header', () => {
    assert.equal(isAllowed({ peerAddress: '127.0.0.1' }), false);
    assert.equal(isAllowed({ host: undefined, peerAddress: '127.0.0.1' }), false);
    assert.equal(isAllowed({ host: '', peerAddress: '127.0.0.1' }), false);
  });

  it('denies a present non-loopback Origin even with a loopback Host (the DNS-rebinding / hostile-page case)', () => {
    assert.equal(
      isAllowed({ host: '127.0.0.1:7777', origin: 'http://evil.example', peerAddress: '127.0.0.1' }),
      false
    );
    assert.equal(
      isAllowed({ host: '127.0.0.1:7777', origin: 'https://evil.example:7777', peerAddress: '127.0.0.1' }),
      false
    );
  });

  it('denies the "null" opaque Origin (sandboxed/file/data document)', () => {
    assert.equal(isAllowed({ host: '127.0.0.1:7777', origin: 'null', peerAddress: '127.0.0.1' }), false);
  });

  it('denies a non-loopback peer socket address even with loopback Host+Origin', () => {
    assert.equal(
      isAllowed({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777', peerAddress: '203.0.113.5' }),
      false
    );
  });

  it('fails closed on a MISSING peer address', () => {
    assert.equal(isAllowed({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' }), false);
    assert.equal(isAllowed({ host: '127.0.0.1:7777', peerAddress: undefined }), false);
  });

  it('never throws and denies for an empty/absent request object', () => {
    assert.doesNotThrow(() => isAllowed());
    assert.equal(isAllowed(), false);
    assert.equal(isAllowed({}), false);
  });
});
