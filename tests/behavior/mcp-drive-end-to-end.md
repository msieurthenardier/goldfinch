# Behavior Test: MCP surface drives the browser end to end

**Slug**: `mcp-drive-end-to-end`
**Status**: active
**Created**: 2026-06-13
**Last Run**: never

## Intent

Verify that the full Goldfinch automation surface — all 16 MCP tools (12 drive + 4 observe) — works end to end over the **loopback Streamable-HTTP transport** when driven by a real MCP client: discovery, tab lifecycle, navigation, DOM/screenshot/a11y reads, and trusted synthetic input all produce their documented observable results, and the actions really change the running browser (not just the tool's self-report). This is the SC6 acceptance for Flight 3. It needs a behavior test rather than a unit test because the contract lives in the **real Electron/Chromium runtime reached across the MCP transport** — webContents resolution, foreground-to-act capture, the in-process debugger a11y read, and synthetic input dispatch only behave correctly in the running app, and the unit tests deliberately fake the engine. The test pairs each tool's **own returned observable** (screenshot pixels, a11y array, DOM snapshot, enumerate listing) with, at the end, an **independent cross-check via the whole-window capture / visible chrome** so the suite is not purely self-referential.

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (`electron . --no-sandbox --automation-dev`) — this starts the MCP server on the loopback transport and **does NOT** open a `--remote-debugging-port`. Do **not** use `dev:debug` / the `:9222` CDP path here; that is a different apparatus.
- The MCP server is listening on **`127.0.0.1:7777`** at the `/mcp` endpoint (the SC7 loopback transport).
- An MCP client is available to connect to the `goldfinch` server: the SDK client, `scripts/mcp-example-client.mjs`, or a Claude Code MCP session pointed at the `.mcp.json` `goldfinch` entry (`http://127.0.0.1:7777/mcp`).
- The trusted-input fixture is served on a **non-CDP HTTP port** (e.g. `python3 -m http.server 8090` from `tests/behavior/fixtures/mcp-drive-end-to-end/`), reachable at `http://127.0.0.1:8090/`.
- **Apparatus note (DD9):** the measuring apparatus is the **MCP client over `127.0.0.1:7777`**, with the app launched via `npm run dev:automation`. The `chrome-devtools` MCP **does NOT qualify** — it launches its own browser, producing a false pass against a process that is not the running Goldfinch. The drive tools refuse non-`http(s)` URLs, which is why the input fixture is served over HTTP.
- **Self-reference caveat:** for most rows the action surface (an MCP tool) and the observable (that tool's return, or a sibling read tool's return) live behind the same transport. The test mitigates by (a) chaining observations across tools (drive with one tool, observe with another — e.g. navigate, then `readDom` shows the new URL), (b) judging screenshot **pixels** not merely "an image block came back", and (c) the Step-9 independent whole-window / visible-chrome cross-check.

## Observables Required

- mcp (MCP tool results over the loopback transport — JSON-text result blocks for drive/enumerate/DOM/a11y, image content blocks for screenshots; `isError` flag — measured via the MCP client connected to `127.0.0.1:7777`)
- browser (rendered tab state — the page visibly rendered in a screenshot, the a11y tree of the live page, the live DOM snapshot, and the visible Goldfinch chrome window for the cross-check)
- shell (precondition probes: fixture HTTP 200 — measured via Bash/curl)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the MCP client to `http://127.0.0.1:7777/mcp`; perform `initialize`; call `tools/list`. Also `curl http://127.0.0.1:8090/` for the fixture. | `initialize` succeeds (handshake ok). `tools/list` returns **exactly 16 tools** with these names: `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`, `captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`. The fixture returns HTTP 200. **If any fails, halt — preconditions not met.** |
| 2 | Call `openTab` with `url: "https://example.com"`. | The result is a normal JSON-text block holding a **numeric `wcId`** (an integer), **not `null`** and **not `isError`**. (Per the contract: `openTab` → the new wcId, or `null` if the URL was rejected/timed out; a number means the tab opened. Record this wcId as **A** for later steps.) |
| 3 | Call `enumerateTabs`. | The result is a JSON-text **array**; one entry has `wcId === A`, with `url`/`title` for example.com and the `{ wcId, url, title, jarId, active }` shape. The MCP-opened tab is enumerable. |
| 4 | Call `navigate` with `wcId: A, url: "https://example.com/"`, then call `readDom` with `wcId: A`. | `navigate` returns the void-op success shape `{"ok":true}` (no `isError`). `readDom` returns a JSON-text `{ url, title, html }` whose `url` is `https://example.com/` and whose `title` is ~"Example Domain" (and `html` contains "Example Domain"). The independent `readDom` confirms the navigate actually landed (cross-tool, not self-report). |
| 5 | Call `captureScreenshot` with `wcId: A`. | The result is an **image content block** (`{ type: 'image', mimeType: 'image/png', data: <base64> }`), not JSON-wrapped, not `isError`. **The Validator decodes and judges the PIXELS:** the example.com page is **visibly rendered** (the "Example Domain" heading/text is legibly on screen) — **not a blank/white frame**. (DD1 blank-capture hazard: a blank foreground capture still returns a *valid* image block, so "an image returned" is insufficient — the pixels must show the page.) |
| 6 | Call `readAxTree` with `wcId: A`. | The result is a JSON-text **array** (`Array.isArray` is true — the AXNode array; success shape per `observe.js`). It is **NOT** the `{ automation: "debugger-unavailable", reason, wcId }` refusal object and **NOT** `isError`. Do **not** require it to be non-empty — an empty `[]` is still a valid success on a sparse page; assert only "an array, the success shape, not the refusal, not an error". |
| 7 | **Trusted input (rendered echo).** Open a new tab to the fixture: `openTab` with `url: "http://127.0.0.1:8090/"` (record wcId **F**); confirm with `readDom(F)` that it loaded. Then: `click(F, x, y)` on the **CLICK ME** button; `typeText(F, "mcp-typed-hello")` into the focused input; `pressKey(F, "Enter")`. After the inputs, `captureScreenshot(F)` and `readAxTree(F)`. | The synthetic inputs land on the page and are **visibly reflected in the render** (rendered-state, not a DOM `.value` read): in the screenshot pixels and/or a11y tree the echo line shows **`ECHO: mcp-typed-hello`**, the click label shows **`CLICK: button was clicked`**, and the key label shows **`KEY: Enter pressed`** — each a value that the *initial* render did not show. This proves `click`/`typeText`/`pressKey` drove the real page. (If exact button coordinates are unknown, the Executor reads them from `readDom(F)`/`readAxTree(F)` first; the *checkpoint* is the rendered echo, not the coordinate derivation.) |
| 8 | **Tab management.** Open a second example tab: `openTab` with `url: "https://example.org"` (record wcId **B**, ends active). Call `activateTab(A)`, then `enumerateTabs`. Then `closeTab(B)`, then `enumerateTabs` again. | `activateTab(A)` returns a JSON-text **`true`** (boolean success signal — not normalized to `{"ok":true}`). The first `enumerateTabs` shows the **`active` flag on A** flipped to true (and not on B). `closeTab(B)` returns **`true`**; the second `enumerateTabs` **no longer lists B** (B's wcId is gone from the array). Tab lifecycle round-trips through enumerate. |
| 9 | **[mixed-frame] Independent cross-check (non-self-referential).** Call `captureWindow` (the 16th tool — whole-window capture, takes no input). Independently, look at the **visible Goldfinch chrome window**. | `captureWindow` returns an **image content block**; the Validator judges its pixels: the whole window shows the MCP-driven state — the foregrounded tab (A / the fixture) and a tab strip reflecting the opens/closes from Steps 2–8 — i.e. the visible browser chrome **matches** what the MCP tools reported. `[mixed-frame]` — justification: the window capture / visible chrome is an **independent** observable (not the driven tab's own self-report), so it confirms the MCP-driven actions truly changed the browser rather than the surface merely echoing success. This also exercises the 16th tool, completing all-16 coverage (drive 12 + observe 4: `captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`). |

## Out of Scope

- **Key gating / auth / audit log (Flight 4).** This spec drives the surface assuming it is reachable; it does not verify per-call key authentication or the audit trail — that is the Flight-4 half and is tested there. SC7's transport/origin guard is covered by the sibling `mcp-loopback-origin-guard` spec, not here.
- **Element-addressing ergonomics (Flight 9).** Coordinate-based `click`/`scroll` and the unimplemented `readAxTree` `depth`/`properties` projection are v1 mechanics; richer selector/element addressing is a Flight-9 concern, not asserted here.
- **The refusal contract / contended a11y / internal-session exclusion** — covered by the `observe-refusal-contract`, `internal-session-exclusion`, and `devtools-cdp-conflict` specs. This spec exercises the **happy path** of all 16 tools.

## Variants (optional)

- N/A. Could later parametrize Step 7 over additional named keys (Tab/Escape/Arrow keys) once the input path stabilizes.
