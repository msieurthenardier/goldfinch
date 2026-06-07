# Leg: verify-integration

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Real-environment acceptance gate for the flight: run the two new behavior tests, re-run the
`tab-keyboard-operability` regression, run the `npm run a11y` axe sweep, and perform the manual
checks (drag / close / minimize / frameless resize spike) against the running GUI on `:9222` —
confirming SC1/SC2/SC8/SC9 + the flight-local behaviors hold live before the flight lands.

## Context
- Interactive/live leg (not autonomous) — requires the running Electron app at `:9222` + a WSLg
  display. Driven by the Flight Director with the operator, per the `/agentic-workflow` interactive-
  leg protocol. Deferred from the build phase by operator decision ("code 4–5 now, verify all
  later").
- **Apparatus**: raw CDP-over-WebSocket CLI (`/tmp/cdp.mjs`) attaching to the existing `:9222`
  renderer with **trusted** `Input.dispatch*` events. The `chrome-devtools` MCP was deliberately
  NOT used (it launches a fresh browser → false pass; the standing Goldfinch trap). This satisfies
  the behavior specs' apparatus precondition (Playwright MCP or raw CDP; not chrome-devtools).
- Execution mode: `SendMessage` absent → single-pass independent Executor + independent Validator
  per test (Witnessed act/judge separation preserved).

## Verification Performed & Results

### HAT alignment (live, with the operator) — see leg 07
A guided live-tuning pass corrected the tab-strip layout and chrome before the behavior tests:
pill moved to hug the **right** of the tabs (leg-1 framing pivot), window controls made flush-
right with a guaranteed drag holder, a muted-gold frameless window border, Chrome-matched 240px
default tab width, and crisp CSS-drawn window-control icons. Details + as-built measurements in
`07-hat-and-alignment.md`. The two new behavior specs were updated to the as-built pill position
before running.

### Behavior tests (Witnessed, live on `:9222`)
- **`unified-tab-controls`** (SC2, SC8) — **8/8 PASS**. Pill `+`/`▾` open plain + container tabs by
  mouse and keyboard; container-menu open/keyboard-nav/Escape-focus-restore correct; visible dark-
  on-gold focus ring confirmed via focused-vs-unfocused screenshot delta (#1e1f25 on #f5c518,
  ≫3:1); tablist contract intact (pill outside the tablist). Run log:
  `tests/behavior/unified-tab-controls/runs/2026-06-07-00-30-09.md`.
- **`responsive-tab-strip`** (flight-local sizing + deferred-close + DD7 maximize) — **8/8 PASS**.
  Tabs 240px→shrink-to-88-floor→scroll (last-resort); pointer-close freezes sibling widths with the
  next close under the cursor, re-expands on strip-leave; keyboard close reflows immediately;
  maximize/restore read path tracks real window state. Run log:
  `tests/behavior/responsive-tab-strip/runs/2026-06-07-00-44-37.md`.
- **`tab-keyboard-operability`** (regression) — **8/8 PASS**. Roving-tabindex/Arrow-Home-End auto-
  activation, keyboard close + focus management, named close buttons, and no-hijack all survived
  the restructure; tablist purity re-verified first-hand (pill + window-controls outside `#tabs`).
  Run log: `tests/behavior/tab-keyboard-operability/runs/2026-06-07-01-14-27.md`.

### `npm run a11y` (SC8)
- WCAG A/AA tag sweep with the a11y-media fixture (`:8000`): **2 violations**, both pre-existing
  `scrollable-region-focusable` in `[privacy-panel]` + `[lightbox]` — **confirmed identical on the
  pre-flight build** (`3fdd5a2`) via a throwaway worktree, so NOT introduced by this flight (which
  touches neither component). **SC8 holds**: zero new WCAG A/AA violations from the pill, reserved
  zone, or window controls. The 2 pre-existing issues are recorded in the flight-log Anomalies +
  mission Known Issues for a future a11y touch-up.

### Manual checks (apparatus can't drive)
- **Frameless resize spike (the divert gate)** — operator confirmed the `frame:false` window
  **resizes and drags** on WSLg → **divert trigger did NOT fire**; legs 4–5 stay in this flight
  (no Flight 1b split). Snap/tile deferred to the Windows installer build.
- **Drag-to-move** — confirmed (drag the reserved zone / strip background moves the window).
- **Minimize** — confirmed (hides + restores).
- **Close quits** — confirmed (the `✕` button quit the app cleanly: `win.close()` →
  `window-all-closed` → `app.quit()`, DD6 quit-path).
- **Maximize/restore** — verified live (1400×900 ↔ 2560×1392; button state flips). **Resolves the
  flagged WSLg-maximize open question: it works.**

## Acceptance Criteria
- [x] `unified-tab-controls` behavior test passes (SC2, SC8).
- [x] `responsive-tab-strip` behavior test passes (flight-local sizing/deferred-close + DD7 maximize).
- [x] `tab-keyboard-operability` regression passes (restructure didn't break the keyboard contract).
- [x] `npm run a11y` introduces no new WCAG A/AA violations from this flight's surfaces (the 2
  reported are pre-existing, confirmed against the pre-flight build).
- [x] Manual: drag-to-move, minimize, close-quits, maximize/restore, and the frameless resize spike
  all verified; divert trigger did not fire.
- [x] Run logs committed under `tests/behavior/<slug>/runs/`; specs promoted `draft → active`.

## Files Affected
- Behavior-test run logs (3) + spec status/Last-Run updates; flight log; mission Known Issues.
- No source changes in this leg beyond the HAT alignment captured in leg 07.

---

## Post-Completion Checklist
- [x] All behavior tests + regression pass; a11y assessed (SC8 holds)
- [x] Manual checks performed with the operator
- [x] Run logs written + specs updated
- [x] Flight log updated with the verification summary
- [x] Findings (pre-existing a11y; future many-tabs items) recorded in flight log + mission Known Issues
