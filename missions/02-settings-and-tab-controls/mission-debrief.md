# Mission Debrief: Settings Area & Tab-Bar Controls

**Date**: 2026-06-12
**Mission**: [Settings Area & Tab-Bar Controls](mission.md)
**Status**: completed
**Duration**: 2026-06-06 – 2026-06-08 (execution, released v0.4.5 → v0.4.9; flight debriefs completed 2026-06-11)
**Flights Completed**: 7 of 7

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| SC1 — unified golden pill `( + \| ▾ )` leading the tabs | **Met** | Flight 1; `unified-tab-controls` 8/8; HAT pivoted the pill to hug the last tab (the "adjacent" ambiguity lesson) |
| SC2 — new-tab + container behavior preserved, mouse + keyboard | **Met** | Flight 1; behavior-test-backed; tablist regression intact |
| SC3 — kebab menu, toolbar row right of Shield, Settings + Exit | **Met** | Flight 2 (placement amended at planning, by operator decision, from tab bar → toolbar row); `kebab-menu` 12/12 |
| SC4 — Exit terminates the application | **Met** | Flight 2; manually verified (quit tears down the harness); macOS deferred to the mac HAT |
| SC5 — Settings opens via internal address; web content cannot navigate/open/embed/spoof the scheme | **Met** | Flight 4; `tab-scheme-guard` 13/13 (Witnessed); all four spoof vectors rejected; CSP read back over CDP |
| SC6 — modern settings layout (section nav + titled sections) | **Met** | Flight 5; `settings-shell` 12/12; guest a11y clean |
| SC7 — Shields + home page operable from settings, persisted, consistent with panels | **Met** | Flight 6; `settings-controls` 12/12; durable schema-versioned store + origin-checked bridge (global toggles only — per-site overrides recorded as a future need) |
| SC8 — keyboard-operable, no new WCAG A/AA violations | **Met** | Every flight; gate upgraded mid-mission (Flight 4) from manual judgment to a pinned-baseline diff with a guest-target mode |
| SC9 — frameless window, custom controls, movable/resizable | **Met** | Flight 1; maximize/restore behavior-test-backed via a built read path; drag/close manual; macOS path entirely deferred to a mac HAT |

### Overall Outcome

**The mission achieved its stated outcome in full.** Goldfinch has a first-class settings area in
its own tab (`goldfinch://settings`) reached through the kebab menu, with real wired controls
(Shields, home page — and beyond the stub promise, a pin system), the restructured golden-pill tab
strip, and frameless custom chrome. The mission deliberately overshot the "settings ships as a
stub" framing: by Flight 6 the stub had become a working settings surface with a durable store and
a security-hardened bridge, and Flight 7 added operator-elected polish (pinnable toolbar icons).

Two by-products exceeded the outcome statement and will outlive the mission:

1. **A security architecture, not just a feature** — the four-gate `goldfinch://` trust model
   (provenance flag + `isInternalPageUrl` allowlist + session-aware `will-navigate` +
   internal-session-only handler), the origin-checked IPC boundary (`registerInternalHandler`),
   and the trust-domain separation across three preloads. It survived three flights of growth on
   top of it without redesign, and the one latent finding (internal-tab web-navigability) was
   discovered, tracked, and discharged across Flights 5/6 exactly as the carry-forward chain
   intended.
2. **A regression apparatus** — the committed `cdp-driver.mjs`, the pinned a11y baseline with a
   guest-target mode, six active behavior specs, and 221 offline unit tests (96 → 221 over two
   missions) on pure, Electron-free modules.

