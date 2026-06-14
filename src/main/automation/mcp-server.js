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
// SESSION MODEL: STATEFUL (per-connection session id via randomUUID). The
// stateless variant (sessionIdGenerator: undefined) 500'd the post-initialize
// `notifications/initialized` POST in this SDK version (1.29.0); the stateful
// path completed the handshake cleanly and is the SDK's documented robust path.
// One local consumer, so the single-session overhead is negligible. (Resolves
// the flight's session-model open question.)
//
// NO ENGINE TOOLS ARE REGISTERED YET (legs 2–3 populate the registry). The
// server advertises the `tools` capability with an empty `tools/list`. The
// engine accessor is injected (lazy) so legs 2–3 can register tools without
// reshaping the constructor — and so a request arriving before the window is
// ready cannot null-deref.

const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
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
 * The engine accessor is accepted and held for legs 2–3 (which will register the
 * 16 engine ops as tools) but is NOT used this leg — no tools are registered.
 * It is taken lazily (a getter) so it is never dereferenced at construction and
 * a recreated/closed window is always picked up at call time.
 *
 * @param {object} [opts]
 * @param {() => any} [opts.getEngine]  lazy accessor for the automation engine
 *   (createEngine(...) result), consumed by legs 2–3 to register tools. Unused
 *   this leg.
 * @param {string} [opts.version]  server version advertised in the handshake;
 *   defaults to the app version from package.json.
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

  const port = resolvePort();

  // The low-level MCP Server. Advertise the `tools` capability. `initialize`
  // negotiates it; `tools/list` and `tools/call` are backed by the SDK-free
  // tool registry (mcp-tools.js) built once from the held getEngine. Leg 2
  // registers the 12 drive tools; Leg 3 appends the 4 observe tools.
  const mcp = new Server(
    { name: SERVER_NAME, version },
    { capabilities: { tools: {} } }
  );
  // Build the registry once; getEngine is called fresh per callTool inside it.
  const registry = buildToolRegistry(getEngine);
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) =>
    registry.callTool(req.params.name, req.params.arguments)
  );

  // Stateful Streamable-HTTP transport (see SESSION MODEL note above).
  // enableJsonResponse: true keeps the simple request/response framing (no SSE
  // stream needed for one local consumer).
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  /** @type {import('http').Server | null} */
  let httpServer = null;
  let connected = false;
  let started = false;

  /**
   * The Node http request handler. The SC7 origin guard runs FIRST on every
   * request (DD3) — a denied request gets a 403 and never reaches the SDK.
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
    // Hand the raw Node (req, res) straight to the transport (premise verified).
    transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  /**
   * Start the server: connect the MCP Server to the transport once, then bind
   * the http server to 127.0.0.1. Idempotent — a second call is a no-op.
   * Rejects (without crashing the app) on a bind error (e.g. EADDRINUSE) so the
   * caller can surface the GOLDFINCH_MCP_PORT override hint.
   * @returns {Promise<void>}
   */
  async function start() {
    if (started) return;
    started = true;

    if (!connected) {
      await mcp.connect(transport);
      connected = true;
    }

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
   * Stop the server: close the http listener (releasing the port) and the
   * transport. Idempotent — safe to call from both `before-quit` and
   * `window-all-closed`, and safe when never started.
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!started) return;
    started = false;

    const srv = httpServer;
    httpServer = null;
    if (srv) {
      await new Promise((resolve) => srv.close(() => resolve(undefined)));
    }
    try {
      await transport.close();
    } catch {
      // already closed — ignore
    }
    connected = false;
  }

  return { start, stop, port };
}

module.exports = { createMcpServer, resolvePort, DEFAULT_PORT };
