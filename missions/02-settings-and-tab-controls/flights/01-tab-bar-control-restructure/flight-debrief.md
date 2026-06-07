# Flight Debrief: Tab-Bar Control Restructure

**Date**: 2026-06-07
**Flight**: [Tab-Bar Control Restructure](flight.md)
**Status**: landed
**Duration**: 2026-06-06 (build) → 2026-06-07 (verify) — single operator session
**Legs Completed**: 7 of 7 (5 build + verify-integration + hat-and-alignment)

## Outcome Assessment

### Objectives Achieved
The flight delivered every objective. The tab strip was restructured into a golden `( + ▾ )` pill,
responsive tabs (240px default → 88px floor → scroll), deferred resize-on-close, and a frameless
window with custom controls + drag regions. Mission **SC1, SC2, SC8, SC9** are verified and checked
off. All In-Flight checkpoints were met. The concrete divert trigger (frameless resize unusable on
WSLg) was armed throughout and correctly **did not fire** — resize confirmed live.

### Verification
- Behavior tests (Witnessed, trusted CDP on the live `:9222` renderer): `unified-tab-controls`
  **8/8**, `responsive-tab-strip` **8/8**, `tab-keyboard-operability` regression **8/8**.
- `npm run a11y`: clean for this flight's surfaces; the 2 reported `scrollable-region-focusable`
  (privacy-panel, lightbox) confirmed **pre-existing** against the pre-flight build (`3fdd5a2`).
- Manual: drag, minimize, close-quits, maximize/restore, resize spike — all pass.
- Two WSLg open questions resolved **positive** (maximize works; frameless resizes). macOS
  traffic-light path remains deferred to a Mac.

## What Worked (reinforce / codify)

- **DD7's both-axes (act + observe) apparatus premise audit — the highest-leverage move.** It
  predicted that window-maximize state had *no existing observable surface* and that a DOM read
  path (main forwards `maximize`/`unmaximize` → `window-maximized-change` IPC → `data-state`/
  `aria-label`) had to be **built before it was needed**. Result: `responsive-tab-strip` Step 7
  passed first try with nothing to scramble for mid-flight. This is exactly the failure mode the
  observe-axis audit exists to prevent, and it worked.
- **DD5 deferred-resize seam — exemplary spec→build fidelity.** Freeze in the pointer-close click
  path (guarded `tabs.size > 1`), release in the keyboard path, shared `closeTab` untouched,
  zero-tab guard respected — implemented line-for-line from the Architect's seam note.
- **DD2's "verify-at-HAT, not known-true" epistemic stance** for the gold-on-gold focus ring — the
  contrast-safe override was added defensively and the HAT screenshot delta confirmed it empirically.
- **DD6 quit-path consistency** honored (`mainWindow.close()` → `closed` → `window-all-closed` →
  `app.quit()`, not a direct `app.quit()`), keeping the future kebab-Exit path aligned.
- **The HAT leg earned its keep** — it caught the DD1 pill-placement reversal *and* the DD4 tab-width
  fix before the behavior tests ran. Layout/feel work genuinely needs a live human loop.
- **Behavior-test apparatus discipline + the Witnessed pattern** — attach-don't-launch raw CDP with
  trusted `Input.dispatch*`; the `chrome-devtools` MCP (present in-session) was correctly avoided;
  the Validator did real adversarial probing (the Step-6 "freeze doesn't release" finding was
  correctly reclassified as a CDP-teleport artifact after a continuous-move test).
- **Conventions held**: JSDoc `els.*` casts, the bridge + `renderer-globals.d.ts` mirror gated by
  typecheck, the `#address:focus-visible` specificity-comment pattern reused for the pill ring.
- **CLAUDE.md updated this flight** (frameless chrome + window-control IPC + drag regions) — arch
  docs are current.

## What Could Be Improved

### Critical / Important

- **[Important] DD1 locked the wrong *position* for the pill — and it cascaded.** SC1's "adjacent to
  the open tabs, rather than trailing them" was under-determined; DD1 read it as "leading the strip
  (first child)" and built a whole focus-order analysis on that. The operator's real intent (pill
  *hugging the right of the last tab*) surfaced only at HAT. The reversal was caught cheaply, but it
  was **not free**: it invalidated DD3 (static `right→left` CSS swap became a *dynamic* JS-measured
  anchor) and forced the `#tabs` flex model to change (`flex:1` → `flex:0 1 auto` + a `#tabstrip-drag`
  spacer). A one-line spatial ambiguity propagated into the layout architecture.
  **Action**: pin UI element **position explicitly** (child order or a small ASCII diagram) in
  mission SC / flight specs for layout work — don't leave "adjacent/left-aligned" to interpretation.
