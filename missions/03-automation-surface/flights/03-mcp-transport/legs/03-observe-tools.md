# Leg: observe-tools

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

## Objective

Register the 4 observe ops (`captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`) as MCP tools — screenshots as image content, DOM/a11y as text/JSON, the `debugger-unavailable` refusal as a normal result and genuine throws as `isError` (DD6) — and fix the `captureScreenshot` opts-spread footgun (DD7) before the tool layer exposes the engine API, keeping the existing 8 `captureScreenshot` unit tests green.

## Context

- **Flight DD5** — the 4 observe ops complete the 1:1 engine→tool mapping (12 drive in Leg 2 + 4 observe = 16). Same thin-adapter discipline: validate input, call `engine[op](...)`, shape the result. Appended to the Leg-2 `TOOLS` registry in `mcp-tools.js` (the Leg-2 dev built a single module-scoped `TOOLS` array as the extension point — Leg 3 just adds 4 defs).
- **Flight DD6 — result/error semantics (the heart of this leg):**
  - `captureScreenshot` / `captureWindow` return a **base64 PNG string** (`observe.js:110,190`) → emit MCP **image content**: `{ type: 'image', data: <base64>, mimeType: 'image/png' }`.
  - `readDom` returns `{ url, title, html }` (`observe.js:173`) → **text/JSON** content.
  - `readAxTree` returns **either** a raw AXNode **array** (success, possibly empty `[]`) **or** the refusal object `{ automation: 'debugger-unavailable', reason, wcId }` (`observe.js:37–38,258,264`). **Both are NORMAL (non-error) tool results** — the refusal is returned, not thrown (DD6: "a busy debugger is expected, not exceptional" — the agent must *see* the refusal and react). So `readAxTree` needs **no custom error mapping**: serialize whichever it returns as JSON text, no `isError`. Discriminate-for-docs via `Array.isArray`, but the result shape is the same (normal).
  - **Genuine throws → `isError: true`** (the generic `callTool` try/catch from Leg 2 already does this): `resolveContents` `bad-handle`/`no-such-contents`/`internal-session` for the three wcId-taking observe ops (`captureScreenshot`/`readDom`/`readAxTree` — `resolve.js:74,80,87`); `captureWindow`'s `chrome window unavailable` throw (`observe.js:188`); and a **post-attach** `readAxTree` sendCommand failure, which **propagates** (the debugger *was* available — `observe.js:218–220` / the un-caught path after a successful attach) → `isError`.
- **Flight DD7 — fix the `captureScreenshot` opts-spread footgun (scope: `captureScreenshot` ONLY).** `engine.js:66` currently calls `observe.captureScreenshot(wcId, { ...deps(), ...opts })` — merging caller-tunable params (`delayMs`/`waitForPaint`) into the **injected-deps bag**, so an over-supplied `opts` key could silently clobber injected `fromId`/`chromeContents`/`activate`. Once the MCP transport feeds real caller input into this op, that silent-override risk becomes concrete. **Fix:** restructure `observe.captureScreenshot` to a **3-arg `(wcId, deps, opts)`** signature — `deps = { fromId, chromeContents, activate }`, `opts = { delayMs, waitForPaint }` — exactly mirroring `readAxTree`'s already-safe shape (`observe.js:245` / `engine.js:69`). Then `engine.js:66` becomes `observe.captureScreenshot(wcId, deps(), opts)` (no spread-merge). **`readAxTree` is already `(wcId, deps, opts)` — do NOT reshape its working signature** (DD7 scope is `captureScreenshot` only).
- **Flight DD8 — stale-handle caveat.** `readAxTree`'s returned AXNodes carry `backendNodeId`/`frameId` that are **CDP-session-scoped, stale-on-detach** (`observe.js:222–224`) — informational only; **no action-by-a11y-handle this flight**. The `readAxTree` tool `description` must state this so consumers don't treat the handles as live references. The op's `depth`/`properties` opts are an **unimplemented Flight-9 stub** (`observe.js:242,246`) — **do NOT expose them** in the tool input schema (exposing an ignored param overpromises); tool input is `{ wcId }` only.
- **The 8-test regression net (DD7).** `test/unit/automation-observe.test.js` has the existing 8 `captureScreenshot` unit tests written against the old single-bag signature. **Note the actual test shape:** each passes `waitForPaint: noopWaitForPaint` inside the deps object and **none pass `delayMs`**. The refactor **must keep them green** — split each call's deps literal so `waitForPaint` moves into the new 3rd `opts` arg (`{ waitForPaint: noopWaitForPaint }`), leaving `{ fromId, chromeContents, activate }` as the 2nd. This is the contained-risk the flight calls out.

