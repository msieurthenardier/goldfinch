# Mission Debrief: First-Class Browser Automation Surface

**Date**: 2026-06-18
**Mission**: [First-Class Browser Automation Surface](mission.md)
**Status**: completed
**Duration**: 2026-06-12 – 2026-06-17 (10 flights; planning began after Mission 02 landed, F1 designed 2026-06-13, F10 landed 2026-06-17)
**Flights Completed**: 10 of 10 (Flight 11 — optional agent-ergonomics tuning — dropped by operator decision)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| SC1 — attach + navigate (open/back/forward/reload), reflected in live UI | **Met** | Capability F1 (drive engine, re-applies `isSafeTabUrl` on `navigate`/`open-tab`); behavior-test-backed once the F3 transport landed and via the F6/F7 spec migration. |
| SC2 — trusted input (click/type/scroll/key) firing real handlers + native focus | **Met** | Capability F1 via `sendInputEvent`; `<webview>` mouseWheel moved to CDP in F4 (`cdp.js` shared lock). Live-smoke + dogfooded specs. |
| SC3 — read a tab's DOM and accessibility tree | **Met** | Capability F2 (`observe.js`; AX tree via in-process `webContents.debugger`, no port). Confirmed live (163-node guest tree F2; 335-node chrome tree F6). |
| SC4 — capture a screenshot of a target tab (and chrome) | **Met** | Capability F2 (`capturePage`, foreground-to-act); behavior-test-backed via migrated specs. |
| SC5 — manage tabs (open/close/switch/enumerate) + target a specific tab | **Met** | Capability F1 (jar-scoped enumeration; foreground-to-act switch). Backed by migrated chrome specs F6/F7. |
| SC6 — MCP-compatible interface an external client discovers, invokes, drives end-to-end | **Met** | F3 (loopback Streamable-HTTP MCP transport, 16→21 tools) + F10 (documented Consumer Contract, getting-started, example-client auth fix). Demonstrated by **the-one** (native external install) and a cross-OS Claude Code session. |
| SC7 — local-only: loopback bind **and** Origin/Host allow-listing (defeats DNS-rebinding) | **Met** | Structural half F3 (`mcp-loopback-origin-guard`, guard-first 403 before 401); key half F4. Live-confirmed. |
| SC8 — off-by-default, opt-in, key-gated (per-jar + env-gated admin) | **Met** | F4 (`mcp-auth-gating` full live pass); upgraded to **production posture** in F8 (Settings toggle is sole bind gate, human-only enable, admin tier usable on packaged binary). |
| SC9 — keys managed from Settings (generate/rotate/revoke), persisted, effective immediately | **Met** | F5 (`settings-automation` live pass). Storage = hashed-at-rest model (operator-confirmed reframing of "encrypted codec"); no plaintext file. |
| SC10 — auditable: visible active-session indicator (admin vs jar, names the jar) + action log | **Met** | F4 data layer + F5 visible half (toolbar indicator + settings audit-log viewer); ungraceful-disconnect indicator-clear fixed F5 leg 7. |
| SC11 — own behavior tests run against the surface (dogfooding); ungated `:9222` retired/hardened | **Met** | Dogfooding across F6 (subset + chrome affordance) and F7 (bulk Group-B); `a11y-audit.mjs` rewritten off CDP and `:9222`/`dev:debug`/`cdp-driver.mjs` **fully removed** in F9. Full test + a11y suite green on the new surface. **Caveat:** three behavior-test steps (`devtools-cdp-conflict` `attach-failed`, `automation-key-gating` toggle-flip, `settings-activity-viewer` pager) remain live-unverified — WSLg apparatus ceiling, not a capability gap (see Action Items). |

All 11 success criteria met. The three carried behavior-test observations are environment-limited (WSLg cannot stage detached-window / coordinate-UI interactions) and are tracked as follow-ups, not unmet criteria — the underlying contracts are unit-covered and the security-critical paths are live-verified.

### Overall Outcome

**The mission delivered its stated outcome in full.** Goldfinch now has a first-class, gated, MCP-compatible browser-automation surface built natively in the main process (`webContents` trusted input / capture / eval + in-process `webContents.debugger` for the a11y tree) — local-only, off-by-default, per-jar + env-gated-admin keyed, and auditable. All three named consumers are served: the project dogfoods its own behavior tests on the surface, external Claude Code sessions attach it as an MCP browser, and the-one (agentic platform) drives it as a native external install. The cautionary-tale `:9222` ungated debugging path that seeded the mission is **gone**.

The privacy thesis was upheld throughout: the surface *strengthened* the privacy posture rather than eroding it. The internal-session exclusion (`goldfinch://settings` unreachable by any drive/observe/eval/devtools op, even for admin), the Origin/Host guard, and jar-scoping by session object-identity all survived every boundary move (gating, chrome-driver, eval tools, production re-architecture). Goldfinch's front door (README) was reframed from "media-panel browser" to the **control / privacy / automatability** triad the project now actually embodies.

