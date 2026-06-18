# Behavior Test: DevTools vs MCP a11y read — CDP single-client conflict (recorded finding)

**Slug**: `devtools-cdp-conflict`
**Status**: archived
**Created**: 2026-06-13
**Last Run**: 2026-06-17-16-25-30 — [run log](./devtools-cdp-conflict/runs/2026-06-17-16-25-30.md)

> **ARCHIVED (Flight 9, leg `run-devtools-cdp-conflict`, 2026-06-17).** The affordance gap that blocked this spec is closed (leg 2's `openDevTools`/`closeDevTools` MCP tools) and the spec was **run confound-free** — the recorded finding is captured (see Last Run). **Outcome: the expected `attach-failed` conflict did NOT reproduce live** — `readAxTree` succeeded with DevTools "open" — but **inconclusively**, because under WSLg the detached DevTools window did not cleanly materialize (so a competing CDP client may not have been genuinely established). The `attach-failed` branch therefore remains **unit-tested-only**; a definitive live observation needs a non-WSLg display. Spec archived as a recorded finding (not pass/fail); reopen only if a future flight wants the definitive observation on a real display.

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test devtools-cdp-conflict` invocation before Flight 6 as a flight-acceptance run.

> **✅ UNBLOCKED (Flight 9 / leg `devtools-tool` + `run-devtools-cdp-conflict`, 2026-06-17).** The affordance gap that blocked this spec is closed: Flight 9 leg 2 landed the **`openDevTools`/`closeDevTools` MCP tools** — a `webContents`-method affordance (NO `--remote-debugging-port`, NO chrome UI), exactly the non-CDP, confound-free DevTools-open mechanism this spec needed. Step 3/4 now drive DevTools via those MCP tools. The spec is run here (leg `run-devtools-cdp-conflict`), the finding recorded, and the spec then **archived**.
>
> *(Historical: it was BLOCKED-AS-WRITTEN from Flight 3 — Goldfinch had no non-CDP DevTools affordance, the only DevTools-open path being `--remote-debugging-port`, the exact confound this spec must avoid; F7 confirmed the `:9222` Origin hardening was unrelated and carried the unblock to "F8-eval" = Flight 9.)*

## Intent

**DD10 recorded finding.** Establish, in the confound-free venue (app launched **without** `--remote-debugging-port`, so the only CDP client contention is Chromium DevTools itself), **whether** opening DevTools on a tab causes the engine's MCP `readAxTree` to return the `attach-failed` refusal — and whether closing DevTools restores success. This is explicitly a **recorded finding, not a pass/fail**: Chromium's one-CDP-client-per-`webContents` behavior is what it is, and the purpose is to **observe and record** it for the flight log + the mission Open-Question closure, not to assert a required outcome. It needs a behavior test because the interaction is between two live CDP clients (DevTools and the in-process debugger) on a real `webContents` — nothing offline can observe it.

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** — **confirm there is NO `--remote-debugging-port`** in the launch (the confound-free venue; a `:9222` CDP attach would be a *third* client and muddy the finding).
- An MCP client connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (with `Authorization: Bearer <key>`).
- DevTools can be opened/closed on a web tab via the **`openDevTools`/`closeDevTools` MCP tools** (the non-CDP, non-UI affordance from Flight 9 / DD3 — a `webContents` method, no `--remote-debugging-port`).
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`** with the app launched via `npm run dev:automation` (**no CDP port**), driving DevTools open/close via the **`openDevTools`/`closeDevTools` MCP tools**. The `chrome-devtools` MCP **must not** be used (it launches its own browser AND adds another CDP client — double disqualification here).

## Observables Required

- mcp (the `readAxTree` MCP result — array success vs `debugger-unavailable` refusal vs `isError`; and the `openDevTools`/`closeDevTools` results `{"ok":true}`; over the loopback transport)
- browser (DevTools open/closed state on the target tab — the contention condition, driven via the `openDevTools`/`closeDevTools` MCP tools)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Confirm the app was launched via `dev:automation` **without** `--remote-debugging-port` (check the launch command / that `:9222` is NOT listening). Connect the MCP client (Bearer key); `initialize`; `tools/list`. | The launch has **no** `--remote-debugging-port` (the confound-free venue). `tools/list` returns **>= 21** tools, **including `readAxTree`, `openDevTools`, and `closeDevTools`** (presence-checked, not an exact count). **If a CDP port is present or those tools are absent / tools/list fails, halt** — the venue is confounded. |
| 2 | Open a web tab (record wcId **W**), let it load. Baseline: call `readAxTree(W)` with DevTools **closed**. | Baseline succeeds: `readAxTree(W)` returns a JSON-text **array** (`Array.isArray`), not `isError`, not the refusal. (Establishes that absent contention, the a11y read works — so any later refusal is attributable to DevTools.) *(If the baseline itself does not return an array, RECORD that — it is itself a finding about the venue.)* |
| 3 | **Call `openDevTools(W)` over MCP** (opens detached DevTools — the non-CDP affordance; expect `{"ok":true}`). Then call `readAxTree(W)` over MCP. | **RECORD the outcome** — do not assert a required result. Capture exactly which of these occurred: (a) the `{ automation: "debugger-unavailable", reason: "attach-failed", wcId: W }` refusal (a normal result), (b) a successful AXNode array (no conflict — DevTools and the in-process debugger coexisted), or (c) an `isError`. The run log notes the observed behavior verbatim for the flight log + the mission Open-Question closure. **The Expected Result is "the outcome is recorded", never "must return attach-failed".** |
| 4 | **Call `closeDevTools(W)` over MCP** (expect `{"ok":true}`). Then call `readAxTree(W)` again over MCP. | `readAxTree(W)` returns a JSON-text **array** again (success restored once the competing CDP client released the contents) — i.e. the conflict, if any, was transient and tied to DevTools being open. **RECORD** if it does not restore (also a finding). |

## Out of Scope

- **The refusal-contract SHAPE** (that a `debugger-unavailable` result is a normal result with `reason`/`wcId`, that bad handles are `isError`, that screenshots are image content) — that contract is verified by **`observe-refusal-contract`**; this spec only **records** whether the DevTools-open condition triggers it in the no-CDP-port venue.
- **The `--remote-debugging-port` / `:9222` venue** — deliberately excluded (it would add a confounding third CDP client). DD10 is scoped to the `dev:automation` venue.
- Pass/fail gating of the flight on the outcome — this is a finding, not an acceptance gate; Flight 3's acceptance is `mcp-drive-end-to-end` + `mcp-loopback-origin-guard`.

## Variants (optional)

- N/A. Could later record the same interaction in the `dev:debug` venue as a contrast (knowing it is confounded by the `:9222` client), purely to characterize the layered behavior.
