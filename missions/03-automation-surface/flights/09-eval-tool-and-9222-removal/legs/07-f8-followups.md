# Leg: f8-followups

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Land three bounded F8-debrief hardening items (DD8): (a) **serialize `applyAutomationEnabledChange`** against concurrent toggle flips with a single mutex that also covers the port-rebind path; (b) add a **`userData`-redirect ordering-invariant test** (no `getPath('userData')` consumer runs before `app.setPath('userData', …)`); (c) add a **`resolvePort` `honorEnv` JSDoc warning** (packaged callers must pass `honorEnv: !app.isPackaged`).

## Context
- **DD8 — low-effort, high-value hardening from the F8 debrief**, touching the same automation surface this flight is already in. Independent of the eval/devtools/migration arc (legs 1-6) — orderable any time after them; placed here before the verify leg.
- **(a) The race (F8 debrief / Architect MEDIUM):** `applyAutomationEnabledChange` (`main.js:204-231`) `await`s the `rebinding` chain (guarding an in-flight port-rebind, `main.js:117`/`rebindMcpServer` `:184-196`) but **NOT** a second `applyAutomationEnabledChange` caller. Two rapid flip-ONs both see `mcpServer===null` (`:108`) and both `startMcpServerInstance()` (`:132-177`) → race to bind the same port (EADDRINUSE); an OFF-after-OFF silently no-ops. Caller: the `internal-settings-set` IPC on `key==='automationEnabled'` (`main.js:712`) — genuinely concurrent (the operator can flip the Settings toggle twice rapidly). **Fix:** ONE in-flight promise chain that BOTH `rebindMcpServer` and `applyAutomationEnabledChange` await + extend — not a second independent lock (the Architect was explicit: a separate `enabling` lock wouldn't serialize against `rebinding`, and vice-versa).
- **(b) The ordering invariant (F8 DD1):** `app.setPath('userData', devUserDataPath(...))` (`main.js:944`, dev-profile isolation, `app.isPackaged`-keyed) MUST run before any `getPath('userData')` consumer — `shields.load()` (`:946` → `shields.js:25`), `settings.load(app.getPath('userData'))` (`:947`), `jars.load()` (`:948` → `jars.js:70`). Today protected by human review only. The F8 debrief asks for a test pinning the invariant.
- **(c) The foot-gun (F8 DD6):** `resolvePort(getSettings, { honorEnv = true })` (`mcp-server.js:141-168`) defaults `honorEnv:true`; a packaged caller that forgets `honorEnv:false` leaks `GOLDFINCH_MCP_PORT` into production. All current callers are explicit (`createMcpServer` threads `opts.honorEnv`; `currentAutomationStatus` `main.js:240` passes `!app.isPackaged`), so this is **doc-only** — a JSDoc warning so a future caller doesn't regress it.

## Inputs (current working tree, post-legs 1-6)
- `src/main/main.js` — `mcpServer` (`:108`), `rebinding` (`:117`), `devEnableOverride` (`:124`); `startMcpServerInstance` (`:132-177`); `rebindMcpServer` (`:184-196`); `applyAutomationEnabledChange` (`:204-231`); `currentAutomationStatus` (`:240`); the `internal-settings-set` caller (`:712`); the `whenReady` block (`:938-948`) with `app.setPath('userData', …)` (`:944`).
- `src/shared/dev-profile.js` — `devUserDataPath` (the redirect target helper).
- `src/main/{shields,jars,settings-store}.js` — `load()` resolves the store path via `app.getPath('userData')` (`shields.js:25`, `jars.js:70`; `settings.load(path)` takes it as an arg).
- `src/main/automation/mcp-server.js` — `resolvePort` (`:141-168`), exported (`:157` block); callers at `:295` (`createMcpServer`, threads `honorEnv`) + `main.js:240`.
- `test/unit/automation-port.test.js` — existing `resolvePort` tests (call it with/without `honorEnv`). Any existing toggle/rebinding test (recon: none found for `applyAutomationEnabledChange`).

## Outputs
- `applyAutomationEnabledChange` + `rebindMcpServer` serialized through one shared in-flight chain; concurrent flips no longer double-bind / lost-no-op.
- A unit test pinning the `userData` setPath-before-consumers ordering invariant.
- A `resolvePort` JSDoc warning about `honorEnv` in packaged builds.
- All gates green.

## Acceptance Criteria
- [x] **AC1 — single-mutex serialization (shipped == tested).** `applyAutomationEnabledChange` and `rebindMcpServer` share ONE in-flight promise chain (a module-scoped `inFlight` each path awaits-then-extends), so: two concurrent `applyAutomationEnabledChange(true)` calls result in exactly ONE `startMcpServerInstance()` (no double-bind); a flip-OFF concurrent with a flip-ON resolves to a single consistent final state; a port-rebind concurrent with a flip is serialized (no stop()-on-null / double-free). NOT a second independent lock alongside `rebinding`. **The existing top-of-function `if (rebinding) await rebinding` lines in BOTH functions are REMOVED** and replaced by the single capture-prior-then-extend wrapper (else an op can await a chain it is itself part of → deadlock). **[HIGH] The serialization the test exercises (AC2) MUST be the exact code path `main.js` uses in production** — if the core is extracted for testability, `main.js`'s two functions delegate into that extracted unit's shared `inFlight`; do NOT leave `main.js` on the old `rebinding`-only guard with a parallel tested-but-unused copy.
- [x] **AC2 — race covered by a test.** A unit test drives two overlapping `applyAutomationEnabledChange(true)` calls (with a fake `start` that resolves on a manually-controlled deferred — more deterministic than a timer) and asserts `start` is invoked **once**; plus a flip-ON-then-OFF overlap test asserting the final state is correct; plus a **rejection-isolation** test: a prior op whose `stop()` rejects does NOT wedge the chain (the next op still runs). `main.js` is NOT unit-reachable (no `module.exports`; it calls `protocol.registerSchemesAsPrivileged` at module load, which the `electron-stub` doesn't provide) — so **extract the serializable core** (see guidance) and test that.
- [x] **AC3 — flip-OFF / dev-override / rebind semantics preserved.** The existing behaviors are unchanged: dev-override flip-OFF keeps the surface bound (DD3/DD4); the persisted-off-but-surface-live state still holds; the port-rebind still works live. Covered at **unit level here** (a dev-override flip-OFF test asserting no teardown). The `automation-key-gating` **behavior-test** run that exercises this end-to-end is **deferred to leg 8** (verify-integration/DD9) — not re-run in this leg.
- [x] **AC4 — userData ordering test.** A unit test asserts the invariant: `app.setPath('userData', …)` executes before any `getPath('userData')` consumer (`shields.load`/`settings.load`/`jars.load`). The test FAILS if a consumer is reordered before `setPath`. (Approach per guidance — prefer extracting the init sequence into a testable function with an instrumented fake `app`.)
- [x] **AC5 — resolvePort JSDoc warning.** `resolvePort`'s JSDoc carries an explicit warning that packaged/main-process callers MUST pass `honorEnv: !app.isPackaged` (default `true` honors `GOLDFINCH_MCP_PORT`, a production leak if forgotten). Behavior unchanged (doc-only). All current callers remain explicit.
- [x] **AC6 — green gates.** `npm test` (incl. the 2 new tests) + typecheck + lint pass.

## Verification Steps
- New tests: the concurrent-flip test (one `startMcpServerInstance`) + the flip-ON/OFF overlap test + the userData-ordering test all pass and are meaningful (each fails if its invariant is broken — verify by temporarily breaking it locally).
- `grep -n "honorEnv" src/main/automation/mcp-server.js` — JSDoc warning present.
- `npm test`, `npm run typecheck`, `npm run lint` — green.

## Implementation Guidance
1. **(a) Single mutex — use this exact shape** (handles self-clear + rejection-isolation; the earlier bare-`await prior` sketch was WRONG — a rejected prior op would wedge the chain):
   ```js
   let inFlight = null; // replaces the `rebinding` variable; ONE chain for both paths
   function runSerialized(body) {
     const prior = inFlight;
     // serialization await tolerates a prior REJECTION (don't let it poison the next op);
     // the op's own body still surfaces its own error to its own caller.
     const mine = (async () => { await Promise.resolve(prior).catch(() => {}); return body(); })();
     inFlight = mine;
     return (async () => { try { return await mine; } finally { if (inFlight === mine) inFlight = null; } })();
   }
   ```
   - `applyAutomationEnabledChange(enabled)` → `return runSerialized(async () => { <existing body, verbatim> })`. **REMOVE** its current top-of-function `if (rebinding) await rebinding` (`:209`) — the wrapper replaces it.
   - `rebindMcpServer()` → `return runSerialized(async () => { await mcpServer.stop(); await startMcpServerInstance(); })`. **REMOVE** its current `if (rebinding) await rebinding` + the inline `rebinding = (...)` chain (`:184-196`) — both collapse into `runSerialized`.
   - Preserve the flip-OFF / dev-override-early-return / status-reset logic **verbatim** inside the body. Only serialization changes.
   - **Body error semantics preserved:** if `mcpServer.stop()` rejects in the rebind body, that op rejects (surface stays as-is) exactly as today; the `.catch` on the *serialization* await only isolates the NEXT op from a prior op's rejection — it does not swallow an op's own error.
2. **(a) testability — extract the core (main.js is NOT unit-reachable: no exports, `protocol.registerSchemesAsPrivileged` at module load).** Extract into a small module (recommend `src/main/automation/toggle.js`) a factory `makeAutomationToggle({ start, stop, getServer, setServer, isDevOverride, setStatus })` returning `{ applyEnabledChange, rebind }` that share the ONE `inFlight` closure + `runSerialized`. `main.js`'s `applyAutomationEnabledChange`/`rebindMcpServer` become thin delegators into this unit (it mediates `mcpServer` via `getServer`/`setServer` and status via `setStatus`). **[HIGH] this extracted unit IS the production path** — not a parallel copy. Test it with fakes: a `start` on a manually-resolved deferred (assert exactly one invocation across two overlapping `applyEnabledChange(true)`), a flip-ON/OFF overlap, and a `stop`-rejects isolation case.
3. **(b) userData ordering** (`main.js` + a new test): **extract** the init sequence into `initProfileAndStores(app, { shields, settings, jars })` = `if (!app.isPackaged) app.setPath('userData', devUserDataPath(app.getPath('userData'))); shields.load(); settings.load(app.getPath('userData')); jars.load();` — then `whenReady` calls it. Test with a **fake `app`** (its own, NOT the shared `electron-stub`) whose `setPath`/`getPath`/`isPackaged` and the fake stores' `load()` push to a shared call-order array; assert `setPath` index < every consumer index.
   - **Instrument the right seam for settings:** `shields.load()`/`jars.load()` read `app.getPath('userData')` *internally*, but `settings.load(userDataPath)` takes the path **as an argument** (`settings-store.js:173`), so the ordering signal for settings is the `getPath('userData')` call `main.js` makes at the call site to build that argument — the call-order array must record that `getPath`, not assume `settings.load` reads app internally (it doesn't).
   - Cover **both** branches: unpackaged (`isPackaged:false` → `setPath` called, ordering asserted) AND packaged (`isPackaged:true` → assert `setPath` is NOT called; consumers still run reading the real userData — invariant vacuously holds).
   - Prefer this extraction over the runtime guard-flag fallback (the test pins source order with zero production cost).
4. **(c) resolvePort JSDoc** (`mcp-server.js:141-168`): add a `@warning`/bold line, e.g. "WARNING: `honorEnv` defaults to `true` (honors `GOLDFINCH_MCP_PORT`). Packaged/main-process callers MUST pass `honorEnv: !app.isPackaged` — forgetting it leaks the env override into a production build (DD6)." No code change.

## Edge Cases
- **inFlight self-clear race** — if op B extended the chain while op A was awaiting, A must NOT null `inFlight` (it no longer points at A). Guard with the identity check.
- **Rejection propagation** — if a chained op throws (e.g. `startMcpServerInstance` fails to bind), the chain must not wedge: subsequent awaiters should still proceed (await in a way that a prior rejection doesn't poison the next — e.g. `await prior.catch(()=>{})` for the *serialization* await, while the op's own result still surfaces its error to its own caller).
- **dev-override flip-OFF** — must still early-return bound (DD3/DD4); the serialization wrapper must not change that the override path returns without teardown.
- **userData test under packaged** — assert the packaged branch (`app.isPackaged===true`) does NOT call setPath, and consumers still run (reading the real userData) — the invariant is "no consumer before setPath", trivially true when setPath isn't called, but the test should cover both branches.
- **resolvePort** — purely doc; ensure no caller's behavior shifts.

## Files Affected
- `src/main/automation/toggle.js` (new) — extracted `makeAutomationToggle` factory (the shared `inFlight`/`runSerialized` + `applyEnabledChange`/`rebind`); the production serialization path.
- `src/main/main.js` — delegate `applyAutomationEnabledChange`/`rebindMcpServer` into `toggle.js`; remove the old `rebinding` top-of-function awaits; extract `initProfileAndStores` (called from `whenReady`).
- `src/main/automation/mcp-server.js` — `resolvePort` JSDoc WARNING (imperative: packaged callers MUST pass `honorEnv: !app.isPackaged`; current JSDoc only neutrally describes it).
- `test/unit/automation-toggle.test.js` (new) — concurrent-flip (one start), flip-ON/OFF overlap, stop-rejects isolation, dev-override flip-OFF (no teardown).
- `test/unit/init-profile-order.test.js` (new) — userData setPath-before-consumers ordering (both `isPackaged` branches).
- `CLAUDE.md` — one-line note IF `toggle.js`/the init extraction warrants it (optional).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to flight end per `/agentic-workflow`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
