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
const net = require('net');
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
const { validateKey } = require('./automation-auth');
const { scopeEngine } = require('./scope');
const { createAuditLog } = require('./audit-log');

// Parse the discriminated error code from an `automation: <code> — …` message.
// The hyphenated codes (`out-of-jar`, `admin-only`, `internal-session`, …) all
// carry the ` — ` separator; a bare message like `automation: engine unavailable`
// does NOT, and correctly falls back (caller uses 'error') rather than capturing
// a truncated word. Anchored at start; the separator after the code is required.
const ERROR_CODE_RE = /^automation:\s*([a-z-]+)\s+—/;

/**
 * Derive a short, human-readable context string for an audit log entry — the
 * "where/what" complement to the op name and targetWcId already recorded.
 *
 * Privacy rule: `typeText` MUST NOT log the content; it records only the
 * character count so an operator can audit that typing happened without ever
 * exposing a typed secret (password, token, etc.) to the log.
 *
 * Null-safe: `args` may be undefined (e.g. when a tool is called with no
 * arguments). All other ops whose wcId already names the tab return `null`.
 *
 * @param {string} op  MCP tool name
 * @param {Record<string, any> | undefined} args  tool call arguments
 * @returns {string | null}
 */
function deriveAuditDetail(op, args) {
  if (!args) return null;
  switch (op) {
    case 'navigate':
      return args.url != null ? 'url=' + String(args.url) : null;
    case 'openTab': {
      let detail = args.url != null ? 'url=' + String(args.url) : null;
      if (detail && args.jarId != null) detail += ' jar=' + String(args.jarId);
      return detail;
    }
    case 'click': {
      const x = args.x;
      const y = args.y;
      if (x == null || y == null) return null;
      let detail = '(' + x + ',' + y + ')';
      if (args.button != null && args.button !== 'left') detail += ' button=' + String(args.button);
      if (args.clickCount != null && args.clickCount !== 1) detail += ' clicks=' + String(args.clickCount);
      return detail;
    }
    case 'scroll': {
      const x = args.x;
      const y = args.y;
      const dx = args.dx;
      const dy = args.dy;
      if (x == null || y == null || dx == null || dy == null) return null;
      return '(' + x + ',' + y + ') d=(' + dx + ',' + dy + ')';
    }
    case 'pressKey': {
      const keyName = args.name ?? args.key;
      if (keyName == null) return null;
      // Record the chord so the audit log distinguishes a bare key (key=M) from a
      // modifier chord (key=M+control). Bare-key calls keep their existing string.
      const mods = Array.isArray(args.modifiers) ? args.modifiers : [];
      const suffix = mods.length ? '+' + mods.map(String).join('+') : '';
      return 'key=' + String(keyName) + suffix;
    }
    case 'typeText': {
      // REDACTED: length only — never the content.
      const len = String(args.text ?? '').length;
      return 'text(' + len + ' chars)';
    }
    default:
      return null;
  }
}

// Configurable MCP listen port. Default moved off the squatted 7777 into the IANA
// dynamic range (DD1). The persisted `automationPort` setting and GOLDFINCH_MCP_PORT
// env override resolve over this in resolvePort().
const DEFAULT_PORT = 49707;
const SERVER_NAME = 'goldfinch';

// DD9: cap request-body accumulation at 1 MiB. Over-cap → 413, do not buffer
// past the cap (the Flight-3 initialize body was buffered unbounded). The cap is
// EXCLUSIVE: a body strictly over 1 MiB is rejected; exactly 1 MiB is allowed.
const MAX_BODY_BYTES = 1024 * 1024;

// Discriminated sentinel readJsonBody resolves when the body exceeds the cap, so
// the caller distinguishes over-cap (413, already written) from the existing
// empty/parse-failure case (undefined → 400).
const BODY_TOO_LARGE = Symbol('body-too-large');

/**
 * Resolve the listen port with precedence: valid GOLDFINCH_MCP_PORT env
 * (any positive integer — the dev/operator escape hatch, may deliberately be
 * < 1024) > valid persisted `automationPort` (range-bound [1024, 65535] to
 * match its validator) > default 49707 (DD1). A missing/invalid env value falls
 * through to the setting, and a missing/invalid/unavailable setting falls
 * through to the default — never throws.
 * @param {() => { get: (k: string) => any }} [getSettings] lazy settings accessor.
 * @returns {number}
 */