- **[Important] The divert-trigger sequencing was inverted by the "code 4–5 now, verify later"
  decision.** The flight designed the resize spike to **open leg 4** — prove resizability *before*
  building leg 5 on top of it, so a Flight-1b split would be cheap. Deferring the spike to the end
  meant both frame legs were fully built + committed before the gate ran; a split at that point would
  have been maximally expensive. It worked out (spike passed), but the risk-management value of the
  bundling-with-divert design was bypassed.
  **Action**: if a spike *is* a divert trigger, it must run before the dependent build — deferring it
  inverts the safety design. (This is a general flight-skill lesson, not just this flight.)
- **[Important] Recurring apparatus gap — hand-rolled CDP driver, twice now.** Verification couldn't
  use the `chrome-devtools` MCP (launches its own browser → false pass; "the standing Goldfinch
  trap") and the registered Playwright MCP "wasn't connected," so the verify session hand-rolled
  `/tmp/cdp.mjs` (trusted `Input.dispatch*`, eval, screenshot, attach-don't-launch). **This recurred
  from mission 01** — same trap, same hand-roll — because the lesson was noted but never carried into
  committed code. The project *already* commits a near-twin: `scripts/a11y-audit.mjs` (CDP-over-
  WebSocket, attach-don't-launch, Node-22 global `WebSocket`, no runtime deps). Promoting the driver
  to **`scripts/cdp-driver.mjs`** (trusted input + eval + screenshot) carries near-zero novelty risk
  and makes it reviewable, discoverable, and nameable as the canonical behavior-test apparatus.
  **Action**: promote `/tmp/cdp.mjs` → `scripts/cdp-driver.mjs` as a small maintenance task or folded
  into the next verify setup. Keep this *decoupled* from the BACKLOG "first-class trusted automation
  surface" (the in-product, gated MCP endpoint) — the committed script is the 30-minute fix; the
  product feature is a future mission. **Meta-lesson (mission-control)**: "flight hand-rolled
  ephemeral apparatus" should itself generate a standing debrief action to commit/standardize it.
- **[Important] The a11y baseline isn't regression-meaningful across flights.** Mission 01 recorded
  "0 violations," but proving the 2 `scrollable-region-focusable` findings were pre-existing required
  spinning up a throwaway worktree on `3fdd5a2`/`:9223` — the prior "0" was measured against a
  different fixture/environment and wasn't comparable.
  **Action**: pin a fixture + environment for `npm run a11y` so its output is a real regression
  baseline (otherwise every flight re-litigates "is this new?").

### Minor

- **Prerequisite phrasing**: "Playwright MCP *registered* in `.mcp.json`" was satisfied on paper but
  failed operationally (not connected). Prereqs should assert **operational availability**
  (connected / port answering), not mere declaration.
- **CSS specificity trap recurred**: `.icon-btn{width:32px}` beat `.win-ctrl{width:46px}` on source
  order (fixed via id-scoped `#window-controls .win-ctrl`) — the same class as mission-01's
  `#address:focus-visible` trap. Worth a checklist item for CSS legs.
- **Coverage gaps (accepted, but noted)**: minimize + Close IPC handlers are manual-only (2 of 4 new
  `ipcMain` handlers never machine-verified — minimize backgrounding isn't CDP-observable; Close
  tears down the harness). The **entire macOS frameless path is unverified** (`titleBarStyle`,
  `trafficLightPosition:{x:12,y:14}`, the 78px inset) — budget a **mac HAT** before any macOS build.
- **Tech debt**: the `.tab` `width:240px` + `flex:0 1 240px` + `overflow:hidden` triad is fragile
  (the explicit width exists only because `overflow:hidden` collapses flex content-size — documented
  inline, but a trap); `#e81123` close-hover is a magic hex, not a token; the hand-mirrored
  `renderer-globals.d.ts` can silently drift (otherwise pervasively `any`).
- **Still open**: the repo-wide `prettier --check` failure on `.github/dependabot.yml` (pre-existing,
  left untouched per leg scope) — a one-line `npm run format` fix for a maintenance pass. Note the
  gate inconsistency: prettier isn't in the `test`/`typecheck`/`lint` trio, so repo-wide format drift
  can sit indefinitely.

## Test Metrics

- `npm test` → **147 pass / 0 fail / 0 skipped** (internal ~72ms; wall ~0.17s). `npm run typecheck`
  → 0 errors (~0.99s). `npm run lint` → 0 problems (~0.52s). No flakes observed (single run; the
  offline suite is pure security/privacy helpers — near-zero flake risk).
- **Test count delta vs mission 01: 0** (147 → 147). History: 96 → 147 (+51, privacy core) →
  147 ×4. `git diff 3fdd5a2 -- test/` shows **no unit-test files changed**; only three behavior
  specs were added/edited. **Zero new offline unit tests is correct here** — a11y/CSS/rendering/IPC
  in this `sourceType:"script"` renderer isn't unit-testable; coverage lives in the 3 behavior tests
  + the axe harness (the "flat 147 is the honest signal" philosophy from the mission-01 debriefs).
- Behavior tests: 3 specs, **8/8 each**, promoted `draft → active`.

## Reusable Patterns That Emerged (capture in CLAUDE.md — overdue)

Mission-01's Flight-5 debrief already had an open action to capture reusable patterns; this flight
adds four strong, currently-uncaptured candidates:
1. **Deferred-resize freeze/release seam** — freeze measured widths only in the pointer-close path,
   never in shared close; release on container `mouseleave`; keyboard path releases-not-freezes.
2. **`html.platform-{platform}` class tagging** — the standard OS-divergence CSS seam (vs scattering
   `process.platform` checks in the renderer).
3. **CSS-drawn, font-independent window-control icons** — pseudo-elements + `currentColor`, keyed off
   `data-state` (removes the cross-platform glyph-rendering fragility that made `□` look broken).
4. **Maximize IPC read-path seam (DD7)** — main forwards window events → a DOM state the behavior
   test consumes; the template for any "read window/system state from a test" assertion.

Also still open from mission 01: the **README keyboard-shortcuts table** omits the tab-nav keys
(Arrow/Home/End/Delete) and now the window controls too — now more overdue.

## Skill Effectiveness

- **Mission skill**: SC1's "adjacent/left-aligned" wording was under-determined on *position* — a
  spec-quality gap that cost a HAT pivot + two cascading deviations. Layout SCs should pin element
  ordering.
- **Flight skill**: the both-axes (act + observe) premise audit (DD7) is the strongest practice this
  flight demonstrated — keep it. New lesson: a spike used as a divert trigger must run **before** the
  dependent build, and prerequisites should assert **operational** availability, not registration.
- **Leg skill**: high-fidelity and mechanically implementable for the autonomous build; but
  layout/feel and flex-`overflow:hidden`-collapse hazards genuinely can't be fully pre-specced —
  budgeting HAT for them was correct.
- **Behavior-test skill**: apparatus discipline (attach-don't-launch, trusted input, avoid
  chrome-devtools) worked; `SendMessage` was absent so all runs used single-pass Executor +
  independent Validator (Witnessed separation preserved). The spec's apparatus precondition should
  list a **committed `scripts/cdp-driver.mjs`** as a canonical option alongside Playwright MCP.

## Action Items

- [ ] **Promote `/tmp/cdp.mjs` → `scripts/cdp-driver.mjs`** (committed, reviewable attach-don't-launch
  trusted-input CDP driver). *(Cheap; do as a maintenance task or in the next flight's verify setup.)*
- [ ] **Pin an a11y fixture + environment** so `npm run a11y` is a real cross-flight regression baseline.
- [ ] **Capture the 4 reusable patterns** above in CLAUDE.md; add tab-nav keys + window controls to
  the README keyboard-shortcuts table.
- [ ] **Fix the 2 pre-existing `scrollable-region-focusable`** a11y violations (`#privacy-body` +
  lightbox scroll container get `tabindex="0"`) — a future a11y / panels touch-up.
- [ ] **Budget a mac HAT** before any macOS build (traffic-light inset + the 78px pad are unverified).
- [ ] **Methodology (mission-control)**: encode "hand-rolled-apparatus-twice ⇒ standing action to
  commit it," and consider phrasing flight prerequisites as operational-availability checks.
- [ ] Future **many-tabs flight** (already in mission Known Issues): replace the un-grabbable
  overflow scrollbar with arrow scroll controllers + `scrollIntoView` the active tab; must preserve
  + re-verify the roving-tabindex tablist, the deferred-resize freeze/release seam, and the
  pill-hugs-tabs layout.
- [ ] Trivial: `npm run format` the pre-existing `.github/dependabot.yml` prettier drift.
