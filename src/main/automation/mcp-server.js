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
const { createVaultContext } = require('../vault/vault-context');

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
 * The optional third `result` param (the MCP tool result, present at the live
 * call site) lets result-dependent ops enrich the detail: `vaultFill` appends the
 * resolved fill origin, `vaultUnlock` records the unlocked-vault count. It defaults
 * to `undefined`, so every existing 2-arg caller keeps its exact prior behavior.
 * The secret invariant holds: no accessKey / admin private key / password / TOTP
 * secret / recovery code is ever read from args OR the result.
 *
 * @param {string} op  MCP tool name
 * @param {Record<string, any> | undefined} args  tool call arguments
 * @param {{ content?: { text?: string }[] } | undefined} [result]  the tool result
 * @returns {string | null}
 */
function deriveAuditDetail(op, args, result) {
  if (!args) return null;
  // Parse the single text-content block of a tool result back into its value.
  // okResult() JSON-serializes the whole op return into content[0].text, so this
  // recovers e.g. { filled, id, origin } / { unlocked }. An error result's text is
  // a non-JSON error string, and an absent/2-arg result is undefined — BOTH (and
  // any other malformed shape) degrade to null. NEVER throws.
  const parseResultJson = (/** @type {any} */ r) => {
    try {
      return JSON.parse(r?.content?.[0]?.text);
    } catch {
      return null;
    }
  };
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
    case 'dragPointer': {
      const from = args.from;
      const to = args.to;
      if (!from || to == null || from.x == null || from.y == null || to.x == null || to.y == null) return null;
      return '(' + from.x + ',' + from.y + ')->(' + to.x + ',' + to.y + ')';
    }
    // Vault ops (M12 F1 Leg 3; result-enriched M12 F4 Leg 5). The `accessKey` (a
    // per-jar vault access secret OR the X25519 admin private key) must NEVER be
    // logged — it is read from NEITHER args nor the result. vaultFill/vaultTotp
    // record the ITEM ID only (safe, not a secret). The resolved fill origin and
    // the unlock count come from the RESULT (DD6) — both non-secret — via
    // parseResultJson, which degrades to null on any malformed/absent result.
    case 'vaultUnlock': {
      // The RESULT carries `{ unlocked: string[] }` (opened vault ids). Record the
      // COUNT only — never the ids-as-secrets, never the accessKey. No result /
      // 2-arg call / unparseable → null (unchanged from the args-only behavior).
      const parsed = parseResultJson(result);
      if (parsed === null) return null;
      const n = Array.isArray(parsed.unlocked) ? parsed.unlocked.length : 0;
      return 'unlocked=' + n;
    }
    case 'vaultList':
      return null;
    case 'vaultTotp':
      return args.itemId != null ? 'item=' + String(args.itemId) : null;
    case 'vaultFill': {
      // Base detail is the item id from args (as before). On a SUCCESSFUL fill the
      // result carries the resolved (non-secret) `origin` — append it. A no-fill /
      // absent / unparseable result keeps `item=<id>` unchanged. NEVER a credential.
      if (args.itemId == null) return null;
      let detail = 'item=' + String(args.itemId);
      const parsed = parseResultJson(result);
      if (parsed && parsed.filled === true && parsed.origin) {
        detail += ' origin=' + String(parsed.origin);
      }
      return detail;
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

// Advertised in the initialize result's `instructions` field, which MCP clients
// surface to the consuming LLM as server-level context. The tool descriptions
// alone never say what Goldfinch IS — a model that has not heard the name has no
// way to know these tools drive a real browser, so say it here, once.
const SERVER_INSTRUCTIONS =
  'Goldfinch is an Electron desktop web browser (Chromium-based). These tools drive and ' +
  'observe real browser tabs in the running app: open and navigate pages, click/type/scroll, ' +
  'capture screenshots, read the live DOM and accessibility tree, and evaluate JavaScript in ' +
  'the page. Use it for web browsing, web-page testing, and UI verification against real ' +
  'rendered pages. Tabs are addressed by wcId (from enumerateTabs/openTab) and live in ' +
  'isolated cookie-jar containers; a jar-scoped key sees only its own jar\'s tabs, while an ' +
  'admin key can also target the browser chrome itself (getChromeTarget).';

// DD9: cap request-body accumulation at 1 MiB. Over-cap → 413, do not buffer
// past the cap (the Flight-3 initialize body was buffered unbounded). The cap is
// EXCLUSIVE: a body strictly over 1 MiB is rejected; exactly 1 MiB is allowed.
const MAX_BODY_BYTES = 1024 * 1024;

// A local automation consumer normally holds one session (occasionally a few
// during reconnects). 64 leaves generous headroom for tooling while bounding
// the permanent Server+transport pairs an initialize-only client can retain.
const MAX_SESSIONS = 64;

// Discriminated sentinel readJsonBody resolves when the body exceeds the cap, so
// the caller distinguishes over-cap (caller writes 413) from the existing
// empty/parse-failure case (undefined → 400).
const BODY_TOO_LARGE = Symbol('body-too-large');

/**
 * Resolve the listen port with precedence: valid GOLDFINCH_MCP_PORT env
 * (any positive integer — the dev/operator escape hatch, may deliberately be
 * < 1024) > valid persisted `automationPort` (range-bound [1024, 65535] to
 * match its validator) > default 49707 (DD1). A missing/invalid env value falls
 * through to the setting, and a missing/invalid/unavailable setting falls
 * through to the default — never throws.
 *
 * WARNING: `honorEnv` defaults to `true`, which HONORS the GOLDFINCH_MCP_PORT env var.
 * Packaged/main-process callers MUST pass `honorEnv: !app.isPackaged` — forgetting it
 * leaks the env override into a production build (a process-environment port override
 * reachable in the installed binary, DD6). The env is a DEV-ONLY escape hatch; never
 * let it reach production. All current callers are explicit — keep them so.
 *
 * @param {() => { get: (k: string) => any }} [getSettings] lazy settings accessor.
 * @param {{ honorEnv?: boolean }} [opts] when `honorEnv` is false (packaged build,
 *   DD6), GOLDFINCH_MCP_PORT is NOT read — the port comes from the setting/default
 *   only. Stays pure/electron-free: the call site supplies the decision
 *   (`honorEnv: !app.isPackaged`), never `app.isPackaged` inside this function.
 *   Defaults to `true` so every existing caller/test is unchanged.
 * @returns {number}
 */
function resolvePort(getSettings, { honorEnv = true } = {}) {
  if (honorEnv) {
    const envRaw = process.env.GOLDFINCH_MCP_PORT;
    const envN = envRaw == null ? NaN : Number(envRaw);
    if (Number.isInteger(envN) && envN > 0) return envN;
  }
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
 *   isChromeContents?: (wc: any) => boolean,
 * }} [opts.scopeCtx]  the jar-scoping context (Leg 2). Injected from main.js
 *   (which has electron + jars + the window registry), keeping scope.js
 *   electron-free and the façade unit-testable. fromId / fromPartition MUST be
 *   the SAME handles the engine uses so a membership check cannot pass while the
 *   engine resolves a different contents. isChromeContents (M09 F6) widens the
 *   jar-tier chrome exclusion to every registered window's chrome.
 * @param {() => { get: (k: string) => any, getAll?: () => any }} [opts.getSettings]
 *   lazy accessor for the settings store (the singleton exposing get/getAll).
 *   Read PER REQUEST by the auth gate so toggles are live, and stubbable in the
 *   headless test. Defaults to `() => require('../settings-store')` — a bare
 *   per-request require is also live but NOT stubbable, so the injectable dep is
 *   required, not optional.
 * @param {boolean | (() => boolean)} [opts.devEnableOverride]
 *   in-memory dev-enable override (DD3/DD4). When active, the auth gate resolves
 *   identity even though the persisted `automationEnabled` is off — a valid Bearer
 *   key is STILL required (the override does NOT waive the key). main.js passes
 *   `() => devEnableOverride` (`!app.isPackaged && isMcpAutomationEnabled(argv)`),
 *   so this is never active in a packaged build. Accepts a boolean or a lazy
 *   reader; normalized to a `() => boolean`. Defaults to `() => false`.
 * @param {(payload: { sessions: any[], log: any[] }) => void} [opts.broadcast]
 *   audit fan-out callback (Leg 3 / DD8). Called with the audit snapshot after
 *   every recorded tool call and every session open/close. main.js injects
 *   `(payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)`.
 *   Defaults to a no-op so headless tests need no Electron.
 * @param {{
 *   unlockVaultWithAccessKey: (vaultId: string, secret: string) => Buffer,
 *   openVaultWithAccessKey: (vaultId: string, secret: string) => { key: Buffer, keyId: string },
 *   openAllWithAdminKey: (privB64: string) => Map<string, Buffer>,
 *   readVaultItems: (vaultId: string, key: Buffer) => any[],
 *   accessEnvelopeExists: (vaultId: string, keyId: string) => boolean,
 *   adminPublicKey: () => string,
 * }} [opts.vaultStore]  the STATELESS vault-store methods (M12 F1 Leg 3) the
 *   per-session vault context dispatches to — never the human-lock singleton.
 *   Absent (engine-only tests) → vault ops degrade to "nothing unlocks".
 * @param {(arg: { wcId: number, credential: any }) => any} [opts.fillDelegate]
 *   the vaultFill effect (M12 F1 Leg 3). Leg 4 injects the real main→preload
 *   fill; Leg 3 tests inject a fake; the running app injects a stub that throws
 *   until Leg 4. Defaults to a throwing stub. The credential never crosses back.
 * @param {() => number} [opts.getAutoLockMinutes]  idle auto-lock minutes reader
 *   for the per-session vault idle backstop (DD5). Defaults to `() => 10`.
 * @param {string} [opts.version]  server version advertised in the handshake;
 *   defaults to the app version from package.json.
 * @param {number} [opts.port]  listen port override (takes precedence over
 *   GOLDFINCH_MCP_PORT / the default); used by tests to pick a free high port.
 *   An explicit `opts.port` forces STRICT bind-exactly-or-reject semantics.
 * @param {boolean} [opts.honorEnv]  when false (packaged build, DD6), the
 *   GOLDFINCH_MCP_PORT env is ignored everywhere (port resolution + strict
 *   detection). main.js passes `!app.isPackaged`. Defaults to true.
 * @returns {{ start: () => Promise<void>, stop: () => Promise<void>, port: number, getActivity: () => { sessions: any[], log: any[] } }}
 *   NOTE: `port` is a live getter returning the actually-bound port (updated by
 *   start() including a fallback retry). Callers MUST read `mcpServer.port` live
 *   each time — do NOT destructure it (that snapshots the pre-start value).
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

  // In-memory dev-enable override (DD3/DD4). Normalize boolean | (() => boolean)
  // | falsy → a () => boolean reader. Read PER REQUEST by the auth gate so the
  // override is live. The override satisfies the auth gate's enable check WITHOUT
  // writing `automationEnabled`, keeping the human-only persisted invariant — but
  // it does NOT waive the Bearer-key requirement.
  const devEnableOverride = typeof opts.devEnableOverride === 'function'
    ? opts.devEnableOverride
    : (opts.devEnableOverride ? () => true : () => false);

  let version = opts.version;
  if (!version) {
    try {
      version = require('../../../package.json').version;
    } catch {
      version = '0.0.0';
    }
  }

  // Port resolution + strict-vs-fallback detection (DD6). Read the env ONCE here
  // (a single source of truth for strictness); resolvePort also reads it
  // internally but synchronously at construction, so the values agree.
  // - explicit opts.port  → STRICT (bind exactly or reject; tests rely on this).
  // - dev GOLDFINCH_MCP_PORT pin (env honored + valid + no explicit) → STRICT.
  // - setting/default      → FALLBACK (retry the real listen on the next free port).
  const honorEnv = opts.honorEnv !== false;
  const explicit = Number.isInteger(opts.port) && opts.port > 0;
  const envRaw = honorEnv ? process.env.GOLDFINCH_MCP_PORT : undefined;
  const envN = Number(envRaw);
  const envUsed = !explicit && Number.isInteger(envN) && envN > 0; // !explicit short-circuit: explicit forces strict on its own
  const preferred = explicit ? opts.port : resolvePort(getSettings, { honorEnv });
  const strict = explicit || envUsed;

  // The actually-bound port. Starts at the preferred port; start() updates it on a
  // successful bind (including a fallback retry to a different free port). Exposed
  // via a `get port()` getter on the returned object so consumers always read the
  // bound value live.
  let boundPort = preferred;

  // Audit fan-out (Leg 3 / DD8). Default no-op so headless tests need no Electron.
  const broadcast = typeof opts.broadcast === 'function' ? opts.broadcast : () => {};

  // Vault surface deps (Mission 12, Flight 1, Leg 3). The vault store (stateless
  // methods only) + the fill delegate are injected per the leg DECISION; a
  // per-session vault context (createVaultContext) is minted PER session in
  // routeRequest. The fill delegate is Leg-4 real / here a caller-injected fake;
  // the running app injects a stub that throws until Leg 4 wires the real
  // main→preload fill effect. getAutoLockMinutes drives the DD5 idle backstop.
  const vaultStore = opts.vaultStore;
  const fillDelegate = typeof opts.fillDelegate === 'function'
    ? opts.fillDelegate
    : () => { throw new Error('automation: vault-fill-not-wired — the main→preload fill delegate lands in Leg 4'); };
  const getVaultAutoLockMinutes = typeof opts.getAutoLockMinutes === 'function'
    ? opts.getAutoLockMinutes
    : () => 10;

  // ONE audit log per server (shared across all per-session Servers). Its onChange
  // fires the injected broadcast with the fresh snapshot on every mutation — one
  // local consumer this flight, so a per-mutation broadcast is acceptable (Flight 5
  // may debounce). In-memory ring only, no disk persistence (DD8).
  const auditLog = createAuditLog({ onChange: (snap) => broadcast(snap) });

  // Live sessions, keyed by the transport's generated session id. Each entry
  // owns a Server + its StreamableHTTPServerTransport + the IDENTITY bound at
  // session creation (DD4 / Leg 2). Created on `initialize`, routed to thereafter
  // by the `Mcp-Session-Id` header, evicted on transport `onclose`.
  /** @type {Map<string, { server: import('@modelcontextprotocol/sdk/server/index.js').Server, transport: StreamableHTTPServerTransport, identity: string, vaultCtx: ReturnType<typeof createVaultContext> }>} */
  const sessions = new Map();
  // Reservations close the async gap between the capacity check and the
  // transport's onsessioninitialized callback, so concurrent initializes cannot
  // all observe the same free slot and exceed MAX_SESSIONS.
  let pendingSessions = 0;

  /**
   * Build a fresh MCP Server with the 34 tools wired over a per-session,
   * IDENTITY-SCOPED engine accessor (DD4/DD6/DD7 / Leg 2) + the per-session VAULT
   * CONTEXT (M12 F1 Leg 3). One per session:
   *   - the engine is built with `{ allowInternal: identity === 'admin' }`, then
   *   - wrapped by scopeEngine(engine, identity, ctx) — admin → unchanged; jar →
   *     a jar-confined façade.
   * getEngine + scopeEngine are called FRESH per callTool inside the registry so a
   * recreated/closed window AND a runtime jars-add are always picked up.
   *
   * The four VAULT tools are non-engine-op: they dispatch to `vaultCtx` (the SAME
   * per-session reference stored in the sessions entry and zeroized in onclose),
   * through a per-session BOUND adapter that closes over the session IDENTITY + the
   * fill membership deps (scopeCtx) so the static tool defs need neither. Vault
   * ops stay in the registry so the audit wrap below records them (they never
   * bypass registry.callTool).
   *
   * Audit recording (Leg 3 / DD8) is wrapped AROUND registry.callTool HERE — the
   * single choke point — so mcp-tools.js stays audit-free. The sessionId is read
   * LAZILY from `sessionRef.id` at call time (the transport is constructed before
   * buildServer, and `onsessioninitialized` fills the id afterward): we close over
   * the ref OBJECT and read `.id` inside the wrapped fn, never capture null at wrap.
   * @param {string} identity  'admin' or a jarId — bound to this session
   * @param {{ id: string|null }} sessionRef  per-session id holder, filled on init
   * @param {ReturnType<typeof createVaultContext>} vaultCtx  the per-session vault ctx
   * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server}
   */
  function buildServer(identity, sessionRef, vaultCtx) {
    const server = new Server(
      { name: SERVER_NAME, version },
      { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
    );
    // Per-session BOUND vault adapter: the four vault tool defs receive THIS as the
    // 3rd callTool arg. It closes over the session identity + the fill membership
    // deps (scopeCtx, the same shape vault-context.fill expects) so the static
    // defs stay identity-free. The RAW vaultCtx (its keys + zeroize) is the shared
    // reference — stored in the sessions entry and zeroized in transport.onclose.
    const boundVault = {
      unlock: (/** @type {string} */ accessKey) => vaultCtx.unlock(identity, accessKey),
      list: () => vaultCtx.list(),
      totp: (/** @type {string} */ itemId, /** @type {string=} */ vaultId) => vaultCtx.totp(itemId, vaultId),
      fill: (/** @type {{ wcId: number, itemId: string, vaultId?: string }} */ target) =>
        vaultCtx.fill(identity, target, scopeCtx || {}),
    };
    const registry = buildToolRegistry(
      () => scopeEngine(getEngine({ allowInternal: identity === 'admin' }), identity, scopeCtx),
      () => boundVault
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
        detail: deriveAuditDetail(name, args, result),
      });
      return result;
    });
    return server;
  }

  /** @type {import('http').Server | null} */
  let httpServer = null;
  let started = false;
  // stop() advances this generation while a listen is pending. The completed
  // listen then closes its freshly-bound server instead of committing an orphan.
  let lifecycleGeneration = 0;

  /**
   * Read and JSON-parse a request body, capping accumulation at MAX_BODY_BYTES
   * (DD9). Resolves:
   *   - the parsed JSON value on success,
   *   - `undefined` on an empty body or a parse failure (the caller treats a
   *     non-initialize / unparseable body without a valid session as a 400),
   *   - the BODY_TOO_LARGE sentinel when the cap is exceeded — distinct from the
   *     undefined case so the caller does NOT collapse it into the 400 path.
   * On over-cap, accumulation stops immediately (we do not read to end); the
   * caller writes the 413 and destroys the request.
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
   * Write the shared over-cap response and stop the inbound body stream.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  function rejectBodyTooLarge(req, res) {
    if (!res.headersSent) {
      res.writeHead(413);
      res.end();
    }
    req.destroy();
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
      // Enable check: the persisted toggle OR the in-memory dev-enable override
      // (DD3/DD4). The override lets an unpackaged `dev:automation` run resolve
      // identity with the persisted toggle off, but a valid Bearer key is STILL
      // required below — the override does NOT waive the key requirement.
      if (settings.get('automationEnabled') !== true && !devEnableOverride()) return null;

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
        // The SDK parses POST bodies itself, so pre-read them through the same
        // capped path used by initialize and pass the parsed value through. GET
        // remains a standalone bodyless SSE stream and must not be consumed here.
        let body;
        if (req.method === 'POST') {
          body = await readJsonBody(req);
          if (body === BODY_TOO_LARGE) {
            rejectBodyTooLarge(req, res);
            return;
          }
        }
        await entry.transport.handleRequest(req, res, body);
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
      rejectBodyTooLarge(req, res);
      return;
    }
    if (!isInitializeRequest(body)) {
      sendJsonRpcError(res, 400, 'No valid session: initialize required to open one');
      return;
    }

    // Reject before allocating another Server+transport pair. Include pending
    // initializations so concurrent requests cannot race past the active cap.
    if (sessions.size + pendingSessions >= MAX_SESSIONS) {
      sendJsonRpcError(res, 429, 'Session limit reached: maximum ' + MAX_SESSIONS + ' active sessions');
      return;
    }
    pendingSessions++;
    let hasReservation = true;

    // Fresh PER-SESSION id holder (Leg 3 / DD8). Allocated ABOVE the transport so
    // onsessioninitialized can fill it AND it can be threaded into buildServer for
    // the callTool wrapper to read lazily. There is no Server/registry reuse across
    // sessions (a fresh pair per initialize), so a per-session ref is correct — a
    // shared/module-level ref would be a cross-session bug.
    const sessionRef = { id: /** @type {string|null} */ (null) };

    // Fresh PER-SESSION vault context (M12 F1 Leg 3). Minted BEFORE the transport
    // (like sessionRef) so the SAME reference threads into buildServer (the tools),
    // the sessions entry, AND transport.onclose (zeroize). Holds this session's
    // vault key Buffers; carries NO cross-session state — a fresh ctx per initialize.
    const vaultCtx = createVaultContext({
      vaultStore,
      fillDelegate,
      getAutoLockMinutes: getVaultAutoLockMinutes,
    });

    // Create a NEW session: fresh transport + Server scoped to this identity,
    // registered on init with the identity BOUND into the entry (DD4 / Leg 2).
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        if (hasReservation) {
          pendingSessions--;
          hasReservation = false;
        }
        sessionRef.id = sid;
        // Store the SAME vaultCtx reference the tools use (M12 F1 Leg 3).
        sessions.set(sid, { server, transport, identity, vaultCtx });
        // Mark the session active (Leg 3 / DD8) — fires the broadcast.
        auditLog.noteSessionOpen(sid, identity);
      },
    });
    transport.onclose = () => {
      // Session-scoped zeroization (M12 F1 Leg 3): .fill(0) + clear this session's
      // vault key Buffers BEFORE eviction. The SAME reference the tools used, so a
      // fresh session must vaultUnlock again. Idempotent (also fired by the idle
      // backstop), so a double-teardown is a clean no-op.
      try { vaultCtx.zeroize(); } catch { /* already zeroized */ }
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        // Close-tracking is wired into onclose ONLY (stop() cascades through here),
        // and noteSessionClose is idempotent so a double-close is a clean no-op.
        auditLog.noteSessionClose(transport.sessionId);
      }
    };
    const server = buildServer(identity, sessionRef, vaultCtx);
    try {
      await server.connect(transport);
      // Pass the already-parsed body so the SDK does not try to re-read the stream.
      await transport.handleRequest(req, res, body);
    } finally {
      if (hasReservation) {
        pendingSessions--;
        hasReservation = false;
      }
    }
  }

  /**
   * Close a bound listener and force lingering keep-alive connections down so
   * its port is immediately reusable.
   * @param {import('http').Server} srv
   * @returns {Promise<void>}
   */
  async function closeHttpServer(srv) {
    const closed = new Promise((resolve) => srv.close(() => resolve(undefined)));
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    await closed;
  }

  /**
   * Start the server: bind the http server to 127.0.0.1. Idempotent — a second
   * call is a no-op. Per-session Server/transport pairs are connected lazily on
   * each `initialize` (see routeRequest), not at start.
   *
   * Strict-vs-fallback semantics (DD6):
   * - STRICT (explicit opts.port, or a dev GOLDFINCH_MCP_PORT pin): attempt the
   *   preferred port ONCE; on EADDRINUSE reject loudly (no retry) so the operator
   *   frees the port / changes the env. The surface stays unbound; the app does
   *   not crash.
   * - FALLBACK (setting/default; env not the source): on EADDRINUSE pick the next
   *   candidate via freePortInRange(attempt + 1) (advisory/fast) and retry the
   *   REAL listen — the listen is the authority, defeating the advisory probe's
   *   TOCTOU. Capped at MAX_BIND_ATTEMPTS; on exhaustion / no free port, reject
   *   "no free port found". The fallback is EPHEMERAL: start() never writes the
   *   persisted `automationPort`.
   *
   * On success boundPort is set to the actually-bound port (read via get port()).
   * Rejects (without crashing the app) on a bind error so the caller can surface
   * a mode-aware hint.
   * @returns {Promise<void>}
   */
  async function start() {
    if (started) return;
    started = true;
    const generation = ++lifecycleGeneration;

    // Cap retries so a pathological "every port in use" environment terminates.
    const MAX_BIND_ATTEMPTS = 20;

    // Attempt to listen once on `attemptPort`. Resolves the bound port on success,
    // or resolves a discriminated EADDRINUSE marker, or rejects on other errors.
    // A failed attempt's server never bound, so it is simply discarded (no close).
    const tryListen = (/** @type {number} */ attemptPort) => new Promise((resolve, reject) => {
      const srv = http.createServer(onRequest);
      const onError = (/** @type {NodeJS.ErrnoException} */ err) => {
        if (err && err.code === 'EADDRINUSE') {
          resolve({ inUse: true });
        } else {
          reject(err);
        }
      };
      srv.once('error', onError);
      // Bind LOOPBACK ONLY — 127.0.0.1, never 0.0.0.0 / :: (SC7).
      srv.listen(attemptPort, '127.0.0.1', () => {
        srv.removeListener('error', onError);
        resolve({ inUse: false, server: srv, port: attemptPort });
      });
    });

    // Reset state so a later retry / stop() / rebind still works.
    const resetAndReject = (/** @type {Error} */ err) => {
      if (lifecycleGeneration === generation) {
        started = false;
        httpServer = null;
      }
      throw err;
    };

    const wasStopped = () => !started || lifecycleGeneration !== generation;

    let attemptPort = preferred;
    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt++) {
      let result;
      try {
        result = await tryListen(attemptPort);
      } catch (err) {
        if (wasStopped()) return;
        // Non-EADDRINUSE error: reject as before (reset state).
        resetAndReject(/** @type {Error} */ (err));
        return; // resetAndReject always throws — unreachable, but explicit for readers
      }
      if (wasStopped()) {
        // stop() ran while listen was pending. A successful bind must be closed
        // here because stop() could not yet see it through httpServer.
        if (!result.inUse) await closeHttpServer(result.server);
        return;
      }
      if (!result.inUse) {
        // Bound. Keep the server + record the actually-bound port.
        httpServer = result.server;
        boundPort = result.port;
        return;
      }
      // EADDRINUSE.
      if (strict) {
        // Strict: do NOT move. The env (dev) or explicit opts.port must bind exactly.
        resetAndReject(new Error(eaddrinuseMessage(attemptPort, /* exhausted */ false)));
        return; // resetAndReject always throws — unreachable, but explicit for readers
      }
      // Fallback: probe for the next candidate above the busy port, then retry the
      // REAL listen (the advisory probe only chooses; the bind confirms).
      const next = await freePortInRange(attemptPort + 1);
      if (wasStopped()) return;
      if (next == null) {
        resetAndReject(new Error(eaddrinuseMessage(attemptPort, /* exhausted */ true)));
        return; // resetAndReject always throws — unreachable, but explicit for readers
      }
      attemptPort = next;
    }
    // Cap exhausted without binding.
    resetAndReject(new Error(eaddrinuseMessage(attemptPort, /* exhausted */ true)));
    return; // resetAndReject always throws — unreachable, but explicit for readers
  }

  /**
   * Build a build/mode-aware EADDRINUSE hint (DD6). The unconditional
   * "set GOLDFINCH_MCP_PORT to override" is replaced:
   * - Dev env-strict (env honored, was the source): mention the env — it must bind
   *   exactly, so free the port or change GOLDFINCH_MCP_PORT.
   * - Explicit opts.port strict (tests/rebind): a plain in-use message, no env hint.
   * - Fallback exhausted (dev-no-env, or packaged): "no free port found"; on a
   *   packaged build (env ignored) point at the Settings port control, not the env.
   * @param {number} attemptPort
   * @param {boolean} exhausted true when the fallback ran out of free ports.
   * @returns {string}
   */
  function eaddrinuseMessage(attemptPort, exhausted) {
    if (exhausted) {
      const where = honorEnv
        ? ' — change the automation port in Settings or free a port'
        : ' — change the automation port in Settings'; // packaged: env ignored
      return 'automation: no free port found near ' + attemptPort + where;
    }
    if (envUsed) {
      return 'automation: MCP port ' + attemptPort + ' is in use — free the port '
        + 'or change GOLDFINCH_MCP_PORT (it must bind exactly when set)';
    }
    return 'automation: MCP port ' + attemptPort + ' is in use';
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
    lifecycleGeneration++;

    const srv = httpServer;
    httpServer = null;
    if (srv) {
      // closeHttpServer stops accepting and forcibly destroys lingering SDK
      // keep-alive sockets so the port frees promptly.
      await closeHttpServer(srv);
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

  // `port` is a live getter (not a fixed value): start() may bind a different free
  // port in fallback mode, and consumers (main.js's post-start capture,
  // currentAutomationStatus) must read the bound port. Callers MUST NOT destructure
  // `mcpServer.port` — that would snapshot the getter at the pre-start value.
  return { start, stop, get port() { return boundPort; }, getActivity };
}

// ---------------------------------------------------------------------------
// Mint path (DD3/DD5/DD6) — gated on isMcpAutomationEnabled in main.js.
//
// These mint a key for a headless / behavior-test harness. The plaintext key is
// generated with a CSPRNG, its HASH is stored, and the plaintext is RETURNED ONCE
// (never persisted). Minting does NOT enable the surface (DD3 — enabling is
// human-only via the UI toggle, or in dev via the in-memory dev-enable override).
// The caller (main.js) wires these behind the isMcpAutomationEnabled(process.argv)
// && !app.isPackaged gate, so they are unreachable in production.
// ---------------------------------------------------------------------------

const { generateKey, hashKey } = require('./automation-auth');

/**
 * Mint a per-jar automation key. Stores the new key's hash under `jarId` in
 * `automationKeyHashes` and returns the plaintext key ONCE. Does NOT enable the
 * automation surface — enabling is human-only / UI-only (DD3); the persisted
 * `automationEnabled` is written ONLY by the settings-UI toggle IPC path. In dev,
 * the surface is enabled by the in-memory dev-enable override (DD3/DD4), not by
 * minting.
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
function mintJarKey(jarId, settings, jars) {
  if (typeof jarId !== 'string' || jarId === '') {
    throw new TypeError('mintJarKey: jarId must be a non-empty string');
  }
  if (jars && typeof jars.list === 'function') {
    const known = jars.list().some((j) => j.id === jarId);
    if (!known) {
      throw new Error(
        'mintJarKey: jarId ' + jarId + ' is not a known jar (burner ids and unknown ids are not valid mint targets)'
      );
    }
  }
  const key = generateKey();
  const hashes = { ...(settings.get('automationKeyHashes') || {}) };
  hashes[jarId] = hashKey(key);
  settings.set('automationKeyHashes', hashes);
  return key;
}

/**
 * Mint the admin key into `automationAdminKeyHash` and return the plaintext ONCE.
 * Only mints when the GOLDFINCH_AUTOMATION_ADMIN presence gate is set (the admin
 * tier is inert without it); returns null otherwise. Does NOT flip
 * `automationEnabled` (admin is orthogonal to the enable toggle; enabling is
 * human-only — DD3 — or, in dev, the in-memory dev-enable override).
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
 * (mirrors mintJarKey) so other jars' hashes stay intact. No-op if the
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
  mintJarKey,
  mintAdminKey,
  revokeJarKey,
  revokeAdminKey,
  deriveAuditDetail,
};