function resolvePort(getSettings) {
  const envRaw = process.env.GOLDFINCH_MCP_PORT;
  const envN = envRaw == null ? NaN : Number(envRaw);
  if (Number.isInteger(envN) && envN > 0) return envN;
  try {
    const s = (typeof getSettings === 'function' ? getSettings() : require('../settings-store'));
    const p = s && typeof s.get === 'function' ? s.get('automationPort') : undefined;
    if (Number.isInteger(p) && p >= 1024 && p <= 65535) return p; // setting is range-bound (matches its validator)
  } catch { /* settings unavailable — fall through */ }
  return DEFAULT_PORT;
}

/**
 * Find the first loopback-free port at or above `lo`, probing sequentially up to
 * `hi`. Returns the port number, or `null` if none in range is free. The result
 * is ADVISORY: there is a documented TOCTOU window between probing and an
 * eventual bind, so the caller must still handle EADDRINUSE.
 * @param {number} [lo] inclusive low bound (default 49152, IANA dynamic range).
 * @param {number} [hi] inclusive high bound (default 65535).
 * @returns {Promise<number | null>}
 */
async function freePortInRange(lo = 49152, hi = 65535) {
  for (let p = lo; p <= hi; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (free) return p;
  }
  return null;
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
 * @param {(engineOpts?: { allowInternal?: boolean }) => any} [opts.getEngine]
 *   lazy accessor for the automation engine (createEngine(...) result). Now takes
 *   an options bag: the per-session Server passes `{ allowInternal: identity === 'admin' }`
 *   so the admin engine relaxes the internal-session exclusion (DD6 / Leg 2).
 * @param {{
 *   jars: { list: () => Array<{ id: string, partition: string }> },
 *   fromId: (id: number) => any,
 *   fromPartition: (partition: string) => any,
 *   getChromeContents: () => any,
 * }} [opts.scopeCtx]  the jar-scoping context (Leg 2). Injected from main.js
 *   (which has electron + jars + mainWindow), keeping scope.js electron-free and
 *   the façade unit-testable. fromId / fromPartition MUST be the SAME handles the
 *   engine uses so a membership check cannot pass while the engine resolves a
 *   different contents.
 * @param {() => { get: (k: string) => any, getAll?: () => any }} [opts.getSettings]
 *   lazy accessor for the settings store (the singleton exposing get/getAll).
 *   Read PER REQUEST by the auth gate so toggles are live, and stubbable in the
 *   headless test. Defaults to `() => require('../settings-store')` — a bare
 *   per-request require is also live but NOT stubbable, so the injectable dep is
 *   required, not optional.
 * @param {(payload: { sessions: any[], log: any[] }) => void} [opts.broadcast]
 *   audit fan-out callback (Leg 3 / DD8). Called with the audit snapshot after
 *   every recorded tool call and every session open/close. main.js injects
 *   `(payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)`.
 *   Defaults to a no-op so headless tests need no Electron.
 * @param {string} [opts.version]  server version advertised in the handshake;
 *   defaults to the app version from package.json.
 * @param {number} [opts.port]  listen port override (takes precedence over
 *   GOLDFINCH_MCP_PORT / the default); used by tests to pick a free high port.
 * @returns {{ start: () => Promise<void>, stop: () => Promise<void>, port: number, getActivity: () => { sessions: any[], log: any[] } }}
 */
function createMcpServer(opts = {}) {
  // Lazy engine accessor. If absent, fall back to an accessor returning a value
  // that throws on any op deref so tools/call degrades to an isError result
  // (never a null-deref). buildToolRegistry catches the throw inside callTool.
  // Now takes an options bag ({ allowInternal }) forwarded to createEngine so the
  // per-session admin Server builds an allowInternal engine (DD6 / Leg 2).
  const getEngine = typeof opts.getEngine === 'function'
    ? opts.getEngine
    : () => { throw new Error('automation: engine unavailable'); };

  // Jar-scoping context (Leg 2). Injected from main.js; absent in some tests that
  // only exercise the gate. scopeEngine needs it only for jar identities (admin
  // returns the engine unchanged), so a jar request with no ctx fails cleanly.
  const scopeCtx = opts.scopeCtx;

  // Live settings accessor, read PER REQUEST by the auth gate. Default to the
  // settings-store singleton; tests inject a stub to toggle enabled/hashes.
  const getSettings = typeof opts.getSettings === 'function'
    ? opts.getSettings
    : () => require('../settings-store');

  let version = opts.version;
  if (!version) {
    try {
      version = require('../../../package.json').version;
    } catch {
      version = '0.0.0';
    }
  }

  const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : resolvePort(getSettings);

  // Audit fan-out (Leg 3 / DD8). Default no-op so headless tests need no Electron.
  const broadcast = typeof opts.broadcast === 'function' ? opts.broadcast : () => {};

  // ONE audit log per server (shared across all per-session Servers). Its onChange
  // fires the injected broadcast with the fresh snapshot on every mutation — one
  // local consumer this flight, so a per-mutation broadcast is acceptable (Flight 5
  // may debounce). In-memory ring only, no disk persistence (DD8).
  const auditLog = createAuditLog({ onChange: (snap) => broadcast(snap) });

  // Live sessions, keyed by the transport's generated session id. Each entry
  // owns a Server + its StreamableHTTPServerTransport + the IDENTITY bound at
  // session creation (DD4 / Leg 2). Created on `initialize`, routed to thereafter
  // by the `Mcp-Session-Id` header, evicted on transport `onclose`.
  /** @type {Map<string, { server: import('@modelcontextprotocol/sdk/server/index.js').Server, transport: StreamableHTTPServerTransport, identity: string }>} */
  const sessions = new Map();

  /**
   * Build a fresh MCP Server with the 17 tools wired over a per-session,
   * IDENTITY-SCOPED engine accessor (DD4/DD6/DD7 / Leg 2). One per session:
   *   - the engine is built with `{ allowInternal: identity === 'admin' }`, then
   *   - wrapped by scopeEngine(engine, identity, ctx) — admin → unchanged; jar →
   *     a jar-confined façade.
   * getEngine + scopeEngine are called FRESH per callTool inside the registry so a
   * recreated/closed window AND a runtime jars-add are always picked up.
   *
   * Audit recording (Leg 3 / DD8) is wrapped AROUND registry.callTool HERE — the
   * single choke point — so mcp-tools.js stays audit-free. The sessionId is read
   * LAZILY from `sessionRef.id` at call time (the transport is constructed before
   * buildServer, and `onsessioninitialized` fills the id afterward): we close over
   * the ref OBJECT and read `.id` inside the wrapped fn, never capture null at wrap.
   * @param {string} identity  'admin' or a jarId — bound to this session
   * @param {{ id: string|null }} sessionRef  per-session id holder, filled on init
   * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server}
   */
  function buildServer(identity, sessionRef) {
    const server = new Server(
      { name: SERVER_NAME, version },
      { capabilities: { tools: {} } }
    );
    const registry = buildToolRegistry(
      () => scopeEngine(getEngine({ allowInternal: identity === 'admin' }), identity, scopeCtx)
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      const args = /** @type {Record<string, any> | undefined} */ (req.params.arguments);
      const result = await registry.callTool(name, args);
      // Record after the call, reading result.isError for the outcome. On error,
      // parse the discriminated code from the first text-content block; an
      // unexpected (non-`automation:`) throw falls back to 'error'.
      const isError = result.isError === true;
      let errorCode = null;
      if (isError) {
        const text = result.content?.find((c) => c && typeof c.text === 'string')?.text;
        const m = typeof text === 'string' ? text.match(ERROR_CODE_RE) : null;
        errorCode = m ? m[1] : 'error';
      }
      auditLog.record({
        identity,
        sessionId: sessionRef.id,
        op: name,
        targetWcId: args?.wcId ?? null,
        outcome: isError ? 'error' : 'ok',
        errorCode,
        detail: deriveAuditDetail(name, args),
      });
      return result;
    });
    return server;
  }

  /** @type {import('http').Server | null} */
  let httpServer = null;
  let started = false;

  /**
   * Read and JSON-parse a request body, capping accumulation at MAX_BODY_BYTES
   * (DD9). Resolves:
   *   - the parsed JSON value on success,
   *   - `undefined` on an empty body or a parse failure (the caller treats a
   *     non-initialize / unparseable body without a valid session as a 400),
   *   - the BODY_TOO_LARGE sentinel when the cap is exceeded — distinct from the
   *     undefined case so the caller does NOT collapse it into the 400 path.
   * On over-cap, `req.destroy()` stops buffering immediately (we do not read to
   * end); the caller writes the 413.
   * @param {import('http').IncomingMessage} req
   * @returns {Promise<any>}
   */
  function readJsonBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let total = 0;
      let settled = false;
      const settle = (/** @type {any} */ value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          // Stop buffering past the cap: drop the chunk, pause the stream, and
          // signal over-cap distinctly. (The cap is exclusive — exactly 1 MiB is
          // allowed; strictly over rejects.) We do NOT destroy the request here —
          // that would tear down the socket before the 413 can be written. The
          // caller writes the 413 and then destroys to stop the inbound flood.
          req.pause();
          chunks.length = 0; // release the buffered chunks
          settle(BODY_TOO_LARGE);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) { settle(undefined); return; }
        try {
          settle(JSON.parse(raw));
        } catch {
          settle(undefined);
        }
      });
      req.on('error', () => settle(undefined));
      req.on('close', () => settle(undefined));
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
   * Parse an `Authorization: Bearer <token>` header. Case-insensitive scheme,
   * tolerant of extra whitespace. Returns the token, or '' if the header is
   * missing, malformed, or carries an empty token (`Bearer ` with no token).
   * @param {import('http').IncomingMessage} req
   * @returns {string}
   */
  function parseBearer(req) {
    const raw = req.headers['authorization'];
    // Node lowercases header keys; a duplicated header arrives as an array.
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string') return '';
    const parts = header.trim().split(/\s+/);
    if (parts.length < 2) return '';
    if (parts[0].toLowerCase() !== 'bearer') return '';
    return parts[1] || '';
  }

  /**
   * The auth gate, LEG 2 form: read settings LIVE via the injected reader and
   * resolve the presented Bearer key to its IDENTITY (DD4). Returns the jarId,
   * the literal 'admin', or null (surface disabled / no key / bad key / settings
   * read failed). Read PER REQUEST so a toggle-off or a revoked key flips a live
   * session — the same reader the gate has always used. Never throws.
   * @param {import('http').IncomingMessage} req
   * @returns {string | null}  jarId | 'admin' | null
   */
  function resolveIdentity(req) {
    try {
      const settings = getSettings();
      if (settings.get('automationEnabled') !== true) return null;

      const token = parseBearer(req);
      if (!token) return null;

      const adminEnabled = !!process.env.GOLDFINCH_AUTOMATION_ADMIN;
      return validateKey(token, {
        keyHashes: settings.get('automationKeyHashes'),
        adminKeyHash: settings.get('automationAdminKeyHash'),
        adminEnabled,
      });
    } catch {
      return null;
    }
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

    // Auth gate (DD2/DD3/DD4/DD5/DD6) — the SECOND pre-routing gate, after the
    // origin guard (which keeps its 403) and before any session routing. Resolve
    // the identity ONCE here (one live settings read) and pass it into
    // routeRequest, which BINDS it on a new session and re-checks it on an
    // existing one. A null identity (surface disabled / no key / bad key) is a
    // bare 401 — mirroring the origin guard's bare 403, keeping this pre-routing
    // security decision out of the JSON-RPC envelope. This is also what kills a
    // live session on a toggle-off / total-revoke: the very next request resolves
    // null here.
    const identity = resolveIdentity(req);
    if (identity === null) {
      res.writeHead(401);
      res.end();
      return;
    }

    routeRequest(req, res, identity).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  /**
   * Route a guard-passed request to a session transport, creating a session on
   * an initialize POST. The live-resolved identity (non-null, from the gate) is
   * BOUND on a new session and RE-CHECKED against an existing session's bound
   * identity before delegating (DD4 / Leg 2).
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} identity  the live-resolved identity (jarId | 'admin')
   * @returns {Promise<void>}
   */
  async function routeRequest(req, res, identity) {
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
        // DD4 identity-match (Leg 2): the gate's per-request live re-validation
        // already 401s a toggle-off / total-revoke (resolveIdentity → null, caught
        // in onRequest). This check covers the case the gate does NOT: a known
        // session id reused under a DIFFERENT still-valid key, or THIS jar's key
        // revoked while OTHER valid keys remain (identity now resolves to a
        // different jar/admin). On mismatch → bare 401, consistent with the gate.
        if (identity !== entry.identity) {
          res.writeHead(401);
          res.end();
          return;
        }
        // Client-disconnect detection: the standalone GET is the session's
        // long-lived SSE stream. When it closes (client gone, no DELETE), tear the
        // session down so the audit/indicator don't show a stale "connected" entry.
        // ONLY the GET stream — a POST (every tool call) and DELETE complete
        // normally and also fire 'close'; tearing down on those would kill the
        // session on every tool call / break the normal terminate path.
        // Tradeoff (acceptable for Goldfinch's clients): a dropped SSE stream tears
        // down immediately rather than awaiting a resumable reconnect.
        if (req.method === 'GET') {
          res.on('close', () => {
            if (sessions.has(sessionId)) {
              // transport.close() fires onclose → sessions.delete + noteSessionClose
              // (idempotent), so a concurrent/prior teardown is a clean no-op.
              try { entry.transport.close(); } catch { /* already closing */ }
            }
          });
        }
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
    // Over-cap (DD9): distinct from the empty/parse-failure → 400 case. The body
    // was abandoned mid-stream (the stream was paused at the cap); reply 413, then
    // destroy the request to stop the inbound flood now the response is flushed.
    if (body === BODY_TOO_LARGE) {
      if (!res.headersSent) {
        res.writeHead(413);
        res.end();
      }
      req.destroy();
      return;
    }
    if (!isInitializeRequest(body)) {
      sendJsonRpcError(res, 400, 'No valid session: initialize required to open one');
      return;
    }

    // Fresh PER-SESSION id holder (Leg 3 / DD8). Allocated ABOVE the transport so
    // onsessioninitialized can fill it AND it can be threaded into buildServer for
    // the callTool wrapper to read lazily. There is no Server/registry reuse across
    // sessions (a fresh pair per initialize), so a per-session ref is correct — a
    // shared/module-level ref would be a cross-session bug.
    const sessionRef = { id: /** @type {string|null} */ (null) };

    // Create a NEW session: fresh transport + Server scoped to this identity,
    // registered on init with the identity BOUND into the entry (DD4 / Leg 2).
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        sessionRef.id = sid;
        sessions.set(sid, { server, transport, identity });
        // Mark the session active (Leg 3 / DD8) — fires the broadcast.
        auditLog.noteSessionOpen(sid, identity);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        // Close-tracking is wired into onclose ONLY (stop() cascades through here),
        // and noteSessionClose is idempotent so a double-close is a clean no-op.
        auditLog.noteSessionClose(transport.sessionId);
      }
    };
    const server = buildServer(identity, sessionRef);
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

  /**
   * Read the current audit snapshot (Leg 3 / DD8) — active sessions + the recent
   * tool-call ring — WITHOUT waiting for a broadcast. Flight 5 / tests / a future
   * IPC query use this to read current state on demand.
   * @returns {{ sessions: any[], log: any[] }}
   */
  function getActivity() {
    return auditLog.snapshot();
  }

  return { start, stop, port, getActivity };
}

