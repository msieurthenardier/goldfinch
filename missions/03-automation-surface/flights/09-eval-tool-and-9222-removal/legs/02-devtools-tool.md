# Leg: devtools-tool

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Add two MCP tools — `openDevTools({wcId})` and `closeDevTools({wcId})` — that call `webContents.openDevTools({mode:'detach'})` / `webContents.closeDevTools()` (synchronous/void → `{"ok":true}`), jar-scoped for guests and admin-only for the chrome, so an external/admin client can open DevTools over MCP and so the `devtools-cdp-conflict` spec (leg 5) has the **non-CDP DevTools-open affordance** it was blocked on.

## Context
- **DD3 — `openDevTools`/`closeDevTools`, `{mode:'detach'}` (WSLg-friendly), same gating as the eval tools.** A `webContents` method (NOT `--remote-debugging-port`), so it is **confound-free** for `devtools-cdp-conflict` — exactly the affordance gap the mission's recorded finding was waiting on (mission Open-Questions, F3 DD10). `{mode:'detach'}` (separate OS window) is preferred under WSLg over the default docked mode (less compositor interference, more predictable).
- **DD3/DD6 — the intended conflict.** Opening DevTools establishes a CDP client on the tab, so a concurrent `readAxTree` (which `withDebuggerSession` → `wc.debugger.attach`) surfaces `attach-failed` — the **recorded finding** (leg 5/DD6), NOT a regression. **`evaluate`/`injectScript` are unaffected** (they use `executeJavaScript`, not the debugger) and keep working under DevTools — a positive capability distinction worth preserving in the tool descriptions.
- **DD3 optional — `isDevToolsOpened()` getter: SKIPPED (design-review decision).** Leg 5's `devtools-cdp-conflict` spec restore check is **behavioral** — `readAxTree(W)` succeeding again *is* the deterministic "restored after close" signal; it never needs a boolean DevTools-state probe. Omitting it keeps the registry at **21** (not 22) and avoids a tool with no consumer. (YAGNI.)
- **DD2b — tool count.** This leg takes the registry **19 → 21** (leg 1 already took 17 → 19). Update every static count consumer to 21. (The `tests/behavior/devtools-cdp-conflict.md` Step-1 `=== 16` self-halt is **leg 5's** responsibility per DD2b — not this leg.)
- **Security — internal-session exclusion even for admin (apply the leg-1 precedent + the mission's hard rule).** The mission's carried-in hard rule: *"any `webContents.debugger` attach MUST skip the internal session."* `openDevTools` establishes a CDP client on the tab (functionally a debugger attach), so opening DevTools on the `goldfinch://settings` internal guest is a privilege-escalation surface onto the privileged `goldfinchInternal` bridge. **This leg refuses DevTools on the internal session even for admin** (the same FINAL `isInternalContents(wc)` refusal leg 1 established for eval), consistent with both the leg-1 HIGH guard and the debugger-attach-skip-internal rule. The `devtools-cdp-conflict` spec runs on a **regular jar tab**, so excluding the internal session does not block it. **This is the leg's key design-review question** (confirm the stance is right vs. a narrower "admin may DevTools the chrome but not the internal guest" reading).

## Inputs
What exists before this leg runs (branch `flight/9-eval-tool-and-9222-removal`, leg 1 landed in the working tree):
- `src/main/automation/engine.js` — dispatch keys incl. the leg-1 `evaluate`/`injectScript` (`engine.js:79-80`); `getChromeTarget` admin op (`engine.js:81-86`); `deps()` carrying `allowInternal` + `fromPartition`.
- `src/main/automation/observe.js` — the eval ops exemplar: resolve → (optional) `classifyContents`-guest activate → re-resolve → **FINAL `isInternalContents(wc)` refusal** → act (`observe.js:319` `evaluate`, `:375` `injectScript`); `module.exports` (`observe.js:386`). `isInternalContents` imported from `resolve.js` (`observe.js:3`).
- `src/main/automation/resolve.js` — `resolveContents`/`resolveContentsForJar`/`isInternalContents` (unchanged from leg 1).
- `src/main/automation/scope.js` — `WCID_FIRST_OPS` (`scope.js:37`, now includes `evaluate`/`injectScript`); facade loop (`scope.js:105`); admin bypass (`scope.js:60` `if (identity === 'admin') return engine`); admin-only refusals for `captureWindow` (`scope.js:131`) / `getChromeTarget` (`scope.js:150`); `module.exports = { scopeEngine, WCID_FIRST_OPS }` (`scope.js:158`).
- `src/main/automation/mcp-tools.js` — registry now 19 tools (`DRIVE_TOOLS`/`OBSERVE_TOOLS`/`CHROME_TOOLS`, `TOOLS = [...]`); `ToolDef` typedef; default JSON-text serialization (void → `{"ok":true}`).
- `src/main/automation/mcp-server.js:321` — JSDoc tool count (now 19).
- `test/unit/automation-mcp-tools.test.js` (count now 19), `test/unit/automation-mcp-server.test.js` (`EXPECTED_TOOL_COUNT` now 19), `test/unit/automation-scope.test.js` (parameterizes over `WCID_FIRST_OPS`).
- `docs/mcp-automation.md`, `CLAUDE.md` — tool counts now 19.

## Outputs
- `openDevTools` + `closeDevTools` engine ops **appended to `src/main/automation/observe.js`** (design-review decision — co-locate with the eval ops, which already share the resolve → FINAL-internal-refusal skeleton; `observe.js`'s header already documents that a write (`injectScript`) and a debugger op (`readAxTree`) live there, so the filename is historical), dispatched via `engine.js`.
- MCP tool defs registered; `WCID_FIRST_OPS` += both; registry **19 → 21**.
- Unit tests for dispatch + the internal-session refusal + the `deriveAuditDetail` `nullOps` entry.
- Doc updates (count 19 → 21; new tool rows; the DevTools/eval capability distinction).

## Acceptance Criteria
- [x] **AC1 — `openDevTools` op.** (unit-testable half verified: op calls `wc.openDevTools({mode:'detach'})` on the resolved contents and returns the void contract; the visual "detached window appears" half is deferred to the verify/HAT leg — no GUI display here.) `openDevTools(wcId)` resolves the target, runs the FINAL `isInternalContents(wc)` refusal, then `wc.openDevTools({ mode: 'detach' })`, and returns `{"ok":true}` (void contract). **Unit-testable half:** the op calls `wc.openDevTools({mode:'detach'})` with the resolved contents and returns the void contract (fake `wc` records the call). **The visual half** ("a detached DevTools window actually appears") is a **live/HAT check, not an `npm test` gate** — do not write a brittle assertion for it.
- [x] **AC2 — `closeDevTools` op.** `closeDevTools(wcId)` resolves the target, runs the FINAL `isInternalContents(wc)` refusal, then `wc.closeDevTools()`, returns `{"ok":true}`. **Idempotent no-op when not open** — `wc.closeDevTools()` on a closed DevTools is a no-op in Electron (does not throw); the op contract is the same (no special error path). Test that calling close without a prior open still returns `{"ok":true}`.
- [x] **AC3 — gating.** (both ops in `WCID_FIRST_OPS`; the scope test parameterizes over the set, so jar membership / out-of-jar / chrome / internal exclusion is auto-covered.) Both ops are in `WCID_FIRST_OPS`: a jar key is membership-checked via `resolveContentsForJar` (out-of-jar / chrome / internal refused) before the op; admin reaches a guest and the chrome target. Internal session refused **even for admin** (AC4).
- [x] **AC4 — [HIGH] internal-session refusal even for admin.** (two named `[HIGH]` unit tests: `allowInternal:true` → refused with the distinct messages, DevTools NOT opened/closed.) Both ops call `isInternalContents(wc)` and refuse (`automation: openDevTools — internal-session excluded`, analogous for close) before opening DevTools, regardless of `allowInternal` — because `openDevTools` establishes a CDP client and the mission rule forbids a debugger client on the internal session. Pinned by a named unit test (`allowInternal:true` → refused, DevTools NOT opened).
- [x] **AC5 — registry 19 → 21, all static counts caught.** (verification grep returns nothing; `deriveAuditDetail` needed no code change — `nullOps` test list extended.) `tools.length === 21` in the registry test; `EXPECTED_TOOL_COUNT` → 21 (`automation-mcp-server.test.js:26`); `mcp-server.js:321` JSDoc; `mcp-tools.js` count comments (`:399`); `docs/mcp-automation.md` (intro count `:19` + "All N" line `:219` + a new `### DevTools tools (2)` section) + `CLAUDE.md` breakdown (`:167`, +2 devtools). Verification grep for `19 tools`/`EXPECTED_TOOL_COUNT = 19`/`the 19 tools` returns nothing.
  - **`deriveAuditDetail` (`mcp-server.js:79-123`)**: the new void ops correctly fall to `default → null` (wcId already names the target, like `closeTab`/`reload`) — **no code change**. But add `openDevTools`/`closeDevTools` to the explicit `nullOps` assertion list in `automation-mcp-server.test.js:1209-1211` for completeness.
  - **Out-of-scope but TRACKED (design review):** ~13 project-owned behavior specs under `tests/behavior/*.md` hard-assert `tools/list returns 17 tools` in their Step-1 precondition probes — already stale at 19 post-leg-1, becoming 21 here. Per the skill–project boundary these are **not this leg's to edit**. They are **deferred to the leg-6 `retire-9222` docs/count sweep** (which should convert the brittle `=== N` probes to `>= N` so they stop being count-coupled) and **logged in the flight log now** so they are not silently broken. This leg only touches the live code/test/doc counts above.
- [x] **AC6 — capability distinction documented.** (tool descriptions + docs note: `openDevTools` CDP client → concurrent `readAxTree`/`scroll` `attach-failed`; `evaluate`/`injectScript` keep working; `{mode:'detach'}` rationale.) Tool descriptions note: `openDevTools` establishes a CDP client (a concurrent `readAxTree`/`scroll` will surface `attach-failed` — expected), while `evaluate`/`injectScript` keep working under DevTools (they use `executeJavaScript`). `{mode:'detach'}` rationale noted.
- [x] **AC7 — green gates.** `npm test` (761 pass / 0 fail), `npm run typecheck`, `npm run lint` all pass.

## Verification Steps
- `npm test` — new dispatch + internal-refusal tests pass; registry-count test asserts 21; `EXPECTED_TOOL_COUNT` test asserts 21.
- `grep -rn "19 tools\|EXPECTED_TOOL_COUNT = 19\|the 19 tools" src/ docs/ CLAUDE.md test/` — returns nothing.
- `npm run typecheck` and `npm run lint` — green.
- **Live capability check (manual, WSLg — may defer to the verify/HAT leg if no display):** `npm run dev:automation`, admin/jar client calls `openDevTools({wcId})` → a detached DevTools window appears; `closeDevTools({wcId})` closes it; internal `goldfinch://settings` wcId is refused for both even with the admin key. (The full conflict sequence — open DevTools, then `readAxTree` → `attach-failed`, then close → restores — is **leg 5's** `devtools-cdp-conflict` run, not this leg.)

## Implementation Guidance

1. **Engine ops — append to `src/main/automation/observe.js`** (design-review decision: co-locate with the eval ops; `isInternalContents` is already imported `observe.js:3`; extend the existing module-header eval-ops paragraph and the `module.exports` line `observe.js:386`). Mirror the eval-op skeleton minus the JS-eval specifics:
   - `openDevTools(wcId, deps)`: `resolveContents(wcId, deps)` → **NO foreground activation** (DevTools attaches to the contents regardless of paint; opening it does not need the tab front) → **FINAL `isInternalContents(wc)` refusal** → `wc.openDevTools({ mode: 'detach' })` → return `undefined` (void → `{"ok":true}`).
   - `closeDevTools(wcId, deps)`: `resolveContents(wcId, deps)` → **FINAL `isInternalContents(wc)` refusal** → `wc.closeDevTools()` → return `undefined` (idempotent — close-when-not-open is an Electron no-op).
   - These ops touch **no CDP/`cdp.js`** themselves — `openDevTools` is a `webContents` method; the CDP *client* it spawns is Chromium's own DevTools front-end, which is the whole point of the (later, leg-5) conflict. The internal exclusion rests on the **privilege-escalation** argument (the mission's debugger-attach-skip-internal rule's intent — DevTools = a full CDP client on the page), not a literal `wc.debugger.attach`.
   - **Internal refusal even for admin** (AC4): admin's `allowInternal:true` makes `resolveContents` permissive, so the op-local `isInternalContents` check is the guard. Place it on the resolved `wc` (no activate branch here, so no re-resolve needed — but keep the check after the resolve).

2. **Engine dispatch in `engine.js`** — add keys next to `evaluate`/`injectScript` (~`engine.js:80`), reusing the existing `observe` require (`engine.js:11`):
   - `openDevTools: (wcId) => observe.openDevTools(wcId, deps())`
   - `closeDevTools: (wcId) => observe.closeDevTools(wcId, deps())`

3. **MCP tool defs in `mcp-tools.js`** — add a small `DEVTOOLS_TOOLS` group (or extend `OBSERVE_TOOLS`); template = any void wcId-op (e.g. `closeTab`/`navigate` for the void → `{"ok":true}` shape):
   - `openDevTools`: inputSchema `{ wcId: integer (required) }`; `call: (engine, { wcId }) => engine.openDevTools(wcId)`. Description: opens DevTools (detached) on the tab; establishes a CDP client (concurrent `readAxTree`/`scroll` → `attach-failed`); jar-scoped guests / admin chrome; internal session excluded.
   - `closeDevTools`: inputSchema `{ wcId: integer (required) }`; `call: (engine, { wcId }) => engine.closeDevTools(wcId)`. Description: closes DevTools; releases the CDP client.
   - Add the group into `TOOLS = [...]`. Registry → 21.

4. **Facade allowlist in `scope.js`** — add `'openDevTools'` and `'closeDevTools'` to `WCID_FIRST_OPS` (`scope.js:37`). Admin bypass (`scope.js:60`) reaches both; jar keys are membership-checked by the facade loop. **Do NOT** add them to the admin-only refusal list (`captureWindow`/`getChromeTarget`) — DevTools on a jar's own guest is within the jar key's authority.

5. **`isDevToolsOpened()` getter — SKIPPED** (design-review decision; see Context). Registry lands at 21, not 22. Leg 5's restore check is behavioral (`readAxTree` succeeds).

6. **Unit tests** — `test/unit/`:
   - Dispatch tests for both ops — fake engine records args.
   - `automation-mcp-tools.test.js`: registry count → 21; add names to the fixtures (`allNames19` → 21).
   - `automation-mcp-server.test.js`: `EXPECTED_TOOL_COUNT` → 21; add `openDevTools`/`closeDevTools` to the `nullOps` assertion list (`:1209-1211`).
   - **[HIGH] internal-session refusal test** (named): an internal-marked `wc` with `allowInternal:true` is refused by both ops and DevTools is NOT opened.
   - **`closeDevTools` idempotency test**: close without prior open returns `{"ok":true}` (no throw).
   - `automation-scope.test.js` parameterizes over `WCID_FIRST_OPS` — confirm the new ops are picked up (jar membership enforced).

7. **Docs** — `docs/mcp-automation.md` (count 19 → 21, new `### DevTools tools (2)` section with both rows + the CDP-client/capability-distinction note) and `CLAUDE.md` (breakdown +2 devtools). Note the `{mode:'detach'}` WSLg rationale.

## Edge Cases
- **`openDevTools` under a headless/no-display run** → may no-op or misbehave. Per the flight Adaptation: gate behind a capability check / record a limitation if it misbehaves headlessly; do not let it crash the engine. In a unit test, `wc.openDevTools` is faked, so this is a live-only concern (defer the live check to verify/HAT if no display).
- **`closeDevTools` when not open** → must not throw uncaught; either idempotent no-op or a clean `automation:` error. Pick and test.
- **Internal `wcId` (settings)** → refused for both ops even with admin (AC4) — the whole security point.
- **DevTools already open, `openDevTools` called again** → Chromium focuses the existing window (no error); acceptable.
- **Concurrent `readAxTree` while DevTools open** → `attach-failed` — NOT this leg's concern to trigger, but the tool description must set the expectation (AC6); it's leg 5's recorded finding.

## Files Affected
- `src/main/automation/observe.js` — append `openDevTools` + `closeDevTools` ops; extend module-header note + `module.exports` (`:386`).
- `src/main/automation/engine.js` — 2 dispatch keys (reuse existing `observe` require).
- `src/main/automation/mcp-tools.js` — `DEVTOOLS_TOOLS` group; registry 19 → 21; count comments (`:399`).
- `src/main/automation/scope.js` — both ops into `WCID_FIRST_OPS` (`:37`).
- `src/main/automation/mcp-server.js` — JSDoc count → 21 (`:321`).
- `test/unit/automation-mcp-tools.test.js` — count → 21 + dispatch + fixtures.
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` → 21 + `nullOps` entries (`:1209-1211`).
- `test/unit/automation-observe.test.js` — internal-refusal (`allowInternal:true`) + dispatch + close-when-not-open idempotency.
- `docs/mcp-automation.md`, `CLAUDE.md` — counts 19 → 21 + new DevTools section + capability-distinction note.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to flight end per `/agentic-workflow`.)*

- [x] All acceptance criteria verified (AC1 visual half deferred to verify/HAT)
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
