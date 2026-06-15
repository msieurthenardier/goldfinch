# Flight Debrief: Gating — opt-in + key auth + audit

**Date**: 2026-06-15
**Flight**: [Gating — opt-in + key auth + audit](flight.md)
**Status**: landed
**Duration**: 2026-06-14 (planning + legs 1–5) → 2026-06-15 (HAT + landing)
**Legs Completed**: 6 of 6 (`hat-and-alignment` dispositioned; `mcp-jar-scoping` live run partial, operator-accepted)

## Outcome Assessment

### Objectives Achieved
Turned the Flight-3 ungated-but-dev-gated MCP transport into the **gated** surface the mission requires: off-by-default + opt-in (`automationEnabled`), **per-jar Bearer-key auth**, an **env-gated admin tier**, **jar-scoping by session object identity** (a jar key sees/touches only its own jar's tabs; internal-session exclusion absolute for jar keys; admin the sole relaxation), and an **audit data layer** (in-process ring + session-active state + `automation-activity-changed` broadcast). The auth gate composes with the SC7 origin guard (guard 403 first, then auth 401) and binds identity to the session at creation with per-request live re-validation.

### Mission Criteria Advanced
- **SC8 — met + behavior-test-backed.** `mcp-auth-gating` full live pass; `mcp-jar-scoping` partial-live + exhaustive headless (operator-accepted).
- **SC7 — now fully met.** Structural loopback/Origin-Host half (Flight 3) + the **key half** (this flight). Guard-first 403 and auth 401 confirmed live.
- **SC10 — data layer met.** Queryable session-active state + action log + broadcast. The visible indicator + log-viewer UI are Flight 5 (agreed Flight 4↔5 split).

All flight checkpoints met. Real-world bonus: an external user-wide MCP client (Claude Code) drove the browser through the gate, and a **cross-OS-boundary** consumer (the-one's path, from the Windows side) completed an MCP `initialize` over WSL2 mirrored-loopback with the key — validating the mission's use-case #2/#3 reach early.

## What Went Well
- **Design-precision held.** Each of the 6 legs cleared with a **single** design-review cycle (no second-round escalations) — the specs were at the right altitude. The hardest leg (`jar-scoping-and-admin`) enumerated all 13 wcId-first ops, both double-resolve sites, and the shared-`fromId` divergence risk up front.
- **Security ordering is structural, not documentary.** Guard-first (403→401), the two-mechanism DD4 (gate kills toggle-off/total-revoke; identity-match kills session-id reuse), and the jar-scoping linchpin (session **object identity**, never partition-string or renderer `jarId`) are enforced by code shape and tested with real object-identity fakes (both spoof directions).
- **`cdp.js` shared-debugger lock.** The out-of-band scroll fix produced a *better* architecture than the invariant it crossed: one shared single-client lock now covers both `readAxTree` and `scroll`, preventing concurrent double-attach by construction.
- **Test rigor.** 590 tests, 0 fail / 0 skip, typecheck + lint clean. 4 new pure/testable modules, all Electron-free with injected deps.
- **Live verification under real constraints.** FD-driven machine-read runs (curl + SDK client) proved the gate end-to-end even with a stale service squatting on 7777 (worked around via `GOLDFINCH_MCP_PORT`).

## What Could Be Improved

### Process
- **Apparatus-reachability check came late (repeat of a Flight-3 lesson).** Leg 04 assumed the `automation:dev-enable-mint` IPC was reachable by an external test harness; it isn't (renderer→main, identity-locked, no preload bridge). Caught at design review, fixed with the env-gated auto-mint-to-stdout — but "how does an external process turn this on and get a credential?" should be a front-loaded question at flight-design time for any headless-testable surface.
- **A pre-review leg framing was misleading.** Leg 02's "admin sees all + the chrome renderer" consumed review cycles clarifying that the chrome wcId is structurally undiscoverable via `listTabs()`. Future specs should frame admin capability against what the surface can actually address.

### Technical
- **`openTab` can't target a jar (v1).** A jar key's new tab opens in the renderer's active container; if that's a different jar, the tab is silently absent from `enumerateTabs` with **no error**. Confinement holds, but it's confusing for consumers.
- **`activeSessions()` tracks transport lifecycle, not auth-liveness.** A revoked key's session lingers in the active set until its next request 401s and the transport closes — an indicator lag Flight 5's UX must phrase carefully ("connected", not "authorized").
- **Live evidence gap for jar-scoping refusals.** Cross-jar / internal-session / burner refusals are headless-backed (with real session-object-identity fakes) but not staged live — the MCP surface can't switch jars or open internal/burner tabs without the Flight-5 jars UI.
- **`sendInputEvent` is not universally reliable on `<webview>` guests.** mouseWheel produced *zero* movement; scroll had to move to CDP. Click/type are confirmed for the cases tried, but this is a signal not to assume `sendInputEvent` works for every input type on guests.

### Test Metrics (captured this run)
`npm test`: **590 pass / 590 (0 fail, 0 skip, 7 suites)**, ~665 ms wall-clock; `typecheck` + `lint` clean; no flakes. Mission-03 trajectory: **F1 358 → F2 391 → F3 478 → F4 590** (+112 this flight). Breakdown from the flight log: leg-01 +37 (auth/validators/gate/body-cap), leg-02 +37 (resolver/scope/multi-jar integration), leg-03 +19 (audit), scroll fix + `shouldAutoMint` +19. Wall-clock rose ~341 ms (F3) → ~665 ms — dominated by the new `automation-scroll.test.js` (async fake-debugger I/O) and the grown `automation-mcp-server.test.js` (790-line multi-jar fake worlds over real loopback sockets); `node --test` parallelizes per-file, so this reflects the slowest suite, not a regression. No suites retired; no skips introduced.

### Documentation
- `docs/mcp-automation.md` gained auth / jar-scoping / admin-tier / audit-broadcast sections (good). **Gaps:** the `openTab` v1 jar-targeting limitation isn't in the tool reference; a "subscribing to `automation-activity-changed`" example is pending Flight 5.
- CLAUDE.md refreshed this flight: the gated-surface state and the `cdp.js` shared-debugger discipline (readAxTree + scroll) — fixing a now-stale "debugger only in observe.js" invariant.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| 413 body-cap: pause+sentinel+caller-writes-413-then-`req.destroy()` (not destroy-in-`readJsonBody`) | Destroying mid-read sent ECONNRESET before the 413 could be written (caught by the cap test) | Yes — "write the response, then destroy" for any stream-abort path |
| `scroll` rewired to in-process CDP `Input.dispatchMouseEvent` (crosses Flight-2 DD8) | `sendInputEvent` mouseWheel doesn't scroll `<webview>` guests (confirmed live) | Yes — route any new debugger op through `cdp.js`'s shared lock; never a second attach path |
| `admin-tier` leg merged into `jar-scoping-and-admin` | Shared identity plumbing; splitting left a half-identity state | Situational — merge legs that share load-bearing plumbing |
| Auto-mint-to-stdout dev affordance (net-new, leg 5) | The enable+mint IPC is unreachable by an external harness | Yes — front-load harness-apparatus analysis for headless-testable surfaces |
| `mcp-jar-scoping` landed `partial` (live) | GUI multi-jar/internal/burner staging needs the Flight-5 jars UI; refusals exhaustively headless-backed | No — close with a full Witnessed run once the apparatus exists |

## Key Learnings
- **Front-load the "how does an external consumer turn this on / authenticate" question** — it surfaced as a late apparatus gap here and a similar one in Flight 3. It often implies a code affordance the implementation legs need to know about.
- **A documented invariant is a proxy for a goal; when crossing it, re-encode the goal.** DD8's "input debugger-free" really meant "single-client lock, no concurrency conflict" — the `cdp.js` shared lock enforces that goal more directly than the original ban did.
- **Trusted-input via `sendInputEvent` is per-event-type and per-target.** Scroll-on-guest needed CDP; don't assume uniformity. Verify the specific interactions a behavior spec depends on before relying on the mechanism.
- **The hash-not-encrypt key model (DD5) reframes SC9.** With SHA-256 hashes there are no per-credential plaintexts to encrypt; the `safeStorage` codec seam now applies file-wide, not per-key. Flight 5 should state this expectation explicitly.
- **Live FD-driven machine-read evidence is a strong, cheap acceptance tier** for HTTP-observable security properties (the whole auth gate was proven with curl); reserve the heavier GUI-staged Witnessed run for what's only observable through the UI.

## Recommendations
1. **Flight 5: complete the `mcp-jar-scoping` full live run.** The jars-management UI provides the apparatus to stage cross-jar/internal/burner tabs — make a full Witnessed pass a Flight-5 acceptance criterion and flip the run log from `partial`.
2. **Flight 5: resolve or formally document the `openTab` jar-targeting gap** — add an `openTab(url, jarId)` parameter (jar-targeted new-tab creation) or return a discriminated result when the tab lands outside the jar; and word the activity indicator as transport-state ("connected"), not auth-state.
3. **Flight 6: design chrome-renderer enumeration up front** — the admin "drive the chrome" capability (needed for SC11 dogfooding of `tab-keyboard-operability` et al.) is net-new; cleanest option is `enumerateTabs` returning a `type:'chrome'` entry (with the real wcId) for the admin identity. Also run an early `sendInputEvent` reliability check (click/type on guests) before migrating specs.
4. **Flight 5: clarify the SC9 storage model** — decide whether to codec-encrypt the whole settings file via the `safeStorage` seam (the hash model makes per-key encryption moot) and document it.
5. **Add regression nets for the two silent gaps**: a behavior-test/unit assertion for the `openTab`-lands-outside-jar silent absence, and an offline `cdp.js` paired test that a concurrent `scroll` + `readAxTree` on one wcId yields exactly one attach (the second `locked`).

## Action Items
- [ ] **Flight 5**: full Witnessed `mcp-jar-scoping` live run (cross-jar/internal/burner) → flip run-log from `partial`.
- [ ] **Flight 5**: `openTab` jar-targeting (param or discriminated result) + indicator-UX language for the revoke→transport-close lag.
- [ ] **Flight 5**: SC9 storage-model decision (file-level `safeStorage` codec vs hash-model-makes-it-moot), documented.
- [ ] **Flight 6**: chrome-renderer enumeration affordance for the admin tier (prefer `enumerateTabs` `type:'chrome'`) + early `sendInputEvent` reliability check on guests.
- [ ] **Flight 7**: harden/retire the ungated `:9222` (`dev:debug` `--remote-allow-origins=*`) + add a `--automation-dev`-gated DevTools-open affordance so the CDP `attach-failed` branch can finally be verified live; update/remove `.mcp.json`.
- [ ] **Docs**: add the `openTab` v1 jar-targeting limitation to `docs/mcp-automation.md` tool reference.
- [ ] **Convention**: codify the `automation: <code> — <detail>` error-prefix format (load-bearing for the audit `errorCode` parser + behavior-spec assertions) and the `cdp.js` shared-lock-gateway rule as named project conventions.
- [ ] **Local cleanup (operator)**: the working-tree `.mcp.json` (goldfinch entry removed for user-scope MCP) is intentionally uncommitted; the two `gf_01*.png` assets are unrelated/untracked.
