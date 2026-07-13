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
const http = require('http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createMcpServer, mintJarKey, revokeJarKey, revokeAdminKey, deriveAuditDetail } = require('../../src/main/automation/mcp-server');
const { hashKey, validateKey } = require('../../src/main/automation/automation-auth');

const TEST_PORT = 7790;
const ENDPOINT = new URL('http://127.0.0.1:' + TEST_PORT + '/mcp');
const EXPECTED_TOOL_COUNT = 27;

// The valid key the test harness mints. The injected settings stub stores its
// hash and reports the surface enabled, so a Bearer with this key passes the gate.
const VALID_KEY = 'test-automation-key';

// A stub of the settings-store singleton's read surface, injected via getSettings
// so the headless test can toggle automationEnabled / hashes WITHOUT Electron or a
// real settings file. The auth gate reads this LIVE per request.
function fakeSettings({ enabled = true, keyHashes = { test: hashKey(VALID_KEY) }, adminKeyHash = '' } = {}) {
  const map = {
    automationEnabled: enabled,
    automationKeyHashes: keyHashes,
    automationAdminKeyHash: adminKeyHash,
  };
  return { get: (k) => map[k] };
}

// ---------------------------------------------------------------------------
// Leg-2 scope harness: a multi-jar fake world driven by a partition→session map.
//
// Each tab is { wcId, partition, jarId (renderer-reported, may LIE), url, ... }.
// fromId(wcId) returns a fake wc whose `session` is the interned Session OBJECT
// for that tab's partition (sessionFor(partition)), so the membership compare
// `wc.session === fromPartition(jar.partition)` is REAL object identity — the
// same discipline the live engine relies on. The renderer-reported jarId is
// deliberately allowed to disagree with the resolved session in some tabs to pin
// "scoping by session, not label" (DD7).
// ---------------------------------------------------------------------------

// Persistent jars (present in jars.list()). 'test' is the default identity the
// existing gate/lifecycle tests authenticate as. A burner jar is NOT listed.
const JARS = [
  { id: 'test', partition: 'persist:container:test' },
  { id: 'work', partition: 'persist:container:work' },
];

// Interned-session map: one stable object per partition (=== identity is the test).
const SESSIONS = new Map();
function sessionFor(partition) {
  if (!SESSIONS.has(partition)) {
    SESSIONS.set(partition, { __partition: partition, __goldfinchInternal: partition === 'goldfinch-internal' });
  }
  return SESSIONS.get(partition);
}
const fakeFromPartition = (partition) => sessionFor(partition);

// The fake world's tabs. wcId → { partition, jarId(reported), ... }.
// - 1: jar 'test'   (reported jarId matches session)
// - 2: jar 'work'   (reported jarId matches session)
// - 3: BURNER       (partition matches no persistent jar; reported jarId lies 'test')
// - 4: jar 'test'   but reported jarId LIES 'work' (session is authoritative)
// - 5: INTERNAL     (goldfinch://settings session)
const WORLD_TABS = [
  { wcId: 1, partition: 'persist:container:test', url: 'https://test.example', title: 'T', jarId: 'test', active: true },
  { wcId: 2, partition: 'persist:container:work', url: 'https://work.example', title: 'W', jarId: 'work', active: false },
  { wcId: 3, partition: 'burner:1', url: 'https://burner.example', title: 'B', jarId: 'test', active: false },
  { wcId: 4, partition: 'persist:container:test', url: 'https://test2.example', title: 'T2', jarId: 'work', active: false },
  { wcId: 5, partition: 'goldfinch-internal', url: 'goldfinch://settings', title: 'Settings', jarId: null, active: false },
];

const TAB_BY_WCID = new Map(WORLD_TABS.map((t) => [t.wcId, t]));

// fromId → a fake wc whose session is the interned Session for the tab's partition.
function fakeFromId(wcId) {
  const t = TAB_BY_WCID.get(wcId);
  if (!t) return null;
  return { id: wcId, session: sessionFor(t.partition), isDestroyed() { return false; } };
}

// The scope ctx injected into createMcpServer. fromId / fromPartition are the
// SAME handles the (fake) engine resolves with — exactly the real-app invariant.
function fakeScopeCtx() {
  return {
    jars: { list: () => JARS },
    fromId: fakeFromId,
    fromPartition: fakeFromPartition,
    getChromeContents: () => ({ id: 0 }),
  };
}

// A fake engine. enumerateTabs returns the FULL world MINUS the internal tab when
// allowInternal is false (mirroring mapEnumeratedTabs), or the full world when
// admin (allowInternal true). The wcId-first ops echo the wcId so a test can prove
// the call reached the engine (and which tab). captureWindow returns a marker.
function makeFakeEngine({ allowInternal = false } = {}) {
  const visible = allowInternal ? WORLD_TABS : WORLD_TABS.filter((t) => t.partition !== 'goldfinch-internal');
  const tabsView = visible.map((t) => ({ wcId: t.wcId, url: t.url, title: t.title, jarId: t.jarId, active: t.active }));
  return {
    enumerateTabs: () => tabsView,
    openTab: (url) => ({ openedFor: url }),
    closeTab: (wcId) => ({ closed: wcId }),
    activateTab: (wcId) => ({ activated: wcId }),
    navigate: (wcId, url) => ({ navigated: wcId, url }),
    goBack: (wcId) => ({ back: wcId }),
    goForward: (wcId) => ({ forward: wcId }),
    reload: (wcId) => ({ reloaded: wcId }),
    click: (wcId) => ({ clicked: wcId }),
    typeText: (wcId) => ({ typed: wcId }),
    scroll: (wcId) => ({ scrolled: wcId }),
    pressKey: (wcId) => ({ pressed: wcId }),
    // The two image ops are shaped as MCP image content (imageResult), whose
    // `data` must be a base64 string — never an object — or the SDK rejects the
    // result envelope. A jar key's captureWindow is refused by the façade before
    // the engine is reached; admin's captureWindow reaches this empty-PNG stub.
    captureScreenshot: () => '',
    captureWindow: () => '',
    readDom: (wcId) => ({ dom: wcId }),
    readAxTree: (wcId) => ({ ax: wcId }),
  };
}

// Default fake engine for the gate/lifecycle tests (identity 'test' is a jar).
function fakeEngine(engineOpts) {
  return makeFakeEngine(engineOpts);
}

// Start a server on the test port with the fake engine + scope ctx. By default
// the surface is ENABLED with VALID_KEY minted as jar 'test'; pass a settings
// override to test the gate's disabled / no-key paths. Returns the handle; the
// caller stop()s in a finally.
async function startServer(settingsOpts, extraOpts) {
  const server = createMcpServer({
    getEngine: (engineOpts) => fakeEngine(engineOpts),
    getSettings: () => fakeSettings(settingsOpts),
    scopeCtx: fakeScopeCtx(),
    port: TEST_PORT,
    ...(extraOpts || {}),
  });
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
async function connectClient(key = VALID_KEY) {
  const client = new Client({ name: 'mcp-server-test', version: '1.0.0' });
  const headers = { connection: 'close' };
  if (key) headers.authorization = 'Bearer ' + key;
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return client;
}

// Raw POST helper for the gate / cap tests: returns { status, body } without the
// SDK client (the SDK would retry/obscure a bare 401/413). `connection: close`
// keeps the undici pool from leaking a socket across server instances (see above).
function rawPost(headers, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    const req = http.request(
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          connection: 'close',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

// Open a session with a RAW initialize POST (no SDK client) and return the
// server-assigned Mcp-Session-Id from the response header. Avoids the SDK
// client's background SSE stream so a subsequent raw probe + server stop() leaves
// no leaked handle. The initialize body passes the gate with the given key.
async function rawInitSession(key = VALID_KEY) {
  const res = await rawPost({ authorization: 'Bearer ' + key }, initBody());
  assert.equal(res.status, 200, 'raw initialize succeeds');
  const sid = res.headers['mcp-session-id'];
  assert.ok(sid, 'server assigned an Mcp-Session-Id');
  return sid;
}

// Poll `predicate` until it returns truthy or the timeout elapses. Used for the
// async transport.onclose path (an HTTP disconnect drains the active set a tick
// or two after client.close() resolves). Throws on timeout so a regression fails
// loudly rather than hanging.
async function waitFor(predicate, { timeoutMs = 2000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor: predicate did not become true within ' + timeoutMs + 'ms');
}

// A minimal MCP initialize request body — the only body that opens a session.
function initBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'raw-test', version: '1.0.0' },
    },
  };
}

test('first client initializes and tools/list returns 27 tools', async () => {
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

test('REGRESSION F12: stop during an in-flight start leaves no orphan listener', async () => {
  const server = createMcpServer({
    getEngine: (engineOpts) => fakeEngine(engineOpts),
    getSettings: () => fakeSettings(),
    scopeCtx: fakeScopeCtx(),
    port: TEST_PORT,
  });

  // start() yields while listen is pending; stop() must cancel that bind even
  // though the listener has not yet been committed to httpServer.
  const starting = server.start();
  await server.stop();
  await starting;

  // The same instance must be able to bind again immediately. Before F12 the
  // first listen committed late with started=false, so this threw EADDRINUSE.
  await assert.doesNotReject(server.start());
  try {
    const client = await connectClient();
    await client.close();
  } finally {
    await server.stop();
  }
});

test('rebind primitive — start→stop→start on a DIFFERENT port binds on B, not A (Leg 7)', async () => {
  // The live port-rebind (Flight 5, Leg 7) is exactly this primitive: stop the
  // current server, then create+start a fresh one on the (now-changed) resolved
  // port. Prove the sequence works across two distinct free ports — the fresh
  // server is reachable on B, and port A is free again (the old listener released).
  const PORT_A = 7791;
  const PORT_B = 7792;

  // Phase 1: bind on A and confirm a full SDK handshake reaches the fake engine.
  const onA = createMcpServer({
    getEngine: (engineOpts) => fakeEngine(engineOpts),
    getSettings: () => fakeSettings(),
    scopeCtx: fakeScopeCtx(),
    port: PORT_A,
  });
  await onA.start();
  assert.equal(onA.port, PORT_A, '.port reflects A');
  const endpointA = new URL('http://127.0.0.1:' + PORT_A + '/mcp');
  {
    const client = new Client({ name: 'rebind-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpointA, {
      requestInit: { headers: { connection: 'close', authorization: 'Bearer ' + VALID_KEY } },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, EXPECTED_TOOL_COUNT, 'reachable on A while bound to A');
    } finally {
      await client.close();
    }
  }

  // Phase 2: stop A (releases the listener + sessions), then start a FRESH server
  // on B — the rebind primitive. The new instance must reach the engine on B.
  await onA.stop();
  const onB = createMcpServer({
    getEngine: (engineOpts) => fakeEngine(engineOpts),
    getSettings: () => fakeSettings(),
    scopeCtx: fakeScopeCtx(),
    port: PORT_B,
  });
  await onB.start();
  try {
    assert.equal(onB.port, PORT_B, '.port reflects B after rebind');
    const endpointB = new URL('http://127.0.0.1:' + PORT_B + '/mcp');
    const client = new Client({ name: 'rebind-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpointB, {
      requestInit: { headers: { connection: 'close', authorization: 'Bearer ' + VALID_KEY } },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, EXPECTED_TOOL_COUNT, 'reachable on B after rebind');
    } finally {
      await client.close();
    }

    // Port A is free again — a fresh server can re-bind it with no EADDRINUSE,
    // proving stop() released the old listener (the rebind didn't leak it).
    const reA = createMcpServer({
      getEngine: (engineOpts) => fakeEngine(engineOpts),
      getSettings: () => fakeSettings(),
      scopeCtx: fakeScopeCtx(),
      port: PORT_A,
    });
    await assert.doesNotReject(reA.start(), 'A is free again after the rebind off it');
    await reA.stop();
  } finally {
    await onB.stop();
  }
});

// ---------------------------------------------------------------------------
// Auth gate (Flight 4, DD2/DD3/DD5/DD6). The gate runs AFTER the origin guard
// (which keeps its 403) and BEFORE session routing. A loopback request from this
// test passes the origin guard, so these tests exercise the auth gate alone. The
// 401 is bare (no JSON-RPC envelope), mirroring the origin guard's bare 403.
// ---------------------------------------------------------------------------

test('auth gate — 401 when automationEnabled is false (even with a valid key)', async () => {
  // The dev-enable override defaults OFF (() => false), so with the persisted toggle
  // off a valid key still 401s — production off-by-default (DD3).
  const server = await startServer({ enabled: false });
  try {
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, initBody());
    assert.equal(res.status, 401);
    assert.equal(res.body, '', '401 is bare — no JSON-RPC envelope');
  } finally {
    await server.stop();
  }
});

// DD3/DD4 (Flight 8) — the in-memory dev-enable override satisfies the auth gate's
// enable check WITHOUT writing automationEnabled, but does NOT waive the Bearer key.
test('auth gate — devEnableOverride ON + automationEnabled false + valid key → identity resolves (200)', async () => {
  const server = await startServer({ enabled: false }, { devEnableOverride: () => true });
  try {
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, initBody());
    assert.equal(res.status, 200, 'override enables the surface even with the persisted toggle off');
  } finally {
    await server.stop();
  }
});

test('auth gate — devEnableOverride ON + automationEnabled false + MISSING key → still 401 (override does NOT waive the key)', async () => {
  const server = await startServer({ enabled: false }, { devEnableOverride: () => true });
  try {
    const res = await rawPost({}, initBody());
    assert.equal(res.status, 401, 'override does not waive the Bearer-key requirement');
  } finally {
    await server.stop();
  }
});

test('auth gate — devEnableOverride ON + automationEnabled false + INVALID key → still 401 (override does NOT waive the key)', async () => {
  const server = await startServer({ enabled: false }, { devEnableOverride: () => true });
  try {
    const res = await rawPost({ authorization: 'Bearer not-a-real-key' }, initBody());
    assert.equal(res.status, 401, 'override does not waive the Bearer-key requirement');
  } finally {
    await server.stop();
  }
});

test('auth gate — devEnableOverride OFF (default) + automationEnabled false + valid key → 401', async () => {
  // Explicit coverage that the default-off override leaves production off-by-default intact.
  const server = await startServer({ enabled: false }, { devEnableOverride: () => false });
  try {
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, initBody());
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('auth gate — 401 when the Authorization header is missing', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({}, initBody());
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('auth gate — 401 for an empty Bearer (no token)', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({ authorization: 'Bearer ' }, initBody());
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('auth gate — 401 for a wrong / unknown key', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({ authorization: 'Bearer wrong-key' }, initBody());
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('auth gate — pass-through on a valid key (full SDK handshake succeeds)', async () => {
  const server = await startServer(); // enabled + VALID_KEY minted
  try {
    const client = await connectClient(VALID_KEY);
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

test('auth gate — case-insensitive Bearer scheme is accepted (raw initialize succeeds)', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({ authorization: 'bearer ' + VALID_KEY }, initBody());
    // A valid initialize that passes the gate is NOT a 401/403/413. The SDK
    // returns 200 with the initialize result (enableJsonResponse).
    assert.ok(res.status !== 401, 'lowercase scheme must pass the gate');
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
  }
});

// ---------------------------------------------------------------------------
// Body-size cap (DD9). Over-cap → 413, distinct from the empty/unparseable → 400.
// The cap is exclusive (strictly over 1 MiB rejects). The over-cap path runs
// AFTER the gate, so the request carries a valid key.
// ---------------------------------------------------------------------------

test('body cap — 413 for a body strictly over 1 MiB (distinct from 400)', async () => {
  const server = await startServer();
  try {
    // > 1 MiB of JSON. Padded so it parses as JSON had it been read — but it is
    // abandoned mid-stream by the cap.
    const huge = JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1024) });
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, huge);
    assert.equal(res.status, 413, 'over-cap body is 413, not 400');
  } finally {
    await server.stop();
  }
});

test('REGRESSION F10: established-session POSTs are also capped at 1 MiB', async () => {
  const server = await startServer();
  try {
    const sid = await rawInitSession();
    const huge = JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1024) });
    const res = await rawPost(
      { authorization: 'Bearer ' + VALID_KEY, 'mcp-session-id': sid },
      huge
    );
    assert.equal(res.status, 413, 'over-cap established-session body is 413');

    // The capped request is refused before delegation without killing the
    // session; a later in-spec request still reaches the same transport.
    const normal = await rawPost(
      { authorization: 'Bearer ' + VALID_KEY, 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} }
    );
    assert.equal(normal.status, 200, 'normal established-session body is unaffected');
  } finally {
    await server.stop();
  }
});

