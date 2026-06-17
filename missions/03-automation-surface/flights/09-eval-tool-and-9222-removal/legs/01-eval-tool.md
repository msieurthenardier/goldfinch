# Leg: eval-tool

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Add two guarded MCP tools — `evaluate({wcId, expression})` and `injectScript({wcId, script})` — built on `webContents.executeJavaScript` (zero CDP), jar-scoped for guests and admin-only for the chrome, with the internal session excluded **even for admin**; and confirm live (the leg-1 premise spike) that `executeJavaScript` can inject `axe-core` and read its report back, before the a11y rewrite depends on it.

## Context
- **Keystone leg (FIRST).** The a11y rewrite (leg 3) and farbling migration (leg 4) both consume these tools; `:9222` removal (leg 6) is only safe once they exist and the migrations land. Nothing else in the flight starts until this lands.
- **DD1 — mechanism: `executeJavaScript`, zero CDP (~95%, Architect-settled).** `webContents.executeJavaScript(code)` evaluates in the page's V8 isolate (not via a `<script>` tag), so `script-src` CSP does not apply — mechanically equivalent to CDP `Runtime.evaluate` for CSP — and it **natively awaits a returned Promise**. So one `executeJavaScript` can inject axe-core and read `axe.run(...)` back. The engine stays debugger-free for eval; `cdp.js`'s lock stays reserved for `readAxTree` + `scroll`.
- **DD2 — shape + gating: two tools.** `injectScript` is void (`{"ok":true}`), defines globals / patches prototypes, **skips foreground-to-act**. `evaluate` returns a **JSON-serializable** value, async natively awaited, thrown-in-page error → `isError`, non-serializable return → `isError` with the message `automation: evaluate — return value is not JSON-serializable`. Both evaluate in the **guest main world** (guest runs `contextIsolation:false`, so main-world is the live DOM — correct for axe + farbling hooks).
- **DD2 [HIGH] — internal session excluded EVEN FOR ADMIN.** Admin builds the engine with `allowInternal:true`, so `resolveContents` will NOT throw on an internal `wcId`. Unlike the read-only ops admin may run on the internal tab, **arbitrary JS in `goldfinch://settings` would exfiltrate the privileged `goldfinchInternal` bridge / call `settingsSet` outside the IPC gate.** The eval op body MUST add an explicit `isInternalContents(wc)` refusal **before** `executeJavaScript`. This is the single most important security item in the leg.
- **DD2 — inject-then-run pairing (for leg 3/DD4):** never assume `window.axe` persists across a gap. The a11y driver pairs `injectScript(axeSource)` immediately with one `evaluate('axe.run(...)')`; this leg's tool contracts must support that pairing (no implicit persistence assumption baked into the tools).
- **DD2b — tool count.** This leg takes the registry **17 → 19**. Leg 2 (`devtools-tool`) later takes it to 21. Every static "17 tools" reference updated here moves to 19.

## Inputs
What exists before this leg runs (branch `flight/9-eval-tool-and-9222-removal`, off post-F8 `main`):
- `src/main/automation/mcp-tools.js` — 17-tool registry (12 drive + 4 observe + 1 admin `getChromeTarget`); `ToolDef` typedef (`mcp-tools.js:100-115`); `TOOLS = [...DRIVE_TOOLS, ...OBSERVE_TOOLS, ...CHROME_TOOLS]` (`mcp-tools.js:361`); `callTool` dispatch (`mcp-tools.js:397-412`); result serialization (`mcp-tools.js:57-68`).
- `src/main/automation/engine.js` — `createEngine(getMainWindow, { allowInternal })` (`engine.js:29-86`); `executeInRenderer` chrome-only helper (`engine.js:42-45`, the `engine.js:44` call); op dispatch keys (e.g. `readDom: (wcId) => observe.readDom(wcId, deps())`, `engine.js:77`).
- `src/main/automation/observe.js` — `readDom` (`observe.js:165-175`) is the resolve→activate→re-resolve→`wc.executeJavaScript(SNIPPET)` exemplar; `readAxTree` (`observe.js:264`) uses `withDebuggerSession` (the eval tools must NOT).
- `src/main/automation/resolve.js` — `isInternalContents(wc)` (`resolve.js:28-30`, strict `=== true`); `resolveContents(wcId, deps)` (`resolve.js:76-100`, throws `bad-handle`/`no-such-contents`/`internal-session` unless `allowInternal`); `resolveContentsForJar` (`resolve.js:141-158`) with the chrome-exclusion guard (`resolve.js:148-149`).
- `src/main/automation/scope.js` — `WCID_FIRST_OPS` (`scope.js:37-42`); the facade wrapper loop (`scope.js:104-109`) that calls `resolveContentsForJar` before delegating to `engine[op]`; admin bypass returns the raw engine (`scope.js:59`).
- `src/main/automation/cdp.js` — `withDebuggerSession` + the `attached` lock (`cdp.js:23`, `cdp.js:64-81`). Reference only; eval tools do not touch it.
- `test/unit/automation-mcp-tools.test.js` — registry/dispatch tests; asserts `tools.length === 17` (`automation-mcp-tools.test.js:64-68`); `ALL_NAMES` fixture (`:22-29`). Sibling: `automation-resolve.test.js`, `automation-scope.test.js`.
- `axe-core@^4.12.1` devDependency present (used by the leg-1 spike + leg 3).
- GUI display (WSLg) + the loopback automation surface reachable via `npm run dev:automation` for the live spike.

