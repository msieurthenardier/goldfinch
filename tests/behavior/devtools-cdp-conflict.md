# Behavior Test: DevTools vs MCP a11y read — CDP single-client conflict (recorded finding)

**Slug**: `devtools-cdp-conflict`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: never

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test devtools-cdp-conflict` invocation before Flight 6 as a flight-acceptance run.

> **⚠ BLOCKED-AS-WRITTEN — affordance gap found in Flight 3 (leg `verify-integration`, 2026-06-14).** Precondition "the chrome can open Chromium DevTools on a web tab" is **currently false**: Goldfinch has **no non-CDP DevTools affordance** (no `openDevTools`, no shortcut, no menu) — the only way to open DevTools is the `--remote-debugging-port` path, which is the exact confound this spec must avoid. So this spec **cannot be run as written** until a non-CDP, `--automation-dev`-gated DevTools-open affordance exists (a future-flight feature). Until then: the `attach-failed` branch is **unit-tested only**, and the related **`locked`** refusal IS live-confirmed confound-free (see `observe-refusal-contract` / the Flight-3 flight log: concurrent `readAxTree` → one array + one `{"reason":"locked"}` normal result). When the affordance lands, run this spec to settle the `attach-failed` observation.

## Intent

**DD10 recorded finding.** Establish, in the confound-free venue (app launched **without** `--remote-debugging-port`, so the only CDP client contention is Chromium DevTools itself), **whether** opening DevTools on a tab causes the engine's MCP `readAxTree` to return the `attach-failed` refusal — and whether closing DevTools restores success. This is explicitly a **recorded finding, not a pass/fail**: Chromium's one-CDP-client-per-`webContents` behavior is what it is, and the purpose is to **observe and record** it for the flight log + the mission Open-Question closure, not to assert a required outcome. It needs a behavior test because the interaction is between two live CDP clients (DevTools and the in-process debugger) on a real `webContents` — nothing offline can observe it.

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** — **confirm there is NO `--remote-debugging-port`** in the launch (the confound-free venue; a `:9222` CDP attach would be a *third* client and muddy the finding).
- An MCP client connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- The chrome can open Chromium DevTools on a web tab.
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`** with the app launched via `npm run dev:automation` (**no CDP port**), plus opening/closing Chromium DevTools from the chrome. The `chrome-devtools` MCP **must not** be used (it launches its own browser AND adds another CDP client — double disqualification here).

## Observables Required

- mcp (the `readAxTree` MCP result — array success vs `debugger-unavailable` refusal vs `isError`; over the loopback transport)
- browser (DevTools open/closed state on the target tab — the contention condition)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Confirm the app was launched via `dev:automation` **without** `--remote-debugging-port` (check the launch command / that `:9222` is NOT listening). Connect the MCP client; `initialize`; `tools/list`. | The launch has **no** `--remote-debugging-port` (the confound-free venue). `tools/list` returns the **16** tools (incl. `readAxTree`). **If a CDP port is present or tools/list fails, halt** — the venue is confounded. |
| 2 | Open a web tab (record wcId **W**), let it load. Baseline: call `readAxTree(W)` with DevTools **closed**. | Baseline succeeds: `readAxTree(W)` returns a JSON-text **array** (`Array.isArray`), not `isError`, not the refusal. (Establishes that absent contention, the a11y read works — so any later refusal is attributable to DevTools.) *(If the baseline itself does not return an array, RECORD that — it is itself a finding about the venue.)* |
| 3 | **Open Chromium DevTools on tab W** (from the chrome). Then call `readAxTree(W)` over MCP. | **RECORD the outcome** — do not assert a required result. Capture exactly which of these occurred: (a) the `{ automation: "debugger-unavailable", reason: "attach-failed", wcId: W }` refusal (a normal result), (b) a successful AXNode array (no conflict — DevTools and the in-process debugger coexisted), or (c) an `isError`. The run log notes the observed behavior verbatim for the flight log + the mission Open-Question closure. **The Expected Result is "the outcome is recorded", never "must return attach-failed".** |
| 4 | **Close DevTools** on tab W. Then call `readAxTree(W)` again over MCP. | `readAxTree(W)` returns a JSON-text **array** again (success restored once the competing CDP client released the contents) — i.e. the conflict, if any, was transient and tied to DevTools being open. **RECORD** if it does not restore (also a finding). |

## Out of Scope

- **The refusal-contract SHAPE** (that a `debugger-unavailable` result is a normal result with `reason`/`wcId`, that bad handles are `isError`, that screenshots are image content) — that contract is verified by **`observe-refusal-contract`**; this spec only **records** whether the DevTools-open condition triggers it in the no-CDP-port venue.
- **The `--remote-debugging-port` / `:9222` venue** — deliberately excluded (it would add a confounding third CDP client). DD10 is scoped to the `dev:automation` venue.
- Pass/fail gating of the flight on the outcome — this is a finding, not an acceptance gate; Flight 3's acceptance is `mcp-drive-end-to-end` + `mcp-loopback-origin-guard`.

## Variants (optional)

- N/A. Could later record the same interaction in the `dev:debug` venue as a contrast (knowing it is confounded by the `:9222` client), purely to characterize the layered behavior.
