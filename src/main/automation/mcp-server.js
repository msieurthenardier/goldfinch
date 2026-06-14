// @ts-check
'use strict';

// Automation MCP transport — the loopback-only Streamable-HTTP server (DD1/DD2/DD3).
//
// This is the SOLE module (alongside the main.js mount) that imports the MCP SDK
// (`@modelcontextprotocol/sdk`) — Goldfinch's deliberate first runtime dependency
// (DD1). The SDK is confined to the transport layer: engine.js and the
// resolve/tabs/nav/input/observe modules stay SDK-free and dependency-free.
//
// SDK-PREMISE FINDING (verified live before scaffolding, leg mcp-server-scaffold):
//   `StreamableHTTPServerTransport.handleRequest(req, res, body?)` consumes the
//   raw Node `http` IncomingMessage/ServerResponse pair directly. We DO NOT add
//   Express, a web framework, or a Fetch Request/Response shim. (Internally the
//   SDK uses @hono/node-server to bridge Node↔WebStandard, but that is opaque to
//   us — our wiring is `http.createServer` → `transport.handleRequest(req,res)`.)
//   A standalone Node spike completed a full `initialize` + `tools/list`
//   handshake from the SDK client over 127.0.0.1 with this exact shape. PASS.
//
// SESSION MODEL: STATEFUL, MULTI-SESSION (per-connection session id via
// randomUUID). The stateless variant (sessionIdGenerator: undefined) 500'd the
// post-initialize `notifications/initialized` POST in this SDK version (1.29.0);
// the stateful path completes the handshake cleanly and is the SDK's documented
// robust path.
//
// MULTI-SESSION (defect fix — see flight-log): a SINGLE transport that is
// connected ONCE at startup binds ONE session for the app's whole lifetime in
// the SDK's stateful mode. After the first client disconnects, a fresh
// `initialize` is refused with -32600 "Server already initialized", and the old
// session id is unrecoverable (-32001 "Session not found") — so clients cannot
// reconnect and a second/concurrent client cannot connect. We instead follow
// the SDK's standard stateful multi-session pattern: a NEW Server+transport pair
// is created per `initialize` request, keyed by the transport's generated
// session id in a live-sessions Map, routed to thereafter by the
// `Mcp-Session-Id` header, and evicted on the transport's `onclose`.
//
// The engine accessor is injected (lazy) so each per-session Server reaches the
// same live engine — and so a request arriving before the window is ready cannot
// null-deref (buildToolRegistry catches the throw inside callTool).

const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} = require('@modelcontextprotocol/sdk/types.js');
const { isAllowed } = require('./origin-guard');
const { buildToolRegistry } = require('./mcp-tools');

const DEFAULT_PORT = 7777;
const SERVER_NAME = 'goldfinch';

/**
 * Resolve the listen port: GOLDFINCH_MCP_PORT (if a valid positive integer)
 * else the fixed default 7777 (DD2).
 * @returns {number}
 */
function resolvePort() {
  const raw = process.env.GOLDFINCH_MCP_PORT;
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PORT;
}

/**
 * Build the loopback MCP server. Does NOT start listening — call `start()`.
 *
 * The engine accessor is held lazily and injected into every per-session tool
 * registry, so each session's Server reaches the same live engine. It is taken
 * lazily (a getter) so it is never dereferenced at construction and a
 * recreated/closed window is always picked up at call time.
 *
 * @param {object} [opts]
 * @param {() => any} [opts.getEngine]  lazy accessor for the automation engine
 *   (createEngine(...) result); wired into each session's tool registry.
 * @param {string} [opts.version]  server version advertised in the handshake;
 *   defaults to the app version from package.json.
 * @param {number} [opts.port]  listen port override (takes precedence over
 *   GOLDFINCH_MCP_PORT / the default); used by tests to pick a free high port.
 * @returns {{ start: () => Promise<void>, stop: () => Promise<void>, port: number }}
 */