This was the largest mission to date (10 flights vs a ~9-flight estimate) — *"a lot to untangle, which is normal,"* in the operator's words — and it landed with a clean, growing test suite (358 → 773 tests, zero failures/skips/flakes introduced) and a documented external contract.

## Flight Summary

| # | Flight | Status | Accomplishment | Key challenge / deviation |
|---|--------|--------|----------------|---------------------------|
| F1 | Drive engine | completed | Native act-half: navigate (re-applying `isSafeTabUrl`), trusted input, tab open/close/enumerate/switch, both chrome + guest. | Wrong `sendInputEvent` event shapes (`canScroll`, `buttons` bitmask) were invisible to 137 unit tests — caught at leg-4 design review, validated by leg-6 live smoke. |
| F2 | Observe engine | landed | Screenshot/DOM/a11y read-half; confirmed `webContents.debugger` returns a full AX tree on a guest with no port. | DevTools-conflict live test apparatus-confounded by `--remote-debugging-port` (multi-session CDP); deferred. |
| F3 | MCP transport | landed | 16 ops exposed as MCP tools over loopback Streamable-HTTP; real client drove end-to-end; Origin/Host guard from the start. | Single-stateful-transport defect (no reconnect / 2nd client) invisible to 471 unit tests — caught only by the Witnessed live run. |
| F4 | Gating | landed | Off-by-default toggle, per-jar Bearer key + env-gated admin tier, jar-scoping by session identity, audit ring + broadcast. SC7 fully met. | `sendInputEvent` mouseWheel doesn't scroll `<webview>`; `scroll` moved to CDP via a new shared-debugger lock (`cdp.js`). |
| F5 | Settings key management | landed | Full self-service surface in `goldfinch://settings`: toggle, MCP address, live port-rebind, key generate/rotate/revoke (show-once), indicator, audit viewer. | HAT surfaced two transport-lifecycle gaps (port-save stale UI → live-rebind; ungraceful-disconnect → SSE-drain) invisible to machine tests. |
| F6 | Chrome dogfood (scoped) | landed | `getChromeTarget` (17th tool), `openTab` jar-targeting, 3 specs migrated; DD2 spike proved `readAxTree`-on-chrome confound-free. | Reframed mid-planning from "migrate all" → "enable + prove + subset"; blind-coordinate chrome clicking flagged as fragile debt. |
| F7 | Spec migration + hardening (scoped) | landed | 8 specs bulk-migrated; numbered audit pagination; `:9222` `--remote-allow-origins` narrowed `*` → loopback; `.mcp.json` trimmed. | HAT surfaced the **entire F8 scope** (production gating, dev-profile bleed, port collision) — undesigned until hands-on interaction revealed it. |
| F8 | Production gating + isolation | landed | Settings toggle as sole production bind gate, human-only enable, admin on packaged binary, dev-profile isolation (`~/.config/goldfinch-dev`), free-port fallback. Live-verified on a real `npm run pack` build. | A double-bind race + a dev-enable-override gap emerged in-flight; fixed via `toggle.js` `runSerialized` mutex + injected override. |
| F9 | Eval tool + `:9222` removal | landed | `evaluate`/`injectScript` (zero CDP, executor-scoped, internal-session excluded even for admin), `openDevTools`/`closeDevTools`, a11y-audit + farbling migrated, **`:9222` fully removed**. 21 tools. | WSLg ceiling: detached DevTools window won't materialize, leaving `attach-failed` + two UI-interaction specs live-unverified. |
| F10 | External-consumer enablement | landed | README reframe (automatability), Consumer Contract + production getting-started, example-client auth fix, `runSerialized` into CLAUDE.md. SC6 closed. | Per-leg design reviews near-redundant for a docs-only flight after the Architect pass; `createJar` + live operator run deferred. |

**Flight patterns.** Flights with a pure-engine, headless-verifiable surface (F1 drive, F9 eval) ran cleanest. Flights touching live UI + transport lifecycle (F5, F6, F7) consistently surfaced integration gaps at the HAT that machine tests could not — this is the HAT working as intended, but it meant those flights systematically undercounted their own scope. The two genuinely hard flights (F4 gating, F8 production re-architecture) were the security-boundary moves, and both were carried by per-leg design review catching crux-premise errors before code.

## What Went Well

1. **Per-leg design review → precise spec → live verification was the mission's strongest result.** Every flight (except the docs-only F10) records the design review catching at least one *load-bearing* defect before code: wrong input event shapes (F1), false partition-collision security premises (F6), fictional tool-count preconditions (F9), a non-binding packaged build (F8). Cheap reviews, expensive bugs averted — and no flight needed a second review cycle.

