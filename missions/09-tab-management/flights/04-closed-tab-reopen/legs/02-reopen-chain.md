# Leg: reopen-chain

**Status**: completed
**Flight**: [Closed-Tab Stack and Reopen](../flight.md)

## Objective

Land the full reopen chain per flight DD2 (authoritative — follow its four
numbered steps exactly), retire the Ctrl+Shift+T reservation in lockstep,
author the `closed-tab-reopen` behavior spec, and add the three F3-debrief
BACKLOG entries.

## Context

- Flight DD2's reopen chain is the spec: classifier action
  `reopen-closed-tab` (reservation retirement incl. the sheet loop split
  and the allowlist assertion INVERSION — all pin sites enumerated in DD2);
  `tabReopen()` bridge + `tab-reopen` invoke (returns entry or null;
  main-side jar resolution; `jarFallback` flag; `isSafeTabUrl`
  re-validation); renderer container resolution via `inheritFromPartition`
  + existing fallback chain + announcement on fallback; `createTab` gains
  `restoreHistory` + `insertAt` (honored via `commitTabMove`, clamped);
  `tab-create` skips `loadURL` when restoring and calls
  `navigationHistory.restore({entries, index})` with the EXPLICIT index;
  captured title as initial strip title.
- Spike verdict (leg 1): restore() full fidelity confirmed — no divert.
- BACKLOG additions (F3 debrief): classifier hand-mirror unification;
  pressKey KEY_MAP PageDown/PageUp; isRepeatSafeAction scope note. Match
  BACKLOG.md's entry style.

## Acceptance Criteria

- [x] Classifier + sheet mirror + allowlist all carry `reopen-closed-tab`
      per DD2 step 1 (lockstep; reservation comments retired — grep-AC: no
      "reserved" Ctrl+Shift+T comments remain in src/ or test/; every old
      null-pin flipped or split as enumerated).
- [x] `tabReopen` bridge + `tab-reopen` handler per DD2 step 2 (incl.
      isSafeTabUrl re-validation, jarFallback flag, null on empty).
- [x] Renderer dispatch + container resolution + announcement per DD2
      step 3; `createTab` `insertAt` clamps and lands the tab at its
      original position via `commitTabMove`.
- [x] `tab-create` restore branch per DD2 step 4 (no loadURL race; explicit
      index; initial title).
- [x] Live checks: reopen restores url+jar+history+position from all three
      capture points (chrome focus, guest-delivered, sheet-open); empty
      stack no-ops; burner/internal never resurrected; jar-deleted fallback
      reopens in the resolved default with announcement. Record in the
      flight log.
- [x] `tests/behavior/closed-tab-reopen.md` authored per flight DD4 (draft,
      Last Run: never; house apparatus preconditions; the history-fidelity
      check uses the goBack nav op; positive controls on the no-op rows;
      burner-exclusion row asserts the burner URL appears NOWHERE after
      reopen attempts).
- [x] BACKLOG.md gains the three F3-debrief entries.
- [x] `npm test`, lint, typecheck green; flight log leg entry.

## Files Affected

- `src/shared/keydown-action.js`, `sheet-accelerator.js`,
  `guest-forward-allowlist.js` (+ their tests)
- `src/renderer/renderer.js`, `src/preload/chrome-preload.js`,
  `src/renderer/renderer-globals.d.ts`
- `src/main/main.js` (tab-reopen handler; tab-create restore branch)
- `tests/behavior/closed-tab-reopen.md` (new), `BACKLOG.md`
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