function createMcpServer(opts = {}) {
  // Lazy engine accessor. If absent, fall back to an accessor returning a value
  // that throws on any op deref so tools/call degrades to an isError result
  // (never a null-deref). buildToolRegistry catches the throw inside callTool.
  const getEngine = typeof opts.getEngine === 'function'
    ? opts.getEngine
    : () => { throw new Error('automation: engine unavailable'); };

  let version = opts.version;
  if (!version) {
    try {
      version = require('../../../package.json').version;
    } catch {
      version = '0.0.0';
    }
  }

  const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : resolvePort();

  // Live sessions, keyed by the transport's generated session id. Each entry
  // owns a Server + its StreamableHTTPServerTransport. Created on `initialize`,
  // routed to thereafter by the `Mcp-Session-Id` header, evicted on transport
  // `onclose`.
  /** @type {Map<string, { server: import('@modelcontextprotocol/sdk/server/index.js').Server, transport: StreamableHTTPServerTransport }>} */
  const sessions = new Map();

  /**
   * Build a fresh MCP Server with the 16 tools wired over the shared (lazy)
   * getEngine. One per session — `tools/list`/`tools/call` are backed by the
   * SDK-free registry (mcp-tools.js), and getEngine is called fresh per
   * callTool inside it so every session reaches the same live engine.
   * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server}
   */
  function buildServer() {
    const server = new Server(
      { name: SERVER_NAME, version },
      { capabilities: { tools: {} } }
    );
    const registry = buildToolRegistry(getEngine);
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (req) =>
      registry.callTool(req.params.name, req.params.arguments)
    );
    return server;
  }

  /** @type {import('http').Server | null} */
  let httpServer = null;
  let started = false;

  /**
   * Read and JSON-parse a request body. Resolves `undefined` on an empty body or
   * a parse failure (the caller treats a non-initialize / unparseable body
   * without a valid session as a 400).
   * @param {import('http').IncomingMessage} req
   * @returns {Promise<any>}
   */
  function readJsonBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) { resolve(undefined); return; }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(undefined);
        }
      });
      req.on('error', () => resolve(undefined));
    });
  }

  /**
   * Write a JSON-RPC error response with the given HTTP status.
   * @param {import('http').ServerResponse} res
   * @param {number} status
   * @param {string} message
   */
  function sendJsonRpcError(res, status, message) {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    }));
  }

  /**
   * The Node http request handler. The SC7 origin guard runs FIRST on every
   * request (DD3) — a denied request gets a 403 and never reaches the SDK or any
   * session routing. After the guard, requests are routed to an existing session
   * (by `Mcp-Session-Id`) or, for an initialize POST, a new session is created.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  function onRequest(req, res) {
    const allowed = isAllowed({
      host: req.headers.host,
      origin: req.headers.origin,
      peerAddress: req.socket.remoteAddress,
    });
    if (!allowed) {
      res.writeHead(403);
      res.end();
      return;
    }
    routeRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  /**
   * Route a guard-passed request to a session transport, creating a session on
   * an initialize POST.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {Promise<void>}
   */
  async function routeRequest(req, res) {
    const sessionId = /** @type {string | undefined} */ (
      Array.isArray(req.headers['mcp-session-id'])
        ? req.headers['mcp-session-id'][0]
        : req.headers['mcp-session-id']
    );

    // Existing session → route straight to its transport (handles POST/GET/DELETE,
    // including the SSE stream and session teardown).
    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (entry) {
        await entry.transport.handleRequest(req, res);
        return;
      }
      // A session id was supplied but is unknown (stale/torn-down).
      sendJsonRpcError(res, 404, 'No valid session: unknown Mcp-Session-Id');
      return;
    }

    // No session id. Only a POST carrying an `initialize` request may create one.
    if (req.method !== 'POST') {
      sendJsonRpcError(res, 400, 'No valid session: Mcp-Session-Id required');
      return;
    }

    const body = await readJsonBody(req);
    if (!isInitializeRequest(body)) {
      sendJsonRpcError(res, 400, 'No valid session: initialize required to open one');
      return;
    }

    // Create a NEW session: fresh transport + Server, registered on init.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => { sessions.set(sid, { server, transport }); },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = buildServer();
    await server.connect(transport);
    // Pass the already-parsed body so the SDK does not try to re-read the stream.
    await transport.handleRequest(req, res, body);
  }

  /**
   * Start the server: bind the http server to 127.0.0.1. Idempotent — a second
   * call is a no-op. Per-session Server/transport pairs are connected lazily on
   * each `initialize` (see routeRequest), not at start. Rejects (without
   * crashing the app) on a bind error (e.g. EADDRINUSE) so the caller can
   * surface the GOLDFINCH_MCP_PORT override hint.
   * @returns {Promise<void>}
   */
  async function start() {
    if (started) return;
    started = true;

    httpServer = http.createServer(onRequest);

    await new Promise((resolve, reject) => {
      const srv = /** @type {import('http').Server} */ (httpServer);
      const onError = (/** @type {NodeJS.ErrnoException} */ err) => {
        // Bind failure (EADDRINUSE etc.): reset so a later retry can re-start,
        // and surface a clear error rather than crashing the app silently.
        started = false;
        httpServer = null;
        if (err && err.code === 'EADDRINUSE') {
          reject(new Error(
            'automation: MCP port ' + port + ' is in use — set GOLDFINCH_MCP_PORT to override'
          ));
        } else {
          reject(err);
        }
      };
      srv.once('error', onError);
      // Bind LOOPBACK ONLY — 127.0.0.1, never 0.0.0.0 / :: (SC7).
      srv.listen(port, '127.0.0.1', () => {
        srv.removeListener('error', onError);
        resolve(undefined);
      });
    });
  }

  /**
   * Stop the server: close the http listener (releasing the port) and EVERY live
   * session's transport. Idempotent — safe to call from both `before-quit` and
   * `window-all-closed`, and safe when never started.
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!started) return;
    started = false;

    const srv = httpServer;
    httpServer = null;
    if (srv) {
      // close() stops accepting and waits for existing connections to finish;
      // lingering keep-alive sockets (the SDK client uses them) would otherwise
      // hold the listen socket open and delay/deny an immediate restart on the
      // same port. Forcibly destroy them so the port frees promptly.
      const closed = new Promise((resolve) => srv.close(() => resolve(undefined)));
      if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
      await closed;
    }
    // Close all live sessions. Each transport.close() fires its onclose, which
    // deletes the entry; snapshot first so iteration is not disturbed by that.
    const entries = [...sessions.values()];
    sessions.clear();
    for (const { transport } of entries) {
      try {
        await transport.close();
      } catch {
        // already closed — ignore
      }
    }
  }

  return { start, stop, port };
}

module.exports = { createMcpServer, resolvePort, DEFAULT_PORT };
