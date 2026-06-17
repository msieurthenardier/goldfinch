# Leg: run-devtools-cdp-conflict

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Now that leg 2's `openDevTools`/`closeDevTools` MCP tools provide the **non-CDP DevTools-open affordance** the `devtools-cdp-conflict` spec was blocked on, update the spec's apparatus (DD6), **run it confound-free** over `dev:automation`, **record** the `readAxTree`-under-DevTools outcome (expected `attach-failed`; `closeDevTools` restores success), then **archive** the spec and **close the mission Open-Question**.

## Context
- **DD6 — this is a recorded FINDING, not pass/fail** (the spec self-describes that way). Chromium's one-CDP-client-per-`webContents` behavior is observed and recorded; the purpose is the flight-log entry + the mission Open-Question closure, not a required outcome.
- **Unblocked by leg 2.** The spec's BLOCKED-AS-WRITTEN warning was gated solely on the missing non-CDP DevTools-open affordance; leg 2 landed `openDevTools`/`closeDevTools` (a `webContents` method, no `--remote-debugging-port`) → confound-free. `evaluate`/`injectScript` are unaffected by DevTools (they use `executeJavaScript`), but `readAxTree` attaches `webContents.debugger` (`cdp.js withDebuggerSession`), so with a DevTools CDP client already on the tab the attach should throw → `withDebuggerSession` returns the `attach-failed` normal result.
- **FD-orchestrated (skill + mission standard).** Behavior-test legs are run by the FD, not a Developer agent. The mission's accepted standard is **FD-driven runs with cited machine-read evidence** (the two-agent Witnessed pattern is available at operator election for high-stakes/first-run specs). For a recorded-finding spec, an FD-driven run capturing the verbatim MCP results is appropriate.
- **Lightweight leg** — no implementation cycle, no Developer design review. The only code-adjacent change is the spec text (DD6) + the run log; the source affordance already landed in leg 2.
- **Depends on leg 2** (openDevTools/closeDevTools live).

## Inputs
- `tests/behavior/devtools-cdp-conflict.md` (`Status: draft`, BLOCKED-AS-WRITTEN): Step 1 halts on `tools/list` returning exactly `16` (`:35` — stale; now 21 post-legs 1-2); Step 3 action "Open Chromium DevTools on tab W (from the chrome)" (`:37`); Step 4 "Close DevTools" (`:38`); precondition "The chrome can open Chromium DevTools on a web tab" (`:22`); apparatus note (`:24`).
- Leg 2's `openDevTools`/`closeDevTools` MCP tools (registry 21); `readAxTree` (`cdp.js withDebuggerSession` → `attach-failed` on a competing CDP client).
- The dogfooding recipe: `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` → admin key (DevTools on a guest needs the jar key; or admin) → `Authorization: Bearer`; `scripts/lib/mcp-client.mjs` (leg 3) for the FD-driven driver.
- Mission Open-Question: the CDP single-client-per-contents `attach-failed` observation (mission.md Open-Questions / F3 DD10 finding) — to be closed by this run.

## Outputs
- `tests/behavior/devtools-cdp-conflict.md` updated (DD6 apparatus: `openDevTools`/`closeDevTools` over MCP; count halt `=== 16` → `>= 21` / presence-based; BLOCKED warning resolved) and **archived** (`Status: archived`, `Last Run` set).
- A run log at `tests/behavior/devtools-cdp-conflict/runs/{ts}.md` recording the observed outcome.
- The mission Open-Question on the `attach-failed` conflict **closed** (annotated with the run result).
- Flight-log entry with the verbatim finding.

## Acceptance Criteria
- [x] **AC1 — spec apparatus updated (DD6).** Step 3 action = "call `openDevTools(W)` over MCP"; Step 4 = "call `closeDevTools(W)` over MCP"; the precondition + apparatus note reference the `openDevTools` MCP tool (the non-CDP, non-UI affordance from F9 DD3); the Step-1 count halt becomes `>= 21` (or presence of `readAxTree`/`openDevTools`/`closeDevTools`), not `=== 16`; the BLOCKED-AS-WRITTEN warning is resolved (annotated unblocked by F9 leg 2). `grep -n "16 tools\|=== 16\|Open Chromium DevTools\|chrome can open" tests/behavior/devtools-cdp-conflict.md` returns nothing stale.
- [x] **AC2 — run executed confound-free.** (Done live: `dev:automation` on `:52347`, `:9222` clear, 21 tools; baseline array → openDevTools ok → readAxTree → closeDevTools ok → array. Run NOT deferred.) The app is launched via `dev:automation` with **no** `--remote-debugging-port` (`:9222` not listening); the run performs: baseline `readAxTree(W)` (DevTools closed) → array; `openDevTools(W)`; `readAxTree(W)` → **record outcome**; `closeDevTools(W)`; `readAxTree(W)` → array (restored). *(If no GUI display is available to the FD this run, the run is deferred to the verify/HAT leg 8 and that deferral is recorded — DevTools-open needs a display.)*
- [x] **AC3 — finding recorded.** (Run log written; finding = `attach-failed` NOT reproduced live, inconclusive/WSLg-limited.) A run log captures the verbatim outcomes (esp. Step 3 — `attach-failed` refusal vs. coexistence vs. `isError`) and the restore. The finding is summarized in the flight log.
- [x] **AC4 — spec archived + mission OQ closed.** (Spec `Status: archived`, `Last Run` set; mission OQ annotated with the F9 closure + inconclusive disposition.) Spec `Status: archived`; the mission Open-Question on the CDP `attach-failed` conflict annotated closed with the run result + date.
- [x] **AC5 — gates unaffected.** (No source change — spec + artifact md edits only; the 781-test suite from leg 4 is unaffected. FD to re-confirm `npm test`/typecheck/lint in the leg-8 verify gate.) `npm test`/typecheck/lint remain green (no source change in this leg; spec + artifact edits only).