2. **The "build the apparatus first, then dogfood" premise paid off exactly as designed.** The mission deliberately deferred three flights to stand up the surface so it could test itself. F3's Witnessed run caught a single-session transport defect that 471 unit tests could not see by construction. The apparatus then held up to real external consumers and a cross-OS-boundary MCP `initialize`.

3. **Security invariants held under sustained pressure.** The internal-session exclusion, Origin/Host guard (403-before-401), and jar-scoping-by-session-identity survived gating (F4), the chrome-driver (F6), eval/devtools tools (F9), and a full production-posture redesign (F8). F8's "human-only-enable" invariant was independently confirmed by a blind Reviewer grep walk.

4. **Test suite trajectory: steep growth, zero regressions.** F1→F10: **358 → 773 tests (+415), 0 failures, 0 skips, 0 flakes introduced**, with `npm test` + `typecheck` + `lint` green as a hard gate every flight. Growth is dominated by real-socket integration tests — the right kind.

5. **Architecturally, the subsystem reinforced the existing design rather than straining it.** The Architect review found the automation engine extended the established main-process discipline (Electron-free modules via injected `deps` bags, `webContents.fromId` addressing, session-marker exclusion) and that extracting `toggle.js` / `init-profile.js` made previously-untestable `main.js` paths unit-reachable *as the production code* — a net structural improvement.

## What Could Be Improved

1. **WSLg is not an adequate apparatus for UI-interaction behavior tests.** Three specs remain live-unverified at mission close because WSLg cannot stage a detached window or coordinate-based settings-guest interaction. Future flights requiring a popup/detached window or coordinate UI should *name their verification apparatus at flight design* — the mission committed to verifying `openDevTools({mode:'detach'})` behavior the dev environment physically can't produce.

2. **Blind-coordinate chrome clicking is environment-fragile debt.** Screenshot-derived hardcoded pixel coordinates with no selector/a11y-handle mechanism (flagged F6) compounded through F6/F7 and was not resolved by F9. An element-addressing affordance (`findElement` / action-by-a11y-handle) is the most actionable remaining usability debt for the surface.

3. **Security-premise verification lagged from flight design to leg design.** Multiple crux errors caught at *leg* review were statically visible at *flight* design (F6 partition collision, F3 DD10 affordance circularity, F4 IPC reachability). Code-verify security-crux DDs at flight design, not at the first leg review.

4. **Prose-claim drift is a recurring, silent quality issue.** Stale counts and "no auth" comments in scripts/specs/JSDoc (F1, F9's 15 specs, F10's example client) accumulate faster than the surface evolves and fail silently. A mechanical pre-flight grep for tool-count / "no auth" claims would catch the category before execution.

5. **HAT-bearing flights systematically undercount scope.** F7's HAT surfaced all of F8; F6's work surfaced F7's `INTERNAL_PAGES` fix. The HAT is working correctly, but flight estimates should budget for the scope hands-on interaction reliably reveals — a post-HAT scope conversation on every flight touching the live product.

## Lessons Learned

**Technical**
- **Transport/protocol/wire-lifecycle defects are invisible to unit tests by construction** (F1 event shapes, F3 reconnect/2nd-client, F4 webview wheel, F5 disconnect drain). Any leg wiring a transport/IPC seam needs a headless multi-interaction end-to-end test (first client, reconnect, 2 concurrent, stop/restart) as an explicit acceptance property.
- **In-process `webContents.debugger` is the right mechanism for the a11y tree** — no port, fully gateable, returns the exact tree the old `:9222` tests asserted. The one-client-per-contents constraint is real and handled by a synchronous shared lock (`cdp.js`) with attach-on-demand + detach-in-`finally`.
- **Session object-identity is the correct membership primitive** (`wc.session === fromPartition(jar.partition)`), never partition-string or renderer-reported labels — TOCTOU-safe and robust to a mislabeled renderer.
- **`runSerialized` mutex shape** (capture-prior → `await prior.catch(()=>{})` → body → identity-guarded self-clear) is now canonical; a bare `await prior` wedges the chain on a rejected prior op.

**Process**
- **Adversarial design review earns its cost even on "just docs" flights** — F10's one non-doc defect (a 401-ing example client) was the highest-value find of that flight.
- **HAT is the integration-gap net** for any flight touching live UI + a transport lifecycle; it should be a default, not optional, for renderer-in-guest integration.
- **Apparatus reachability is a flight-design question**: "by what affordance will this precondition be stageable in this venue?" and "how does an external consumer turn this on and get a credential?" must be answered at design time (the F3 DevTools circularity and F4 IPC-reachability gaps both trace to skipping this).

