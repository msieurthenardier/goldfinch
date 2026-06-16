# Flight: Chrome-driving affordance + behavior-spec dogfooding (scoped)

**Status**: in-flight
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC11 (part 1, scoped)** — Goldfinch's **own behavior tests run against this surface** (dogfooding). This flight delivers the *enabling capability* (an admin client can drive the **chrome renderer** over the MCP surface) and **proves it** by migrating a representative **subset** of the CDP-`:9222` chrome-driving specs onto the surface. The **bulk** migration (the remaining Group-B specs) + the `a11y-audit.mjs` rewrite + retiring the ungated `:9222` path are explicitly **out of scope** (a follow-on flight + Flight 7).

---

> **Scope (operator-agreed, 2026-06-15).** "Enable + prove + migrate a subset." F6 builds the chrome-enumeration affordance + `openTab` jar-targeting + verifies trusted-input/read on the chrome, then migrates a **small representative subset** of Group-B specs to demonstrate end-to-end dogfooding. It does NOT migrate all 12 Group-B specs. `dev:debug`/`:9222` stays alive (the un-migrated specs still use it; Flight 7 retires it — the F6→F7 sequencing constraint).

> **Re-baseline.** The mission's "11 specs at Mission-02 close" is stale — there are **20 specs** now (Mission 03 authored 9). They split into **Group A** (8 already on the MCP surface; 6 hardcode the old `7777`) and **Group B** (12 CDP-`:9222` chrome-driving specs = migration targets). See the flight-log Reconnaissance Report.

## Pre-Flight

### Objective
Make the chrome renderer (tab strip, toolbar, kebab, window controls) drivable by a **trusted admin MCP client** — today the engine can drive a chrome `webContents` but **no tool discovers its `wcId`** (`enumerateTabs` lists only guest `<webview>` tabs). Build a dedicated **admin-only `getChromeTarget` tool** that returns the chrome `wcId`, verify trusted input + DOM/a11y reads work against the chrome, add **`openTab` jar-targeting**, then **migrate a representative subset** of Group-B chrome specs onto the admin surface (dogfooding) — proving Goldfinch can drive its own chrome tests without the ungated `:9222`/`cdp-driver.mjs` path. Also: reconcile the 6 Group-A `7777` specs (port-only) and consolidate the dual `automationListKeys()` call. Include a guided HAT.

### Open Questions
- [x] **Scope** → RESOLVED: enable + prove + subset (operator).
- [x] **Chrome-affordance shape** → RESOLVED (DD1): a dedicated admin-only `getChromeTarget` tool (operator chose this over an `enumerateTabs` `type:'chrome'` entry).
- [x] **Carried items to fold in** → RESOLVED: `openTab` jar-targeting (DD3) + the 6 Group-A `7777` port fixes (DD5) + the dual-`automationListKeys` cleanup (DD6). **Deferred:** the `devtools-cdp-conflict` non-CDP DevTools-open affordance.
- [x] **HAT** → RESOLVED: include it (DD7).
- [ ] **Subset membership** → propose `tab-keyboard-operability` + `kebab-menu` (pure chrome-renderer proofs: trusted keys/clicks + chrome DOM/a11y) + `settings-shell` (admin→internal-guest + the chrome address-bar chip). Confirm/adjust at execution (low-stakes; the proof set just needs to exercise getChromeTarget + chrome trusted-input + chrome read + the internal-guest path).
- [ ] **Trusted-input-on-chrome premise** → the apparatus DD rests on `sendInputEvent` firing real handlers + native focus traversal on the **chrome** `wcId` (coords today are tuned for guests). MUST be verified early (DD2) before the migrations are locked — a resolved-or-divert item.

### Design Decisions

