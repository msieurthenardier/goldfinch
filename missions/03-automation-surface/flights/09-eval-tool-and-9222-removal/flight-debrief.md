# Flight Debrief: Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal

**Date**: 2026-06-17
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](flight.md)
**Status**: landed
**Duration**: 2026-06-17 (planned + executed same day; F8 merged → planning → 8-leg execution → land)
**Legs Completed**: 8 of 8

## Outcome Assessment

### Objectives Achieved
Yes. The flight delivered the full SC11 remainder and the incidental SC6 capability:
- **Two guarded in-page MCP tools** (`evaluate`/`injectScript`) on `webContents.executeJavaScript` (zero CDP), jar-scoped for guests / admin-only for chrome, with the internal `goldfinch://settings` session excluded **even for admin** — the single most security-critical item, implemented exactly (op-local `isInternalContents` refusal on the final resolved `wc`, pinned by named `[HIGH]` tests for all four new ops).
- **Two DevTools tools** (`openDevTools`/`closeDevTools`) — the non-CDP affordance that unblocked the `devtools-cdp-conflict` recorded finding.
- **The a11y gate rewritten** off CDP-`:9222` onto an MCP client + the eval tool (`npm run a11y` **live-PASS**: exit 0, no NEW violations), and **`farbling-correctness` migrated** to the eval tool (guest main world).
- **The ungated `:9222` path fully removed** — `dev:debug`, the `--remote-debugging-port` arm of `isAutomationDevEnabled` (consolidated into `isMcpAutomationEnabled`, 3 consumers repointed), and `scripts/cdp-driver.mjs`.
- **Three F8-debrief follow-ups** landed (serialized automation toggle, `userData` ordering-invariant test, `resolvePort` JSDoc warning).

Registry 17 → 21 tools. Single review gate confirmed; 773 tests / typecheck / lint green. PR #54 (ready for review).

### Mission Criteria Advanced
- **SC11 (dogfooding + retire the ungated path)** — substantially advanced and the ungated-path half is **complete** (`:9222`/`dev:debug`/`cdp-driver.mjs` gone; a11y + farbling migrated; the full test + a11y suite runs green on the new surface). The behavior-test-backed half has **carried items** (see below) — the load-bearing assertions of every dogfooded spec passed, but three specs have steps deferred for apparatus reasons. Whether SC11 is checked depends on the operator's bar for "all 11 specs migrated + run green"; the substantive retirement is done.
- **SC6 (incidental)** — a new DevTools-open capability an external/admin client can drive.

### Checkpoints
All in-flight checkpoints met except the two WSLg-limited live observations (DevTools-conflict definitive outcome; the UI-interaction behavior-test steps) — recorded as carries, not failures.

## What Went Well
- **Design-review-per-leg caught every load-bearing gap before code.** Each of the 8 legs got a `/leg` design + one independent Developer design-review cycle. Every cycle returned *approve-with-changes*; **no leg needed a second cycle**, and the single flight-level Reviewer pass returned `[HANDOFF:confirmed]` with **no fix loop**. The gaps caught were real and structural — the leg-1 stale `EXPECTED_TOOL_COUNT`/JSDoc counts (would break `npm test`), the `[HIGH]` guard placement on the *final* `wc`, the a11y launch-model flip (spawn → attach), the farbling admin-key correction, the `runSerialized` rejection-wedge shape, and the vacuous AC6 grep. Cheap reviews, expensive bugs averted.
- **The riskiest premise (OQ1) held live.** `executeJavaScript`-injects-axe-core was confirmed end-to-end in the leg-1 spike (`{"violations":2,"passes":13}`) — zero CDP, clean `:9222` death. The Adaptation fallback was never needed.
- **Clean, fully-verified `:9222` removal.** `isAutomationDevEnabled` consolidated with a correct consumer audit; the CDP-decoupling invariant tests intentionally kept; hard-zero grep over source/scripts/docs.
- **Electron-free extraction discipline.** `toggle.js` + `init-profile.js` made previously-untestable `main.js` logic unit-reachable as the *production* path (thin delegators), not parallel copies.

## What Could Be Improved

