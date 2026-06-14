'use strict';

// Regression test for the MCP transport's MULTI-SESSION lifecycle (Flight 3,
// leg verify-integration). The earlier single-transport-connected-once design
// bound ONE session for the app's whole lifetime: after the first client
// disconnected, a fresh `initialize` was refused (-32600 "Server already
// initialized") and the old session id was unrecoverable — so a client could
// not reconnect and a second/concurrent client could not connect. This suite
// pins the fixed standard stateful multi-session pattern.
//
// HEADLESS: mcp-server.js needs no Electron — we inject a fake engine. The real
// SDK client connects over a TEST port (7790, to avoid colliding with a dev
// instance on 7777). Each test starts + stops its own server in a try/finally
// so the port frees deterministically.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createMcpServer } = require('../../src/main/automation/mcp-server');

const TEST_PORT = 7790;
const ENDPOINT = new URL('http://127.0.0.1:' + TEST_PORT + '/mcp');
const EXPECTED_TOOL_COUNT = 16;

// A fake engine whose ops return canned values — deterministic and offline. Only
// enumerateTabs is exercised here (tools/list does not call the engine at all),
// but the registry is wired over the full op set so all 16 tools register.
function fakeEngine() {
  return {
    enumerateTabs: () => [{ wcId: 1, url: 'https://example.com', title: 'Example', jarId: 'default', active: true }],
    openTab: () => 2,
    closeTab: () => true,
    activateTab: () => true,
    navigate: () => undefined,
    goBack: () => undefined,
    goForward: () => undefined,
    reload: () => undefined,
    click: () => undefined,
    typeText: () => undefined,
    scroll: () => undefined,
    pressKey: () => undefined,
    captureScreenshot: () => '',
    captureWindow: () => '',
    readDom: () => ({ url: 'https://example.com', title: 'Example', html: '<html></html>' }),
    readAxTree: () => [],
  };
}

// Start a server on the test port with the fake engine. Returns the handle; the
// caller is responsible for stop() in a finally.
async function startServer() {
  const server = createMcpServer({ getEngine: fakeEngine, port: TEST_PORT });
  await server.start();
  return server;
}

// Connect a fresh SDK client (performs the MCP initialize handshake) and return
// it. Caller closes it.
//
// `Connection: close` on every request is deliberate and load-bearing for the
// test harness: Node's global undici fetch pool would otherwise keep a
// keep-alive socket alive and REUSE it across server instances bound to the same
// 127.0.0.1 port. After a server stop()s (force-closing its sockets), that
// pooled socket is dead — a later fetch reusing it fails ("fetch failed") and
// the dead handle keeps `node --test` from exiting. Closing the connection per
// request means no socket is pooled, so the restart-on-same-port case is clean
// and the process exits with no leaked handles. (The real app never hits this:
// a restart there is a whole new OS process with a fresh fetch pool.)
async function connectClient() {
  const client = new Client({ name: 'mcp-server-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { connection: 'close' } },
  });
  await client.connect(transport);
  return client;
}

test('first client initializes and tools/list returns 16 tools', async () => {
  const server = await startServer();
  try {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, EXPECTED_TOOL_COUNT);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('REGRESSION: a second fresh client can reconnect after the first closes', async () => {
  const server = await startServer();
  try {
    // First client: connect, list, close (the disconnect that used to wedge the server).
    const first = await connectClient();
    const firstTools = await first.listTools();
    assert.equal(firstTools.tools.length, EXPECTED_TOOL_COUNT);
    await first.close();

    // Second client: a brand-new initialize must succeed (was -32600 before the fix).
    const second = await connectClient();
    try {
      const secondTools = await second.listTools();
      assert.equal(secondTools.tools.length, EXPECTED_TOOL_COUNT);
    } finally {
      await second.close();
    }
  } finally {
    await server.stop();
  }
});

test('two concurrent clients both initialize and list tools (distinct sessions)', async () => {
  const server = await startServer();
  const a = await connectClient();
  const b = await connectClient();
  try {
    const [ta, tb] = await Promise.all([a.listTools(), b.listTools()]);
    assert.equal(ta.tools.length, EXPECTED_TOOL_COUNT);
    assert.equal(tb.tools.length, EXPECTED_TOOL_COUNT);

    // Distinct sessions: the SDK client transport surfaces the server-assigned
    // session id; the two must differ.
    assert.ok(a.transport.sessionId, 'client A has a session id');
    assert.ok(b.transport.sessionId, 'client B has a session id');
    assert.notEqual(a.transport.sessionId, b.transport.sessionId);

    // Both sessions are actually usable for a tool call against the fake engine.
    const enumA = await a.callTool({ name: 'enumerateTabs', arguments: {} });
    assert.equal(enumA.isError, undefined);
  } finally {
    await a.close();
    await b.close();
    await server.stop();
  }
});

test('clean stop() tears everything down — a subsequent start on the same port succeeds (no EADDRINUSE)', async () => {
  const first = await startServer();
  const client = await connectClient();
  await client.listTools();
  await client.close();
  await first.stop();

  // The port must be free for an immediate restart — proves the http listener
  // and all session transports were released.
  const second = await startServer();
  try {
    const again = await connectClient();
    try {
      const { tools } = await again.listTools();
      assert.equal(tools.length, EXPECTED_TOOL_COUNT);
    } finally {
      await again.close();
    }
  } finally {
    await second.stop();
  }
});
