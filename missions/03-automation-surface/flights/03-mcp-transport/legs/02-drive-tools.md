# Leg: drive-tools

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

## Objective

Register the 12 drive ops (`enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`) as MCP-discoverable tools with JSON input schemas, via a thin adapter over `engine[op](...)`, with DD6 result/error mapping — so a connected MCP client can `tools/list` and `tools/call` to drive the browser. Unit-tested with a fake engine.

## Context

- **Flight DD5** — the 16 `engine.js` ops map **1:1** to MCP tools; the tool layer is a **thin adapter** that validates input, calls `engine[op](...)`, and maps the result/error (DD6). It adds discovery + schemas + result shaping, **not** new capability and **not** new security logic — the engine's `resolveContents` guard stays authoritative (`resolve.js:72`). This leg does the **12 drive** ops; the **4 observe** ops are Leg 3 (`observe-tools`).
- **Flight DD6** — result/error semantics at the MCP boundary: **operational conditions → normal tool result**; **programmer/security errors → tool error (`isError: true`)**. For drive ops specifically:
  - **Every op that takes a `wcId` resolves through `resolveContents` first** and so can throw the trio `bad-handle` (`resolve.js:74`) / `no-such-contents` (`resolve.js:80`) / `internal-session` (`resolve.js:87`): that is `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`, **and also `closeTab` (`tabs.js:99`) and `activateTab` (`tabs.js:113`)**. Plus the op-specific throws: `navigate`'s `bad-url` (`nav.js:43`), `openTab`'s non-string `bad-url` (`tabs.js:79`), `pressKey`'s `unknown key` (`input.js:33`). All of these → **`isError: true`** results.
  - **`openTab` returning `null`** (URL rejected **renderer-side** by the `createTab` untrusted branch's `isSafeTabUrl`, or no handle within the timeout — `tabs.js:81`) is an **operational** condition → **normal** result (not an error). Note the asymmetry: `navigate` applies `isSafeTabUrl` **in-engine** (`nav.js:42`) and a bad URL **throws**; `openTab`'s `isSafeTabUrl` gate is enforced **in the renderer** and a bad URL surfaces as the `null` operational result. Both are correct per their layer.
  - (The observe `debugger-unavailable` refusal-as-result is a Leg-3 concern; no drive op produces one.)
- **Leg-1 seam** — `mcp-server.js` (`createMcpServer`) already advertises the `tools` capability and holds the lazy engine accessor `getEngine` (`mcp-server.js:72`, currently unused: `void _getEngine`). It currently registers a **static empty** `ListToolsRequestSchema` handler returning `{ tools: [] }` (`mcp-server.js:94`). This leg replaces that with a populated list + a `CallToolRequestSchema` handler, both backed by a new tool-registry adapter module, and **starts using `getEngine`**.
- **Engine entry points** — the drive ops are the first 12 returned by `createEngine(...)` (`engine.js:50–63`). Each takes a `wcId` (except `enumerateTabs`/`openTab`) and resolves deps fresh per call. The adapter must map **named tool arguments → positional engine arguments** (the engine is positional). Notably `engine.click(wcId, x, y, opts)` takes an `opts` object `{ button, clickCount }` as its 4th arg (`engine.js:58`, `input.js:161`).
- **No engine-bypass invariant (from Leg 1)** — the tool layer must reach engine ops **only** through `engine[op](...)`; it must not call the underlying `tabs`/`nav`/`input` modules directly or construct its own deps, so the `resolveContents` internal-session guard cannot be bypassed.

## Inputs

What exists before this leg runs:
- `src/main/automation/engine.js` — `createEngine(getMainWindow)` returning the 16 ops (drive ops at `engine.js:50–63`).
- `src/main/automation/mcp-server.js` — `createMcpServer({ getEngine, version })`; SDK `Server` with `tools` capability; static empty list handler at `mcp-server.js:94`; `getEngine` held but unused at `mcp-server.js:72`.
- `src/main/automation/resolve.js` — `resolveContents` throwing the three distinct guard errors.
- The MCP SDK request schemas: `ListToolsRequestSchema`, `CallToolRequestSchema` from `@modelcontextprotocol/sdk/types.js` (the former already imported in `mcp-server.js:37`).
- Unit-test conventions: `test/unit/automation-*.test.js` (`node:test` + `node:assert`, fakes, no Electron).

## Outputs

What exists after this leg completes:
- `src/main/automation/mcp-tools.js` (new) — a thin, SDK-agnostic tool-registry adapter. Exports a builder, e.g. `buildToolRegistry(getEngine)` → `{ listTools(): ToolDef[], callTool(name, args): Promise<CallToolResult> }`. **Drive tools only** this leg; Leg 3 extends it with the 4 observe tools. The module is **dependency-free and SDK-free** (it returns plain MCP-shaped objects; the SDK schemas are wired in `mcp-server.js`) so it is unit-testable with a fake engine and no SDK import.
- `src/main/automation/mcp-server.js` — wires `setRequestHandler(ListToolsRequestSchema, …)` to `registry.listTools()` and `setRequestHandler(CallToolRequestSchema, …)` to `registry.callTool(name, args)`; builds the registry from the held `getEngine`. The static empty-list handler at `mcp-server.js:94` is replaced.
- `test/unit/automation-mcp-tools.test.js` (new) — exhaustive adapter tests with a fake engine.

## Acceptance Criteria

- [ ] **12 drive tools listed.** `registry.listTools()` (and `tools/list` over the transport) returns exactly the 12 drive tools, named **1:1** with the engine ops: `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`. Each has a `description` and a valid JSON `inputSchema` (`type: object`, correct `properties`, correct `required`).
- [ ] **Input schemas correct** (the discovery contract):
  - `enumerateTabs` — no required input (empty `properties` / no params).
  - `openTab` — `{ url: string }` required.
  - `closeTab`, `activateTab`, `goBack`, `goForward`, `reload` — `{ wcId: integer }` required.
  - `navigate` — `{ wcId: integer, url: string }` required.
  - `click` — `{ wcId: integer, x: number, y: number }` required; optional `button` (enum `left|right|middle`), `clickCount` (integer).
  - `typeText` — `{ wcId: integer, text: string }` required.
  - `scroll` — `{ wcId: integer, x: number, y: number, dx: number, dy: number }` required.
  - `pressKey` — `{ wcId: integer, name: string }` required (description enumerates the known keys: `Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, ShiftTab`).
- [ ] **Dispatch maps named → positional correctly.** `callTool(name, args)` invokes the matching `engine[name](...)` with arguments mapped from the named schema to the engine's positional signature — in particular `click` → `engine.click(wcId, x, y, { button, clickCount })` (the opts object, per `engine.js:58`), and `enumerateTabs` → `engine.enumerateTabs()` (no args).
- [ ] **DD6 success mapping.** A successful op returns a **normal** tool result (no `isError`). The op's **actual return value is serialized** into the result content as JSON text, uniformly:
  - `enumerateTabs` → the tab array as JSON; `openTab` → the new `wcId` (a number) or `null` (see operational case below).
  - `closeTab` / `activateTab` → their **boolean** return (the renderer's success signal — `tabs.js:100,114`), serialized as `true`/`false`. They are **not** void; do not normalize them to `{ ok: true }`.
  - The genuinely void ops — `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey` (resolve `undefined`) — serialize to the one consistent success shape `{ ok: true }`.
  - So the rule is simply: `serialize(value)` = `value === undefined ? '{"ok":true}' : JSON.stringify(value)`.
- [ ] **DD6 operational-vs-error mapping.** `openTab` returning **`null`** → **normal** result (content notes the URL was rejected/timed out), **not** `isError`. Every engine **throw** (`resolveContents` `bad-handle`/`no-such-contents`/`internal-session`; `navigate`/`openTab` `bad-url`; `pressKey` `unknown key`) → a tool result with **`isError: true`** whose content carries the `automation: …` error message. An **unknown tool name** → `isError: true`.
- [ ] **Engine-only reach (security).** The adapter calls engine ops **only** via the injected `getEngine()` result; it does not import `tabs`/`nav`/`input`/`resolve` or build its own deps. (Confirms the Leg-1 no-bypass invariant — `resolveContents`/`isSafeTabUrl` stay authoritative; the internal-session guard is reachable only through the engine.)
- [ ] **Adapter is SDK-free + unit-tested.** `mcp-tools.js` imports no SDK and no Electron; `test/unit/automation-mcp-tools.test.js` covers list shape, per-op arg mapping (fake engine records calls), success serialization, the `openTab`-null operational case, each throw→`isError`, and unknown-tool→`isError`.
- [ ] **Gates green.** `npm test`, `npm run typecheck`, `npm run lint` all pass. (No new runtime dependency — DD1's one SDK dep already landed in Leg 1.)

## Verification Steps

- **List**: `npm test` — adapter test asserts the 12 tool names + schemas; (live `tools/list` over the transport is exercised in Leg 6).
- **Dispatch + mapping**: adapter test calls `callTool('navigate', { wcId: 7, url: 'https://example.com' })` against a fake engine and asserts `engine.navigate` was called with `(7, 'https://example.com')`; `callTool('click', { wcId: 7, x: 10, y: 20, button: 'left', clickCount: 1 })` → `engine.click(7, 10, 20, { button: 'left', clickCount: 1 })`.
- **DD6 success**: fake `enumerateTabs` returns a 2-tab array → result content is the JSON array, no `isError`. Void op → `{ ok: true }`-style content, no `isError`.
- **DD6 operational**: fake `openTab` returns `null` → normal result, `isError` falsy.
- **DD6 error**: fake engine op throws `new Error('automation: internal-session — …')` → result `isError: true`, message preserved. `callTool('nope', {})` → `isError: true`.
- **Static**: `npm run typecheck` and `npm run lint` clean.

## Implementation Guidance

1. **Build the adapter module (`src/main/automation/mcp-tools.js`).**
   - `@ts-check`, `'use strict'`, no SDK/Electron imports.
   - Define a `DRIVE_TOOLS` table: each entry `{ name, description, inputSchema, call(engine, args) }` where `call` maps named args to the positional engine call and returns the engine op's promise/value. Keep the per-op `call` mappers tiny and explicit (this is the named→positional seam — `click` is the one with an opts object).
   - Export `buildToolRegistry(getEngine)` returning:
     - `listTools()` → the tool defs (without the internal `call` fn — return `{ name, description, inputSchema }`).
     - `callTool(name, args)` → look up the def; if none → `isError` result. Else `const engine = getEngine();` then `try { const value = await def.call(engine, args ?? {}); return okResult(value); } catch (err) { return errResult(err); }`.
   - Result helpers: `okResult(value)` → `{ content: [{ type: 'text', text: serialize(value) }] }` where `serialize(undefined)` → `'{"ok":true}'` (or a small `{ ok: true }` JSON), arrays/objects → `JSON.stringify`, primitives → `JSON.stringify`. `errResult(err)` → `{ content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true }`. Document the chosen success shape in a comment (Leg 4 docs it for consumers).
   - **Design the registry so Leg 3 only appends** the 4 observe tools (e.g. a `TOOLS` array the builder iterates, or a `registerObserveTools` extension point) — but do not pre-stub observe here; that is Leg 3's work.

2. **Wire into `mcp-server.js`.**
   - Import `CallToolRequestSchema` (alongside the existing `ListToolsRequestSchema`, `mcp-server.js:37`) and `buildToolRegistry`.
   - Build the registry once from the held `getEngine` (remove the `void _getEngine` no-op — it is now used). If `getEngine` is absent, fall back to a registry over an engine that throws a clear "engine unavailable" error so `tools/call` degrades to an `isError`, never a null-deref.
   - Replace the static `ListToolsRequestSchema` handler (`mcp-server.js:94`) with `async () => ({ tools: registry.listTools() })`.
   - Add `mcp.setRequestHandler(CallToolRequestSchema, async (req) => registry.callTool(req.params.name, req.params.arguments))`.
   - Keep the SDK confined to `mcp-server.js` (the adapter stays SDK-free).

3. **Unit-test (`test/unit/automation-mcp-tools.test.js`).**
   - Fake engine = an object whose 12 ops are recording stubs (capture args; configurable return/throw). Match the existing `automation-*.test.js` style.
   - Cover: list shape (12 names + schema required-fields, **and that each listed tool exposes only `{ name, description, inputSchema }` — no internal `call` fn leaks into the serialized list**); each op's named→positional mapping; success serialization (array, number, boolean for close/activate, void→`{ok:true}`); `openTab` null → normal; each throw class → `isError` with message (incl. close/activate surfacing the `resolveContents` trio); unknown-tool → `isError`; and that `getEngine` is called per `callTool` (fresh engine each call, matching the engine's per-call deps discipline).

## Edge Cases

- **Missing required arg** (e.g. `navigate` with no `url`): let the engine guard fire (`isSafeTabUrl(undefined)` → `bad-url` throw → `isError`). The adapter need not duplicate validation; the `inputSchema` is the client-facing contract. (Optionally short-circuit a clearly-absent required arg to a cleaner message — at implementer discretion, but do not build a parallel validation layer.)
- **`arguments` undefined** (a `tools/call` with no args): default to `{}` so destructuring in `call` mappers doesn't throw.
- **Non-number `wcId`** arriving as a string: the engine's `bad-handle` guard (`resolve.js:74`) throws → `isError`. Do not silently coerce — a string wcId is a client contract violation.
- **`click` without `button`/`clickCount`**: pass `{}` (or omit) so `input.js` defaults (`button='left'`, `clickCount=1`, `input.js:60`) apply.
- **Engine op returns a Promise vs a sync value** (nav ops are sync-returning `void`, others async): `await` uniformly in `callTool` — `await` on a non-promise is fine.
- **`getEngine()` returns null** (window closed at call time): calling `engine[op]` null-derefs → catch → `isError`. Ensure the try/catch wraps the `getEngine()` deref too, or guard it explicitly.

## Files Affected

- `src/main/automation/mcp-tools.js` — new, the SDK-free drive-tool registry adapter (extension point for Leg 3 observe tools).
- `src/main/automation/mcp-server.js` — wire list + call handlers to the registry; start using `getEngine`; import `CallToolRequestSchema` + `buildToolRegistry`.
- `test/unit/automation-mcp-tools.test.js` — new, exhaustive adapter unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (autonomous leg — do NOT commit; the Flight Director defers review + commit to the end of the flight):**

- [ ] All acceptance criteria verified (live `tools/list`/`tools/call` over the transport is exercised in Leg 6 `verify-integration`)
- [ ] Unit tests + typecheck + lint passing
- [ ] Update flight-log.md with a Leg Progress entry (the chosen success-result shape; the registry extension-point design for Leg 3)
- [ ] Set this leg's status to `landed` (NOT `completed`)
- [ ] Do NOT commit; do NOT check off the leg in flight.md yet