test('body cap — a normal initialize body (well under 1 MiB) is unaffected', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, initBody());
    assert.equal(res.status, 200, 'a normal body passes the cap and initializes');
  } finally {
    await server.stop();
  }
});

test('body cap — an empty/unparseable body is still 400 (not collapsed into 413)', async () => {
  const server = await startServer();
  try {
    const res = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, '{not json');
    assert.equal(res.status, 400, 'unparseable non-initialize body stays 400');
  } finally {
    await server.stop();
  }
});

// ---------------------------------------------------------------------------
// Jar-scoping + admin tier (Flight 4 Leg 2, DD4/DD6/DD7). The fake world above
// (multi-jar tabs + a burner + an internal-session tab + a partition→session map
// with REAL object identity) makes the membership compare authentic. Identity is
// resolved per request and bound to the session; the per-session Server is built
// scoped to that identity.
// ---------------------------------------------------------------------------

const WORK_KEY = 'work-automation-key';
const ADMIN_KEY = 'admin-automation-key';

// Settings exposing a 'test' jar key, a 'work' jar key, and (optionally) the
// admin key. The admin tier additionally needs the GOLDFINCH_AUTOMATION_ADMIN
// env presence gate set at request time.
function multiKeySettings({ enabled = true, withAdmin = false } = {}) {
  const keyHashes = { test: hashKey(VALID_KEY), work: hashKey(WORK_KEY) };
  const adminKeyHash = withAdmin ? hashKey(ADMIN_KEY) : '';
  return () => fakeSettings({ enabled, keyHashes, adminKeyHash });
}