The operator's verdict (interview): the mission went roughly as anticipated, the structure worked
well overall, and the standout was **how much the HAT caught** that automation could not.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1 — tab-bar-control-restructure | completed | Golden pill, responsive tabs, frameless chrome + window controls; the "adjacent" position ambiguity → HAT pivot (lesson: pin layout positions explicitly) |
| 2 — kebab-menu | completed | APG menu-button kebab (Settings + Exit); the act-axis apparatus audit caught the missing arrow keys in the driver before the test ran |
| 3 — menu-robustness | completed | Inserted debt flight (operator call): shared `menuController` (mutex + outside-dismiss); spike-before-build applied correctly |
| 4 — internal-page-scheme | completed | `goldfinch://` four-gate model; a11y baseline pinned (thrice-flagged debt discharged); design reviews caught two HIGH defects pre-code; **debrief ran 4 days late (process oversight)** |
| 5 — settings-page-shell | completed | Settings shell + chips/popup/nav-lock (operator-elected scope); menu keyboard hoist (−21 lines); live gates caught what 182/182 offline could not |
| 6 — wire-existing-controls | completed | Durable settings store + origin-checked bridge (the mission's security keystone); SC7 closed; the unstyled-controls HAT lesson → styling criteria |
| 7 — pinnable-toolbar-items | completed | Pin system + icon toolbar; live behavior test caught the `settingsSet`-resolution cross-process bug; native-menu clumsiness → custom context-menu Known Issue |

## What Went Well

- **The carry-forward chain is the mission's process backbone — and it demonstrably works.** Every
  flight's debrief seeded the next flight's reconnaissance (Flight 7's recon table walking the
  Flight-6 debrief item-by-item is the model case). Lessons compounded measurably: Flight 1's
  position-ambiguity → Flight 2 pinned placement with an ASCII diagram and it held; Flight 1's
  deferred-spike inversion → Flights 3/4 ran spikes before the dependent build; Flight 6's
  unstyled-controls HAT discovery → Flight 7's leg specs carried styling criteria + a pre-HAT
  screenshot and needed only a glyph swap. Even the one dropped ball (Flight 4's missing debrief)
  caused no execution damage *because* the flight log + mission Known Issues carried the critical
  findings redundantly.
- **Pre-implementation design reviews were the mission's quiet MVP.** Across seven flights they
  caught, before any code shipped: the CSP-on-custom-protocol silent-drop trap, the synchronous
  `session-created` exclusion bug, the New-Identity data-loss trap, a menu-controller infinite
  recursion, and the `!!`-coercion that defeated a strict security predicate. None of these would
  have failed an offline gate; several would have been silent in production.
- **Live verification is load-bearing for this codebase — proven three separate times.** A fully
  green offline suite coexisted with: a real a11y regression + two Shields internal-tab bugs
  (Flight 5), raw-default unstyled controls (Flight 6), and the pin-toggle cross-process sync bug
  (Flight 7). The renderer is non-importable by design (`nodeIntegration:false`), so behavior
  tests + the a11y gate + the HAT are the regression net, and the mission invested in them
  accordingly (committed driver, pinned baseline, guest-target mode).
- **The HAT consistently earned its keep** (operator-confirmed as the mission's biggest
  positive surprise): the pill-placement pivot, the icon-glyph swap, the chip-vs-Shields
  security-copy incoherence, the native-menu clumsiness — all caught only by a human looking at
  the live app. Layout/feel/coherence work genuinely needs the human loop, and budgeting an
  explicit HAT leg per flight is the right shape.
- **The architecture improved while shipping features** (Architect assessment: net-positive,
  deliberate decomposition). The mission extracted four pure, injected-deps, unit-tested modules
  (`settings-store`, `internal-ipc`, `internal-assets`, plus `internal-page`) rather than growing
  the monoliths; trust-domain decisions were consistent across all seven flights; CSP discipline
  held unchanged through five flights of settings-surface growth.
- **Scope elasticity worked** (operator verdict: keep it). The tentative flight list flexed from
  ~5 to 7 — a debt flight inserted (3), operator-elected scope absorbed at planning (5), a split
  when a flight grew past size (6→7) — with every change logged at a planning gate, and the
  mission boundary never silently eroded.

## What Could Be Improved

- **The debrief step can silently drop.** Flight 4 landed without a debrief and nobody noticed for
  four days (caught by a registry sweep, not by the process). The flight artifact's Post-Flight
  checklist doesn't include "debrief exists," so the gap was invisible in the artifact itself.
- **Artifact ceremony is heavier than the oversight it buys** (operator interview — the one
  structural complaint). Seven flights produced ~60 artifacts (flights, logs, legs, debriefs,
  specs, run logs). The structure worked, but the operator flags the volume as a cost. Candidate
  reductions without losing the load-bearing parts: lighter leg files for small legs (the
  verify/HAT legs are already terse — extend that), debrief-by-exception for short flights, and
  folding flight-log leg-progress entries into the leg files (Flight 7's log skipped them and
  nothing was lost — but then the log's Summary line must still be swept at landing, which is the
  part that failed).
- **Apparatus/spec maintenance lags behavior changes.** Twice the committed spec drifted from
  HAT-introduced behavior until a debrief flagged it (kebab mutual-exclusion/Tab-closes; the
  toolbar-pins right-click path). The landing step should include "did the HAT change behavior a
  spec should pin?"
- **A handful of contracts shipped undocumented and bit later.** The `settingsSet`
  full-config-resolution shape (knowable since Flight 6, bit at Flight 7), the `get()`/`getAll()`
  copy asymmetry, and the three-surface internal-page growth rule (still missing the
  `will-navigate` leg in CLAUDE.md). The pattern: when an IPC/store contract has a surprising
  shape, the JSDoc/d.ts must say so the day it ships — code comments at one call site don't
  protect the next call site.
- **macOS is a standing blind spot.** Five subsystems (frameless chrome, traffic lights,
  `app-quit`, menu dismissal, window controls) are verified only on Linux/WSL, flagged in five
  debriefs, and still unverified. Nothing in CLAUDE.md states this platform-coverage gap; one mac
  HAT clears all of it and should be scheduled before any macOS release is promoted.

## Lessons Learned

1. **Provenance, not content, is the trust discriminator** — the call-site `trusted` flag and the
   session-marker (not URL/partition-string) checks are the security idioms that survived every
   stress this mission applied. Codified in CLAUDE.md; carry them into Mission 03's automation
   gating.
2. **Pure-module + injected-deps is the testing standard that makes security testable.** Every
   security-critical decision (sender trust, store validation, asset resolution) has fast offline
   coverage because the logic is Electron-free. This should be a named, required convention, and
   `handleInternal` is the one piece that still hasn't finished the journey.
3. **Premise audits beat assumptions** — the both-axes (act + observe) apparatus audit and the
   spike-before-dependent-build rule each caught a real gap when applied (driver KEYS, maximize
   read path, `will-navigate` shape) and cost a HAT pivot the one time sequencing was inverted
   (Flight 1).
4. **Offline-green ≠ done, structurally.** Three flights produced live-only defects. For a
   non-importable renderer, live verification isn't a nice-to-have phase, it's where a class of
   bugs lives — plan it as load-bearing, not confirmatory.
5. **Operator-elected scope at planning gates is healthy elasticity** — every mission change
   (insertion, absorption, split, HAT additions) was decided at a gate and logged; the mission
   never drifted unconsciously.

## Methodology Feedback

- **Witnessed pattern — operator decision (this debrief): FD-driven runs are accepted as the
  standard execution mode.** The compensating control (every verdict cites a raw machine-read
  value — DOM attribute, file content, exit code) is judged sufficient; the repeatedly
  carried-forward "run the formal two-agent pass" items for `settings-shell`, `settings-controls`,
  and `toolbar-pins` are **closed by this decision**, not by execution. Mission-control follow-up:
  update the behavior-test skill so FD-driven-with-cited-evidence is a sanctioned mode (not a
  logged deviation), while keeping the two-agent pattern available for high-stakes/first-run
  specs at the operator's election.
- **Debrief must be part of landing.** Add a "flight-debrief exists" line to the flight Post-Flight
  checklist template, and have the landing step sweep the flight log (status line, leg entries,
  HAT-introduced behaviors → spec updates). The Flight-4 gap and the Flight-7 log staleness are
  the same failure: landing has no closing sweep.
- **Right-size the ceremony.** Operator feedback: the structure worked but costs too much paper.
  Concrete candidates: terse leg format for verify/HAT legs (already emergent — formalize it);
  debrief-by-exception or a short-form debrief for small flights; drop duplicated leg-progress
  bookkeeping (leg file OR flight log, not both). The parts that proved load-bearing and must not
  be cut: design decisions with rationale (DDs), the carry-forward/recon chain, flight-log
  anomaly entries, and live-verification records.
- **What to keep, verbatim**: phase-gated planning with operator decisions logged; the both-axes
  apparatus premise audit; spike-before-dependent-build as a hard rule; styling criteria +
  pre-HAT screenshot for visible UI; the deferred-commit / live-verify split; HAT legs for
  anything with feel.

## Action Items

**Quick wins before Mission 03 (one short maintenance pass):**
- [ ] `internal-preload.js` / d.ts: document the `settingsSet` resolution shape + the named
  "apply locally-computed state" antipattern in CLAUDE.md Patterns
- [ ] CLAUDE.md: complete the internal-page growth rule (add the `will-navigate` allowlist leg);
  add the pathname-duality note; add a Platform Coverage note (macOS unverified surfaces)
- [ ] `settings-store.js`: `get()` no-mutation JSDoc (live nested reference vs `getAll()` copy)
- [ ] `chrome-preload.js`: hygiene comment (why bare `ipcRenderer.on` is safe in a non-reloading
  context; use the handle pattern otherwise)
- [ ] `test/unit/url-safety.test.js`: `isInternalPageUrl` fragment case
- [ ] `npm run format` the `.github/dependabot.yml` drift (flagged in 3 debriefs)

**Scoped future flights (mission-level known issues, in priority order):**
- [ ] **Custom context-menu component flight** — graduates `menuController` to a module (+ mutex/
  recursion unit test) as its prerequisite leg; migrates the right-click Unpin onto a
  CDP-drivable, behavior-testable surface
- [ ] **mac HAT** — one session clears the frameless/traffic-light/app-quit/menu-dismissal/window-
  control deferrals
- [ ] **Tab-overflow many-tabs pass** (arrow scroll controllers; scroll-into-view active tab)
- [ ] **Per-site Shields overrides (more-strict-only)** — store + bridge seams are ready
- [ ] `handleInternal` extraction + unit tests; `privacyByTab` cleanup on tab close (leak under
  tab-cycling — amplified by Mission 03's automation use case); plan a renderer.js split when
  Mission 03 grows the chrome (~2,500-line tipping point)

**Mission 03 prerequisites (carried to its planning):**
- [ ] Session-type registry decision (`WeakMap<Session, type>`) before a third session category;
  automation enumeration must exclude internal-session webContents (privilege-escalation gate)
- [ ] Automation API key + toggles live in `settings-store.js` (no parallel config); status
  fan-out via `broadcastToChromeAndInternal`; any `goldfinch://automation` page enters via the
  trusted path + three-surface growth rule; hidden automation tabs are *web* sessions (Shields
  applied), never `goldfinch-internal`

**Mission-control (methodology) follow-ups:**
- [ ] behavior-test skill: sanction FD-driven-with-cited-evidence as a standard mode (operator
  decision, this debrief)
- [ ] flight skill: add "flight-debrief exists" to the Post-Flight checklist; add a landing sweep
  (log status/entries; HAT-behavior → spec update check)
- [ ] Right-size artifact ceremony (terse-leg format, short-form debrief option, deduplicated
  leg-progress bookkeeping)