// ---------------------------------------------------------------------------
// Dev enable+mint path (DD3/DD5/DD6) — gated on isMcpAutomationEnabled in main.js.
//
// These turn the surface ON and mint a key for a headless / behavior-test harness.
// The plaintext key is generated with a CSPRNG, its HASH is stored, and the
// plaintext is RETURNED ONCE (never persisted). The caller (main.js) wires these
// behind the isMcpAutomationEnabled(process.argv) gate via a dev-only IPC handler,
// so they are unreachable in production.
// ---------------------------------------------------------------------------

const { generateKey, hashKey } = require('./automation-auth');

/**
 * Enable the automation surface and mint a per-jar key. Flips
 * `automationEnabled` true, stores the new key's hash under `jarId` in
 * `automationKeyHashes`, and returns the plaintext key ONCE.
 *
 * Mint guard (Leg 2): when a `jars` accessor is supplied, the jarId MUST be
 * present in `jars.list()` — otherwise a key could bind an identity that resolves
 * to no jar (the scope façade would then refuse every op). Burner ids (renderer-
 * only, never in list()) are therefore never valid mint targets. A jarId that
 * exists at mint time but is deleted later still degrades safely (façade →
 * all-ops-error). The accessor is OPTIONAL so the pure unit tests need no jars
 * module; main.js always passes it.
 *
 * @param {string} jarId  the jar this key authenticates as
 * @param {{ get: (k: string) => any, set: (k: string, v: any) => any }} settings
 *   the settings-store singleton
 * @param {{ list: () => Array<{ id: string }> }} [jars]  optional jar-registry
 *   accessor; when present, jarId is validated against jars.list()
 * @returns {string}  the plaintext key (caller surfaces it once; never persisted)
 */