// Start a server with the multi-key settings + the scope ctx + a getEngine that
// honours allowInternal (so the admin path actually enumerates the internal tab).
async function startScopedServer({ enabled = true, withAdmin = false } = {}) {
  const server = createMcpServer({
    getEngine: (engineOpts) => makeFakeEngine(engineOpts),
    getSettings: multiKeySettings({ enabled, withAdmin }),
    scopeCtx: fakeScopeCtx(),
    port: TEST_PORT,
  });
  await server.start();
  return server;
}

// Parse a (non-image) tool result's single text-content block as JSON.
function toolJson(result) {
  return JSON.parse(result.content[0].text);
}

test('scope — a jar key enumerates ONLY its own jar (by session, not reported jarId)', async () => {
  const server = await startScopedServer();
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      const res = await client.callTool({ name: 'enumerateTabs', arguments: {} });
      assert.equal(res.isError, undefined);
      const tabs = toolJson(res);
      const wcIds = tabs.map((t) => t.wcId).sort();
      // wcId 1 (test, label matches) + wcId 4 (test session, label LIES 'work').
      // NOT wcId 2 (work), 3 (burner), or 5 (internal).
      assert.deepEqual(wcIds, [1, 4]);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('scope — a jar key drives its own tab but is REFUSED on an out-of-jar tab', async () => {
  const server = await startScopedServer();
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      // In-jar: wcId 1 belongs to 'test' → reaches the engine.
      const ok = await client.callTool({ name: 'navigate', arguments: { wcId: 1, url: 'https://x.example' } });
      assert.equal(ok.isError, undefined);
      assert.deepEqual(toolJson(ok), { navigated: 1, url: 'https://x.example' });

      // Out-of-jar: wcId 2 belongs to 'work' → out-of-jar refusal (isError).
      const refused = await client.callTool({ name: 'navigate', arguments: { wcId: 2, url: 'https://x.example' } });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /out-of-jar/);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('scope — a jar key is REFUSED on a burner tab (session matches no persistent jar)', async () => {
  const server = await startScopedServer();
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      // wcId 3 is a burner; its renderer-reported jarId LIES 'test', but its
      // session matches no jar → out-of-jar.
      const refused = await client.callTool({ name: 'click', arguments: { wcId: 3, x: 1, y: 1 } });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /out-of-jar/);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('scope — a jar key is REFUSED on the internal-session tab (absolute exclusion)', async () => {
  const server = await startScopedServer();
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      // wcId 5 is the internal goldfinch://settings tab. A jar key never carries
      // allowInternal → internal-session throw before the membership check.
      const refused = await client.callTool({ name: 'readDom', arguments: { wcId: 5 } });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /internal-session/);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('scope — a jar key captureWindow is admin-only (distinct from out-of-jar)', async () => {
  const server = await startScopedServer();
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      const refused = await client.callTool({ name: 'captureWindow', arguments: {} });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /admin-only/);
      assert.doesNotMatch(refused.content[0].text, /out-of-jar/);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('scope — admin (env-set) enumerates ALL jars + the internal tab and captureWindow succeeds', async () => {
  process.env.GOLDFINCH_AUTOMATION_ADMIN = '1';
  const server = await startScopedServer({ withAdmin: true });
  try {
    const client = await connectClient(ADMIN_KEY); // identity 'admin'
    try {
      const res = await client.callTool({ name: 'enumerateTabs', arguments: {} });
      assert.equal(res.isError, undefined);
      const wcIds = toolJson(res).map((t) => t.wcId).sort();
      // Admin sees every tab INCLUDING the internal session tab (wcId 5).
      assert.deepEqual(wcIds, [1, 2, 3, 4, 5]);

      // captureWindow is allowed for admin.
      const win = await client.callTool({ name: 'captureWindow', arguments: {} });
      assert.equal(win.isError, undefined);

      // Admin drives any tab, including the internal one (allowInternal relaxation).
      const drive = await client.callTool({ name: 'readDom', arguments: { wcId: 5 } });
      assert.equal(drive.isError, undefined);
      assert.deepEqual(toolJson(drive), { dom: 5 });
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
    delete process.env.GOLDFINCH_AUTOMATION_ADMIN;
  }
});

test('scope — admin minting refused / 401 when the env gate is UNSET at request time', async () => {
  // No GOLDFINCH_AUTOMATION_ADMIN in env → the admin key never resolves → 401.
  delete process.env.GOLDFINCH_AUTOMATION_ADMIN;
  const server = await startScopedServer({ withAdmin: true });
  try {
    const res = await rawPost({ authorization: 'Bearer ' + ADMIN_KEY }, initBody());
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('identity-match — an existing session reused under a DIFFERENT valid key → 401', async () => {
  const server = await startScopedServer();
  try {
    // Open a session as jar 'test' via a raw initialize (no SDK client → no
    // background SSE stream to leak across the raw probe + stop()).
    const sid = await rawInitSession(VALID_KEY);
    // Replay a request on that same session id but with the 'work' key. The gate
    // resolves a valid (work) identity, so it is NOT caught by the bare gate; the
    // routeRequest identity-match catches the mismatch → bare 401.
    const res = await rawPost(
      { authorization: 'Bearer ' + WORK_KEY, 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }
    );
    assert.equal(res.status, 401, 'identity mismatch on an existing session is 401');
    assert.equal(res.body, '', '401 is bare');
  } finally {
    await server.stop();
  }
});

test('identity-match — same session reused under the SAME key still works', async () => {
  const server = await startScopedServer();
  try {
    const sid = await rawInitSession(VALID_KEY);
    const res = await rawPost(
      { authorization: 'Bearer ' + VALID_KEY, 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }
    );
    assert.equal(res.status, 200, 'same-identity reuse passes');
  } finally {
    await server.stop();
  }
});

test('live re-validation — toggle-off mid-session → the next request on the session is 401', async () => {
  // The gate reads settings live per request. Open a session, then re-start the
  // surface DISABLED: a request reusing the old session id with the valid key is
  // 401 at the gate (resolveIdentity → null on disabled), confirming the gate
  // itself kills a live session on toggle-off (no separate mechanism needed).
  const server = await startScopedServer();
  let sid;
  try {
    sid = await rawInitSession(VALID_KEY);
  } finally {
    await server.stop();
  }
  const disabled = await startScopedServer({ enabled: false });
  try {
    const res = await rawPost(
      { authorization: 'Bearer ' + VALID_KEY, 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }
    );
    assert.equal(res.status, 401, 'toggle-off makes the next request 401 (live re-validation)');
  } finally {
    await disabled.stop();
  }
});

test('REGRESSION F11: initialize rejects once 64 active sessions are retained', async () => {
  const server = await startServer();
  try {
    for (let i = 0; i < 64; i++) await rawInitSession();
    assert.equal(server.getActivity().sessions.length, 64, 'the configured active-session capacity is reachable');

    const over = await rawPost({ authorization: 'Bearer ' + VALID_KEY }, initBody());
    assert.equal(over.status, 429, 'the next initialize is rejected at the cap');
    const rpc = JSON.parse(over.body);
    assert.equal(rpc.error.code, -32000);
    assert.match(rpc.error.message, /Session limit reached: maximum 64 active sessions/);
    assert.equal(server.getActivity().sessions.length, 64, 'rejection allocates no additional session');

    // Existing sessions remain active and are not evicted by a rejected initialize.
    const [sid] = server.getActivity().sessions.map((s) => s.sessionId);
    const normal = await rawPost(
      { authorization: 'Bearer ' + VALID_KEY, 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 13, method: 'tools/list', params: {} }
    );
    assert.equal(normal.status, 200, 'an existing session remains usable at capacity');
  } finally {
    await server.stop();
  }
});

// ---------------------------------------------------------------------------
// Audit data layer (Flight 4, Leg 3, DD8). The choke-point wrapper in
// buildServer records every tool call; session open/close updates the active
// set; the injected `broadcast` fires the audit snapshot on every mutation;
// getActivity() reads the current snapshot on demand. The fake engine + scope
// ctx above drive real ok / out-of-jar outcomes through the recorder.
// ---------------------------------------------------------------------------

// Start a scoped server that also captures every broadcast payload into `sink`.
async function startAuditServer(sink, { withAdmin = false } = {}) {
  const server = createMcpServer({
    getEngine: (engineOpts) => makeFakeEngine(engineOpts),
    getSettings: multiKeySettings({ withAdmin }),
    scopeCtx: fakeScopeCtx(),
    broadcast: (payload) => sink.push(payload),
    port: TEST_PORT,
  });
  await server.start();
  return server;
}

test('audit — a successful tool call appends one entry (identity/op/targetWcId/outcome:ok)', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      const before = server.getActivity().log.length;
      const ok = await client.callTool({ name: 'navigate', arguments: { wcId: 1, url: 'https://x.example' } });
      assert.equal(ok.isError, undefined);

      const log = server.getActivity().log;
      assert.equal(log.length, before + 1, 'exactly one entry appended');
      const entry = log[log.length - 1];
      assert.equal(entry.identity, 'test');
      assert.equal(entry.op, 'navigate');
      assert.equal(entry.targetWcId, 1);
      assert.equal(entry.outcome, 'ok');
      assert.equal(entry.errorCode, null);
      assert.equal(typeof entry.ts, 'number');
      assert.ok(entry.sessionId, 'sessionId is populated (read lazily from the per-session ref)');
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('audit — an out-of-jar refusal records outcome:error with errorCode out-of-jar', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    try {
      // wcId 2 belongs to 'work' → out-of-jar refusal.
      const refused = await client.callTool({ name: 'navigate', arguments: { wcId: 2, url: 'https://x.example' } });
      assert.equal(refused.isError, true);

      const log = server.getActivity().log;
      const entry = log[log.length - 1];
      assert.equal(entry.op, 'navigate');
      assert.equal(entry.targetWcId, 2);
      assert.equal(entry.outcome, 'error');
      assert.equal(entry.errorCode, 'out-of-jar');
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('audit — a no-wcId op records targetWcId:null', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY);
    try {
      await client.callTool({ name: 'enumerateTabs', arguments: {} });
      const entry = server.getActivity().log.slice(-1)[0];
      assert.equal(entry.op, 'enumerateTabs');
      assert.equal(entry.targetWcId, null);
      assert.equal(entry.outcome, 'ok');
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('audit — opening then closing a session updates getActivity().sessions (named jar)', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY); // identity 'test'
    // After connect: one active session, named jar 'test'.
    const open = server.getActivity().sessions;
    assert.equal(open.length, 1, 'one active session after connect');
    assert.equal(open[0].identity, 'test');
    assert.equal(open[0].kind, 'jar');
    assert.equal(open[0].jarId, 'test');
    assert.ok(open[0].sessionId);
    assert.equal(typeof open[0].since, 'number');

    // Explicitly terminate the session (HTTP DELETE) — the realistic client
    // disconnect that fires the server transport's onclose → noteSessionClose.
    // (A bare client.close() over a connection:close harness does not tear down
    // the server-side transport; stop() would, but we want to observe the
    // mid-life close here.) The close is async over HTTP; poll for the drain.
    await client.transport.terminateSession();
    await client.close();
    await waitFor(() => server.getActivity().sessions.length === 0);
    assert.equal(server.getActivity().sessions.length, 0, 'active set drains on disconnect');
  } finally {
    await server.stop();
  }
});

// Open the session's standalone GET SSE stream (the long-lived stream a real
// client holds for server→client messages) and return the live http.ClientRequest
// so the caller can abort it WITHOUT a DELETE — simulating an ungraceful client
// drop (process death / SDK client.close() that only tears down locally). Resolves
// once the response headers arrive so the server-side res 'close' handler is armed.
function openGetStream(sessionId, key = VALID_KEY) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        path: '/mcp',
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          authorization: 'Bearer ' + key,
          'mcp-session-id': sessionId,
        },
      },
      (res) => resolve({ req, res })
    );
    req.on('error', reject);
    req.end();
  });
}

test('audit — an ungracefully-dropped GET SSE stream (no DELETE) drains the session', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    // Open a session (raw initialize POST → session id), then hold its standalone
    // GET SSE stream open — the realistic long-lived client stream.
    const sid = await rawInitSession(VALID_KEY);
    await waitFor(() => server.getActivity().sessions.length === 1);
    const { req } = await openGetStream(sid);

    // Drop the GET stream WITHOUT a DELETE / terminateSession — the process-death
    // case. The fix's res 'close' handler must tear the session down so it does
    // not linger as "connected". (Before the fix, transport.onclose never fired
    // for a dropped GET and the session lingered until app restart.)
    req.destroy();
    await waitFor(() => server.getActivity().sessions.length === 0);
    assert.equal(server.getActivity().sessions.length, 0, 'dropped GET stream drains the session');
  } finally {
    await server.stop();
  }
});

test('audit — admin session reports kind:admin with jarId null', async () => {
  process.env.GOLDFINCH_AUTOMATION_ADMIN = '1';
  const broadcasts = [];
  const server = await startAuditServer(broadcasts, { withAdmin: true });
  try {
    const client = await connectClient(ADMIN_KEY); // identity 'admin'
    try {
      const [s] = server.getActivity().sessions;
      assert.equal(s.identity, 'admin');
      assert.equal(s.kind, 'admin');
      assert.equal(s.jarId, null);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
    delete process.env.GOLDFINCH_AUTOMATION_ADMIN;
  }
});

test('audit — the injected broadcast fires with the snapshot on session open and on a tool call', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY);
    try {
      // Session open already fired at least one broadcast carrying the snapshot.
      assert.ok(broadcasts.length >= 1, 'session open fired a broadcast');
      const opened = broadcasts[broadcasts.length - 1];
      assert.ok(Array.isArray(opened.sessions) && Array.isArray(opened.log), 'broadcast payload is a snapshot');
      assert.equal(opened.sessions.length, 1);

      const beforeCall = broadcasts.length;
      await client.callTool({ name: 'click', arguments: { wcId: 1, x: 1, y: 1 } });
      assert.ok(broadcasts.length > beforeCall, 'the tool call fired a broadcast');
      const afterCall = broadcasts[broadcasts.length - 1];
      assert.ok(afterCall.log.length >= 1, 'the broadcast snapshot carries the recorded call');
      assert.equal(afterCall.log[afterCall.log.length - 1].op, 'click');
    } finally {
      // Terminate the session (DELETE) so the server transport's onclose fires
      // the session-close broadcast (see the sessions-drain test for the why).
      await client.transport.terminateSession();
      await client.close();
    }
    // The disconnect fires a session-close broadcast too.
    await waitFor(() => broadcasts.some((b) => b.sessions.length === 0));
    assert.ok(broadcasts.some((b) => b.sessions.length === 0), 'session close fired a broadcast with an empty active set');
  } finally {
    await server.stop();
  }
});

// ---------------------------------------------------------------------------
// Mint guard (Leg 2): mintJarKey rejects a jarId absent from jars.list() so a key
// cannot bind an identity that resolves to no jar. DD3 (Flight 8): mintJarKey
// creates the credential ONLY — it never enables the surface (enabling is
// human-only via the toggle). Pure — in-memory settings stub + a fake jars accessor.
// ---------------------------------------------------------------------------

function memSettings() {
  const map = {};
  return { get: (k) => map[k], set: (k, v) => { map[k] = v; } };
}

test('mint — minting a KNOWN jar id creates a credential that validates as that jar (never enables)', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }, { id: 'work' }] };
  const key = mintJarKey('personal', settings, jars);
  assert.equal(typeof key, 'string');
  // DD3: minting creates the credential ONLY — it does NOT flip automationEnabled.
  assert.equal(settings.get('automationEnabled'), undefined, 'mint does NOT enable the surface');
  const identity = validateKey(key, { keyHashes: settings.get('automationKeyHashes') });
  assert.equal(identity, 'personal');
});