## Verification Steps
- `grep -n "=== 16\|16 tools\|Open Chromium DevTools\|chrome can open Chromium" tests/behavior/devtools-cdp-conflict.md` — nothing.
- Run log exists at `tests/behavior/devtools-cdp-conflict/runs/{ts}.md` with the per-step outcomes.
- Spec header `Status: archived`, `Last Run` set.
- Mission OQ annotated closed.

## Implementation Guidance
1. **Update the spec (DD6)** — FD edit (small, targeted):
   - Resolve the BLOCKED-AS-WRITTEN block: annotate that F9 leg 2's `openDevTools`/`closeDevTools` MCP tools are the non-CDP affordance the spec was blocked on → now runnable.
   - Precondition "The chrome can open Chromium DevTools on a web tab" → "DevTools can be opened/closed via the `openDevTools`/`closeDevTools` MCP tools (the non-CDP, non-UI affordance — F9 DD3)."
   - Apparatus note: add that DevTools is driven via the `openDevTools`/`closeDevTools` MCP tools (still: no `--remote-debugging-port`, no `chrome-devtools` MCP).
   - Observables: DevTools open/closed state is now driven/observed via the MCP tools (mcp observable), not a chrome UI affordance.
   - Step 1: `tools/list returns the 16 tools` → `returns >= 21 tools (incl. readAxTree, openDevTools, closeDevTools)` — presence-based, not a brittle exact count.
   - Step 3 action: "Open Chromium DevTools on tab W (from the chrome)" → "call `openDevTools(W)` over MCP". Keep the RECORD-the-outcome Expected Result verbatim.
   - Step 4 action: "Close DevTools on tab W" → "call `closeDevTools(W)` over MCP".
2. **Run it (FD-driven; or `/behavior-test devtools-cdp-conflict` Witnessed at operator election).** Launch `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; confirm `:9222` is NOT listening (confound-free). Drive via `scripts/lib/mcp-client.mjs`: open/find a web tab (wcId W, a jar guest — DevTools on a guest works with the jar key; admin also works), baseline `readAxTree(W)`, `openDevTools(W)`, `readAxTree(W)` (record), `closeDevTools(W)`, `readAxTree(W)` (restore). Capture each result verbatim.
3. **Write the run log** at `tests/behavior/devtools-cdp-conflict/runs/{ts}.md` per the ARTIFACTS.md run-log format. Evidence (if any) → the ephemeral `/tmp/behavior-tests/goldfinch/devtools-cdp-conflict/{ts}/` path (never committed).
4. **Archive + close.** Set spec `Status: archived`, `Last Run: {ts}`. Annotate the mission Open-Question closed with the observed result + date (annotate at the OQ entry — do not rewrite the body).
5. **Disposition if no display:** record the spec update as done and defer the *run* to leg 8 (verify-integration/HAT), which has the display + dogfood-run remit. Do not fabricate a run.

## Edge Cases
- **`openDevTools` headless** — no display → DevTools cannot open; the conflict can't be staged. Defer the run (AC2 escape hatch), don't fake it.
- **DevTools on a guest vs. internal** — use a normal web guest tab (W). The internal `goldfinch://settings` is excluded from `openDevTools` even for admin (leg 2) — not the target here.
- **`attach-failed` vs coexistence** — RECORD whichever occurs; the spec is explicitly a finding. If DevTools and the in-process debugger coexist (no conflict), that is itself the recorded finding.
- **Restore step** — if `readAxTree` does not restore after `closeDevTools`, record that too (a finding about the contention's persistence).

## Files Affected
- `tests/behavior/devtools-cdp-conflict.md` — DD6 apparatus update + archive.
- `tests/behavior/devtools-cdp-conflict/runs/{ts}.md` — new run log.
- `missions/03-automation-surface/mission.md` — annotate the relevant Open-Question closed (at the entry, not a body rewrite).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to flight end per `/agentic-workflow`.)*

- [ ] Spec apparatus updated (DD6) + archived
- [ ] Run executed + run log written (or run deferred to leg 8 with rationale)
- [ ] Mission Open-Question annotated closed
- [ ] Flight-log entry with the finding
- [ ] Set this leg's status to `landed`; check off in flight.md