## Inputs

What exists before this leg runs:
- `src/main/automation/observe.js` — the 4 observe ops; `captureScreenshot` at `observe.js:100` with the **old** single-bag signature `(wcId, { fromId, chromeContents, activate, waitForPaint, delayMs })`; `readAxTree` already `(wcId, deps, opts)` at `observe.js:245`; the `debuggerUnavailable` refusal builder at `observe.js:37`.
- `src/main/automation/engine.js` — observe wiring at `engine.js:66–69`; line 66 has the footgun (`{ ...deps(), ...opts }`); line 69 (`readAxTree`) is already safe (`deps(), opts`).
- `src/main/automation/mcp-tools.js` (from Leg 2) — `buildToolRegistry(getEngine)` over a module-scoped `TOOLS` array of `{ name, description, inputSchema, call }`; generic `okResult`/`errResult`/`serialize` shaping; `callTool` wraps `def.call(engine, args)` in try/catch → `errResult` on throw.
- `test/unit/automation-observe.test.js` — the 8 `captureScreenshot` tests (regression net) + the readDom/captureWindow/readAxTree tests.
- `test/unit/automation-mcp-tools.test.js` (from Leg 2) — the drive-tool adapter tests to extend.

## Outputs

What exists after this leg completes:
- `src/main/automation/observe.js` — `captureScreenshot` reshaped to `(wcId, deps, opts)` (DD7); behavior otherwise identical.
- `src/main/automation/engine.js` — `engine.js:66` updated to `observe.captureScreenshot(wcId, deps(), opts)` (no spread-merge). The footgun comment at `engine.js:64–65` removed/updated.
- `src/main/automation/mcp-tools.js` — 4 observe tool defs appended to `TOOLS`; a minimal per-tool result-shaping seam so image ops emit image content (drive tools + `readDom` + `readAxTree` keep the default serialize shaping).
- `test/unit/automation-observe.test.js` — the 8 `captureScreenshot` call sites updated to the new signature; all green.
- `test/unit/automation-mcp-tools.test.js` — observe-tool cases added.

## Acceptance Criteria

- [ ] **16 tools listed.** `registry.listTools()` now returns all 16 tools — the 12 drive + the 4 observe (`captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`), named 1:1 with the engine ops, each with a `description` and valid JSON `inputSchema`.
- [ ] **Observe input schemas:**
  - `captureScreenshot` — `{ wcId: integer }` required; optional `delayMs: integer` (paint-settle tuning).
  - `captureWindow` — **no input** (no `wcId`; whole-window capture).
  - `readDom` — `{ wcId: integer }` required.
  - `readAxTree` — `{ wcId: integer }` required; **`depth`/`properties` are NOT exposed** (unimplemented Flight-9 stub). `description` carries the DD8 stale-handle caveat.