test('mint — minting an UNKNOWN jar id throws (creates no credential)', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }] };
  assert.throws(
    () => mintJarKey('ghost', settings, jars),
    (err) => err instanceof Error && /not a known jar/.test(err.message)
  );
  // Mint never enables, so this only confirms a rejected mint stores no credential.
  assert.equal(settings.get('automationEnabled'), undefined, 'mint never enables (rejected or not)');
  assert.equal(settings.get('automationKeyHashes'), undefined, 'no hash stored on a rejected mint');
});

test('mint — a BURNER id (never in jars.list()) is rejected', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }, { id: 'work' }] };
  assert.throws(
    () => mintJarKey('burner:1', settings, jars),
    (err) => err instanceof Error && /not a known jar/.test(err.message)
  );
});

test('mint — omitting the jars accessor keeps the legacy non-empty-string behaviour', () => {
  const settings = memSettings();
  // No jars arg → only the non-empty-string check applies (back-compat for the
  // pure auth tests). main.js always passes jars.
  const key = mintJarKey('anything', settings);
  assert.equal(typeof key, 'string');
  assert.throws(() => mintJarKey('', settings), /non-empty string/);
});

// ---------------------------------------------------------------------------
// Revoke (Leg 3): revokeJarKey deletes only the target jar's hash (others
// intact; absent id is a no-op); revokeAdminKey clears to ''. Neither touches a
// live sessions Map — DD5's "effective immediately" comes from per-request
// re-validation, proved at the validation layer below.
// ---------------------------------------------------------------------------

