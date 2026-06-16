# Flight Debrief: Chrome-driving affordance + behavior-spec dogfooding (scoped)

**Date**: 2026-06-16
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](flight.md)
**Status**: landed
**Duration**: 2026-06-15 → 2026-06-16 (planning landed 2026-06-15; execution + HAT 2026-06-15/16)
**Legs Completed**: 8 of 8

## Outcome Assessment

### Objectives Achieved
The flight delivered **SC11 part 1 (scoped)** — the chrome renderer is now drivable by a trusted admin MCP client, and a representative subset of the CDP-`:9222` chrome-driving specs dogfoods on the surface:
- **`getChromeTarget`** (17th MCP tool, admin-only) returns the chrome `wcId`; the existing drive/observe tools act on it. A defense-in-depth chrome-contents exclusion guard in `resolveContentsForJar` backstops the façade gate.
- **`openTab` jar-targeting** (DD3) threads a `jarId` through all four layers; jar keys are confined to their own jar (the old silent `DEFAULT_CONTAINER` fallback is gone), admin targets any jar, unknown jarId is refused.
- **DD2 spike RESOLVED both axes live, confound-free**: `readAxTree` returned 335 AXNodes on the chrome target without `:9222` (the mission's chief open unknown — settled); trusted `click`/`typeText`/`pressKey` fire real handlers + native focus traversal.
- **Three specs migrated** (`tab-keyboard-operability`, `kebab-menu`, `settings-shell`) and **verified passing live** on the admin surface; **6 Group-A specs** reconciled to `$GOLDFINCH_MCP_PORT`; the dual `automationListKeys()` consolidated.
- **HAT** surfaced and fixed three real gaps inline (below).

All checkpoints met. Final gates: **650/650 tests, typecheck + lint green.** PR #44 ready for review.

### Mission Criteria Advanced
- **SC11 (part 1, scoped)** — the enabling chrome-driving capability exists + a representative subset dogfoods on the surface. (Bulk migration + `a11y-audit.mjs` rewrite + ungated-path retirement remain — Flight 7.)
- **SC10 (auditability)** — *strengthened* beyond its F4/F5 baseline: the HAT-driven audit `detail` field makes the activity log actionable (per-action "where": URL / coords / key), with `typeText` redacted.

## What Went Well

- **The DD2 spike-before-migration hard ordering was vindicated.** Proving the apparatus live before authoring the migrations meant leg 4's CDP→MCP mapping table was grounded in concrete spike results (the `(400,63)` omnibox coordinate, the 335-node AXTree, the focus-anchor rule) rather than hypotheses. No divert, no engine fix needed.
- **Design review caught real spec-level errors before implementation.** Leg-1's factually-wrong "partition collision" security premise was corrected against `main.js:197-209` (chrome uses `session.defaultSession`, which no jar aliases); leg-3's spec under-cited the four `refresh()` mint/revoke sites that must NOT be consolidated. Granular per-leg Citation Audits did their job.
- **The HAT paid real dividends — exactly its rationale.** Operator interaction with the live product surfaced three gaps the FD-driven automated passes (leg 7) did not: the SC10 audit-context gap, the port Save dirty-state, and the misleading "(takes effect on next launch)" note. All fixed inline + re-verified before sign-off.
- **The autonomous-first / live-block split + interim commit worked cleanly.** Legs 1/3/5/6 ran autonomously and were reviewed + committed (PR #44) to de-risk uncommitted work; the live block (2/4/7/8) followed in an operator session. The DD2 ordering was preserved.
- **Architecture held.** The automation engine's electron-free/injected-deps discipline, the scope-façade identity model, the `automation: <code> — …` error convention, and the single audit choke-point were all maintained. `deriveAuditDetail` is a pure mapping at the one `record()` site; `getChromeTarget`'s separate discovery path is a deliberate, clean separation.

## What Could Be Improved

### Process
- **Flight-design-level security premises weren't code-verified.** DD1's partition-collision claim was designated HIGH must-fix without walking `main.js:197-209` — the leg-design review caught it because its Citation Audit is more granular. **Lesson**: apply a flight-design citation audit to the code premises of any security-crux DD, not just at leg design.
- **The "16 tools" sweep used a hand-picked path list** and missed `scripts/mcp-example-client.mjs`, `CLAUDE.md`, and a test title (the FD caught it via follow-up). **Lesson**: a "no stale references" AC must be verified with a **repo-wide** grep (minus vendored/immutable trees), not a narrow path list.
- **The SC10 audit-context gap should have been anticipated at flight design** — this flight was explicitly about dogfooding the audit viewer, yet the audit record's lack of per-action context wasn't on any AC; the HAT caught it. **Lesson**: when a flight extends the audit surface or adds tool ops, make "is the audit entry actionable?" a review criterion (e.g. an AC: "URL-bearing ops record the URL").

### Technical
- **Blind-coordinate chrome clicking is real, compounding debt.** Chrome `click(wcId,x,y)` has no selector mechanism — specs locate controls via a `captureWindow` screenshot and hardcode approximate coordinates (leg 7 logged a tuning artifact: Settings item needed x=1300, not x=1265). This is environment-fragile (window size / DPI / element moves) with no error signal, and it will compound across Flight 7's 9-spec bulk migration. An element-addressing affordance (a `findElement(selector)→coords` tool resolving an a11y/DOM node to a hit-testable point) is the structural fix — mission Flight 9 territory.
- **Audit `detail` has no paging** (`LOG_DISPLAY_CAP = 50` silent slice of a 500-entry ring). A bulk migration run will generate hundreds of entries; the operator can't see older context-bearing entries. A "showing last 50 of N" / load-more affordance should land **before** Flight 7's high-volume runs.
- **Renderer-side behaviors lack offline regression coverage** (no renderer harness, by design): `settings.js` port dirty-state, the `renderer.js` openTab container-lookup/unknown-jar throw, and the audit `detail` rendering are verified only by live HAT/leg-7 runs. A `<=` vs `!==` regression in `updatePortSaveDirty` would pass `npm test`. These are good Witnessed-behavior-test candidates (deterministic observables: the Save button's `disabled` attr, the `detail` span's presence) — fold into an enhanced `settings-automation`/`settings-shell` spec.
- **`getChromeTarget` has no automated transport-level e2e test** — its chain (scope façade → engine op) is regression-caught only by a live run. Acceptable given the project's testing philosophy, but noted.

### Documentation
- Add a comment at `main.js:197-209` (the `mainWindow` `webPreferences`) noting **no partition is set → the chrome renderer uses `defaultSession`, which no jar's partition ever equals** — to pre-empt the partition-collision misconception from recurring.
- Document the `captureWindow`-locate + `click(wcId,x,y)` pattern as a **known-limitation** standard form for chrome-clicking specs (coordinates valid at a stated window size; verify via `captureWindow` before running). The migrated specs already do this.
- Add a brief note near `automationKeysOnce()` that it is the canonical shared on-load fetch — any new settings-page consumer should reuse it, not call `bridge.automationListKeys()` directly.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD1 "partition collision" premise corrected → guard reframed as defense-in-depth | The premise was factually wrong (chrome uses `defaultSession`); the guard is still correct | **Yes** — code-verify security-crux DD premises at flight design |
| `:9222` confound eliminated by killing the running `dev:debug` instance + clean `dev:automation` relaunch (operator-approved) | A confound-free `readAxTree`-on-chrome verdict required no `--remote-debugging-port` | **Yes** — the clean-instance apparatus is the standard for chrome-drive verification |
| Design review skipped for legs 5 (spec-only) and 4 (apparatus empirically proven by the spike) | Low-risk / independently de-risked; the live runs are the real validation | **Yes** — codify when FD may skip per-leg review (spec-only or empirically-proven) |
| Autonomous-first execution + interim review/commit of legs 1/3/5/6 | De-risk uncommitted work given the live block awaited an operator session | **Yes** — the pattern for mixed autonomous/live flights |
| `typeText` audited as `text(N chars)`, content redacted | A typed secret must never reach the local audit log | **Yes** — redact input content in audit logging by default |
| Settings-menu open needed coordinate tuning (1265→1300) mid-run | Blind-coordinate clicking | No (artifact) — but motivates the element-addressing affordance |

## Key Learnings

- **Spike-before-migration is high-value whenever the apparatus premise is itself the risk.** The DD2 leg de-risked every downstream migration and produced the exact apparatus mapping leg 4 needed.
- **The HAT is where audit/UX *ergonomics* gaps surface.** FD-driven machine-read passes confirm capabilities work; only operator interaction reveals "is this actually auditable/usable?" Three of this flight's most valuable fixes came from the HAT, not the automated legs.
- **Granular Citation Audits catch code-premise errors** — the leg-1 correction is the proof. The same discipline should reach up to flight-design for security-crux decisions.

### Test Metrics (this debrief)
- **Suite**: 650 tests / 650 pass / 0 fail / 0 skipped / 0 flakes; wall-clock ~807–835 ms (7 suites). The socket-using `automation-mcp-server.test.js` (~667–736 ms) sets the floor.
- **Mission-03 trajectory**: F1 358 → F2 391 → F3 478 → F4 590 → F5 613 → **F6 650 (+37)**. Wall-clock +~60–90 ms vs F5 (~745 ms) — attributable to the 18 new `automation-mcp-server` tests (3 instantiate a real loopback server). No new skips, no flakes — healthy.
- The +37 spread across 6 suites: audit-log +4 (detail), resolve +3 (chrome-exclusion ordering), scope +7 (openTab/getChromeTarget scoping), mcp-tools +7 (17-tool + getChromeTarget), tabs +3 (jarId call-string), mcp-server +18 (deriveAuditDetail + e2e). The `deriveAuditDetail` tests are notably thorough (every branch, both pressKey aliases, the typeText-redaction invariant).

## Recommendations

1. **Build an element-addressing affordance (`findElement`/`getElementCoords` by selector or a11y label) before scaling chrome-driving specs.** The blind-coordinate debt compounds with each F7 spec; an a11y-tree-backed node→point resolver lets specs express intent, not pixels. Mission Flight 9 alignment is the natural home; don't grow the coordinate-tuning surface unacknowledged before then.
2. **Add audit-log paging / a "showing last 50 of N" indicator before Flight 7's bulk runs** (which will generate hundreds of entries). Pairs with the F5 fast-follow (paging/clear/retention) still open.
3. **Add the `main.js` `webPreferences` comment** (no partition → `defaultSession`) and a **flight-design citation-audit step for security-crux DDs** — both pre-empt the recurrence of the DD1-style premise error.
4. **Close the renderer-side regression gaps with Witnessed behavior tests** (port Save dirty-state; audit `detail` rendering; openTab container-lookup) — deterministic observables via `readDom` on the settings `wcId`. Author the specs in the next planning conversation; fold into `settings-automation`/`settings-shell`.
5. **Make "no stale references" ACs use a repo-wide grep** (excluding vendored/immutable trees) — codify in the leg template so the next reference-consistency sweep can't miss `scripts/`, `CLAUDE.md`, or test titles.

## Action Items
- [ ] **Flight 7** (carried from scope): bulk Group-B migration (9 specs; `farbling-correctness`'s `chrome-devtools`-MCP apparatus needs early attention), `a11y-audit.mjs` rewrite (target `readAxTree` — F6 proved 335 AXNodes on chrome), retire `dev:debug`/`--remote-allow-origins=*`/update `.mcp.json`, and **re-evaluate the `devtools-cdp-conflict` `BLOCKED-AS-WRITTEN`** (intersects the `:9222` retirement).
- [ ] Add audit-log paging / "last 50 of N" affordance (before F7 bulk runs).
- [ ] Add the `main.js:197-209` no-partition→defaultSession comment.
- [ ] Author Witnessed behavior tests for the port Save dirty-state + audit `detail` rendering (renderer regression coverage); next planning conversation.
- [ ] Evaluate an element-addressing affordance (`findElement`) for chrome controls — Flight 9 (agent-ergonomics alignment).
- [ ] *(Optional)* extend `deriveAuditDetail` to `enumerateTabs` (tab count) and other read ops for richer audit context.
