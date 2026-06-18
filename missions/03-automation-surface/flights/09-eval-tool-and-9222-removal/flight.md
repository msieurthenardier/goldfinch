# Flight: Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal

**Status**: completed
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC11** — dogfooding + retire the ungated path. This flight delivers the **deferred remainder** of SC11: the guarded in-page `evaluate`/`injectScript` MCP tool, the **`scripts/a11y-audit.mjs` rewrite** onto the new surface, the **`farbling-correctness`** spec migration off `:9222`, and the **full removal** of the hardened `:9222` / `--remote-debugging-port` / `dev:debug` path so it is no longer the verification apparatus.
- [ ] **SC6** (incidental) — adds a **DevTools-open MCP tool** (`webContents.openDevTools`/`closeDevTools`), a new capability an external/admin client can drive; also the non-CDP affordance that unblocks the `devtools-cdp-conflict` recorded finding.

> **Source artifacts**: the F7 "F8-eval" follow-on (mission roadmap Flight 9), the F7 debrief (a11y-gate rewrite + ungated-path retirement), and the F8 debrief follow-ups (run the two authored behavior specs; serialize `applyAutomationEnabledChange`; `userData`-redirect ordering test). See the flight-log Reconnaissance Report for the per-item classification against current code.

---

## Pre-Flight

### Objective
Add a **guarded in-page `evaluate`/`injectScript` MCP tool** (arbitrary JS in a guest or — admin — the chrome), use it to **rewrite `scripts/a11y-audit.mjs`** and **migrate the `farbling-correctness` behavior test** off the CDP `:9222` apparatus, add a **DevTools-open MCP tool** that doubles as the non-CDP affordance needed to **run the `devtools-cdp-conflict` recorded finding**, then **fully remove the `:9222` path** (`dev:debug`, the `--remote-debugging-port` arm of `isAutomationDevEnabled`, `scripts/cdp-driver.mjs`, the a11y CDP client) — the last consumers having migrated. Also land three F8 debrief follow-ups. Rewrite CLAUDE.md / `docs/mcp-automation.md` for the new tool set and the retired `:9222` path.

### Open Questions
- [x] **OQ1 — Eval tool mechanism** → **RESOLVED (Architect, ~95% confidence): `executeJavaScript`, zero CDP.** `webContents.executeJavaScript(code)` evaluates directly in the page's V8 isolate (not via a `<script>` tag), so `script-src` CSP does not apply — mechanically equivalent to CDP `Runtime.evaluate` for CSP, and it **natively awaits a returned Promise**. So it can inject axe-core and read back `axe.run(...)`'s report. The flight needs **no CDP** for eval; `cdp.js`'s debugger lock stays reserved for `readAxTree` + `scroll`. The **leg-1 spike** confirms the auto-await + JSON-serializable round-trip live before the a11y rewrite is committed.
- [x] **OQ2 — Eval tool shape + gating** → **RESOLVED (Architect): two tools.** `injectScript({wcId, script})` (void → `{"ok":true}`, defines globals / patches prototypes, **skips foreground-to-act**) + `evaluate({wcId, expression})` (returns a **JSON-serializable** value; async natively awaited; thrown-in-page error → `isError`; a non-serializable return → `isError` with `automation: evaluate — return value is not JSON-serializable`, not a confusing V8 message). Gating: **jar-scoped guests** (`resolveContentsForJar` — arbitrary JS in a jar's own tab is within that jar key's existing authority; blast radius bounded to its session) + **admin-only chrome** (`getChromeTarget`/`captureWindow` pattern). **[HIGH] internal session is excluded EVEN FOR ADMIN** — see DD2.
- [x] **OQ3 — DevTools tool** → **RESOLVED (Architect): `openDevTools`/`closeDevTools`, jar-scoped guests / admin chrome, `{mode:'detach'}` (WSLg-friendly).** Synchronous/void → `{"ok":true}`; add both to `WCID_FIRST_OPS` in `scope.js`. Confound-free for `devtools-cdp-conflict` (a `webContents` method, no `--remote-debugging-port`). `openDevTools` works under WSLg with a display; gate behind a capability check + record a limitation if it misbehaves headlessly (Adaptation).
- [x] **OQ4 — DevTools↔debugger conflict** → **RESOLVED (confirmed expected): DevTools open → `readAxTree` attach throws → `withDebuggerSession` returns `attach-failed` (normal result); `closeDevTools` restores success.** This is the recorded finding (DD6), not a blocker. Note: **`evaluate`/`injectScript` keep working under DevTools** (they use `executeJavaScript`, not the debugger) — a positive capability distinction.

