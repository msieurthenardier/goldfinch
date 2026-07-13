# Leg: hat-reverification

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Closing HAT: the operator re-walks the surfaces the four fix legs changed,
confirming each banked finding is resolved and nothing regressed. Plus the
`jar-data-controls` behavior test re-run (its spec was rewritten
close-not-reload in Leg 05).

## Context

- Fix legs committed (`290d3b0`, PR #79). App must be RELAUNCHED on
  `flight/08-history-mission` to load the new renderer/main source (dev
  is source-loaded — a restart suffices; no build).
- Interactive leg — the FD guides one step at a time; look-and-feel fixes
  ride inline, new-behavior requests get promoted (fix-vs-feature gate).

## Re-verification steps (map to the banked findings)

1. **R1 (address select-all)**: click into a populated address bar → whole
   URL selected; second click places cursor; Ctrl+L still selects;
   internal-tab bar (readOnly) unaffected.
2. **H4 (tabs)**: jars page shows a per-jar tab strip (History/Cookies/
   Other site data), History default, count badge; professional/tight
   look; keyboard arrows move tabs; Burner has no tabs.
3. **H1 (paging) + H5**: History tab shows a numbered pager (`< 1 2 3 >`),
   page nav works, no "of many" bug.
4. **H2 (row links)**: clicking a history entry opens it in a NEW tab in
   the SAME jar (try left + middle-click).
5. **H3 (trashcan)**: per-row delete is a trashcan icon; deletes the entry.
6. **H7 (modal)**: any destructive action (clear/wipe/delete) opens a
   MODAL that can't be overlooked; Escape/Cancel/backdrop dismiss;
   Confirm acts.
7. **H6 (wipe closes tabs)**: wipe a jar with open tabs → tabs CLOSE (not
   reload), history stays cleared, confirm copy warned about it.
8. **jar-data-controls behavior test**: re-run `/behavior-test
   jar-data-controls` → pass (close-not-reload spec).

## Acceptance

- [x] Findings R1/H1–H7 confirmed resolved live (operator satisfaction).
- [x] `jar-data-controls` behavior test passes — 7/7 PASS, run log
      `tests/behavior/jar-data-controls/runs/2026-07-13-15-09-25.md`.
- [x] Any inline fixes committed; gates green. (Inline fix this leg was the
      `jar-data-controls` spec Step-5 parenthetical correction; the H6
      renderer behavior itself needed no change — the behavior test proved
      it works as designed. H8 + H9 dispositioned as follow-ups.)

---

## Post-Completion Checklist

- [x] All re-verification steps pass (or dispositioned) — Re-Steps 1–8 PASS;
      H8 + H9 filed/banked as follow-ups.
- [x] Update flight-log.md; set leg `completed`
- [x] Flight → landed; mission ready for `/mission-debrief`