function enableAndMintJarKey(jarId, settings, jars) {
  if (typeof jarId !== 'string' || jarId === '') {
    throw new TypeError('enableAndMintJarKey: jarId must be a non-empty string');
  }
  if (jars && typeof jars.list === 'function') {
    const known = jars.list().some((j) => j.id === jarId);
    if (!known) {
      throw new Error(
        'enableAndMintJarKey: jarId ' + jarId + ' is not a known jar (burner ids and unknown ids are not valid mint targets)'
      );
    }
  }
  const key = generateKey();
  const hashes = { ...(settings.get('automationKeyHashes') || {}) };
  hashes[jarId] = hashKey(key);
  settings.set('automationKeyHashes', hashes);
  settings.set('automationEnabled', true);
  return key;
}

/**
 * Mint the admin key into `automationAdminKeyHash` and return the plaintext ONCE.
 * Only mints when the GOLDFINCH_AUTOMATION_ADMIN presence gate is set (the admin
 * tier is inert without it); returns null otherwise. Does NOT flip
 * `automationEnabled` (admin is orthogonal to the enable toggle — but a caller
 * minting both will have enabled it via enableAndMintJarKey).
 *
 * @param {{ get: (k: string) => any, set: (k: string, v: any) => any }} settings
 * @returns {string | null}  the plaintext admin key, or null if the gate is unset
 */
