# Flight Log: Chrome-driving affordance + behavior-spec dogfooding (scoped)

**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](flight.md)

## Summary
Flight `planning` (drafted 2026-06-15). Scope (operator): enable + prove + migrate a subset. Build the chrome-enumeration affordance (a dedicated admin-only `getChromeTarget` tool), verify trusted-input/read on the chrome (apparatus premise), add `openTab` jar-targeting, then migrate a representative subset of Group-B chrome specs onto the admin MCP surface (dogfooding). Plus: reconcile the 6 Group-A `7777` specs (port-only) + consolidate the dual `automationListKeys()`. HAT included. The bulk migration + `a11y-audit.mjs` rewrite + retiring the ungated `:9222` path are out of scope (follow-on + Flight 7). SC11 part 1 (scoped).

Operator decisions (planning, 2026-06-15): scope = enable+prove+subset; chrome affordance = a **dedicated `getChromeTarget` tool** (not an `enumerateTabs` type:'chrome' row); fold in `openTab` jar-targeting + the 6 Group-A `7777` port fixes + the dual-`automationListKeys` cleanup; defer the `devtools-cdp-conflict` non-CDP affordance; include the HAT.

---

## Reconnaissance Report
Sources: the F4 + F5 flight debriefs' carried follow-ups, the mission SC11 text. Every cited item walked against current code (2026-06-15). Verdict: **F6 needs real engine work, not spec edits only** — the MCP surface cannot address the chrome renderer today (the engine can drive a chrome `wcId` but nothing discovers it).

| Item | Classification | Evidence / disposition |
|------|----------------|------------------------|
| **Chrome-driving via MCP** (the SC11-part-1 enabler) | **confirmed-live (the central gap)** | Engine CAN drive a chrome `wcId` (`resolve.js:48` `classifyContents`→`'chrome'`; every op skips foreground-to-act for chrome). But **no tool discovers the chrome wcId** — `enumerateTabs`→`tabs.js:62`→renderer `listTabs()` (`renderer.js:1992-2001`) maps only guest `tabs.values()`; no `type:'chrome'`. `scope.js:12-16` documents this as a "Flight-6 affordance." → **DD1**: build admin-only `getChromeTarget`. |
| **`openTab` jar-targeting gap** (F4→F5→F6) | **confirmed-live** | `mcp-tools.js:126` openTab takes only `{url}`; `tabs.js:81`→renderer `createTab(url)` with no container; `createTab` defaults to `DEFAULT_CONTAINER`. A jar key's tab can land outside its jar, silently absent from `enumerateTabs`. → **DD3**. |
| **6 Group-A specs hardcode `7777`** | **confirmed-live; already on the MCP surface** | `foreground-to-act`, `observe-refusal-contract`, `internal-session-exclusion`, `devtools-cdp-conflict`, `mcp-drive-end-to-end`, `mcp-loopback-origin-guard` still reference `7777`; all `dev:automation` specs → F6 job is **port reconciliation only** (→ 49707/`GOLDFINCH_MCP_PORT`). The 2 newest (F4: `mcp-auth-gating`, `mcp-jar-scoping`) already pin the env. → **DD5**. |
| **Stale `.mcp.json` reference** | **partially-satisfied (entry gone; reference stale)** | The `goldfinch` `:7777` entry was removed in F5 (`.mcp.json` now has only `playwright`). But `mcp-drive-end-to-end.md:16` still *references* it → scrub the reference (DD5). Full `.mcp.json` update = Flight 7. |
| **Dual `automationListKeys()`** in `settings.js` | **confirmed-live** | Two IIFEs (`settings.js:548` key-mgmt `refresh()`; `:600` activity-viewer jarName seed) each call it. → **DD6** cleanup. |
| **`a11y-audit.mjs` rewrite** | **out of scope — Flight 7** | CDP/axe harness; mission assigns its rewrite to F7 (`mission.md:368`). F6 leaves it untouched. |
| **Retire `dev:debug` / `--remote-allow-origins=*` / `.mcp.json`** | **out of scope — Flight 7** | F6 must KEEP `dev:debug` alive (the un-migrated Group-B specs use it). The F6→F7 sequencing constraint. |
| **Spec baseline "11"** | **drifted** | 20 specs now (Mission 03 authored 9). Re-baselined: Group A (8) / Group B (12). |
| **`farbling-correctness` uses the disqualified `chrome-devtools` MCP** | **needs-human-recheck** | Unique among Group B; not in the proposed F6 subset. Confirm intent when/if migrated (a follow-on concern). |

