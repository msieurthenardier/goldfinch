// @ts-check
'use strict';

// Automation MCP tool registry — the thin, SDK-free adapter over engine.js (DD5/DD6).
//
// This module is DELIBERATELY SDK-FREE and ELECTRON-FREE. It imports nothing —
// it returns plain MCP-shaped result objects ({ content: [...] }, optional
// isError). The SDK request schemas (ListToolsRequestSchema / CallToolRequestSchema)
// are wired in mcp-server.js, which is the SOLE SDK importer. Keeping the registry
// SDK-free makes it unit-testable with a fake engine and no SDK/Electron stub.
//
// DD5 — the engine ops map 1:1 to MCP tools; this layer is a thin adapter that
// maps named tool arguments → the engine's positional signature, calls
// engine[op](...), and shapes the result/error (DD6). It adds discovery +
// schemas + result shaping, NOT new capability and NOT new security logic. The
// engine's resolveContents guard (resolve.js) and isSafeTabUrl (nav.js) stay
// authoritative — reached ONLY through engine[op](...), never by importing the
// tabs/nav/input/resolve modules or building deps here (the Leg-1 no-bypass
// invariant).
//
// DD6 — result/error semantics at the MCP boundary:
//   - operational conditions → normal tool result (no isError)
//   - programmer/security errors (engine throws) → tool error (isError: true)
// SUCCESS-RESULT SHAPE (the consumer contract; Leg 4 documents it for clients):
//   The op's actual return value is serialized into one text-content block as
//   JSON. The single exception is a genuinely-void op (resolves `undefined`),
//   which serializes to the one consistent success shape `{"ok":true}`.
//     serialize(value) = value === undefined ? '{"ok":true}' : JSON.stringify(value)
//   Therefore:
//     enumerateTabs  → the tab array as JSON
//     openTab        → the new wcId (number) OR null (operational: URL rejected
//                      renderer-side or timed out — a NORMAL result, not isError)
//     closeTab /     → their BOOLEAN return (the renderer's success signal),
//     activateTab      serialized as true/false. They are NOT void — do NOT
//                      normalize them to {"ok":true}.
//     the void ops   → navigate/goBack/goForward/reload/click/typeText/scroll/
//                      pressKey resolve undefined → {"ok":true}.
//
// EXTENSION POINT (for Leg 3 observe-tools): the registry iterates a single
// `TOOLS` array. Leg 3 APPENDS its 4 observe tool defs (captureScreenshot,
// captureWindow, readDom, readAxTree) to that array — each with its own
// `call(engine, args)` mapper and (for screenshots) its own result shaping.
// Nothing about the drive tools needs to change. Do NOT pre-stub observe here.

// ---------------------------------------------------------------------------
// Result shaping (DD6)
// ---------------------------------------------------------------------------

/**
 * Serialize an engine op's return value to the success-content JSON text.
 * `undefined` (a void op) → the one consistent success shape; everything else
 * (arrays, numbers, booleans, null, objects) → JSON.stringify verbatim.
 *
 * @param {any} value
 * @returns {string}
 */
function serialize(value) {
  return value === undefined ? '{"ok":true}' : JSON.stringify(value);
}

/**
 * Wrap a successful op return value as a normal MCP tool result (no isError).
 * @param {any} value
 * @returns {{ content: { type: 'text', text: string }[] }}
 */
function okResult(value) {
  return { content: [{ type: 'text', text: serialize(value) }] };
}

/**
 * Wrap an engine throw (programmer/security error) as an MCP error result. The
 * `automation: …` error message is preserved in the content text.
 * @param {any} err
 * @returns {{ content: { type: 'text', text: string }[], isError: true }}
 */
function errResult(err) {
  return { content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true };
}

/**
 * Shape a base64 PNG string the engine returned as MCP IMAGE content (DD6). The
 * base64 string is passed through VERBATIM into `data` — never re-encoded, never
 * JSON-wrapped. SDK-free: a plain object, the same shape the SDK would emit.
 * @param {string} b64  the base64-encoded PNG the engine op returned
 * @returns {{ content: { type: 'image', data: string, mimeType: 'image/png' }[] }}
 */
function imageResult(b64) {
  return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
}

// ---------------------------------------------------------------------------
// Tool definitions — drive ops (12). Each: { name, description, inputSchema,
// call(engine, args) }. `call` is the named→positional seam (kept tiny and
// explicit); it is internal and is NOT leaked by listTools().
// ---------------------------------------------------------------------------

const PRESS_KEY_NAMES =
  'Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, ShiftTab';

/**
 * Tool def shape. `call` is the named→positional seam (internal; never leaked by listTools).
 * `shape` is an OPTIONAL per-tool result-shaper (Leg 3): when present, callTool uses it to
 * shape the op's success return instead of the default JSON-text serialize — only the two
 * image ops (captureScreenshot / captureWindow) set it. Drive tools + readDom + readAxTree
 * omit it and ride the default serialize. (Thrown errors still map to isError via callTool's
 * try/catch regardless of `shape`.)
 *
 * @typedef {{
 *   name: string,
 *   description: string,
 *   inputSchema: object,
 *   call: (engine: any, args: any) => any,
 *   shape?: (value: any) => { content: any[] },
 * }} ToolDef
 */