test('revokeJarKey — deletes only the target jar hash; other jars untouched', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }, { id: 'work' }] };
  mintJarKey('personal', settings, jars);
  mintJarKey('work', settings, jars);
  const beforeWork = settings.get('automationKeyHashes').work;

  revokeJarKey('personal', settings);

  const hashes = settings.get('automationKeyHashes');
  assert.equal(
    Object.prototype.hasOwnProperty.call(hashes, 'personal'),
    false,
    'target jar hash deleted'
  );
  assert.equal(hashes.work, beforeWork, "other jar's hash left intact");
});

test('revokeJarKey — an absent jar id is a no-op (never throws; leaves hashes unchanged)', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }] };
  mintJarKey('personal', settings, jars);
  const before = { ...settings.get('automationKeyHashes') };

  assert.doesNotThrow(() => revokeJarKey('ghost', settings));
  assert.deepEqual(settings.get('automationKeyHashes'), before, 'hashes unchanged for an absent id');
});

test('revokeAdminKey — clears the admin key hash to the empty string', () => {
  const settings = memSettings();
  settings.set('automationAdminKeyHash', hashKey('an-admin-key'));
  revokeAdminKey(settings);
  assert.equal(settings.get('automationAdminKeyHash'), '');
});

test('revoke re-validation — a minted token validates to its jar, then to null after revoke', () => {
  const settings = memSettings();
  const jars = { list: () => [{ id: 'personal' }, { id: 'work' }] };
  const key = mintJarKey('personal', settings, jars);

  // Pre-revoke: the live hashes resolve the token to its jar (what resolveIdentity
  // reads every request).
  assert.equal(
    validateKey(key, { keyHashes: settings.get('automationKeyHashes') }),
    'personal',
    'minted token validates to its jar before revoke'
  );

  revokeJarKey('personal', settings);

  // Post-revoke: the SAME token now validates to null — the next MCP request 401s
  // (DD5 "effective immediately"), with no sessions.delete() required.
  assert.equal(
    validateKey(key, { keyHashes: settings.get('automationKeyHashes') }),
    null,
    'same token validates to null after revoke (proves 401-on-next-request)'
  );
});

