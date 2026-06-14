# Behavior Test: Observe tools honor the result/refusal/error contract

**Slug**: `observe-refusal-contract`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: never

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test observe-refusal-contract` invocation before Flight 6 as a flight-acceptance run.

## Intent

Verify the DD6/DD8 **result/refusal/error tri-state** of the observe tools across the MCP transport: a `readAxTree` whose in-process debugger cannot attach (the contents is held by another CDP client) returns the **`debugger-unavailable` refusal as a NORMAL result** (`isError` falsy) — an operational condition the agent should see and react to, *not* an error; a genuinely bad/dead/internal `wcId` returns **`isError`**; and `captureScreenshot` returns **image content** (not a JSON-wrapped string). This needs a behavior test rather than a unit test because the refusal only arises from a **real CDP attach contention** in the running app (the unit test fakes the debugger), and the contract's whole point is that an agent over the transport can discriminate "busy, retry" from "broken".

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); MCP server up on `127.0.0.1:7777`.
- An MCP client connected to `http://127.0.0.1:7777/mcp`.
- A web tab is open (control target).
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:7777`** (app via `npm run dev:automation`), plus the ability to **open Chromium DevTools on a target tab from the chrome** (the PRIMARY way to occupy the single-client CDP debugger and force `attach-failed`). Not the `:9222` CDP path; `chrome-devtools` MCP does not qualify.

## Observables Required

- mcp (MCP tool results — the JSON-text content of `readAxTree` (array vs `debugger-unavailable` object), the `isError` flag, and image content blocks; over the loopback transport)
- browser (the chrome UI to open/close DevTools on a tab — the contention trigger)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the MCP client; `initialize`; `tools/list`. | `tools/list` returns the **16** tools (incl. `readAxTree`, `captureScreenshot`). **If not, halt.** |
| 2 | **Refusal (primary trigger — DevTools open).** Open a web tab (record wcId **W**). **Open Chromium DevTools on tab W from the chrome** (this occupies the single CDP client, so the engine's on-demand attach will fail). Then call `readAxTree(W)` over MCP. | The result is a **NORMAL** result (`isError` is **falsy**) whose JSON-text content is the refusal object **`{ automation: "debugger-unavailable", reason: "attach-failed", wcId: W }`** — `reason` is `attach-failed` (another CDP client holds the contents). It is **NOT** an `isError`, and **NOT** an AXNode array. This is the DD8 contract: a contended a11y read is a first-class operational result the agent reacts to (retry / close DevTools), not a thrown error. *(The `reason: "locked"` variant needs a true concurrent in-engine race that sequential MCP calls won't reliably reproduce — list it only as an optional secondary path, not the primary assertion.)* |
| 3 | **Error (bad/dead/internal `wcId`).** Call `readAxTree` with a `wcId` that does not resolve — a never-existed integer (e.g. a very large id) or a closed tab's stale wcId. | The result is **`isError: true`** with content text containing **`automation: no-such-contents`** (or `bad-handle` if a non-integer was sent) — the resolve-time throw, distinct from the Step-2 refusal. This is the genuine-error half of the tri-state: a broken handle is an error, a busy debugger is not. |
| 4 | **Image content (not JSON-wrapped).** Call `captureScreenshot(W)` (close DevTools first if needed so the page is capturable). | The result is an **image content block** (`{ type: 'image', mimeType: 'image/png', data: <base64> }`) — **not** a JSON-text block, **not** `isError`. The base64 is passed through verbatim (DD6 image shaping). Confirms the screenshot path returns image content, the third arm of the observe contract. |

## Out of Scope

- **The DD10 recorded finding** — *whether* `attach-failed` actually occurs when DevTools is open in the **no-`--remote-debugging-port`** venue is the `devtools-cdp-conflict` spec's RECORDED finding, not a hard assertion. This spec verifies the **refusal contract SHAPE** (if a refusal arises, it has this structure and is a normal result); they share the DevTools trigger but differ in intent — **see `devtools-cdp-conflict`**.
- **The `internal-session` rejection** — covered by `internal-session-exclusion`. Here, Step 3 uses bad/dead handles to exercise the generic `isError` path, not the internal-session branch specifically.
- **A11y tree content correctness** (that the AXNodes accurately describe the page) — out of scope; this spec asserts the **result/refusal/error discrimination**, not tree fidelity.

## Variants (optional)

- N/A. Could add a `reason: "locked"` variant if a reliable concurrent-call harness is built (two simultaneous `readAxTree(W)` racing the in-engine lock).