function mintAdminKey(settings) {
  if (!process.env.GOLDFINCH_AUTOMATION_ADMIN) return null;
  const key = generateKey();
  settings.set('automationAdminKeyHash', hashKey(key));
  return key;
}

/**
 * Revoke a per-jar automation key by deleting its hash entry. Copy-then-set
 * (mirrors enableAndMintJarKey) so other jars' hashes stay intact. No-op if the
 * jarId has no hash; never throws on a missing id.
 *
 * Does NOT touch the live `sessions` Map (DD5): Flight-4 per-request
 * re-validation (resolveIdentity reads live hashes every request) returns null
 * once the hash is gone, so the next MCP request 401s — "effective immediately"
 * comes for free without tearing down the live transport.
 *
 * @param {string} jarId  the jar whose key to revoke
 * @param {{ get: (k: string) => any, set: (k: string, v: any) => any }} settings
 */
function revokeJarKey(jarId, settings) {
  const hashes = { ...(settings.get('automationKeyHashes') || {}) };
  if (Object.prototype.hasOwnProperty.call(hashes, jarId)) {
    delete hashes[jarId];
    settings.set('automationKeyHashes', hashes);
  }
  // Live sessions are NOT touched (DD5): per-request re-validation 401s the next call.
}

/**
 * Revoke the admin key by clearing `automationAdminKeyHash` to ''. Like
 * revokeJarKey, leaves the live sessions Map alone; per-request re-validation
 * 401s the next admin-scoped request.
 *
 * @param {{ get: (k: string) => any, set: (k: string, v: any) => any }} settings
 */
function revokeAdminKey(settings) {
  settings.set('automationAdminKeyHash', '');
}

module.exports = {
  createMcpServer,
  resolvePort,
  freePortInRange,
  DEFAULT_PORT,
  enableAndMintJarKey,
  mintAdminKey,
  revokeJarKey,
  revokeAdminKey,
  deriveAuditDetail,
};
