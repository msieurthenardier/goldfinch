'use strict';

// Unit tests for resolvePort precedence + freePortInRange (Flight 5 / DD1).
//
// resolvePort precedence: valid GOLDFINCH_MCP_PORT env (any positive integer) >
// valid persisted automationPort (range-bound [1024, 65535]) > default 49707.
// freePortInRange: returns the first loopback-free port in [lo, hi], skips an
// occupied port, returns null if none free.
//
// No Electron needed — mcp-server's resolvePort/freePortInRange are pure-ish
// (resolvePort reads env + an injected settings accessor; freePortInRange uses
// node's `net`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { resolvePort, freePortInRange, DEFAULT_PORT } = require('../../src/main/automation/mcp-server');

// A stub settings accessor returning a given automationPort value (or undefined).
function stubSettings(portValue) {
  return () => ({ get: (k) => (k === 'automationPort' ? portValue : undefined) });
}

// Save/restore GOLDFINCH_MCP_PORT around env-sensitive cases.
function withEnv(value, fn) {
  const saved = process.env.GOLDFINCH_MCP_PORT;
  if (value === undefined) delete process.env.GOLDFINCH_MCP_PORT;
  else process.env.GOLDFINCH_MCP_PORT = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.GOLDFINCH_MCP_PORT;
    else process.env.GOLDFINCH_MCP_PORT = saved;
  }
}

test('DEFAULT_PORT is 49707', () => {
  assert.equal(DEFAULT_PORT, 49707);
});

test('resolvePort — valid env wins over setting and default', () => {
  withEnv('8123', () => {
    assert.equal(resolvePort(stubSettings(50000)), 8123);
  });
});

test('resolvePort — env accepts a sub-1024 positive integer (operator escape hatch)', () => {
  withEnv('80', () => {
    assert.equal(resolvePort(stubSettings(50000)), 80);
  });
});

test('resolvePort — no env, valid setting → setting', () => {
  withEnv(undefined, () => {
    assert.equal(resolvePort(stubSettings(50000)), 50000);
  });
});

test('resolvePort — neither env nor setting → default 49707', () => {
  withEnv(undefined, () => {
    assert.equal(resolvePort(stubSettings(undefined)), 49707);
  });
});

test('resolvePort — invalid env (non-numeric) falls through to valid setting', () => {
  withEnv('abc', () => {
    assert.equal(resolvePort(stubSettings(50000)), 50000);
  });
});

test('resolvePort — invalid env (0) falls through to valid setting', () => {
  withEnv('0', () => {
    assert.equal(resolvePort(stubSettings(50000)), 50000);
  });
});

test('resolvePort — out-of-range setting falls through to default', () => {
  withEnv(undefined, () => {
    // setting is range-bound: 70000 is out of [1024, 65535] → default
    assert.equal(resolvePort(stubSettings(70000)), 49707);
  });
});

test('resolvePort — settings accessor that throws falls through to default', () => {
  withEnv(undefined, () => {
    const throwing = () => { throw new Error('settings unavailable'); };
    assert.equal(resolvePort(throwing), 49707);
  });
});

test('resolvePort — no accessor + no env does not throw (falls through to default or live store)', () => {
  withEnv(undefined, () => {
    // With no accessor it requires the live settings-store singleton (not loaded
    // in this test → get returns the default automationPort, or the require/get
    // path is caught). Either way it must return a positive integer and not throw.
    const p = resolvePort();
    assert.ok(Number.isInteger(p) && p > 0);
  });
});

test('freePortInRange — returns a port within [lo, hi]', async () => {
  const p = await freePortInRange(50000, 50100);
  assert.ok(p !== null, 'expected a free port in range');
  assert.ok(p >= 50000 && p <= 50100, 'returned port should be within range');
});

test('freePortInRange — single occupied port returns null', async () => {
  // Occupy a port, then ask for exactly that one-port range.
  const srv = net.createServer();
  const port = await new Promise((resolve, reject) => {
    srv.once('error', reject);
    // Listen on an ephemeral port (0) then read the assigned port.
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  try {
    const result = await freePortInRange(port, port);
    assert.equal(result, null, 'a fully-occupied single-port range returns null');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('freePortInRange — skips an occupied port and returns the next free one', async () => {
  const srv = net.createServer();
  const port = await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  try {
    // Range [port, port+1]: port is occupied, so the scan should skip to port+1.
    // (port+1 is very likely free; the assertion tolerates the rare collision by
    // accepting any free port > port within the 2-wide range.)
    const result = await freePortInRange(port, port + 1);
    assert.equal(result, port + 1, 'should skip the occupied port and return the next');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});