// ---------------------------------------------------------------------------
// deriveAuditDetail (pure helper, HAT SC10 inline fix). Tests every mapping and
// the key safety invariant: typeText MUST NOT log content — length only.
// ---------------------------------------------------------------------------

test('deriveAuditDetail — navigate returns url=<url>', () => {
  assert.equal(deriveAuditDetail('navigate', { wcId: 1, url: 'https://example.com' }), 'url=https://example.com');
});

test('deriveAuditDetail — navigate with null url returns null', () => {
  assert.equal(deriveAuditDetail('navigate', { wcId: 1 }), null);
});

test('deriveAuditDetail — openTab returns url=<url>', () => {
  assert.equal(deriveAuditDetail('openTab', { url: 'https://x.example' }), 'url=https://x.example');
});

test('deriveAuditDetail — openTab with jarId appends jar=<jarId>', () => {
  assert.equal(deriveAuditDetail('openTab', { url: 'https://x.example', jarId: 'work' }), 'url=https://x.example jar=work');
});

test('deriveAuditDetail — click returns (x,y) with defaults omitted', () => {
  assert.equal(deriveAuditDetail('click', { wcId: 1, x: 10, y: 20 }), '(10,20)');
});

test('deriveAuditDetail — click with non-default button includes it', () => {
  assert.equal(deriveAuditDetail('click', { wcId: 1, x: 10, y: 20, button: 'right', clickCount: 1 }), '(10,20) button=right');
});