/** @type {ToolDef[]} */
const DRIVE_TOOLS = [
  {
    name: 'enumerateTabs',
    description: 'List all drivable (non-internal, dom-ready) tabs as an array of { wcId, url, title, jarId, active }.',
    inputSchema: { type: 'object', properties: {} },
    call: (engine) => engine.enumerateTabs(),
  },
  {
    name: 'openTab',
    description: 'Open a new tab at the given URL. Returns the new tab\'s wcId, or null if the URL was rejected renderer-side or no handle became available within the timeout.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) URL to open' } },
      required: ['url'],
    },
    call: (engine, { url }) => engine.openTab(url),
  },
  {
    name: 'closeTab',
    description: 'Close the tab identified by wcId. Returns a boolean success signal.',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    call: (engine, { wcId }) => engine.closeTab(wcId),
  },
  {
    name: 'activateTab',
    description: 'Bring the tab identified by wcId to the foreground. Returns a boolean success signal.',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    call: (engine, { wcId }) => engine.activateTab(wcId),
  },
  {
    name: 'navigate',
    description: 'Navigate the tab identified by wcId to a URL (http(s) only; unsafe URLs are refused).',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        url: { type: 'string', description: 'http(s) URL to load' },
      },
      required: ['wcId', 'url'],
    },
    call: (engine, { wcId, url }) => engine.navigate(wcId, url),
  },
  {
    name: 'goBack',
    description: 'Navigate the tab identified by wcId back in history (no-op when there is no back history).',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    call: (engine, { wcId }) => engine.goBack(wcId),
  },
  {
    name: 'goForward',
    description: 'Navigate the tab identified by wcId forward in history (no-op when there is no forward history).',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    call: (engine, { wcId }) => engine.goForward(wcId),
  },
  {
    name: 'reload',
    description: 'Reload the tab identified by wcId.',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    call: (engine, { wcId }) => engine.reload(wcId),
  },
  {
    name: 'click',
    description: 'Synthetic mouse click at (x, y) in the target tab\'s viewport. Coordinates are guest-viewport-relative.',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        x: { type: 'number', description: 'viewport x coordinate' },
        y: { type: 'number', description: 'viewport y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'mouse button (default left)' },
        clickCount: { type: 'integer', description: 'click count (default 1; 2 for double-click)' },
      },
      required: ['wcId', 'x', 'y'],
    },
    call: (engine, { wcId, x, y, button, clickCount }) =>
      engine.click(wcId, x, y, { button, clickCount }),
  },
  {
    name: 'typeText',
    description: 'Type text character-by-character into the focused element of the target tab. For named keys (Enter/Tab/…) use pressKey.',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        text: { type: 'string', description: 'text to type' },
      },
      required: ['wcId', 'text'],
    },
    call: (engine, { wcId, text }) => engine.typeText(wcId, text),
  },
  {
    name: 'scroll',
    description: 'Synthetic scroll-wheel event at (x, y) in the target tab\'s viewport by pixel deltas (dx, dy).',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        x: { type: 'number', description: 'viewport x coordinate of the wheel event' },
        y: { type: 'number', description: 'viewport y coordinate of the wheel event' },
        dx: { type: 'number', description: 'pixel delta on the X axis' },
        dy: { type: 'number', description: 'pixel delta on the Y axis' },
      },
      required: ['wcId', 'x', 'y', 'dx', 'dy'],
    },
    call: (engine, { wcId, x, y, dx, dy }) => engine.scroll(wcId, x, y, dx, dy),
  },
  {
    name: 'pressKey',
    description:
      'Press a named key (keyDown + keyUp) in the target tab. The key is given as `name` (preferred) or `key` (accepted alias) — exactly one is required, alongside wcId. Valid key names: ' +
      PRESS_KEY_NAMES + '.',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        name: { type: 'string', description: 'friendly key name (preferred) — one of: ' + PRESS_KEY_NAMES },
        key: { type: 'string', description: 'accepted alias for `name` — one of: ' + PRESS_KEY_NAMES },
      },
      // wcId is always required; the key may arrive as `name` (preferred) or `key`
      // (alias). anyOf expresses "at least one of name/key" cleanly under JSON-schema
      // validation without coupling the two into a single required slot.
      required: ['wcId'],
      anyOf: [{ required: ['name'] }, { required: ['key'] }],
    },
    // name primary, key alias (??: an explicit `name` wins; falls back to `key`).
    call: (engine, args) => engine.pressKey(args.wcId, args.name ?? args.key),
  },
];

// ---------------------------------------------------------------------------
// Tool definitions — observe ops (4). Same thin-adapter discipline as the drive
// tools (DD5): validate input, call engine[op](...), shape the result. The two
// image ops set `shape: imageResult` (base64 PNG → MCP image content, DD6);
// readDom + readAxTree ride the default JSON-text serialize.
// ---------------------------------------------------------------------------