- [ ] **Image content (DD6).** `captureScreenshot` and `captureWindow` results are MCP **image content**: `{ content: [{ type: 'image', data: <the base64 PNG string the engine returned>, mimeType: 'image/png' }] }`. The base64 string is passed through unchanged (not re-encoded, not wrapped in JSON).
- [ ] **DOM content (DD6).** `readDom` → normal result, `{ url, title, html }` serialized as JSON text.
- [ ] **a11y content (DD6).** `readAxTree` success (the AXNode **array**, incl. empty `[]`) → normal JSON-text result. The **refusal object** (`{ automation: 'debugger-unavailable', reason, wcId }`) → **normal** JSON-text result (NOT `isError`) so the agent sees and reacts. No custom error mapping for `readAxTree` — both returns are normal; only throws are errors.
- [ ] **Error mapping (DD6).** A `resolveContents` throw (bad-handle/no-such-contents/internal-session) from `captureScreenshot`/`readDom`/`readAxTree`, `captureWindow`'s chrome-unavailable throw, and a **post-attach** `readAxTree` sendCommand failure all → `isError: true` results (via the Leg-2 `callTool` try/catch). The `debugger-unavailable` refusal is **never** `isError`.
- [ ] **DD7 footgun fixed.** `observe.captureScreenshot` is `(wcId, deps, opts)`; `engine.js:66` no longer spreads `opts` into the deps bag; an `opts` key cannot override injected `fromId`/`chromeContents`/`activate`. **`readAxTree`'s signature is unchanged.**
- [ ] **Regression net green.** The 8 existing `captureScreenshot` tests in `automation-observe.test.js` pass against the new signature (call sites updated). No behavior change to the capture itself (foreground→re-resolve→paint-settle→capture, base64 PNG out).
- [ ] **Engine-only reach + SDK-free adapter** preserved: observe defs call only `engine[op](...)`; `mcp-tools.js` still imports no SDK/Electron; image content is plain objects.
- [ ] **Gates green.** `npm test`, `npm run typecheck`, `npm run lint` pass. No new runtime dependency.

## Verification Steps

- **DD7 refactor**: `npm test` — `automation-observe.test.js` (incl. the 8 captureScreenshot tests) green against `(wcId, deps, opts)`; `npm run typecheck` confirms `engine.js:66`'s call matches the new signature.
- **List**: adapter test asserts 16 tool names + the observe input schemas (incl. `captureWindow` no-input, `readAxTree` no `depth`/`properties`).
- **Image shaping**: fake `captureScreenshot`/`captureWindow` return a known base64 string → result is `{ content: [{ type:'image', data: <that string>, mimeType:'image/png' }] }`, no JSON-wrapping, no `isError`.
- **readDom**: fake returns `{url,title,html}` → JSON-text normal result.
- **readAxTree**: fake returns `[{...}]` → JSON-text normal result; fake returns the `debugger-unavailable` refusal object → **normal** JSON-text result, `isError` falsy; fake **throws** `automation: internal-session` → `isError: true`.
- **Static**: `npm run typecheck`, `npm run lint` clean.

## Implementation Guidance

1. **DD7 refactor first (so the engine API is solid before the tool exposes it).**
   - In `observe.js`, change `captureScreenshot(wcId, { fromId, chromeContents, activate, waitForPaint = defaultWaitForPaint, delayMs })` → `captureScreenshot(wcId, { fromId, chromeContents, activate }, { waitForPaint = defaultWaitForPaint, delayMs } = {})`. Body unchanged. Update the JSDoc (the deps/opts split).
   - In `engine.js`, change line 66 to `captureScreenshot: (/** @type {number} */ wcId, /** @type {any} */ opts) => observe.captureScreenshot(wcId, deps(), opts)` and remove/replace the `engine.js:64–65` footgun warning comment (the footgun is gone). Keep `readAxTree` (`engine.js:69`) exactly as-is.
   - Update the 8 `captureScreenshot` call sites in `automation-observe.test.js` to pass `(wcId, deps, opts)`: move `waitForPaint` (the only tunable the tests pass — they do NOT pass `delayMs`) out of the deps object into the 3rd arg `{ waitForPaint: noopWaitForPaint }`, leaving `{ fromId, chromeContents, activate }` as the 2nd. Run the suite green before touching the tool layer.

