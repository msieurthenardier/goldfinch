# Behavior Test: Observe tools honor the result/refusal/error contract

**Slug**: `observe-refusal-contract`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: 2026-07-08-19-00-59 (partial — see `observe-refusal-contract/runs/2026-07-08-19-00-59.md`)

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test observe-refusal-contract` invocation before Flight 6 as a flight-acceptance run.

## Intent

Verify the DD6/DD8 **result/refusal/error tri-state** of the observe tools across the MCP transport: a `readAxTree` whose in-process debugger cannot attach (the contents is held by another CDP client) returns the **`debugger-unavailable` refusal as a NORMAL result** (`isError` falsy) — an operational condition the agent should see and react to, *not* an error; a genuinely bad/dead/internal `wcId` returns **`isError`**; and `captureScreenshot` returns **image content** (not a JSON-wrapped string). This needs a behavior test rather than a unit test because the refusal only arises from a **real CDP attach contention** in the running app (the unit test fakes the debugger), and the contract's whole point is that an agent over the transport can discriminate "busy, retry" from "broken".

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); MCP server up on `127.0.0.1:$GOLDFINCH_MCP_PORT`.
- An MCP client connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- A web tab is open (control target).
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`** (app via `npm run dev:automation`), plus the ability to **open Chromium DevTools on a target tab from the chrome** (the PRIMARY way to occupy the single-client CDP debugger and force `attach-failed`). Not the `:9222` CDP path; `chrome-devtools` MCP does not qualify.

## Observables Required

- mcp (MCP tool results — the JSON-text content of `readAxTree` (array vs `debugger-unavailable` object), the `isError` flag, and image content blocks; over the loopback transport)
- browser (the chrome UI to open/close DevTools on a tab — the contention trigger)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the MCP client; `initialize`; `tools/list`. | `tools/list` **includes the tools this spec drives**: `readAxTree`, `captureScreenshot` (presence-checked, not an exact count — the registry total grows independently). **If any are absent, halt.** |
| 2 | **DevTools-open observation.** Open a web tab (record wcId **W**). **Open Chromium DevTools on tab W from the chrome**, confirm it is genuinely open, then call `readAxTree(W)` over MCP. | **RECORD the native outcome; either of the sibling conflict spec's established results is valid.** If DevTools owns the single debugger client, the result is a **NORMAL** result (`isError` falsy) containing **`{ automation: "debugger-unavailable", reason: "attach-failed", wcId: W }`** — not an error and not an AXNode array. If detached DevTools does not contend for this attach path, the result is a successful AXNode array — also not an error. In either case, the observed outcome must match `devtools-cdp-conflict.md`; do not manufacture contention. The refusal branch, when it occurs, pins the DD8 shape. *(The `reason: "locked"` variant needs a true concurrent in-engine race and remains optional.)* |
| 3 | **Error (bad/dead/internal `wcId`).** Call `readAxTree` with a `wcId` that does not resolve — a never-existed integer (e.g. a very large id) or a closed tab's stale wcId. | The result is **`isError: true`** with content text containing **`automation: no-such-contents`** (or `bad-handle` if a non-integer was sent) — the resolve-time throw, distinct from the Step-2 refusal. This is the genuine-error half of the tri-state: a broken handle is an error, a busy debugger is not. |
| 4 | **Image content (not JSON-wrapped).** Call `captureScreenshot(W)` (close DevTools first if needed so the page is capturable). | The result is an **image content block** (`{ type: 'image', mimeType: 'image/png', data: <base64> }`) — **not** a JSON-text block, **not** `isError`. The base64 is passed through verbatim (DD6 image shaping). Confirms the screenshot path returns image content, the third arm of the observe contract. |

## Out of Scope

- **Forcing a particular DD10 finding** — *whether* `attach-failed` actually occurs when DevTools is open in the **no-`--remote-debugging-port`** venue is recorded, not forced. This spec cross-checks that observation and verifies the **refusal contract SHAPE** if a refusal arises; see `devtools-cdp-conflict`.
- **The `internal-session` rejection** — covered by `internal-session-exclusion`. Here, Step 3 uses bad/dead handles to exercise the generic `isError` path, not the internal-session branch specifically.
- **A11y tree content correctness** (that the AXNodes accurately describe the page) — out of scope; this spec asserts the **result/refusal/error discrimination**, not tree fidelity.

## Variants (optional)

- N/A. Could add a `reason: "locked"` variant if a reliable concurrent-call harness is built (two simultaneous `readAxTree(W)` racing the in-engine lock).
