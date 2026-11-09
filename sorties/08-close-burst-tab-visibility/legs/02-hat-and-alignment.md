# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Close-Burst Tab Visibility](../flight.md)

## Objective
The operator closes runs of tabs by hand and confirms that every pointer close shows the tab under the cursor, with no flash and no hover switching; anything that surfaces is fixed (look-and-feel inline; new behavior through the fix-vs-feature gate).

## Context
- Leg 01 landed and committed (`6dec29e`): `closeTab(id, { pointer })` from the ✕ and middle-click sites; one activation; no-target → old behavior.
- Not automatable (flight DD7): the sub-frame "no flash" and "hover never switches" — this leg is their acceptance.
- Leg 01 smoke anomaly: `captureWindow`/`captureScreenshot` timed out on heavy restored dev-profile pages (environmental) — rendered truth is judged by eye here.
- Accepted trade-off to judge (DD2): with a squeezed strip, a tab frozen under the 64px active floor grows when it becomes active, shifting the next ✕ a few px.

## Inputs
- App launched in dev mode (`npm run dev:automation`, profile-isolated; `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` so the behavior spec can run afterwards).

## Outputs
- Operator verdict per step, recorded in the flight log; any fixes committed.

## Acceptance Criteria (operator-verified, one at a time)
- [x] **H1 — mid-strip ✕ run.** With ~8 tabs open, click the ✕ of a background tab in the middle and keep clicking the same spot 3–4 times without moving the mouse. Each close shows the page of the tab that slid under the cursor; the tab highlight and address bar match; no other tab's page flashes in between.
- [x] **H2 — middle-click run.** Middle-click the bodies of background tabs mid-strip. Same result as H1.
- [x] **H3 — hover never switches.** Move the mouse slowly back and forth across the tabs (no clicks). The active tab and page never change.
- [x] **H4 — right-end run.** Close the rightmost tab by ✕ several times in a row. Whatever tab ends up under the cursor is shown; when the cursor ends up on the `+` or empty space, the visible tab follows the old rule.
- [x] **H5 — squeezed strip.** Open 20+ tabs and do a mid-strip ✕ run. The shown tab is always the one under the cursor; judge whether the small shift from the active-tab minimum width is acceptable.
- [x] **H6 — keyboard unchanged.** Ctrl+W on a mid-strip tab behaves as before (jumps to the rightmost tab — squawk 0177).
- [x] **H7 — operator overall sign-off** that closing a run of tabs is now confident.

## Verification Steps
Flight Director presents one step at a time; the operator performs it and reports; failures are diagnosed and fixed (Developer spawn for code), then the step is re-verified.

## Implementation Guidance
Interactive leg — no autonomous implementation.

## Edge Cases
- Cursor lands in the 4px gap between tabs → no switch (old rule); note if the operator hits it.

## Files Affected
- Only if a fix is needed.

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