## Outputs
- `evaluate` and `injectScript` engine ops (in `observe.js`, dispatched via `engine.js`), MCP tool defs (in `mcp-tools.js`), registered in the facade allowlist (`scope.js` `WCID_FIRST_OPS`).
- Registry size 17 → 19; all static counts updated.
- Unit tests for the pure parts (dispatch mapping, serialization-error path, the internal-session refusal predicate).
- A recorded **premise-spike result** in the flight log: `executeJavaScript` injected `axe-core` into a live guest and returned `axe.run(...)`'s JSON report (or, if it failed, the Adaptation fallback is triggered and recorded).

## Acceptance Criteria
- [x] **AC1 — `evaluate` op.** `evaluate(wcId, expression)` resolves the target (resolve→activate→re-resolve for a guest), runs `wc.executeJavaScript(expression)` in the guest main world, awaits a returned Promise, and returns the value. A thrown-in-page error surfaces as an error result (`isError`). A non-JSON-serializable return surfaces as `isError` with the exact message `automation: evaluate — return value is not JSON-serializable` (not a raw V8 message).
- [x] **AC2 — `injectScript` op.** `injectScript(wcId, script)` runs `wc.executeJavaScript(script)` in the guest main world, **without foreground-to-act activation**, and returns `{"ok":true}` (void contract). A thrown-in-page error surfaces as `isError`.
- [x] **AC3 — [HIGH] internal-session refusal even for admin.** Both ops call `isInternalContents(wc)` and refuse with `automation: evaluate — internal-session excluded` (and the analogous `injectScript` message) **before** any `executeJavaScript`, regardless of `allowInternal`. A unit test pins this: an internal-marked `wc` is refused even with `allowInternal:true`.
- [x] **AC4 — jar scoping.** Both ops are in `WCID_FIRST_OPS`, so a jar key is verified via `resolveContentsForJar` (out-of-jar / chrome / internal all refused) before the op runs; admin reaches guests and the chrome target. No new gating path is invented — reuse the existing facade.
- [x] **AC5 — zero CDP.** Neither op imports or calls `cdp.js` / `withDebuggerSession` / `wc.debugger`. Confirmed by grep + the ops running concurrently with `readAxTree`/`scroll` without lock contention.
- [x] **AC6 — registry 17 → 19, ALL static counts caught.** `mcp-tools.js` registers `evaluate` + `injectScript`; `tools.length === 19` in the registry test. **Every** static count is updated to 19 (the design review found the leg's first inventory missed two that break `npm test`):
  - `test/unit/automation-mcp-tools.test.js:64-68` — `tools.length === 19` + test name.
  - `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT = 17` → `19` (`:26`), asserted in ~9 places (`:257,272,279,294-295,327,362,388,507`) + the `'…tools/list returns 17 tools'` test-name string (`:251`). **[HIGH] — these fail `npm test` if missed.**
  - `src/main/automation/mcp-server.js:321` — JSDoc `…with the 17 tools wired…` (comment-only, but AC6 intent requires it).
  - `docs/mcp-automation.md` — intro count (`:19` "17 tools — 12 drive, 4 observe, 1 admin") + "All 17 tools below" (`:219`) + a new `### Eval tools (2)` section with `evaluate`/`injectScript` rows.
  - `CLAUDE.md` — the "17 tools" breakdown → **19** (12 drive + 4 observe + **2 eval** + 1 admin discovery).
  - `evaluate` tool description states the JSON-serializable return contract; `injectScript` states void + skips-foreground-to-act + no-persistence.
  - **Not this leg:** `tests/behavior/devtools-cdp-conflict.md` Step 1 (`=== 16`, already stale pre-this-flight) is owned by leg 5/6 per flight DD2b.
- [x] **AC7 — premise spike (live).** Over `npm run dev:automation`, an MCP client injects `axe-core` source via `injectScript` and reads `axe.run(document, {...})` back via a single immediately-following `evaluate`, receiving the violation report as JSON. Result recorded in the flight log. (If it fails: trigger the Adaptation fallback — add a CDP `Runtime.evaluate` path through `cdp.js` — and record the premise outcome; `:9222` still dies in leg 6 because the in-process debugger is not the port.)
- [x] **AC8 — green gates.** `npm test`, typecheck, and lint pass.

## Verification Steps
- `npm test` — new unit tests for `evaluate`/`injectScript` dispatch, the serialization-error path, and the internal-session refusal pass; registry-count test asserts 19.
- `grep -n "debugger\|withDebuggerSession\|require.*cdp" src/main/automation/observe.js` near the new ops — no debugger usage in the eval paths.
- `grep -rn "17 tools\|EXPECTED_TOOL_COUNT = 17\|the 17 tools" src/ docs/ CLAUDE.md test/` — returns nothing (all moved to 19; broadened from the original `docs/ CLAUDE.md`-only grep, which missed `mcp-server.js` and the server test).
- Live spike (manual, WSLg): `npm run dev:automation`, then via an MCP client (admin key for chrome, jar key for a guest tab) call `injectScript({wcId, script: <axe-core source>})` then `evaluate({wcId, expression: 'axe.run(document).then(r => ({violations: r.violations.length}))'})` — returns a JSON object. Internal `goldfinch://settings` wcId is refused for both even with the admin key.
- `npm run typecheck` and `npm run lint` (or the project's configured names) — green.

## Implementation Guidance

1. **Premise spike FIRST (de-risk before building the public surface).**
   - Smallest possible proof: from a scratch MCP-client call (or a throwaway harness mirroring `scripts/cdp-driver.mjs`'s attach-don't-launch shape, over the loopback surface), confirm `wc.executeJavaScript(<axe-core source>)` then `wc.executeJavaScript('axe.run(document)')` returns a JSON-serializable report and that the returned Promise is auto-awaited. Record the outcome in the flight log before committing the a11y rewrite (leg 3). This is the load-bearing premise (OQ1).

2. **Engine ops in `observe.js`** — mirror `readDom` (`observe.js:165-175`):
   - `evaluate(wcId, expression, deps)`: `resolveContents(wcId, deps)` → if guest + `activate` exists, `await activate(wcId)` then **re-resolve** (the `readDom` activate-branch, `observe.js:168-173`) → **`isInternalContents(wc)` refusal check on the FINAL `wc`** → `wc.executeJavaScript(expression)`. Wrap the result: the **engine op itself** must `try { JSON.stringify(value) } catch` and throw the exact DD2 message **before returning** (do not rely on the adapter's bare `JSON.stringify` at `mcp-tools.js:57`, whose throw would surface a raw V8 message via `errResult`); in-page throws propagate as errors; `await` so a returned Promise resolves before serialization.
   - `injectScript(wcId, script, deps)`: `resolveContents(wcId, deps)` → **NO activate** (skips foreground-to-act) → **`isInternalContents(wc)` refusal check** → `await wc.executeJavaScript(script)` → return `undefined` (void → `{"ok":true}` via the serializer).
   - **[HIGH/MEDIUM] Placement of the internal check (design-review note):** `readDom`/`captureScreenshot` only re-resolve *inside* the `if (guest && activate)` block; a chrome target or an admin call without `activate` skips re-resolve. The `isInternalContents` refusal MUST run on the **final** `wc` **after** the (optional) activate branch — NOT inside it — so it also covers the no-activate path (admin/chrome). This is the load-bearing guard: admin's `allowInternal:true` makes `resolveContents` permissive (`resolve.js:95-97`), so without this op-local check admin could run arbitrary JS in `goldfinch://settings` and reach the privileged `goldfinchInternal` bridge.
   - Both: do NOT use `executeInRenderer` (that's chrome-only); call `wc.executeJavaScript` on the resolved guest `wc`, exactly like `readDom`. Use the exported `isInternalContents` from `resolve.js`.
   - **Module-header note:** add a one-line comment to `observe.js`'s header noting the eval ops are debugger-free `executeJavaScript` ops co-located with `readDom` for the shared resolve→activate→re-resolve skeleton, even though `injectScript` is a *write* — so a future reader doesn't trip on a write living in the "observe" file.

3. **Engine dispatch in `engine.js`** — add keys alongside `readDom`/`readAxTree` (~`engine.js:77`):
   - `evaluate: (wcId, expression) => observe.evaluate(wcId, expression, deps())`
   - `injectScript: (wcId, script) => observe.injectScript(wcId, script, deps())`

4. **MCP tool defs in `mcp-tools.js`** — add to `OBSERVE_TOOLS` (template: `readDom` `mcp-tools.js:312-322`; serializer handles JSON-text by default, `mcp-tools.js:57-68`):
   - `evaluate`: inputSchema `{ wcId: integer (required), expression: string (required) }`; `call: (engine, { wcId, expression }) => engine.evaluate(wcId, expression)`. Description states the **JSON-serializable return contract** and main-world evaluation.
   - `injectScript`: inputSchema `{ wcId: integer (required), script: string (required) }`; `call: (engine, { wcId, script }) => engine.injectScript(wcId, script)`. Description states void/`{"ok":true}` + "defines globals; skips foreground-to-act."

5. **Facade allowlist in `scope.js`** — add `'evaluate'` and `'injectScript'` to `WCID_FIRST_OPS` (`scope.js:37-42`) so a jar key is membership-checked via `resolveContentsForJar` before the op runs (`scope.js:104-109`). Admin bypass (`scope.js:59`) already reaches both.

6. **Unit tests** — `test/unit/automation-mcp-tools.test.js` AND `test/unit/automation-mcp-server.test.js` (+ resolve/scope siblings as needed):
   - `automation-mcp-tools.test.js`: add the two names to `ALL_NAMES` (`:22-29`); update the registry-count assertion to 19 (`:64-68`).
   - `automation-mcp-server.test.js`: bump `EXPECTED_TOOL_COUNT = 17` → `19` (`:26`) — this constant drives ~9 assertions + a test-name string; missing it fails `npm test`.
   - Test named→positional dispatch for both ops (fake engine records args).
   - Assert `injectScript` does **NOT** call `activate` (the intentional asymmetry vs `evaluate`, so it can't silently regress).
   - Test the serialization-error path for `evaluate`: assert the **engine op** throws the exact string `automation: evaluate — return value is not JSON-serializable` (e.g. a circular plain object survives the structured-clone boundary then fails `JSON.stringify`), surfaced as `isError`.
   - Test the internal-session refusal as a pure predicate: an internal-marked `wc` is refused by the op even when `allowInternal:true` (this is the HIGH guard — give it a named, explicit test).

7. **Docs** — update `docs/mcp-automation.md` (count + tool list: add `evaluate`/`injectScript` rows) and `CLAUDE.md` (the "17 tools" breakdown → 19, "+2 eval"). Note the JSON-serializable contract and the internal-session exclusion (security invariant) in the docs.

## Edge Cases
- **Non-serializable `evaluate` return** (DOM node, function, circular object) → `isError` with the exact DD2 message, never a raw V8 message.
- **In-page throw** (ReferenceError, page code throws) → `isError` surfacing the page error; not swallowed.
- **Promise return** → auto-awaited by `executeJavaScript`; the tool must `await` so the resolved value (not a Promise) is serialized.
- **Internal `wcId` with admin key** → refused by the explicit `isInternalContents` check (the whole point of DD2 HIGH). Without this check admin would execute arbitrary JS in the privileged settings page.
- **Guest not foregrounded for `injectScript`** → intentional; `injectScript` defines globals/patches prototypes and does not need a paint, so it skips activation (DD2). `evaluate` keeps foreground-to-act for parity with reads.
- **`window.axe` lifetime** → the tools make no persistence guarantee; the a11y driver (leg 3) pairs inject→run immediately. Document the non-persistence in the `injectScript` tool description.
- **Stale handle after activate** → re-resolve after `await activate` (the documented discipline) guards a destroyed/replaced webContents.

## Files Affected
- `src/main/automation/observe.js` — add `evaluate` + `injectScript` ops (export both) + module-header note.
- `src/main/automation/engine.js` — add two dispatch keys.
- `src/main/automation/mcp-tools.js` — add two tool defs to `OBSERVE_TOOLS`; registry 17 → 19.
- `src/main/automation/scope.js` — add both ops to `WCID_FIRST_OPS`.
- `src/main/automation/mcp-server.js` — JSDoc count `17` → `19` (`:321`).
- `test/unit/automation-mcp-tools.test.js` — count + dispatch + serialization-error + no-activate tests.
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 17 → 19 (+ test-name string).
- `test/unit/automation-resolve.test.js` / `automation-scope.test.js` — internal-session refusal predicate (as needed).
- `docs/mcp-automation.md` — tool count 17 → 19 (intro + "All N" line), new `### Eval tools (2)` section, security-invariant note.
- `CLAUDE.md` — tool count 17 → 19, new breakdown (+2 eval), security-invariant note.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(Note: per `/agentic-workflow`, commit is deferred to flight end — the Developer lands the leg and updates the log, but does NOT commit.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry (incl. the premise-spike outcome)
- [x] Set this leg's status to `landed` (commit/`completed` happens at flight-end review)
- [x] Check off this leg in flight.md