test('deriveAuditDetail — click with non-default clickCount includes it', () => {
  assert.equal(deriveAuditDetail('click', { wcId: 1, x: 5, y: 5, clickCount: 2 }), '(5,5) clicks=2');
});

test('deriveAuditDetail — scroll returns (x,y) d=(dx,dy)', () => {
  assert.equal(deriveAuditDetail('scroll', { wcId: 1, x: 0, y: 0, dx: 0, dy: -100 }), '(0,0) d=(0,-100)');
});

test('deriveAuditDetail — pressKey returns key=<name> (preferred alias)', () => {
  assert.equal(deriveAuditDetail('pressKey', { wcId: 1, name: 'Enter' }), 'key=Enter');
});

test('deriveAuditDetail — pressKey falls back to key alias when name absent', () => {
  assert.equal(deriveAuditDetail('pressKey', { wcId: 1, key: 'Tab' }), 'key=Tab');
});

test('deriveAuditDetail — pressKey with a single modifier records the chord (key=M+control)', () => {
  assert.equal(deriveAuditDetail('pressKey', { wcId: 1, name: 'M', modifiers: ['control'] }), 'key=M+control');
});

test('deriveAuditDetail — pressKey with multiple modifiers records each (key=P+control+shift)', () => {
  assert.equal(deriveAuditDetail('pressKey', { wcId: 1, name: 'P', modifiers: ['control', 'shift'] }), 'key=P+control+shift');
});