**DD1 — Dedicated admin-only `getChromeTarget` MCP tool (the chrome-enumeration affordance).**
- Choice: add a new MCP tool `getChromeTarget` that returns the chrome renderer's `wcId` (`mainWindow.webContents.id`) + minimal metadata (e.g. `{ wcId, kind:'chrome', url }`), **assembled in main** (the scope ctx already injects `getChromeContents`), exposed **only to the admin identity** (jar keys get the `automation: admin-only` refusal, mirroring `captureWindow`). The returned `wcId` is then passed to the existing drive/observe tools (`click`/`typeText`/`pressKey`/`scroll`/`readDom`/`readAxTree`), which already special-case chrome (no foreground-to-act).
- Rationale: the engine can already drive a chrome `wcId` (`resolve.js` `classifyContents` → `'chrome'`; every op skips activate for chrome); the **only** gap is discovery. A dedicated tool (vs an `enumerateTabs` `type:'chrome'` row) keeps "tabs" (guest enumeration) and "chrome" (the singular app shell) as distinct concepts and makes the admin-only scoping explicit at the tool boundary. The renderer's `listTabs()` cannot supply the chrome's own `webContents.id`, so this MUST be assembled main-side — a dedicated tool makes that natural.
- Trade-off: a 17th tool + a second discovery path. Accepted for the clearer separation + explicit admin gating. **Adding the 17th tool breaks `mcp-drive-end-to-end.md`'s "exactly 16 tools" assertion (Step 1 + its named list) — this leg MUST update that spec to 17 + add `getChromeTarget` to the list**, or the next run regresses. Do it in THIS leg (not deferred to `group-a-port-reconcile`) so there's never a window where the count is wrong.
- **Null window:** if `mainWindow` is null (closed/startup), `getChromeTarget` throws `automation: chrome-window-unavailable` (mirrors `captureWindow`'s null-`chromeContents` throw in `observe.js`), never a soft `{wcId:null}`.
- **Hard constraint — the security crux (Architect HIGH, must-fix):** jar keys must NEVER reach the chrome `wcId`. The current `resolveContentsForJar` (`resolve.js`) gates by **session membership** (`wc.session === fromPartition(jar.partition)`) — but the chrome renderer's `webContents` uses `persist:goldfinch` (`PAGE_PARTITION`), the **same partition as the `default` jar**, so a default-jar key presenting the chrome `wcId` to `click`/`readDom`/etc. would PASS the session check and drive the chrome — a privilege escalation. Fix: add an **explicit chrome-contents exclusion** in `resolveContentsForJar` — `if (deps.chromeContents != null && wc === deps.chromeContents) throw 'automation: out-of-jar'` (or a distinct `chrome-only`) — **before** the session check, so a jar key is refused the chrome regardless of partition. The leg's unit test MUST cover: a jar key (esp. the `default` jar) presenting the chrome `wcId` → explicit rejection. `getChromeTarget` itself stays admin-only at the façade (mirrors `captureWindow`'s `admin-only` refusal); this guard is defense-in-depth for the wcId-first ops that take a caller-supplied `wcId`.

**DD2 — Apparatus premise audit: trusted input + DOM/a11y read on the chrome, verified EARLY (act + observe axes).**
- Choice: before locking the migrations, verify on the **chrome** `wcId` that (act) `sendInputEvent` click/type/key fire the chrome's real handlers + native focus traversal (equivalent to `cdp-driver.mjs`'s trusted input), and (observe) `readDom` returns the chrome DOM, `readAxTree` attaches `Accessibility.getFullAXTree` on the chrome target live, and `captureWindow` images it. This is the apparatus DD for every migrated spec; both axes are premises, not assumptions.
- Rationale: `input.js` coords were tuned for guests (the recon flags chrome synthetic-input as unverified); `readAxTree` uses the in-process CDP debugger and its attach on the chrome target is unconfirmed. A skipped observability/act audit becomes a mid-flight scramble.
- **Pass evidence (the spike's own ACs):** (observe) `readDom` on the chrome `wcId` returns the chrome DOM; `readAxTree` returns a **non-empty AXNode array** on the chrome `wcId`; `captureWindow` returns an image. (act) a `click` at a known chrome coordinate (or a `pressKey`) produces an **observable** chrome change — a DOM mutation or focus change read back via `readDom` (e.g. focus moves to the address bar / a toolbar button's `aria`/`data-state` flips). Record the verdict.
- **Note (Architect):** `readAxTree` uses the in-process CDP debugger (`cdp.js` `withDebuggerSession`, attach `'1.3'`); its attach on a GUEST is already only runtime-verified, and the **chrome** renderer's `webContents` may interact with Electron's own internal DevTools session differently — the spike is exactly where this is settled.
- **Resolve-or-divert:** if chrome trusted input is unreliable (coordinate space, focus), F6 fixes it in the engine (chrome coord handling) before migrating; if `readAxTree` cannot attach on chrome, the migrated specs assert via `readDom` (DOM-shape) instead of the a11y tree, recorded as a limitation. Verified in the first verification leg (`chrome-drive-spike`) — a **hard ordering dependency**: it runs after `chrome-target-affordance` (needs the tool to get a wcId) and before the migrations (which depend on its verdict).

**DD3 — `openTab` jar-targeting.**
- Choice: add an optional `jarId` (container) param to the `openTab` tool → `tabs.openTab(url, jarId, ...)` → **the renderer hook `__goldfinchAutomation.openTab` (`renderer.js`) accepts the jarId and looks up the container** from its `containers` array → `createTab(url, container)` (the renderer signature `createTab(url, container, {trusted})` already exists). A **jar key** may only open in its own jar (the scope façade forces the caller's jarId; a mismatched/foreign jarId is refused); **admin** may target any jar. Default (no jarId) preserves today's behavior.
- **Change sites (all four, Architect):** `mcp-tools.js` (add `jarId` to the `openTab` inputSchema + call seam), `tabs.js` (`openTab(url, jarId, {executeInRenderer})`), **`renderer.js` `__goldfinchAutomation.openTab`** (accept + container-lookup), `scope.js` (jar-key → own-jar enforcement; also **update the stale "KNOWN LIMITATION (v1)… acceptable for Flight 4" comment** at the openTab delegation so it no longer misleads).
- **Unknown-jarId failure mode (Architect Q2):** if the renderer's `containers` list lacks the requested jarId (startup race before `jars-changed`, or a bad id), **refuse the open** (return an error result) — do NOT silently fall back to `DEFAULT_CONTAINER` (that's the exact silent-wrong-jar bug this DD fixes). The scope façade already validated the jarId for a jar key; admin-supplied unknown ids are refused too.
- Rationale: closes the F4→F5 carried gap — today a jar key's new tab lands in the renderer's active container and can silently fall outside the jar (absent from `enumerateTabs`, no error). Needed for clean jar-scoped specs and correct agent ergonomics.
- Trade-off: threads a container arg through four layers; the scope façade gains an openTab jar check.

**DD4 — Migrate a representative subset (proof), defer the bulk.**
- Choice: migrate **~2–3 Group-B specs** that together exercise the full new capability:
  - `tab-keyboard-operability` + `kebab-menu` — the **chrome trusted-input** proofs (trusted keys/clicks on the chrome `wcId` via `getChromeTarget` + chrome DOM/a11y read + menu dismissal).
  - `settings-shell` — the **internal-guest + chrome-observe** proof (admin opens the `goldfinch://settings` guest — already admin-enumerable as a tab — and reads the chrome **address-bar chip** via `getChromeTarget`+`readDom`/`readAxTree`). *(Architect clarification: `settings-shell` is NOT a chrome-trusted-input proof — it mostly reads the chrome chip + drives the settings guest; the input proof is the tab/kebab pair.)*
  The remaining 9 Group-B specs are a **follow-on flight** (or fold into Flight 7's apparatus work).
- Rationale: the operator chose "prove the capability, migrate a subset." Together the set covers getChromeTarget + chrome trusted input (tab/kebab) + chrome DOM/a11y read + the internal-guest path (settings-shell) — the whole apparatus — without a 12-spec sprawl.
- Trade-off: most Group-B specs stay on `:9222` after F6 (so `dev:debug` stays alive — F7 territory). Recorded; not a silent omission.

**DD5 — Apparatus + the Group-A `7777` reconciliation.**
- Choice: the migrated specs' apparatus = an **admin MCP client over the loopback surface** (`dev:automation` + the auto-mint-to-stdout admin key, `GOLDFINCH_AUTOMATION_DEV_MINT=1` + `GOLDFINCH_AUTOMATION_ADMIN=1`, port pinned via `GOLDFINCH_MCP_PORT`). Separately, reconcile the **6 Group-A specs** (`foreground-to-act`, `observe-refusal-contract`, `internal-session-exclusion`, `devtools-cdp-conflict`, `mcp-drive-end-to-end`, `mcp-loopback-origin-guard`) from hardcoded `7777` → `GOLDFINCH_MCP_PORT`/`49707`, and **scrub the stale `.mcp.json` `goldfinch` reference** in `mcp-drive-end-to-end` (the entry was removed in F5).
- **Reconciliation is not a blind `s/7777/49707/` (Architect):** `mcp-loopback-origin-guard` carries `7777` in **load-bearing expected-result strings** (the `ss`/`lsof` "listener on `127.0.0.1:7777`" checks, the Host-header rows), not just apparatus URLs — update those too. `devtools-cdp-conflict` keeps its **`BLOCKED-AS-WRITTEN`** annotation after the port fix (its non-CDP DevTools-open affordance stays deferred) — port-only, preserve the block note. (The `mcp-drive-end-to-end` "16 tools → 17 + getChromeTarget" assertion update is done in the `chrome-target-affordance` leg per DD1, NOT here, so it never lags the tool.)
- Rationale: Group A is already on the surface; their only F6 debt is the stale port. Light, bundled because it's the same "dogfooding hygiene" surface.
- Trade-off: none material.

**DD6 — `settings.js` cleanup: consolidate the dual `automationListKeys()`.**
- Choice: the key-management IIFE and the activity-viewer IIFE each call `automationListKeys()` on load; consolidate into one shared page-scope init that fetches once and distributes to both. (F5 debrief cleanup.)
- Rationale: one fewer IPC round-trip; non-blocking debt flagged in the F5 review.

**DD7 — Guided HAT.**
- Choice: include the optional `hat-and-alignment` leg — the operator drives the chrome affordance + the migrated specs live, fixing issues inline. The HAT caught real integration gaps in F3/F5; dogfooding the chrome affordance is exactly where it pays off.

### Prerequisites
- [ ] **Flight 5 landed on `main`** (the auth core + admin tier + auto-mint apparatus + the audit surface). Satisfied (Mission 03 flights 1–5 merged to `main`, v0.5.0).
- [ ] **`dev:automation` + admin auto-mint** is the apparatus — confirm `GOLDFINCH_AUTOMATION_DEV_MINT=1` + `GOLDFINCH_AUTOMATION_ADMIN=1` mints an admin key to stdout (verified live in F5/F6 prep).
- [ ] **`dev:debug`/`:9222` stays intact** through F6 (the un-migrated Group-B specs still use it). Do NOT touch `--remote-allow-origins=*` (Flight 7).
- [ ] **Port**: pin `GOLDFINCH_MCP_PORT` for runs (default `49707`); no new port/bind (reuses the F3–F5 loopback server).
- [ ] **`a11y-audit.mjs` untouched** (Flight 7).
- [ ] **The chrome `wcId` is reachable in the scope ctx** — `main.js` already injects `getChromeContents: () => mainWindow.webContents`; confirm at the façade.

### Pre-Flight Checklist
- [ ] Open questions resolved (subset membership + the trusted-input-on-chrome premise are confirmed at execution / DD2's early leg)
- [ ] Design decisions documented (DD1–DD7) + Architect-reviewed
- [ ] Prerequisites verified (F5 on main; admin auto-mint; dev:debug intact; chrome contents in scope ctx)
- [ ] Validation approach defined (the migrated subset specs run on the admin surface + the chrome-drive premise spike + unit tests for getChromeTarget/openTab scope)
- [x] Legs defined
- [x] Operator sign-off

---

## In-Flight

### Technical Approach
1. **`chrome-target-affordance`** — add the admin-only `getChromeTarget` MCP tool (tool def + façade method returning `mainWindow.webContents.id`, throwing `chrome-window-unavailable` when null); scope it to admin in `scope.js` (jar keys → `admin-only` refusal); **add the explicit chrome-contents exclusion guard in `resolveContentsForJar` (DD1 HIGH security fix)**; update `mcp-drive-end-to-end.md`'s tool-count assertion 16 → 17 + add `getChromeTarget` to the named list (so it never lags the tool); document the tool in `docs/mcp-automation.md`. Unit tests: admin gets the chrome wcId; a jar key (incl. `default`) is refused `getChromeTarget` AND refused the chrome wcId via the wcId-first ops (the exclusion guard).
2. **`chrome-drive-spike`** (DD2 apparatus premise audit) — a verification leg: with an admin client, exercise `getChromeTarget` → `readDom`/`readAxTree`/`captureWindow` (observe) and `click`/`typeText`/`pressKey` (act) on the chrome `wcId`; confirm trusted input fires chrome handlers + native focus and the reads work. Resolve-or-divert: fix chrome coord/focus handling or fall back to DOM-based assertions if a11y can't attach. Record the verdict (this de-risks every migration).
3. **`open-tab-jar-targeting`** — add the `jarId` param across all four sites (`mcp-tools.js` schema → `tabs.js` → **`renderer.js` `__goldfinchAutomation.openTab` container-lookup** → `createTab(url, container)`); scope-enforce (jar key → own jar only; admin → any); refuse an unknown jarId (no silent `DEFAULT_CONTAINER` fallback); update the stale `scope.js` "KNOWN LIMITATION (v1)" comment; document `openTab.jarId` in `docs/mcp-automation.md`; unit + engine tests.
4. **`migrate-subset-specs`** — rewrite the chosen subset (`tab-keyboard-operability`, `kebab-menu`, `settings-shell` — confirm) from the CDP-`:9222`/`cdp-driver.mjs` apparatus onto the admin MCP client + `getChromeTarget`. Update each spec's Preconditions/Observables/Apparatus to the new surface; keep the step semantics. (Spec-authoring; the runs happen in `verify-integration`.)
5. **`group-a-port-reconcile`** — the 6 Group-A specs `7777` → `GOLDFINCH_MCP_PORT`/`49707`; scrub the stale `.mcp.json` reference in `mcp-drive-end-to-end`. No semantic changes.
6. **`settings-cleanup`** — consolidate the dual `automationListKeys()` in `settings.js` (DD6).
7. **`verify-integration`** — run the migrated subset specs live on the admin surface (FD-driven, cited evidence); full unit + typecheck + lint green; confirm `dev:debug` still works for the un-migrated specs (no regression).
8. **`hat-and-alignment`** *(optional — included)* — guided HAT of the chrome affordance + the migrated specs.

### Checkpoints
- [ ] `getChromeTarget` admin-only tool + scope tests (jar key refused).
- [ ] Chrome-drive premise verified (trusted input + DOM/a11y read + captureWindow on the chrome wcId) — DD2 resolve-or-divert recorded.
- [ ] `openTab` jar-targeting (jar key → own jar; admin → any) + tests.
- [ ] Subset specs rewritten onto the admin MCP surface.
- [ ] 6 Group-A specs reconciled to the new port; stale `.mcp.json` ref scrubbed.
- [ ] `automationListKeys()` consolidated.
- [ ] Live: subset specs pass on the admin surface; full gates green; `dev:debug` un-migrated specs unaffected.
- [ ] Guided HAT.

### Adaptation Criteria
**Divert if**:
- Chrome trusted input (`sendInputEvent`) can't be made reliable on the chrome `wcId` (coordinate/focus) → narrow the subset to read-only/observe-driven chrome specs + record the act-axis limitation for the engine to address before the bulk migration.
- `readAxTree` (`Accessibility.getFullAXTree`) cannot attach on the chrome target → migrated specs assert via `readDom` (DOM-shape) instead of the a11y tree; record it.

**Acceptable variations**:
- Exact subset membership (any 2–3 specs that exercise getChromeTarget + chrome input + chrome read + the internal-guest path).
- `getChromeTarget` return shape (wcId + optional metadata).
- Whether the chrome-drive spike is its own leg or folded into the affordance leg's verification.

### Legs
> **Note:** Tentative; created one at a time as the flight progresses. May merge/split.

- [x] `chrome-target-affordance` — admin-only `getChromeTarget` tool + scope + tests. (DD1)
- [ ] `chrome-drive-spike` — verify trusted input + DOM/a11y read + captureWindow on the chrome wcId (apparatus premise). (DD2)
- [x] `open-tab-jar-targeting` — `openTab` jarId param + scope enforcement + tests. (DD3)
- [ ] `migrate-subset-specs` — rewrite the chosen subset onto the admin MCP surface. (DD4, DD5)
- [x] `group-a-port-reconcile` — 6 Group-A `7777` → port; scrub stale `.mcp.json` ref. (DD5)
- [x] `settings-cleanup` — consolidate dual `automationListKeys()`. (DD6)
- [ ] `verify-integration` — run the migrated subset live (admin surface) + full gates + dev:debug regression check. (DD4)
- [ ] `hat-and-alignment` *(optional — included)* — guided HAT. (DD7)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (PR onto `main`)
- [ ] Tests passing (unit for getChromeTarget/openTab scope + typecheck + lint)
- [ ] Documentation updated (`docs/mcp-automation.md`: the `getChromeTarget` admin tool + `openTab` jarId; CLAUDE.md automation note); the migrated specs + the 6 reconciled specs reflect the surface/port
- [ ] Flight debrief written (separate `/flight-debrief` step)

### Verification
- **Unit**: `getChromeTarget` scoping (admin returns the chrome wcId; jar key → `admin-only`; a jar key presenting the chrome wcId still hits the exclusion); `openTab` jar-targeting (jar key confined to its jar; admin any jar; default unchanged).
- **Chrome-drive premise (DD2)**: an admin client drives + reads the chrome wcId live (trusted input fires handlers; `readDom`/`readAxTree`/`captureWindow` read it) — recorded in the spike leg.
- **Behavior tests (admin MCP surface)**: the migrated subset (`tab-keyboard-operability`, `kebab-menu`, `settings-shell` — confirm) pass driven by the admin MCP client + `getChromeTarget`, NOT `cdp-driver.mjs`/`:9222`.
- **Regression**: the un-migrated Group-B specs still run on `dev:debug`/`:9222` (untouched); full `npm test` + typecheck + lint green.
- SC11-part-1 (scoped): the chrome-driving affordance exists + a representative subset dogfoods on the surface; the bulk migration + `a11y-audit` rewrite + ungated-path retirement remain (follow-on + Flight 7).