/** @type {ToolDef[]} */
const OBSERVE_TOOLS = [
  {
    name: 'captureScreenshot',
    description: 'Capture a PNG screenshot of the tab identified by wcId (foreground-first; the tab is brought to front before capture). Returns image content. Optional delayMs tunes the paint-settle wait after foregrounding.',
    inputSchema: {
      type: 'object',
      properties: {
        wcId: { type: 'integer', description: 'webContents id of the target tab' },
        delayMs: { type: 'integer', description: 'paint-settle delay (ms) after foregrounding before capture (optional tuning)' },
      },
      required: ['wcId'],
    },
    // delayMs absent → pass undefined (NOT {} / {delayMs:undefined}) so observe's
    // `{ delayMs } = {}` default + DEFAULT_PAINT_DELAY_MS apply cleanly (DD7 opts arg).
    call: (engine, { wcId, delayMs }) => engine.captureScreenshot(wcId, delayMs == null ? undefined : { delayMs }),
    shape: imageResult,
  },
  {
    name: 'captureWindow',
    description: 'Capture a PNG screenshot of the whole browser window (chrome + composited guests). Takes no input. Returns image content.',
    inputSchema: { type: 'object', properties: {} },
    call: (engine) => engine.captureWindow(),
    shape: imageResult,
  },
  {
    name: 'readDom',
    description: 'Read the live DOM of the tab identified by wcId (foreground-first). Returns { url, title, html } as JSON text — the full live document.documentElement outerHTML (no trimming).',
    inputSchema: {
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    // No `shape`: the { url, title, html } object rides the default JSON-text serialize.
    call: (engine, { wcId }) => engine.readDom(wcId),
  },
  {
    name: 'readAxTree',
    description: 'Read the accessibility tree of the tab identified by wcId (foreground-first; uses the in-process debugger). Returns the AXNode array as JSON text on success, or a { automation: "debugger-unavailable", reason, wcId } object (a NORMAL result, not an error) when the debugger is busy — react by retrying or closing DevTools. CAVEAT (DD8): returned AXNodes carry backendNodeId/frameId that are CDP-session-scoped and stale-on-detach — informational only, NOT live references; address elements by coordinates/selectors for now.',
    inputSchema: {
      // wcId ONLY: the engine op's depth/properties opts are an unimplemented Flight-9 stub
      // (observe.js ignores them) — exposing an ignored param would overpromise (DD8), so omit them.
      type: 'object',
      properties: { wcId: { type: 'integer', description: 'webContents id of the target tab' } },
      required: ['wcId'],
    },
    // No `shape` — DELIBERATE (DD6): the default serialize JSON-texts BOTH the success array
    // AND the debugger-unavailable refusal object as NORMAL results. The refusal is RETURNED
    // (not thrown) by the engine, so it is not an error — the agent must see it and react. Only
    // genuine throws (resolveContents bad/dead/internal, post-attach sendCommand failure) reach
    // callTool's try/catch → isError. No custom mapping is needed or wanted here.
    call: (engine, { wcId }) => engine.readAxTree(wcId),
  },
];

// The full tool table — the 12 drive tools + the 4 observe tools (Leg 3),
// iterated by buildToolRegistry for both discovery and dispatch.
const TOOLS = [...DRIVE_TOOLS, ...OBSERVE_TOOLS];

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

/**
 * Build the MCP tool registry over the (lazily-accessed) automation engine.
 *
 * @param {() => any} getEngine  lazy accessor for the engine (createEngine(...)
 *   result). Called fresh per callTool so a recreated/closed window is always
 *   picked up — matching the engine's per-call deps discipline. If it returns
 *   null (window closed) the op call null-derefs and is caught → isError.
 * @returns {{
 *   listTools: () => { name: string, description: string, inputSchema: object }[],
 *   callTool: (name: string, args: any) => Promise<{ content: any[], isError?: true }>
 * }}
 */
function buildToolRegistry(getEngine) {
  const byName = new Map(TOOLS.map((t) => [t.name, t]));

  /**
   * The discovery contract — ONLY { name, description, inputSchema } per tool.
   * The internal `call` mapper is never leaked into the serialized list.
   */
  function listTools() {
    return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  /**
   * Dispatch a tool call: map named args → positional engine args, invoke the
   * engine op, and shape the result (DD6). An unknown tool name, a null engine,
   * or any engine throw all degrade to an isError result — never a null-deref.
   * @param {string} name
   * @param {any} args
   */
  async function callTool(name, args) {
    const def = byName.get(name);
    if (!def) {
      return errResult(new Error('automation: unknown-tool — no such tool: ' + name));
    }
    try {
      // getEngine() deref is inside the try so a null engine degrades to isError.
      const engine = getEngine();
      const value = await def.call(engine, args ?? {});
      // Per-tool result-shaping seam (Leg 3): the image ops shape base64 → image
      // content; everything else rides the default JSON-text serialize (okResult).
      return def.shape ? def.shape(value) : okResult(value);
    } catch (err) {
      return errResult(err);
    }
  }

  return { listTools, callTool };
}

module.exports = { buildToolRegistry, serialize, okResult, errResult, imageResult };
