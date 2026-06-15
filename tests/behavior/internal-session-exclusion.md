# Behavior Test: Internal session is excluded from the automation surface

**Slug**: `internal-session-exclusion`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: never

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test internal-session-exclusion` invocation before Flight 6 as a flight-acceptance run.

## Intent

Verify the DD5 load-bearing security guard across the MCP transport: the privileged **internal session** (`goldfinch://settings`) is invisible to and undrivable by the automation surface. `enumerateTabs` never lists the internal guest, **and** — the bypass-closing part — a directly-supplied internal-guest `wcId` handed to any drive/observe tool is **rejected at resolve time** with an `internal-session` `isError`, never executed. A normal web tab is the control. This needs a behavior test rather than a unit test because the guard's value is that it holds **across the real transport** on the **real internal session** (`wc.session.__goldfinchInternal === true`) — the unit test (`resolve.js`) proves the predicate, but only the running app proves the internal session is genuinely marked and the guard genuinely fires when the wcId arrives over MCP.

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); MCP server up on `127.0.0.1:7777`.
- An MCP client connected to `http://127.0.0.1:7777/mcp`.
- A way to obtain the internal guest's `wcId` **out of band** (it is deliberately not enumerable — see Step 4's apparatus note). The internal Settings tab is openable from the chrome (kebab ⋮ → Settings).
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:7777`** (app via `npm run dev:automation`), plus an **out-of-band readback** for the internal wcId (Step 4). Not the `:9222` CDP path; `chrome-devtools` MCP does not qualify (own browser → false pass).

## Observables Required

- mcp (MCP tool results — the `enumerateTabs` array, and the `isError` + error message text from drive/observe calls; over the loopback transport)
- browser (the chrome UI to open Settings; the rendered Settings stub as confirmation the internal tab exists)
- diagnostic (an out-of-band readback of the internal guest's webContents id — see Step 4; this is a deliberate diagnostic channel, used only to obtain a handle the surface intentionally withholds)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the MCP client; `initialize`; `tools/list`. | `tools/list` returns the **16** tools. **If not, halt.** |
| 2 | In the running chrome, open the kebab (⋮) menu and select **Settings** so `goldfinch://settings` opens in its own internal-session tab. | A tab opens to `goldfinch://settings` and renders the settings stub (e.g. "Settings — coming soon" / `<h1>Settings</h1>`). The internal guest now exists. *(setup — confirms the internal tab is live)* |
| 3 | Call `enumerateTabs` via MCP. | The returned array **does NOT** include the `goldfinch://settings` internal guest — no entry has a `goldfinch://` url; the internal session is filtered from enumeration. (Any normal web tabs are still listed.) |
| 4 | **Obtain the internal guest's `wcId` out of band**, then call drive/observe tools on it. *How to get the wcId (name the apparatus so the step does not stall):* it is deliberately **not** in `enumerateTabs`, so read it from a diagnostic channel of the **running app** — e.g. the dev-seam / `--automation-dev` debug readback that lists ALL webContents (including internal) with their ids, or a main-process log/inspector that prints the internal guest's `webContents.id` when the Settings tab opens. Take that internal `wcId` (call it **I**) and call, over MCP: `navigate(I, "https://example.com")`, `readDom(I)`, `captureScreenshot(I)`, `readAxTree(I)`. | **Each** of the four calls returns **`isError: true`** whose content text contains **`automation: internal-session`** (the `resolve.js` internal-session throw: "wcId I belongs to the internal goldfinch://settings session and cannot be driven"). The internal tab is **never navigated, read, captured, or a11y-read** — the guard fires at resolve time, **before** any activate/execute. (Closing the bypass: exclusion-from-enumerate alone is not enough; a directly-supplied wcId must also be rejected.) |
| 5 | **Control.** Take a normal **web** tab's `wcId` (from `enumerateTabs`, call it **W**) and call the same four tools: `navigate(W, "https://example.com")`, `readDom(W)`, `captureScreenshot(W)`, `readAxTree(W)`. | All four **succeed** (no `isError`): `navigate`→`{"ok":true}`, `readDom`→`{ url, title, html }`, `captureScreenshot`→image content, `readAxTree`→an array. Confirms the Step-4 rejections are the **internal-session guard** specifically, not a tool/transport failure. |

## Out of Scope

- **The internal-scheme web-reachability boundary** (a hostile page cannot navigate to / embed / `fetch` `goldfinch://`) — that is covered by `tab-scheme-guard` (steps 8–13). This spec is the **automation-surface** exclusion (`resolveContents` across the MCP transport), a different enforcement point.
- The internal session's CSP / partition isolation internals — out of scope; here we assert only enumerate-exclusion + resolve-time rejection.
- `bad-handle` / `no-such-contents` rejection paths — those are the `observe-refusal-contract` spec's `isError` cases; this spec isolates the **`internal-session`** path.

## Variants (optional)

- N/A. Could parametrize Step 4 over the full tool set (every drive op) once the resolve-time guard is confirmed for the four representatives.