### Process
- **Legs 5 and 8 overlapped on behavior-test runs** (both FD-orchestrated). The FD batched them into single `dev:automation` sessions, which was correct — but the flight design could have folded the `devtools-cdp-conflict` run into leg 8's dogfood batch from the start rather than giving it leg 5. Future: group all FD-driven behavior runs into the verify leg unless one gates a later leg.
- **Legs 3 and 4 were independent after legs 1-2** and could have been run concurrently by two Developers; they were serialized (safe, conservative). Minor wall-clock cost only.
- **Behavior-spec count sweep was reactive.** 15 specs carried stale prose tool-counts; a pre-flight "grep for prose count claims, flag stale" check would have surfaced this before implementation. Recommend adding to `/preflight-check` or the flight recon.
- **Record-keeping nit:** the leg-2 "Changes Made" block was filed under the leg-3 heading in the flight log (provenance-noted, not corrected). Harmless.

### Technical
- **WSLg apparatus ceiling (the dominant limiter).** `openDevTools({mode:'detach'})` did not cleanly materialize a detached window under WSLg (`blink.mojom.WidgetHost`/`Widget` "Message rejected"), so the `devtools-cdp-conflict` `attach-failed` conflict **could not be staged live** — the branch stays unit-tested-only. The same ceiling blocked the coordinate-click UI-interaction steps in `automation-key-gating` (live toggle-flip) and `settings-activity-viewer` (pager/freeze navigation). Eval-on-internal is (correctly) refused, so there is no programmatic shortcut. These are environment limits, **not Electron-version limits** — an Electron upgrade would not fix them; a real (non-WSLg) display or a coordinate-capable apparatus would.
- **`observe.js` is now ~471 lines** across five op categories (screenshot/read/debugger/eval/devtools). Still navigable with its module header; flag a split (`observe-read`/`observe-eval`/`observe-devtools` + barrel) if more ops land.
- **`farbling-correctness` left `draft`.** PASS recorded on the new apparatus (incl. seed-dependence via the New-Identity Variant), but promotion to `active` is deferred to the next Electron upgrade per the spec's own note. Highest-value unfinished behavior coverage for the privacy surface.
- **`scripts/a11y-audit.mjs` has no unit harness** for its own state-driving/baseline logic — covered only by the live `npm run a11y`. Adequate now.
- **Windows `app.isPackaged` path-isolation unverified.** `init-profile.js`/`devUserDataPath` use cross-platform path ops but `\`-separator handling under Windows packaging hasn't been live-confirmed. Low urgency.

### Documentation
- **Canonicalize the `runSerialized` mutex shape** (capture-prior → `await prior.catch(()=>{})` → body → identity-guarded self-clear) in CLAUDE.md / a dev-patterns note — it will recur and the rejection-wedge trap is easy to rediscover.
- **Promote two security/architecture facts in `docs/mcp-automation.md`** from "notes" to stated boundaries: (1) the `injectScript`-then-immediate-`evaluate` no-persistence pairing as a consumer contract; (2) the `goldfinch://settings` internal-session exclusion from eval/devtools as a hard boundary (settings interaction goes through IPC, never `evaluate`).

### Test Metrics
Full suite run during this debrief: **773 pass / 0 fail / 0 skipped** across **12 suites**, **~903 ms** wall-clock; `typecheck` clean; `lint` clean; **no flakes** on the run. (WSLg live-run flakiness — renderer SIGTRAP, TIME_WAIT on rapid relaunch — is a live-apparatus concern, not a unit-test one.)

Historical trend (from prior flight debriefs in this mission):

| Flight | Tests | Δ | Wall-clock |
|--------|-------|---|-----------|
| F3 | 478 | — | ~341 ms |
| F4 | 590 | +112 | ~665 ms |
| F5 | 613 | +23 | ~745 ms |
| F6 | 650 | +37 | ~807 ms |
| F7 | 709 | +59 | ~774 ms |
| F8 | 732 | +23 | ~897 ms |
| **F9** | **773** | **+41** | **~903 ms** |

