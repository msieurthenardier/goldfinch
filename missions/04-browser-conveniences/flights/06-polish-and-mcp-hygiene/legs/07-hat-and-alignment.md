# Leg: hat-and-alignment

**Status**: in-flight
**Flight**: [Polish & MCP Hygiene](../flight.md)

## Objective

Operator-driven live verification of the flight's HAT/visual-only and apparatus-gated acceptance — the
SC10 panel-animation smoothness (esp. Shields, the planning-HAT 2nd glitch source), the new app icon, and
the PART-D behavior-test runs + `npm run a11y` deferred from leg 6 — fixing any issues inline until the
operator is satisfied.

## Context

- **Non-optional for this flight** (Flight Director decision, flight-log): this leg is the sole home for
  SC10 visual verification (#27 animation), the app-icon eyeball, and the leg-6 deferred PART-D rows
  (behavior-test runs + a11y) — none observable headless.
- Mirrors Flight 5's post-landing HAT leg: runs after the autonomous legs committed + draft PR (#67), may
  find/fix defects inline, commits HAT results at close.

## Acceptance Criteria (verification steps)

- [ ] **AC1 — Media panel animation (SC10):** open/close the Media panel (`Ctrl+M`) — slides smoothly, top
  chrome stationary, no per-frame content reflow/jump.
- [ ] **AC2 — Shields panel animation (SC10, the key one):** open/close the Shields/privacy panel
  (`Ctrl+Shift+P`) — now matches Media (no content pop-in/reflow mid-slide; the planning-HAT glitch gone).
- [ ] **AC3 — Cross-panel switch:** switch directly Media↔Shields — the closing panel releases cleanly, no
  strand at panel width, no double-border/jump.
- [ ] **AC4 — Reduced-motion:** with `prefers-reduced-motion` on, panels snap open/closed (no slide) and
  still function.
- [ ] **AC5 — App icon:** the new goldfinch icon shows on the window/taskbar.
- [ ] **AC6 — Settings cleanup:** `goldfinch://settings` shows no Downloads nav entry/section; the
  spellcheck note reads "Enabling spellcheck downloads a one-time dictionary…"; scrollspy tracks the 5
  sections.
- [ ] **AC7 — `downloads-surface` re-run:** behavior test green incl. the new dedup + exactly-one-record
  checkpoints (scripted live MCP smoke); spec stays `active`, run log written.
- [ ] **AC8 — `page-context-menu` run:** runnable rows green → flip `draft → active`; run log written.
- [ ] **AC9 — `spellcheck` run:** WSLg-acceptance rows green → flip `draft → active`; native-render rows
  (squiggle paint, NSSpellChecker) recorded INCONCLUSIVE-on-WSLg / macOS-deferred; run log written.
- [ ] **AC10 — a11y:** `npm run a11y` 0 new chrome-sweep violations.

## Notes

_(append observations + inline fixes during the session)_

- **2026-06-20 — HAT finding (AC1, keyboard path):** `Ctrl+M` minimizes the window instead of toggling the
  Media panel when a web page has focus. **Pre-existing, not a Flight-6 regression** (`keydown-action.js` +
  the `main.js:380` `before-input-event` block unchanged this flight; no custom app menu → Electron default
  menu owns `Ctrl+M`=Minimize; no page-focus forwarding branch for the Media toggle). **Out of Flight-6
  scope → logged as a follow-up bug** in the mission Known Issues (operator decision). Does NOT block SC10
  verification — Media/Shields animation verified via the toolbar buttons + `Ctrl+Shift+P` instead.
- **2026-06-21 — HAT outcome (AC1–AC4, the #27 animation): REVERTED + DEFERRED.** Three mechanism attempts
  all failed live under WSLg (the `<webview>` native surface mis-positions on panel open; DOM geometry
  correct, render shifts — full diagnosis in the flight-log HAT-session note). Operator decided to revert
  #27 entirely and defer to macOS/Windows. Leg 01 → `aborted`; SC10 deferred. AC1–AC4 of this HAT leg are
  therefore **N/A this flight** (no new animation to verify).
- **Remaining HAT for the LANDED wins (AC5–AC10):** still owed for the four wins that DID land — app-icon
  eyeball (AC5), settings-cleanup visual (AC6), and the leg-6 PART-D behavior-test runs + a11y (AC7–AC10).
  See the Flight Director's closing note for disposition.