**Domain**
- **A copy-pasteable example client is a contract artifact** — when the gate changes (F4 added auth), the example must change with it; it silently lagged two flights.
- **Foreground-to-act was the right v1 model** for the named headless/sandboxed consumers; concurrent human+agent background driving is a validated future flight, not a research risk (F1 spike proved behind-layering + per-tab hidden windows on Electron ^42).

## Methodology Feedback

- **Agentic orchestration worked well end-to-end** (operator: *"autonomy works great"*). The design-per-leg → batch-implement → single-review-and-commit shape of `/agentic-workflow` scaled from 6 to 9 legs per flight with no second-cycle escalations. Handoffs between design-review, implementer, and reviewer agents were clean.
- **Coordination experience: "a lot to untangle, which is normal."** Despite a mid-mission renumbering (F8 inserted for production gating pushed eval→F9, consumer→F10) and several scope reframes, the operator did not lose the thread of status or go/no-go. The flight/leg structure held up under the largest mission to date.
- **Planning accuracy: +2 flights over a ~9-flight estimate (~22% under).** One was a *correct* design decomposition foreseen-but-not-pre-counted (the F4↔F5 data-layer / visible-layer split); the other was a *genuinely undesigned* scope item (F8 production posture) that only hands-on HAT interaction revealed. Reasonable for a novel-surface mission of this size.
- **Recurring methodology asks for mission-control** (carried from F2/F3/F7/F9/F10 debriefs): a pre-flight prose-claim / stale-tool-count grep in `/preflight-check` or flight recon; a "multi-interaction lifecycle is an explicit headless acceptance property" item on the transport/IPC leg-design checklist; a lighter review cadence for docs/closeout flights; a flight-design security-premise code-audit for boundary moves.
- **"Larger than expected"** — the operator's one-line read of the mission. Worth carrying into the next large, novel-surface mission's estimate as a known bias toward undercounting.

## Action Items

**Verification (apparatus-limited — no code change, needs a non-WSLg display)**
- [ ] Re-run `devtools-cdp-conflict` (settle `attach-failed` live), `automation-key-gating` (toggle-flip steps 4–6), and `settings-activity-viewer` (pager/freeze steps 5–8) on a real X11 / macOS host / HW-rendering CI. (F9 Rec 1)
- [ ] Formal Witnessed `farbling-correctness` run + promote `draft → active` **before the next Electron major upgrade** — it's the regression net for canvas/`navigator` hooks a Chromium bump could silently break. (F9 Rec 2)

**Deferred features / debt**
- [ ] `createJar` (jar-lifecycle MCP tool) — unblocks the two-container farbling primary path and gives external consumers a real jar lifecycle. Highest-priority new capability if a future mission targets external consumers. (F9 Rec 5, F10 Rec 3)
- [ ] Element-addressing affordance (`findElement` / action-by-a11y-handle) to retire blind-coordinate chrome clicking. (F6 Rec 1)
- [ ] Two `.ps-list` `scrollable-region-focusable` a11y violations (privacy panel + lightbox): `tabindex="0"` on the scroll containers or a formal `ACCEPTED` entry. (F7)
- [ ] (Watch) Split `observe.js` (~471 lines, 5 op categories) if more ops land; verify Windows `app.isPackaged` profile isolation + flip-OFF live unbind when packaging is exercised. (F8/F9)
- [ ] (Cleanup) Stale `automation-dev.js` staging JSDoc; harden `resolvePort` `honorEnv` default against leaking the env override to production. (F8/F9)
- [ ] (Docs) Add the `injectScript`→`evaluate` no-persistence pairing and the `goldfinch://settings` eval/devtools exclusion to `docs/mcp-automation.md` as stated boundaries; document `scroll`'s `debugger-unavailable` return in the tool reference. (F9 Rec 3, Architect)

**Process (mission-control methodology — not project-specific)**
- [ ] Add a prose-claim / stale-tool-count drift grep to `/preflight-check` or flight recon. (F9 Rec 4, F10 Rec 1)
- [ ] Add "multi-interaction lifecycle (reconnect / concurrent / restart) is an explicit headless acceptance property" to the transport/protocol/IPC leg-design checklist. (F3)
- [ ] Lighter review cadence for docs/closeout flights — one consolidated design review post-Architect, not per-leg. (F10 Rec 2)
- [ ] Code-verify security-crux DDs at flight design (not first leg review) for any boundary-moving flight. (F6/F8)

**Optional / waived**
- [ ] Live example-client getting-started run on the operator's session — operator-waived as low marginal value (SC6 already demonstrated by the-one; auth fix is identical to the proven `mcp-client.mjs`). Non-blocking. (F10)

---

> **Next step:** with the mission landed, `/routine-maintenance` is the appropriate between-mission codebase health check before the next mission. The optional Flight 11 (agent-ergonomics tuning — latency instrumentation, element-addressing) was dropped here; its substance survives as the `createJar` and element-addressing action items above, to be picked up if a future mission targets external-consumer ergonomics.