2. **Append the 4 observe tool defs to `TOOLS` in `mcp-tools.js`.**
   - Add a minimal per-tool result-shaping seam: extend the tool def with an optional `shape(value)` that returns the full result object; `callTool` uses `def.shape ? def.shape(value) : okResult(value)` (errors still go through the existing try/catch → `errResult`). Drive tools and `readDom`/`readAxTree` use the **default** (no `shape`). Only the two image ops define `shape`.
   - `captureScreenshot`: input `{ wcId: integer, delayMs?: integer }`; `call(engine, { wcId, delayMs }) => engine.captureScreenshot(wcId, delayMs == null ? undefined : { delayMs })`; `shape(b64) => imageResult(b64)`.
   - `captureWindow`: no input; `call(engine) => engine.captureWindow()`; `shape(b64) => imageResult(b64)`.
   - `readDom`: input `{ wcId: integer }`; `call(engine, { wcId }) => engine.readDom(wcId)`; **no `shape`** (default JSON-text serialize).
   - `readAxTree`: input `{ wcId: integer }`; `call(engine, { wcId }) => engine.readAxTree(wcId)`; **no `shape`** — the default `serialize` JSON-texts both the array and the refusal object as normal results (the throws are caught upstream → `isError`). Add a comment stating WHY there is no custom mapping (refusal-is-normal, DD6). Description carries the DD8 stale-handle caveat + "addresses elements by coordinates/selectors for now".
   - `imageResult(b64) => ({ content: [{ type: 'image', data: b64, mimeType: 'image/png' }] })`. Keep it SDK-free (plain object).

3. **Extend `automation-mcp-tools.test.js`** with the observe ops: 16-tool list shape + observe schemas (captureWindow no-input, readAxTree no depth/properties); image shaping (base64 pass-through, no JSON-wrap); readDom JSON-text; readAxTree array→normal, refusal-object→normal (not isError), throw→isError; and the engine-arg mapping for captureScreenshot's `delayMs` (present → `{delayMs}`, absent → `undefined`).

## Edge Cases

- **`captureScreenshot` `delayMs` absent**: pass `undefined` (not `{}`/`{delayMs:undefined}` ambiguity is fine, but prefer `undefined` so `observe`'s `{ delayMs } = {}` default and `DEFAULT_PAINT_DELAY_MS` apply cleanly).
- **`readAxTree` empty array `[]`**: a valid success (`observe.js:271`) → normal JSON-text `[]`, not a refusal, not an error.
- **Refusal object must not be mistaken for an error**: it has no `Error` shape; the generic `callTool` only catches *thrown* errors, so a *returned* refusal naturally flows to a normal result — verify the default path does NOT set `isError` for it.
- **Post-attach sendCommand failure** (`Accessibility.enable`/`getFullAXTree` rejects after a successful attach): propagates out of `readAxTree` (it is genuinely exceptional — the debugger was available) → caught by `callTool` → `isError`. Distinct from `attach-failed`, which is a returned refusal.
- **`captureWindow` with no live chrome window**: `observe.js:188` throws `automation: chrome window unavailable` → `isError`.
- **Image data is already base64**: do not `JSON.stringify` it or re-encode; pass the string straight into `data`.

## Files Affected

- `src/main/automation/observe.js` — `captureScreenshot` → `(wcId, deps, opts)` (DD7); JSDoc.
- `src/main/automation/engine.js` — `engine.js:66` call updated; footgun comment removed. `readAxTree` (line 69) untouched.
- `src/main/automation/mcp-tools.js` — 4 observe tool defs + the `shape` seam + `imageResult`.
- `test/unit/automation-observe.test.js` — 8 `captureScreenshot` call sites updated to the new signature.
- `test/unit/automation-mcp-tools.test.js` — observe-tool adapter cases added.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (autonomous leg — do NOT commit; the Flight Director defers review + commit to the end of the flight):**

- [ ] All acceptance criteria verified (live capture/a11y over the transport is exercised in Leg 6 `verify-integration`)
- [ ] Unit tests + typecheck + lint passing (incl. the 8-test captureScreenshot regression net)
- [ ] Update flight-log.md with a Leg Progress entry (the DD7 refactor + how the 8 tests were updated; the image-content `shape` seam; the readAxTree refusal-is-normal decision)
- [ ] Set this leg's status to `landed` (NOT `completed`)
- [ ] Do NOT commit; do NOT check off the leg in flight.md yet