**Apparatus premise to verify early (DD2):** the migrated specs' apparatus is the admin MCP client driving the chrome `wcId`. Both axes are unverified premises: **act** — `sendInputEvent` coords are tuned for guests (`input.js`), chrome trusted input unconfirmed; **observe** — `readAxTree` (in-process CDP `Accessibility.getFullAXTree`) attach on the chrome target unconfirmed. Resolve-or-divert in the `chrome-drive-spike` leg before locking the migrations.

---

## Design Review Notes

Architect review (2026-06-15): **approve with changes** — all incorporated (single cycle; reviewer-prescribed fixes, no new design risk → operator review is the next gate).
- **[HIGH] DD1 scope hole — FIXED in spec.** The chrome renderer's `webContents` uses `persist:goldfinch` (`PAGE_PARTITION`), the **same partition as the `default` jar**, so a default-jar key presenting the chrome `wcId` would PASS `resolveContentsForJar`'s session-membership check and drive the chrome (privilege escalation). DD1 now mandates an explicit chrome-contents exclusion guard in `resolveContentsForJar` (refuse the chrome `wcId` for any jar identity regardless of partition), with a unit test on the `default` jar.
- **[HIGH] DD3 threading — clarified.** Called out all four change sites incl. the renderer hook `__goldfinchAutomation.openTab` (container-lookup) + the unknown-jarId failure mode (refuse, no silent `DEFAULT_CONTAINER` fallback) + updating the stale `scope.js` "v1 limitation" comment.
- **[MED] DD2 spike** — added concrete pass-evidence ACs (readAxTree non-empty on chrome; click→observable DOM/focus change); noted the chrome-vs-Electron-internal-DevTools attach risk; hard ordering (after affordance, before migrations).
- **[MED] DD4 subset** — clarified `settings-shell` is the internal-guest + chrome-observe proof, NOT a chrome-trusted-input proof (that's tab-keyboard-operability/kebab-menu).
- **[MED] DD5 tool count** — adding `getChromeTarget` makes 17; `mcp-drive-end-to-end.md` asserts "exactly 16" → the count update is folded into the **`chrome-target-affordance` leg** (not the port-reconcile leg) so it never lags the tool.
- **[LOW]** `mcp-loopback-origin-guard` has `7777` in load-bearing expected-result strings (ss/lsof), not just URLs; `devtools-cdp-conflict` keeps `BLOCKED-AS-WRITTEN` after the port fix; `getChromeTarget` throws on null `mainWindow`. All recorded.
- Confirmed sound: the engine already drives a chrome `wcId` (resolve.js classifyContents); the admin-only `captureWindow` refusal pattern is the model; the 8-leg order with `chrome-drive-spike` before migrations; the admin-auto-mint apparatus; prerequisites.

---

## Leg Progress

### Leg 06: settings-cleanup — landed (2026-06-15)

**Status**: landed

**Changes Made**:
- `src/renderer/pages/settings.js` — added module-scope `_automationKeysOnce` variable and `automationKeysOnce()` function (lines 417–426, between the automation-controller IIFE and the key-management IIFE). Null-safe when `window.goldfinchInternal` is absent (`Promise.resolve(null)`); memoizes the first `bridge.automationListKeys()` call only.
- Key-mgmt IIFE on-load path (~line 592): replaced `refresh().catch(() => {})` with `automationKeysOnce().then((info) => { if (info) { renderJars(info.jars); renderAdmin(info.adminEnabled, info.adminKeySet); } }).catch(() => {})`. `clearReveal()` preceding call preserved.
- Activity-viewer IIFE jarNames seed (~line 612): replaced `bridge.automationListKeys()` with `automationKeysOnce()`; kept the `info && Array.isArray(info.jars)` guard and `if (lastSnap) renderActivity(lastSnap)` re-render unchanged.

**Notes**:
- All four mint/revoke `refresh()` sites confirmed untouched and still fresh: jar mint (~line 518: `refresh().then(() => reveal(key))`), jar revoke (~line 530: `.then(refresh).catch(showErr)`), admin mint (~line 570: `refresh().then(() => { if (key) reveal(key); })`), admin revoke (~line 576: `.then(refresh).catch(showErr)`). None route through `automationKeysOnce()`.
- Net effect: exactly ONE `automationListKeys()` IPC on page load (was two). Mint/revoke still re-fetch fresh via `refresh()`.
- `npm run typecheck`: clean. `npm run lint`: clean. `npm test`: **630 pass / 0 fail** (no main-process/unit surface touched — settings.js is renderer-only). *(The implementing Developer reported "569" here; the FD re-ran the suite directly and confirmed 630/630, exit 0 — the 569 was a stream miscount, not a regression.)*

---

### Leg 05: group-a-port-reconcile — landed (2026-06-15)

**Status**: landed

**Changes Made**:
- `tests/behavior/foreground-to-act.md` — Replaced 3 `127.0.0.1:7777` references (Preconditions: server URL, client URL, apparatus note) with `127.0.0.1:$GOLDFINCH_MCP_PORT`; added port-pin precondition bullet (default `49707`).
- `tests/behavior/observe-refusal-contract.md` — Replaced 3 `127.0.0.1:7777` references (Preconditions: server URL, client URL, apparatus note) with `127.0.0.1:$GOLDFINCH_MCP_PORT`; added port-pin precondition bullet.
- `tests/behavior/internal-session-exclusion.md` — Replaced 3 `127.0.0.1:7777` references (Preconditions: server URL, client URL, apparatus note) with `127.0.0.1:$GOLDFINCH_MCP_PORT`; added port-pin precondition bullet.
- `tests/behavior/devtools-cdp-conflict.md` — Replaced 2 `127.0.0.1:7777` references (client URL, apparatus note) with `127.0.0.1:$GOLDFINCH_MCP_PORT`; added port-pin precondition bullet. `BLOCKED-AS-WRITTEN` annotation and block rationale untouched.
- `tests/behavior/mcp-drive-end-to-end.md` — Replaced 4 `7777` references (server URL in Preconditions, Observables, Step 1 connect URL); rewrote the stale `.mcp.json` `goldfinch`-entry line (Preconditions line 3) to reference the SDK client / `scripts/mcp-example-client.mjs` at `$GOLDFINCH_MCP_PORT` (F5 removed the `.mcp.json` goldfinch entry — reference-scrub only); added port-pin precondition bullet. 17-tools list untouched.
- `tests/behavior/mcp-loopback-origin-guard.md` — Replaced all non-load-bearing `7777` references with `$GOLDFINCH_MCP_PORT`: Preconditions client URL and apparatus note; Step 2 connect URL and auto-Host description; Step 3 connect URL; Step 4 connect URL and auto-Host description; Step 5 both URLs and Host header; Step 6 connect URL (the `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` connect target). **Step-1 load-bearing `ss`/`lsof` strings updated** to `$GOLDFINCH_MCP_PORT` in all three address forms (`127.0.0.1:$GOLDFINCH_MCP_PORT`, `0.0.0.0:$GOLDFINCH_MCP_PORT`, `[::]:$GOLDFINCH_MCP_PORT`). **Step 6's `Host: 127.0.0.1:9999` preserved as 9999** (deliberate mismatched-port control; prose updated to explicitly call out that `9999` is not the listen port); added port-pin precondition bullet.

**Notes**:
- `grep -n "7777" tests/behavior/*.md` → zero hits (spec files clean).
- `grep -rn "7777" tests/behavior/` → hits in `tests/behavior/mcp-loopback-origin-guard/runs/2026-06-14-14-28-59.md` (6 hits) and `tests/behavior/mcp-auth-gating/runs/2026-06-14-13-20-52.md` (2 hits) and `tests/behavior/mcp-drive-end-to-end/runs/2026-06-14-15-29-23.md` (1 hit) — all under `*/runs/` (immutable historical evidence; expected).
- Step 6 of `mcp-loopback-origin-guard.md` still contains `9999`; prose reads coherently (explicitly labeled as mismatched-port control, not the listen port).
- `devtools-cdp-conflict.md` still carries `BLOCKED-AS-WRITTEN` annotation unchanged.
- `.mcp.json` `goldfinch`-entry reference scrubbed from `mcp-drive-end-to-end.md` line 16.
- `npm test`: 630 pass / 0 fail. `npm run typecheck`: clean. `npm run lint`: clean. (No source touched.)

---

### Leg 03: open-tab-jar-targeting — landed (2026-06-15)

**Status**: landed

**Changes Made**:
- `src/main/automation/mcp-tools.js` — added optional `jarId` to `openTab` `inputSchema` (string, not required); updated description to document jar-key confinement, admin-any, unknown-jar refusal; updated call seam to `engine.openTab(url, jarId)`.
- `src/main/automation/engine.js` — updated `openTab` op signature to `(url, jarId)` → `tabs.openTab(url, jarId, deps())`.
- `src/main/automation/tabs.js` — updated `openTab(url, jarId, { executeInRenderer })`: added `jarId` as second positional param; added `jarArg = jarId == null ? '' : ', ' + JSON.stringify(jarId)` guard to avoid `JSON.stringify(undefined)` footgun; updated JSDoc.
- `src/renderer/renderer.js` — updated `__goldfinchAutomation.openTab(url, jarId)`: added container-lookup on `containers` array when `jarId != null`; throws `'automation: unknown-jar — no container ' + jarId` on unknown jarId (no silent `DEFAULT_CONTAINER` fallback); passes resolved `container` (or `null`) to `createTab`.
- `src/main/automation/scope.js` — replaced stale v1-limitation `openTab` delegation with jar-targeted enforcement: `requireJar()` → refuse foreign jarId (`out-of-jar`) → `engine.openTab(url, jar.id)` (forces caller's own jar); updated module header comment (removed v1-limitation language; described the new jar-targeted behavior).
- `docs/mcp-automation.md` — updated `openTab` tool reference row (added `jarId?: string`, refusal semantics); replaced "Known limitation (v1)" bullet with `openTab` jar-targeting description including `out-of-jar`, `unknown-jar`, and admin-any semantics.
- `test/unit/automation-scope.test.js` — updated fake `engine.openTab` stub to 2-arity `(url, jarId)`; renamed + updated existing openTab delegation test (now asserts façade forces `jar.id`); added 3 new cases: `openTab(url, ownId)` allowed; `openTab(url, foreignId)` throws `out-of-jar` + engine not reached; admin passes jarId through.
- `test/unit/automation-mcp-tools.test.js` — updated existing openTab mapping test to assert `(url, undefined)` for no-jarId call; added test for jarId forwarding `engine.openTab(url, 'personal')`.
- `test/unit/automation-tabs.test.js` — updated all 6 existing `openTab` test calls from 2-arity to 3-arity `(url, null, { executeInRenderer })`; added 3 new tests: no-jarId produces single-arg call string; undefined jarId produces single-arg call string; with jarId produces exact two-arg string with `', '` separator.

**Notes**:
- Test suite: 630 tests, 0 fail (up from 623 — 7 net new tests). Typecheck: clean. Lint: clean.
- Behavior-spec grep finding: `grep -rn "openTab" tests/behavior/*.md` hit 2 files. `foreground-to-act.md` and `mcp-drive-end-to-end.md` reference `openTab` as a drive tool with no jarId (admin-context usage — unaffected by the jar-targeting change). `mcp-jar-scoping.md:81` explicitly states the old v1 limitation ("openTab cannot target a specific jar for a jar key"), which is now superseded — noted for leg 4 (the spec author note says "not asserted as a confinement step" — it was a note, not an AC; the spec remains correct in that the behavior test was not asserting the old behavior). No spec assumes the old "jar key tab lands in DEFAULT_CONTAINER" behavior as a test assertion; no spec edits required this leg per the leg instructions.
- AC3 renderer-side unknown-jar refusal is not unit-tested (renderer.js has no offline harness — confirmed by review); asserted live in leg 7 as specified.
- The stale `scope.js` "KNOWN LIMITATION (v1) … Acceptable for Flight 4" comment is confirmed removed: `grep -n "Acceptable for Flight 4" src/main/automation/scope.js` returns nothing.

---

### Leg 01: chrome-target-affordance — landed (2026-06-15)

**Status**: landed

**Changes Made**:
- `src/main/automation/resolve.js` — added chrome-exclusion guard in `resolveContentsForJar` (before the session-identity check; defense-in-depth per the corrected DD1 premise); updated JSDoc guard-order list.
- `src/main/automation/engine.js` — added `getChromeTarget` op: reads `getMainWindow()` directly, throws `automation: chrome-window-unavailable —…` (hyphenated code) on null window, returns `{ wcId, kind: 'chrome', url }`.
- `src/main/automation/scope.js` — added `getChromeTarget` admin-only refusal on the jar façade (mirrors `captureWindow`); updated module header comment to note the affordance now exists.
- `src/main/automation/mcp-tools.js` — added `CHROME_TOOLS` array with the `getChromeTarget` tool def; updated `TOOLS` to `[...DRIVE_TOOLS, ...OBSERVE_TOOLS, ...CHROME_TOOLS]` (17 total); updated assembly comment.
- `src/main/automation/mcp-server.js` — updated `buildServer` JSDoc "16 tools" → "17 tools".
- `tests/behavior/mcp-drive-end-to-end.md` — updated intent paragraph, Step 1 count + named list, Step 9 wording, Out of Scope paragraph: 16 → 17 + `getChromeTarget` added to list. Port references (`7777`) left untouched per leg scope.
- `docs/mcp-automation.md` — updated tool count strings (overview :16 → :17, tool-reference :177 → :17), added "Admin discovery (1)" subsection with `getChromeTarget` table row and admin-only note, updated admin identity section and the `wcId` link to discovery tools.
- `test/unit/automation-resolve.test.js` — added 3 tests: chrome-exclusion guard fires before session check (synthetic collision proof); null `chromeContents` is a no-op; undefined `chromeContents` is a no-op.
- `test/unit/automation-scope.test.js` — added 3 tests: jar `getChromeTarget` → admin-only, engine not reached; admin → engine reached; unknown jar → no-such-jar.
- `test/unit/automation-mcp-tools.test.js` — updated tool-count assertion 16 → 17; added 4 tests: `getChromeTarget` in listTools with no-input schema; callTool admin-path returns serialized target; callTool jar-path returns isError admin-only; callTool chrome-unavailable returns isError.
- `test/unit/automation-mcp-server.test.js` — updated `EXPECTED_TOOL_COUNT` constant 16 → 17 (pre-existing integration test that asserted the count via full SDK handshake).

**Notes**:
- Test suite: 623 tests, 0 fail. Typecheck: clean. Lint: clean.
- `TOOLS.length === 17` confirmed via `node -e` spot-check.
- `grep -n "16 tools" docs/ src/ tests/behavior/mcp-drive-end-to-end.md` returns nothing.
- The `automation-mcp-server.test.js` `EXPECTED_TOOL_COUNT` constant was a pre-existing assertion of the tool count via full SDK integration test; updated to 17 alongside the other "16 tools" references (the leg spec enumerated the four target files but this constant was causing a test failure — fix is in scope of AC7 "all gates green").

---

## Flight Director Notes
_Orchestration decisions recorded here during execution._

### 2026-06-15 — Flight start (FD: agentic-workflow)
- Phase file loaded: `.flightops/agent-crews/leg-execution.md` — validated (Crew / Interaction Protocol / Prompts all present; Developer=Sonnet, Reviewer=Sonnet). Defaults not needed.
- Operator sign-off obtained (the next gate per the Architect review note); flight `planning` → `in-flight`; pre-flight checklist closed (legs defined + sign-off).
- Branch: `flight/06-chrome-dogfood-affordance` created off `main`.
- Execution model (agentic-workflow): leg design reviewed per leg; implementation batched across autonomous legs; **single** code review + commit deferred to flight end. HAT leg (`hat-and-alignment`) runs interactively, not autonomously.
- Leg order honors the DD2 hard-ordering dependency: `chrome-target-affordance` → `chrome-drive-spike` (resolve-or-divert verdict) → remaining legs.
- Starting point: leg 1 `chrome-target-affordance` (legs/ dir empty — fresh flight, no prior leg state).

### 2026-06-15 — Autonomous batch reviewed + interim-committed (operator decision)
- **Operator chose an interim review+commit** of the 4 autonomous legs (de-risk uncommitted work; the live block gets its own review+commit later).
- **Reviewer (independent, Sonnet, fresh context — no Developer reasoning):** **[HANDOFF:confirmed]** — all four legs' ACs met; `npm test` 630/630; typecheck + lint green; zero stale "16 tools" or Group-A "7777"; `mcp-loopback-origin-guard` Step-6 `9999` + `devtools-cdp-conflict` `BLOCKED-AS-WRITTEN` preserved. No blocking/non-blocking issues.
- Legs 1, 3, 5, 6 → **completed**, checked off in flight.md, and committed (code + leg artifacts + flight log; the unrelated untracked `src/renderer/assets/gf_01*.png` were deliberately NOT staged). Draft PR opened with the 4 legs checked, the live legs (2/4/7/8) unchecked. Flight stays **in-flight**.
- Next: the live block — leg 2 spike → leg 4 → leg 7 → leg 8 — in a session with the operator; then mark PR ready + land the flight.

### 2026-06-15 — Autonomous batch complete (legs 1, 3, 5, 6 landed)
- Legs **1** (chrome-target-affordance), **3** (open-tab-jar-targeting), **5** (group-a-port-reconcile), **6** (settings-cleanup) all landed, uncommitted (batched). Each: FD-designed → Developer design-reviewed (legs 1, 3, 6; leg 5 review FD-skipped as low-risk spec-only) → Developer-implemented.
- **Suite state (FD-verified directly): `npm test` = 630 / 630 pass / 0 fail (exit 0), 22 files; typecheck + lint clean.**
- **Remaining = the live block** (awaiting operator session): leg 2 `chrome-drive-spike` (resolve-or-divert) → leg 4 `migrate-subset-specs` (depends on the spike verdict) → leg 7 `verify-integration` → leg 8 `hat-and-alignment`. Then the single flight review + commit + PR + land.
- **Open orchestration question for the operator**: interim review+commit of the 4 autonomous legs now (de-risk uncommitted work) vs. one combined review+commit after the live block.

### 2026-06-15 — Leg resequencing (operator decision: autonomous-first)
- Leg 1 landed (incl. a follow-up stale-count sweep — see Anomalies). Leg 2 `chrome-drive-spike` designed (`ready`) but it is a **live** verification spike (needs the running GUI app + admin MCP client + a resolve-or-divert call) — a headless subagent can't reliably drive the WSLg display, and the M02 standard is FD-driven live runs.
- **Operator decision (2026-06-15):** run the **autonomous, no-live-app legs first** — `open-tab-jar-targeting` (3), `group-a-port-reconcile` (5), `settings-cleanup` (6) — then run the **live block together later**: leg 2 spike → leg 4 `migrate-subset-specs` → leg 7 `verify-integration` → leg 8 HAT. **Leg 4 stays after leg 2** (its spec assertions depend on the spike's resolve-or-divert verdict — a11y-tree vs DOM-shape, subset membership), preserving the DD2 hard-ordering dependency.
- Execution order this session: **leg 3 → leg 5 → leg 6**, then pause for the live session. Each gets design + design-review + implement (batched; no per-leg commit). The single flight review + commit + PR happens after the live block lands (or, if the operator prefers, an interim commit of the autonomous legs can be taken — to be confirmed before committing).

---

## Decisions
_Runtime decisions not in the original plan._

### DD1 "partition collision" security premise corrected (leg 1 design review, 2026-06-15)
**Context**: DD1 and the planning-time Architect review framed the chrome-exclusion guard as plugging a **live** privilege escalation: "the chrome renderer's `webContents` uses `persist:goldfinch` — the same partition as the `default` jar — so a default-jar key presenting the chrome `wcId` would PASS `resolveContentsForJar`'s session check and drive the chrome."
**Decision**: The leg-1 Developer design review checked this against the code and found it **factually wrong**, which the FD confirmed directly: `mainWindow`'s `webPreferences` (main.js:197-209) specifies **no `partition`/`session`**, so `mainWindow.webContents.session === session.defaultSession`. The `default` jar uses `persist:goldfinch` (jars.js:22) — a distinct Session object — and `jars.js:42` forces every jar partition to match `/^persist:/`, so no jar's session can ever equal `defaultSession`. A `default`-jar key presenting the chrome `wcId` is therefore **already** refused by the existing session check (`out-of-jar`); there is no live escalation.
**Impact**: The chrome-exclusion guard is **retained** (the flight deliverable is unchanged) but reframed as **defense-in-depth** — object-identity exclusion robust against future config changes that could give the chrome a jar-aliased session. The leg-1 unit test proves the guard fires before/independent of the session check using a synthetic fake (not the false real-world collision). Leg-1 artifact (Context, AC2, impl step 1, Edge Cases, Citation Audit) reframed accordingly. **DD1's body in flight.md is left as the planning snapshot** (per the FD scope-change discipline — inspection records are snapshots, not living plans); this Decision is the authoritative correction. No operator escalation needed — guard + tests stand; only the rationale changed.

### Leg 5 design review — SKIPPED (FD decision, low-risk spec-only leg)
`group-a-port-reconcile` is markdown-only (no source, no security surface) and the FD walked **every** `7777` citation against the live specs during design (the recon grep cross-referenced all 6 specs' exact lines + the load-bearing `ss`/Host strings in `mcp-loopback-origin-guard` + the deliberate Step-6 `9999` + the stale `.mcp.json` ref). The independent-verification value of a design-review spawn is marginal here; the implementing Developer self-verifies (final `grep 7777` empty, `9999` preserved, `BLOCKED-AS-WRITTEN` preserved). Per the agentic-workflow FD discretion on review depth, the separate design-review cycle is skipped for this leg. (Legs 1, 3, and the code legs still get full design review.)

### Leg 3 design review — approve with changes (single cycle)
Reviewer verdict: **approve with changes**. Two [HIGH]: the existing 1-arity `openTab` test stubs + assertions (`automation-scope.test.js:62/202`, `automation-mcp-tools.test.js:62/182`) will break on the arity change → leg now explicitly instructs updating them (not just adding cases). Two [MED]: AC2 startup-race semantic-tightening note added; docs verification strengthened beyond a bare grep. Reviewer confirmed the load-bearing premises sound: `executeJavaScript` rejection-on-throw propagates renderer→tabs→engine→callTool→isError; the `jarId == null` footgun guard is correct; `enumerateTabs` session-identity filter keeps the new in-jar tab visible (no cross-jar gap); `automation-tabs.test.js:208-257` is the openTab unit-test home. All incorporated; test-guidance-only refinements (no design change) → second cycle skipped. Leg → `ready`; implementing.

### Leg 1 design review — approve with changes (single cycle)
Reviewer verdict: **approve with changes**. [HIGH] partition-collision premise correction (above). [MED] two more `16 tools` strings in `docs/mcp-automation.md` (:16, :177) folded into leg scope. [LOW] greppable intent string + `makeFakeEngine` test-helper gap noted. All incorporated into the leg artifact. Changes were rationale-text + scope-additions the reviewer itself prescribed (guard code + tests unchanged, no new design risk) → **second review cycle skipped** per the agentic-workflow "skip if only minor/cosmetic fixes" rule. Leg status → `ready`; proceeding to implementation.

---

## Deviations
_Departures from the planned approach._

---

## Anomalies
_Unexpected issues._

### Leg-1 "16 tools" sweep was scoped too narrowly (caught by FD, 2026-06-15)
**Observed**: The leg-1 Developer verified "no stale 16-tools strings" with `grep -n "16 tools" docs/ src/ tests/behavior/mcp-drive-end-to-end.md` — a path list that excluded `scripts/`, `CLAUDE.md`, and `test/`. Three live references survived: `scripts/mcp-example-client.mjs:4,65` ("16 tools"/"16 Goldfinch tools" comments), `CLAUDE.md:167` ("advertises **16 tools**" + named 12+4 list missing `getChromeTarget`), and `test/unit/automation-mcp-server.test.js:250` (test *name* "returns 16 tools"; the `EXPECTED_TOOL_COUNT` constant was correctly updated to 17, so the test passes — only the title is stale).
**Severity**: cosmetic/degraded (docs + a test title; no functional defect — all gates were green).
**Resolution**: FD spawned a follow-up Developer to finish the sweep across `scripts/` + `CLAUDE.md` + the test title, with a repo-wide verification grep (excluding `node_modules`, `missions/`, and immutable `tests/behavior/*/runs/` historical run logs). **Process lesson for future legs**: a "no stale references" AC must be verified with a repo-wide grep (minus vendored/immutable trees), not a narrow hand-picked path list.

---

## Session Notes
_Chronological notes from work sessions._
