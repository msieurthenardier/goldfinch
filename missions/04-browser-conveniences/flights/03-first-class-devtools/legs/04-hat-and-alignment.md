# Leg: hat-and-alignment

**Status**: completed
**Flight**: [First-class DevTools](../flight.md)

## Objective

Operator-driven guided human acceptance test of the Flight-3 DevTools affordance: confirm the
button/shortcut/pin/window behave correctly on a real display, fixing any issues inline, until the
operator is satisfied.

## Context

- Optional interactive leg (operator-driven). NOT executed by autonomous agents — the Flight Director
  guides the operator one step at a time; failures are fixed inline (spawning a Developer if code
  changes are needed) and the step re-verified before moving on.
- Runs against the committed Flight-3 code (`flight/03-first-class-devtools`, commit `422692e`).
- Environment: WSLg. Per **DD8**, the **detached DevTools window materialization** and the **live CDP
  single-client conflict** are **macOS-authoritative** — on WSLg they are smoke / inconclusive-tolerated
  (do not fail the leg on a WSLg window-materialization hiccup; record it). Pin/shortcut/button/internal
  no-op are fully WSLg-testable.
- Apparatus: `npm run dev:automation` (the app + the loopback MCP surface) so the CDP-conflict step can
  drive `readAxTree`/`evaluate` while DevTools is open. The FD drives the MCP calls (curl/SDK); the
  operator drives the GUI.

## Acceptance Criteria (verification steps — operator-confirmed)

- [x] **H1 — Pin from Settings.** Settings → Appearance DevTools toggle; toggling on adds
  `#toggle-devtools` to the toolbar; toggle state matches. **PASS.**
- [x] **H2 — Button opens DevTools.** Click toggles DevTools open/close. **PASS** (functional). Surfaced a
  gap: **no visible pressed state** — fixed inline (`#toggle-devtools.active` gold fill,
  `styles.css:1189`); re-verified after restart. The ~1s detached-window close lag is WSLg-tolerated (DD8).
- [x] **H3 — `F12` page-focused.** Opens; closes when the Goldfinch window has focus. **PASS with caveat:**
  a 2nd `F12` from *inside* the focused DevTools window doesn't toggle (the detached window owns its own
  key focus — Chromium-native, macOS-authoritative). Re-focusing the app → `F12` closes correctly.
- [x] **H4 — `F12` / `Ctrl+Shift+I` chrome-focused.** Both toggle via the renderer fallback. **PASS.**
- [x] **H5 — Unpinned shortcut still works.** Unpinned (button hidden), `F12` still opens. **PASS.**
- [x] **H6 — Right-click unpin.** Native "Unpin DevTools" removes the icon; Settings toggle re-syncs.
  **PASS.**
- [x] **H7 — Persist across restart.** Pinned, quit, relaunch → still pinned. **PASS.**
- [x] **H8 — Internal no-op.** On `goldfinch://settings`, `F12`/button inert. **PASS.** Operator alignment
  call: make all 3 pinnable buttons (Media/Shields/DevTools) **visibly disabled** on internal tabs (they
  are tab-scoped) — fixed inline (`activateTab` toggles `disabled` from `isInternalTab`; reuses
  `.icon-btn:disabled` dim). See the flight-log pivot note (DD5 reframed).
- [x] **H9 — Live CDP conflict (macOS-authoritative; WSLg-tolerated).** **Recorded finding — no conflict
  under WSLg.** With DevTools open on the web tab (wcId=2, opened via the new `F12` affordance),
  `readAxTree(2)` **still returned the full AX tree** (not `debugger-unavailable`/`attach-failed`) and
  `evaluate(2)` succeeded; closing DevTools left `readAxTree` working. Reproduces the prior M03 WSLg
  finding (the detached DevTools window doesn't cleanly establish a competing CDP client under WSLg) — now
  confirmed via the human-affordance open path, not just the M03 MCP tool. The refusal path stays
  unit-tested; definitive live observation needs macOS. Driven over the MCP surface (admin key, port
  49730) by the Flight Director.
- [x] **H10 — Alignment.** Operator signed off ("ship it") after the 3 inline fixes (pressed-state,
  centering, dim-on-internal).

## Run Log

Guided live session on WSLg (DISPLAY=:0), app launched by the Flight Director via
`npm run dev:automation` (GUI + loopback MCP for H9); operator drove the GUI, FD drove the MCP probes.

**Per-step**: H1–H8, H10 all PASS (with the H3 focus caveat and the H8 alignment change above);
H9 recorded as WSLg-inconclusive (macOS-authoritative).

**Inline fixes applied during the HAT** (all gates green after each — 841 tests / typecheck / lint):
1. **Pressed-state CSS** — `#toggle-devtools.active { background: var(--accent); color: var(--accent-fg) }`
   (`styles.css:1189`). DevTools, unlike the panel toggles, has no in-app surface to signal open state
   (its window can be offscreen under WSLg), so the button must carry it. Matches `.filter.active`.
2. **Glyph centering** — added `#toggle-devtools` to the `#toggle-media,#toggle-privacy,#automation-indicator`
   flex-centering selector group (`styles.css:1135`); it was falling back to the un-centered base `.icon-btn`.
3. **Dim/disable all 3 pinnable buttons on internal tabs** — `activateTab` sets `disabled` on
   `toggleMedia`/`togglePrivacy`/`toggleDevtools` from `isInternalTab(tab)` (`renderer.js:603-612`),
   reusing the existing `.icon-btn:disabled` dim; separate from `applyToolbarPins` (still pin-driven).
   + CLAUDE.md note recording the **tab-scoped toolbar** principle (see flight-log pivot).

**Restarts**: two app restarts to pick up renderer/CSS changes (pin state persisted across both, also
serving as H7 evidence). MCP port races on first two binds (49720) resolved by relaunching on a fresh
port (49725/49730) — a dev-harness flake, not a product issue.

---

## Post-Completion Checklist

- [x] All HAT steps confirmed (H1–H8/H10 PASS; H3 focus caveat; H9 WSLg-inconclusive/macOS-authoritative;
  operator signed off "ship it")
- [x] Inline fixes implemented + gates green (841 tests / typecheck / lint)
- [x] Flight log updated with the HAT outcome + the DD5-reframe pivot
- [x] Leg status → `completed`; HAT leg artifact + fixes committed with the flight