F9's +41 (2nd-largest gain after F4) is the new pure-unit suites — `automation-toggle` (7), `init-profile-order` (3), `mcp-client` (20) = 30, plus ~11 in the observe eval/devtools additions. Wall-clock delta is the smallest in the mission (+6 ms): the new tests are socket-free pure units; the integration floor was already set by F8's mcp-server suite. No growing skip list (still 0 skipped). Suite health is good and improving.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| a11y launch model: self-contained-spawn → **attach + env key** | Codebase precedent (every prior dogfood run attaches; `mcp-example-client.mjs` is attach-only); spawn is WSLg-fragile | **Yes** — attach + `AUTOMATION_DEV_MINT` env key is the dogfooding standard |
| farbling Step 6: two-container → **New-Identity reroll** Variant | No `createJar` MCP tool exists to provision a 2nd jar programmatically; both reroll paths need admin anyway | Situational — prefer two-container once `createJar` exists (F10) |
| `runSerialized` shape (rejection-isolation + identity self-clear) | Bare `await prior` wedges the chain on a rejected prior op | **Yes** — canonical async-serialization mutex |
| `init-profile.js` extracted to its own module (planned inline in main.js) | `main.js` not unit-reachable (`protocol.registerSchemesAsPrivileged` at module load) | **Yes** — Electron-free extraction for any new main.js-coupled logic |
| behavior-spec `tools/list` count probes → presence-checks | The 16-vs-17 jar/admin split was **fictional** — `registry.listTools()` returns all 21 identity-independently | **Yes** — never write exact tool-count preconditions |

## Key Learnings
- **The `tools/list` count was never identity-scoped.** ~15 specs encoded a fictional 16-vs-17 jar/admin split; identity gates *call* success, not *list* contents. Presence-of-used-tools is the only durable precondition shape.
- **Design-review-per-leg is high-leverage here.** Every load-bearing gap was caught pre-code at the cost of one review cycle each; the flight-level review then sailed through.
- **WSLg is the real verification ceiling for this surface**, not the toolset. UI-interaction and detached-window behavior tests need a real display; the eval/observe/gating contracts are fully verifiable headlessly via `readDom`/`evaluate` + store reads.
- **The internal-session exclusion is now load-bearing and helpful** — it (correctly) prevents even the FD from programmatically driving the settings toggle, which is exactly why those steps need real input.

## Recommendations
1. **Re-run the three WSLg-limited specs on a non-WSLg display** (real X11 / macOS host / HW-rendering CI) — `devtools-cdp-conflict` (settle `attach-failed` live), `automation-key-gating` (toggle-flip Steps 4-6), `settings-activity-viewer` (pager/freeze Steps 5-8). No code change; closes the carried verification. **Not an Electron upgrade** — that addresses neither.
2. **Formal `/behavior-test farbling-correctness` Witnessed run + promote `draft → active`** before any Electron major upgrade (the spec is the regression net for canvas/`navigator` hooks a Chromium bump could silently break).
3. **Canonicalize patterns in docs:** the `runSerialized` mutex shape; the `injectScript`→`evaluate` no-persistence pairing; the `goldfinch://settings` eval/devtools exclusion as a hard architectural boundary (settings → IPC only).
4. **Add a pre-flight registry-count check** (grep behavior specs for prose tool-count claims, flag stale) to `/preflight-check` or flight recon — F9 swept 15 specs reactively.
5. **Scope `createJar` for F10 (external-consumer enablement).** It unblocks the two-container farbling primary path without admin and is part of giving external MCP clients a real jar lifecycle; pair with the README reframe + a getting-started narrative (the `scripts/lib/mcp-client.mjs` + example client are the models).

## Action Items
- [ ] Re-run `devtools-cdp-conflict` + `automation-key-gating` + `settings-activity-viewer` on a real (non-WSLg) display; update their run logs / promote where they pass. (Rec 1)
- [ ] Formal Witnessed `farbling-correctness` run + promote to `active` before the next Electron upgrade. (Rec 2)
- [ ] Add to `docs/mcp-automation.md`: the inject-then-run pairing contract + the internal-session eval/devtools exclusion boundary; add the `runSerialized` shape to CLAUDE.md/dev-patterns. (Rec 3)
- [ ] Add a stale-tool-count grep to `/preflight-check` or the flight recon checklist. (Rec 4)
- [ ] Carry `createJar` + README reframe + external getting-started into F10 design. (Rec 5)
- [ ] (Watch) Split `observe.js` if further ops land; verify Windows `app.isPackaged` profile isolation when packaging is exercised.