test('deriveAuditDetail — pressKey with empty modifiers keeps the bare-key string', () => {
  assert.equal(deriveAuditDetail('pressKey', { wcId: 1, name: 'Enter', modifiers: [] }), 'key=Enter');
});

test('deriveAuditDetail — typeText returns text(N chars) — NEVER the raw content', () => {
  const secret = 'hunter2';
  const detail = deriveAuditDetail('typeText', { wcId: 1, text: secret });
  // Must be the length form.
  assert.equal(detail, 'text(' + secret.length + ' chars)');
  // MUST NOT contain the raw text.
  assert.ok(!detail.includes(secret), 'typeText detail must not contain the typed content');
});

test('deriveAuditDetail — typeText with empty text returns text(0 chars)', () => {
  assert.equal(deriveAuditDetail('typeText', { wcId: 1, text: '' }), 'text(0 chars)');
});

test('deriveAuditDetail — null-returning ops yield null', () => {
  const nullOps = ['enumerateTabs', 'getChromeTarget', 'downloadsList', 'captureWindow', 'captureScreenshot',
    'readDom', 'readAxTree', 'closeTab', 'activateTab', 'goBack', 'goForward', 'reload',
    'openDevTools', 'closeDevTools'];
  for (const op of nullOps) {
    assert.equal(deriveAuditDetail(op, { wcId: 1 }), null, op + ' should return null');
  }
});

test('deriveAuditDetail — null-safe: returns null when args is undefined', () => {
  assert.equal(deriveAuditDetail('navigate', undefined), null);
  assert.equal(deriveAuditDetail('typeText', undefined), null);
  assert.equal(deriveAuditDetail('click', undefined), null);
});

test('audit — navigate tool call records detail=url=… in the log entry', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY);
    try {
      await client.callTool({ name: 'navigate', arguments: { wcId: 1, url: 'https://detail-test.example' } });
      const entry = server.getActivity().log.slice(-1)[0];
      assert.equal(entry.op, 'navigate');
      assert.equal(entry.detail, 'url=https://detail-test.example');
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('audit — typeText tool call records text(N chars) detail — never the content', async () => {
  const secret = 's3cr3t!';
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY);
    try {
      await client.callTool({ name: 'typeText', arguments: { wcId: 1, text: secret } });
      const entry = server.getActivity().log.slice(-1)[0];
      assert.equal(entry.op, 'typeText');
      assert.equal(entry.detail, 'text(' + secret.length + ' chars)');
      assert.ok(!entry.detail.includes(secret), 'the typed secret must not appear in the log detail');
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});

test('audit — enumerateTabs tool call records detail:null (no context needed)', async () => {
  const broadcasts = [];
  const server = await startAuditServer(broadcasts);
  try {
    const client = await connectClient(VALID_KEY);
    try {
      await client.callTool({ name: 'enumerateTabs', arguments: {} });
      const entry = server.getActivity().log.slice(-1)[0];
      assert.equal(entry.op, 'enumerateTabs');
      assert.equal(entry.detail, null);
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }
});