### Design Decisions
*(Architect-reviewed 2026-06-17, approve-with-changes — OQ1–OQ4 settled, all HIGH/MEDIUM folded in below.)*

**DD1 — Eval tool mechanism: `executeJavaScript`, zero CDP (Architect-settled, ~95%).**
- Choice: build `evaluate`/`injectScript` on `webContents.executeJavaScript` (the established main→guest path via `engine.js:44` `executeInRenderer` / `observe.js` read snippet), evaluating in the guest **main world** (correct for axe + the farbling hooks; guest runs `contextIsolation:false` so main-world is the live DOM). **No CDP path** — `executeJavaScript` is CSP-immune for direct eval and auto-awaits a returned Promise, so it injects axe-core and reads `axe.run(...)` back identically to the old `Runtime.evaluate`.
- Rationale: keeps the engine debugger-free for eval (`cdp.js`'s lock stays for `readAxTree` + `scroll` only) and is the prerequisite for killing `:9222`.
- **Leg-1 spike confirms** the auto-await + JSON round-trip live before the a11y rewrite commits. If (against expectation) it fails, the Adaptation fallback adds a CDP path through `cdp.js` — but `:9222` still goes (the in-process debugger is not the port).

**DD2 — Eval tool shape + gating: two tools; internal session excluded even for admin (Architect-settled; HIGH guard).**
- Choice: **`injectScript({wcId, script})`** — void (`{"ok":true}`), defines globals / patches prototypes, **skips foreground-to-act**; **`evaluate({wcId, expression})`** — returns a **JSON-serializable** value, async natively awaited, thrown-in-page error → `isError`, non-serializable return → `isError` with `automation: evaluate — return value is not JSON-serializable`. Tool descriptions state the JSON-serializable contract.
- Gating: jar-scoped guests via `resolveContentsForJar` (within a jar key's existing authority over its tabs; chrome-exclusion guard at `resolve.js:148-149` already refuses a jar key the chrome `wcId` even if obtained via admin `getChromeTarget` — **document as a security invariant**); **admin-only for chrome**.
- **[HIGH — Architect] The internal session is excluded EVEN FOR ADMIN.** Admin builds with `allowInternal:true`, so `resolveContents` will NOT throw on an internal `wcId`. The eval op body MUST add an explicit `isInternalContents(wc)` check and refuse (`automation: evaluate — internal-session excluded`) **before** `executeJavaScript`. Unlike the read-only ops admin can run on the internal tab, arbitrary JS in `goldfinch://settings` would exfiltrate the privileged `goldfinchInternal` bridge / call `settingsSet` outside the IPC gate. This guard is the single most important leg-1 security item.
- **Inject-then-run pattern (MEDIUM — for DD4):** `injectScript(axeSource)` then a **single** `evaluate('axe.run(...)')` immediately after — do NOT assume `window.axe` persists across an arbitrary gap (a concurrent eval / navigation could destroy it). The a11y driver controls its own session so the window is small, but the leg enforces the immediate inject→run pairing.

**DD2b — Tool count bookkeeping (Architect — stale-count hazards).** F9 takes the registry 17 → **21** tools (`evaluate`, `injectScript`, `openDevTools`, `closeDevTools`). Two static counts must be updated or they self-break: `tests/behavior/devtools-cdp-conflict.md` Step 1 hard-halts on `=== 16` (now 17, will be 21) — change to `>= N` or update; CLAUDE.md / `docs/mcp-automation.md` say "17 tools". Tracked in the relevant legs (run-devtools-cdp-conflict / retire-9222 docs).

**DD3 — DevTools-open tool (`openDevTools`/`closeDevTools`) (Architect-settled).**
- Choice: a new tool calling `wc.openDevTools({ mode: 'detach' })` / `wc.closeDevTools()` (synchronous/void → `{"ok":true}`), added to `WCID_FIRST_OPS` in `scope.js` so the jar façade enforces membership; gated jar-scoped guests / admin chrome. `{mode:'detach'}` (separate OS window) is preferred under WSLg over the default docked mode (less compositor interference, more predictable). This is the **non-CDP DevTools affordance** the `devtools-cdp-conflict` spec was blocked on, and the DevTools-via-MCP capability the operator wants.
- Rationale: `openDevTools` is a `webContents` API (no `--remote-debugging-port`), so it is confound-free for the spec. Trade-off: opening DevTools establishes a CDP client on the tab, so a concurrent `readAxTree` (which attaches `webContents.debugger`) surfaces `attach-failed` — the intended recorded finding (DD6), not a regression. **`evaluate`/`injectScript` are unaffected** (they use `executeJavaScript`, not the debugger) — they keep working under DevTools.
- Optional (suggestion): an `isDevToolsOpened()` read-only getter would make the spec's "restores after close" step deterministic; include if cheap.

**DD4 — Rewrite `scripts/a11y-audit.mjs` onto the eval tool (no CDP/`:9222`).**
- Choice: replace the 350-line WebSocket-CDP-at-`:9222` client (`fetch /json` + `Runtime.evaluate` axe injection) with an MCP client over the loopback automation surface that uses the new `evaluate`/`injectScript` tool to inject `axe-core` and read the violation report, diffing against the curated baseline as today. Launch becomes `dev:automation` (admin key for the chrome target; jar/guest for guest audits), not `dev:debug`. Depends on DD1/DD2.
- Rationale: the a11y gate is the last CDP-`:9222` consumer besides farbling; moving it is what lets `:9222` die.

**DD5 — Migrate `farbling-correctness` onto the eval tool.**
- Choice: rewrite the spec's apparatus from `chrome-devtools` MCP `evaluate_script` attached to `:9222` to the Goldfinch MCP `evaluate` tool, **evaluating in the guest main world** (where the farbling hooks live — selecting the guest target, not the chrome shell). The reads (`navigator.hardwareConcurrency`/`deviceMemory`, `canvas.toDataURL`/`getImageData`) are returned directly by `evaluate` — no test-only seam. Launch via `dev:automation` + a jar key; serve the fixture page over HTTP as today.
- Rationale: removes the spec's `:9222` dependency and dogfoods the new tool on a real privacy-correctness assertion. Depends on DD1/DD2.

**DD6 — Run `devtools-cdp-conflict` to settle the recorded finding.**
- Choice: with DD3 landed, **update the spec's apparatus text** (it currently assumes a native UI affordance + halts on `=== 16` tools) — Step 3's action becomes "call `openDevTools(W)` over MCP"; the apparatus note becomes "DevTools opened via the `openDevTools` MCP tool (the non-CDP, non-UI affordance from DD3)"; the tool-count halt becomes `>= N`. Then run it confound-free over `dev:automation`: open DevTools via the new tool, call `readAxTree`, **record** the outcome (expected `attach-failed`; `closeDevTools` restores success). **Record as a finding and archive** the spec (it self-describes as "recorded finding, not pass/fail"); close the mission Open-Question.
- Rationale: this is a recorded finding, not pass/fail — the affordance gap is now closed.

**DD7 — Fully remove the `:9222` path (LAST — after DD4/DD5 migrate off it).**
- Choice: remove the `dev:debug` script (and its `--remote-debugging-port` / `--remote-allow-origins`), the `--remote-debugging-port` arm of `isAutomationDevEnabled` (`src/shared/automation-dev.js`) + its now-stale staging JSDoc, `scripts/cdp-driver.mjs` (the legacy CDP driver), and the a11y CDP client; clean the `main.js` `--remote-debugging-port` comments. Confirm `.mcp.json` has no `:9222`/playwright remnant (F7 trimmed it; verify). Rewrite CLAUDE.md's "dev seam / `:9222`" narrative + `docs/mcp-automation.md`.
- Rationale: completes SC11's "retire the ungated path." Sequenced last so nothing still depends on `:9222` when it goes.
- **Consumer audit (Architect-completed — cut is SAFE):** `isAutomationDevEnabled` has 3 consumers, none of which need the `--remote-debugging-port` arm: (1) `chrome-preload.js:79` — the renderer's `process.argv` never carries `--remote-debugging-port` (it's main-process-only), so that arm never fired there; only `--automation-dev` (injected via `additionalArguments`) matched. (2) `main.js:274` (additionalArguments) + (3) `main.js:981` (dev-seam IPC) — both should switch to **`isMcpAutomationEnabled(process.argv)`** directly (the narrower `--automation-dev`-only predicate, which is the actual intent per the `main.js:1001-1002` comment). After the switch, `isAutomationDevEnabled` is unused and is **removed** from `automation-dev.js` (+ its stale staging JSDoc) once `dev:debug` is gone.

**DD8 — F8 debrief follow-ups (bundled cleanup).**
- Choice: (a) **serialize `applyAutomationEnabledChange` against concurrent toggle flips** — the current `await rebinding` at the top guards against a port-rebind but NOT against a second `applyAutomationEnabledChange` caller (Architect MEDIUM: two rapid flip-ONs both see `mcpServer===null` and both `startMcpServerInstance()` → race to bind the same port; an OFF after an OFF silently no-ops). Fix: a single mutex covering **both** `rebinding` and concurrent `applyAutomationEnabledChange` callers (e.g. one `inFlight` promise-chain both paths await + extend), not just a second independent `enabling` lock. (b) `userData`-redirect **ordering-invariant test** (assert no `getPath('userData')` consumer precedes `app.setPath` in `whenReady`). (c) `resolvePort` `honorEnv` JSDoc warning (main-process callers must pass `honorEnv: !app.isPackaged`).
- Rationale: low-effort, high-value hardening from the F8 debrief, touching the same automation surface this flight is already in.

**DD9 — Verification (FD-driven + dogfood the migrated tests + the F8 authored specs).**
- Choice: (a) FD-driven `verify-integration` — the rewritten `npm run a11y` runs green on the new surface (no `:9222`); `:9222` is gone (no listener under `dev:automation`; `dev:debug` removed); full `npm test` + typecheck + lint green; (b) run the migrated `farbling-correctness` + the unblocked `devtools-cdp-conflict` (recorded finding); (c) run the **F8-authored** `automation-key-gating` + `settings-activity-viewer` behavior specs (deferred from F8); (d) optional guided HAT.

### Prerequisites
- [x] **F8 landed + merged** to `main` (PR #52, 2026-06-17).
- [ ] **`axe-core` devDependency present** — confirmed (`^4.12.1`).
- [ ] **GUI display (WSLg)** for the a11y / farbling / DevTools live runs.
- [ ] **Eval-tool mechanism premise (OQ1)** — `executeJavaScript`-can-inject-axe spike, verified at leg 1 / Architect review before the a11y rewrite is committed.
- [ ] **No new transport / no new bind gate** — reuses the F3–F8 loopback server + auth model; the eval/devtools tools are new *capabilities* on the existing surface, not a new surface.

### Pre-Flight Checklist
- [x] All open questions resolved (OQ1–OQ4 settled by the Architect; the OQ1 mechanism is additionally confirmed by a leg-1 live spike before the a11y rewrite commits)
- [x] Design decisions documented (DD1–DD9) + **Architect-reviewed** (approve-with-changes, 2026-06-17 — all HIGH/MEDIUM folded in: the admin internal-session eval guard, the two-tool shape, the stale tool-counts, the concurrent-flip mutex, the inject-then-run pattern, the safe `isAutomationDevEnabled` cut)
- [ ] Prerequisites verified (F8 merged ✓; axe-core ✓; **GUI display** + the **leg-1 `executeJavaScript` spike** verified at execution)
- [x] Validation approach defined (FD-driven + migrated behavior tests + the F8 authored specs)
- [x] Legs defined
- [x] Operator sign-off (2026-06-17) — flight marked `ready`. The GUI-display prereq + the leg-1 `executeJavaScript`-injects-axe spike are deliberately deferred to execution; neither blocks starting leg 1.

---

## In-Flight

### Technical Approach
1. **`eval-tool`** *(keystone; FIRST)* — premise-audit `executeJavaScript`-can-inject-axe (DD1), then add the guarded `evaluate`(/`injectScript`) op + MCP tool, jar-scoped guests / admin chrome (DD2). Unit-test the pure parts; the engine op follows the resolve→activate→re-resolve discipline.
2. **`devtools-tool`** *(DD3)* — `openDevTools`/`closeDevTools` op + MCP tool, same gating.
3. **`a11y-audit-rewrite`** *(DD4)* — rewrite `scripts/a11y-audit.mjs` onto an MCP client + the eval tool; `npm run a11y` green on `dev:automation`.
4. **`farbling-migration`** *(DD5)* — migrate the `farbling-correctness` spec apparatus to the eval tool (guest main world).
5. **`run-devtools-cdp-conflict`** *(DD6)* — run the unblocked spec; record the `attach-failed` finding; update its status + the mission Open-Question.
6. **`retire-9222`** *(DD7; LAST of the migration arc)* — remove `dev:debug` / the `--remote-debugging-port` arm / `cdp-driver.mjs` / the a11y CDP path; docs rewrite.
7. **`f8-followups`** *(DD8)* — serialize `applyAutomationEnabledChange`; `userData` ordering-invariant test; `resolvePort` JSDoc warning.
8. **`verify-integration` + HAT** *(DD9)* — FD-driven green-gates + dogfood runs (a11y, farbling, devtools-cdp-conflict, automation-key-gating, settings-activity-viewer); optional guided HAT.

### Checkpoints
- [ ] `evaluate` injects axe-core + returns its report (premise OQ1 settled live)
- [ ] Eval tool jar-scoped (guest) / admin (chrome); arbitrary JS refused out-of-jar / on the internal session for jar keys
- [ ] DevTools-open tool works; `devtools-cdp-conflict` recorded finding captured
- [ ] `npm run a11y` runs green on the new surface (no `:9222`); `farbling-correctness` passes on the eval tool
- [ ] `:9222` fully removed — `dev:debug` gone, no `--remote-debugging-port` reachable; CLAUDE.md/docs rewritten
- [ ] F8 follow-ups landed; full `npm test` + typecheck + lint green
- [ ] F8-authored `automation-key-gating` + `settings-activity-viewer` run

### Adaptation Criteria
**Divert / adapt if**:
- **`executeJavaScript` cannot inject axe-core / read it back (OQ1 fails)** → the eval tool gets a CDP `Runtime.evaluate` path through `cdp.js`'s shared lock, and `:9222` removal (DD7) must confirm the a11y rewrite no longer needs the *port* even if it uses the in-process debugger. Record the premise outcome.
- **`openDevTools` misbehaves under WSLg** (no window / crashes headless) → gate the DevTools tool behind a clear capability check and record the limitation; `devtools-cdp-conflict` may stay a recorded-as-blocked finding.

**Acceptable variations**:
- One eval tool vs `evaluate`+`injectScript` split (Architect's call).
- Folding `f8-followups` into another leg if trivial.
- Archiving vs activating `devtools-cdp-conflict` once the finding is recorded.

### Legs
> **Note:** Tentative; created one at a time as the flight progresses. May merge/split.

- [x] `eval-tool` — guarded `evaluate`(/`injectScript`) MCP tool; mechanism per OQ1 spike; jar-scoped guests / admin chrome. (DD1/DD2) **FIRST.** *(landed 2026-06-17; live spike PASS — axe injected + `axe.run` read back as JSON.)*
- [x] `devtools-tool` — `openDevTools`/`closeDevTools` MCP tool (the non-CDP affordance). (DD3) *(landed 2026-06-17; registry 19 → 21; unit gates green; live "window appears" + internal-refusal probe deferred to verify/HAT.)*
- [x] `a11y-audit-rewrite` — `scripts/a11y-audit.mjs` onto the eval tool; `npm run a11y` green on `dev:automation`. (DD4) *(landed 2026-06-17; CDP/`:9222` fully removed; shared `scripts/lib/mcp-client.mjs` extracted; all gates green — 781 tests; **AC5 live a11y PASS on WSLg** — exit 0, no NEW violations.)*
- [x] `farbling-migration` — migrate `farbling-correctness` apparatus to the eval tool (guest main world). (DD5) *(landed 2026-06-17; spec-only — apparatus → MCP `evaluate` in the guest main world; DD-F two-container = PRIMARY Step 6, New Identity = Variant; gates green 781 tests; live core-read smoke PASS on WSLg — navigator spoof `8`, `toDataURL` stable A===A2; status stays `draft` for the leg-8 formal run.)*
- [x] `run-devtools-cdp-conflict` — ran the unblocked spec (FD-driven, confound-free); finding recorded — **`attach-failed` NOT reproduced live** (inconclusive, WSLg detached-DevTools-window didn't materialize; branch stays unit-tested-only); spec archived; mission OQ closed. (DD6) *(landed 2026-06-17.)*
- [x] `retire-9222` — remove `dev:debug` / `--remote-debugging-port` arm / `cdp-driver.mjs` / a11y CDP path; docs. (DD7) **LAST of the migration arc.**
- [x] `f8-followups` — serialize `applyAutomationEnabledChange`; `userData` ordering test; `resolvePort` JSDoc warning. (DD8) *(landed 2026-06-17; serialized core extracted to `automation/toggle.js` + `init-profile.js`; 773 tests / typecheck / lint green; semantics preserved.)*
- [x] `verify-integration` + `hat-and-alignment` — FD-driven gates GREEN (773 tests/typecheck/lint), `:9222` retired (live), a11y green (leg 3); dogfood runs: farbling **PASS**, devtools-cdp-conflict recorded (leg 5), automation-key-gating + settings-activity-viewer **partial** (load-bearing assertions pass; UI-interaction steps carried/apparatus-limited); HAT skipped per operator. (DD9) *(landed 2026-06-17.)*

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (PR onto `main`)
- [ ] Tests passing (`npm test` + typecheck + lint); `npm run a11y` green on the new surface
- [ ] `:9222` / `dev:debug` / `--remote-debugging-port` fully removed; CLAUDE.md + `docs/mcp-automation.md` rewritten
- [ ] Flight debrief written

### Verification
- **Eval tool**: an MCP client (admin for chrome, jar key for a guest) calls `evaluate` to run an expression and read its value; `injectScript`/`evaluate` injects axe-core and returns its report; a jar key is refused out-of-jar and on the internal session.
- **a11y gate**: `npm run a11y` (rewritten) runs green against `dev:automation` (no `:9222`); the curated baseline diff still works.
- **farbling**: `/behavior-test farbling-correctness` passes on the eval-tool apparatus (guest main-world reads).
- **devtools-cdp-conflict**: `/behavior-test devtools-cdp-conflict` runs (no longer blocked); the `attach-failed` outcome is recorded.
- **:9222 gone**: `dev:debug` is removed from `package.json`; no `--remote-debugging-port` listener under `dev:automation`; `isAutomationDevEnabled` no longer matches `--remote-debugging-port`; `cdp-driver.mjs` removed.
- **F8 follow-ups**: concurrent toggle flips don't race `applyAutomationEnabledChange`; the `userData`-redirect ordering-invariant test fails if a consumer is moved before `setPath`.
- **F8 authored specs**: `/behavior-test automation-key-gating` + `/behavior-test settings-activity-viewer` produce run logs.
- **Regression**: full `npm test` + typecheck + lint green.
