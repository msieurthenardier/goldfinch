# Leg: 04-verification

**Status**: landed
**Flight**: [Cross-Window Tab Drag](../flight.md)

## Objective

Bring the behavior-spec net into truth with the shipped native-DnD drag layer: author the
`cross-window-drag` spec (criterion 8's regression net, HAT-apparatus), rewrite `tab-tearoff`'s
cross-window banner (the criterion is now satisfied — the banner's world is gone), and disposition the
now-inert `dragPointer` tab-drag rows across every spec that has them — honestly, not green-washed.
Design-reviewed; all review fixes incorporated.

## Context

Risk: **HIGH** — this leg REVERSES a prior spec's load-bearing warnings and re-scopes multiple committed
specs. Documentation/spec files only — no `src/` changes (except none; CLAUDE.md is docs).

**The two facts this leg propagates:**
1. **Criterion 8 is SATISFIED** — F11 shipped cross-window drag on HTML5 DnD (the banner's "candidate 2
   … foreclosed by omission, never measured" WAS measured: probes 2–10 + the wayland relaunch); the
   operator witnessed the full gesture live on X11 (flight log, criterion-8 HAT). DD5: on the WSLg dev
   rig the gesture is X11-only (Wayland cancels the drag at the source surface); packaged native
   targets expected full-parity.
2. **The `dragPointer` instrument cannot complete a tab drag** — the drag layer is native HTML5 DnD;
   synthetic pointer injection cannot drive the native drag loop (recorded at Leg 2; the PRECISE
   mechanism — whether a synthetic sequence fires `dragstart` before dying — is inferred, not measured;
   the disposition prose must not overclaim it). `dragPointer` remains valid for non-tab drags.
   Tab-strip dragPointer rows are dead instruments that would FAIL — the OPPOSITE failure mode from
   the old banner's false-pass trap, and just as corrosive left looking runnable.

**⚠ THE LIVE SUCCESSOR TRAP (must survive as an ACTIVE warning, not history):** the DnD handlers ARE
drivable by a synthetic `DragEvent`/`DataTransfer` dispatched via `evaluate` — a fabricated `drop` on
`#tabs` fires the REAL `tab-adopt-by-drop` IPC and goes green with no OS transport exercised. The flight
log forbids this explicitly. The rewritten banner and the new spec must carry it as the successor
warning, in the spirit of (and citing) the old banner's false-pass doctrine and the `multi-window-shell`
9/9-over-a-real-bug precedent.

## Affected surface (review-verified)

- `tests/behavior/tab-tearoff.md` — banner; rows **3, 4, 5 (downstream of 4), 6, 7** (dead instrument);
  surviving scope rows **8, 8a, 9 + the HIGH-1 displaced-menu block**; PLUS the stale supporting prose:
  the Out of Scope "CROSS-WINDOW DRAG — NOT VERIFIED, BY RULING" bullet, the `Math.hypot` arm-threshold
  bullet (threshold no longer exists), the instrument bullets ("dragPointer paces its moves", the DD9
  `e.buttons` note), the V1 chrome-band section, the rows-3/4 controlled-pair + 5px-arm-threshold
  row-convention prose — all premised on the removed injection path; same historical-reframe treatment.
- `tests/behavior/tab-reorder.md` — **Step 3 ONLY** is dead-instrument (Step 4 already retired). Steps
  5–6 (keyboard `pressKey`) and 7–9 (click model) are LIVE instrument-valid coverage — do NOT retire.
  Steps 7–8's Expected Results cite `suppressClickActivate`/pointerdown-activation — REMOVED by F11;
  mechanism-note update (native DnD needs no click-suppression flag), not retirement. The Out of Scope
  cancel-restore rationale ("dragPointer is atomic") is stale (cancel is now Escape→dragend, itself
  Wayland-unavailable per the DD5 extension) — one-line premise update.
- `tests/behavior/tab-cycling.md` — sole dragPointer mention is an Out of Scope prose note premised on
  the old pointer machinery; one-line premise update (no banner).
- `tests/behavior/foreground-to-act.md` — confirmed NON-tab (raising-ops contract list, still true);
  UNTOUCHED.
- `tests/behavior/multi-window-automation.md` — Out of Scope "Tear-off / cross-window drag — F8 owns
  it" stale flight pointer; one-line fix.
- `docs/mcp-automation.md` — dragPointer entry recommends "e.g. tab reorder"; replace example with a
  non-tab drag + one sentence (tab drags are native HTML5 DnD as of M09 F11; HAT-apparatus specs own them).
- `CLAUDE.md` (goldfinch) — the "Two-set-point click-suppression flag (M09 F2 DD2) — do not 'simplify'
  to one" section describes REMOVED machinery as a live invariant (delete/replace with the native-DnD
  truth); the automation paragraph bills dragPointer as "for tab reorder" (update).

## Acceptance Criteria

- [x] **AC1 — `tests/behavior/cross-window-drag.md` authored** (criterion 8's net), conforming to the
      ARTIFACTS.md spec format. **Apparatus split with an explicit convention:** gesture Actions are
      marked **`OPERATOR:`** — the Orchestrator pauses and asks the operator to perform the physical
      drag and confirm (the run-skill's operator touch-point mechanism); the Executor NEVER attempts
      the gesture (native DnD is automation-inert by measurement — and a synthetic `DragEvent` via
      `evaluate` is FORBIDDEN per the live trap above; state both IN the spec); the Executor is
      observe-only (`enumerateWindows`/`enumerateTabs`/history/rendered state), the Validator judges.
      **Preconditions:** `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
      dev:automation -- --ozone-platform=x11` (dev-launch passes the flag through; admin key via
      env-var reference ONLY, never echoed — standing discipline), with the DD5 citation (gesture does
      not exist under Wayland on WSLg) AND the caveat that X11 + `--automation-dev` is a first-time
      pairing on this rig and X11 carries the M05 F8 first-click-swallow quirk (a swallowed first click
      is the environment, not a product regression). Two windows; a tab with ≥2 committed history entries.
      **Rows:** (1) cross-window drop on target strip — identity triple (same `wcId`, same jar, live
      history: `goBack` lands), source closes ranks, TARGET announces (the source's `no-tab` is
      suppressed — cite renderer.js requestTearOff), announce sequence read per-record via the
      disconnect-then-arm recorder discipline (carry errata: per-record `addedNodes`, not
      final-value; calibrate); (2) same-window reorder control (zone-model negative control, unchanged
      behavior); (3) tear-off to desktop — new window at release, **identity triple asserted here too**
      (the tear-off door's DD2 coverage — old row 5's — dies with old row 4; this row inherits it),
      row chains: its new window is row 4's fixture; (4) sole-tab drag into the existing window
      consolidates + closes source (F10 L3); (5) **refusal coverage inherited from old rows 6–7:**
      sole-tab tear-off to desktop refused + announced (`Cannot move the only tab…`), internal
      (settings) tab drag refused + announced (`This tab cannot be moved…`) — both still-live product
      arms (renderer.js ~1729). Status `draft`; first run owed to the operator's keyed gauntlet.
- [x] **AC2 — `tab-tearoff.md` banner + supporting prose rewritten.** The "DOES NOT VERIFY CROSS-WINDOW
      DRAG" banner is replaced with the current truth: the gesture SHIPS (F11, HTML5 DnD), criterion 8
      operator-witnessed (X11, flight-11 log), verification lives in `cross-window-drag.md`
      (HAT-apparatus). PRESERVE as explicitly-historical: the fiction-coordinate findings and the
      `multi-window-shell` false-pass tale (they justify the HAT apparatus). CARRY FORWARD as ACTIVE:
      the synthetic-`DragEvent` green-wash trap (successor of the old false-pass warning). The stale
      supporting prose (listed in Affected surface) gets the same historical-reframe treatment — the
      spec must not self-contradict after the edit.
- [x] **AC3 — dead-instrument disposition in `tab-tearoff.md`.** Rows 3, 4, 6, 7 marked superseded
      (dead instrument: native DnD, F11) with row 5 superseded as row-4-downstream; pointers to
      `cross-window-drag.md` successors (reorder→row 2, tear-off→row 3, sole-tab refusal→row 5,
      internal refusal→row 5). Rows 8, 8a, 9 + HIGH-1 stay live (keyboard instrument unaffected).
      **The header's owed clean re-run is formally RE-SCOPED to the surviving rows (8/8a/9 + HIGH-1)**
      — rows 3–7 are permanently unrunnable as written. Run history and the 2026-07-16 partial verdict
      stay intact as provenance.
- [x] **AC4 — `tab-reorder.md` scoped disposition** per Affected surface: Step 3 superseded; Steps 5–9
      live; Steps 7–8 mechanism-note updates (`suppressClickActivate` removed — native DnD needs no
      suppression flag); Out of Scope premise updates. No live coverage retired.
- [x] **AC5 — `tab-cycling.md` one-line premise update; `foreground-to-act.md` untouched (verified
      non-tab); `multi-window-automation.md` stale-pointer fix.** Report each.
- [x] **AC6 — `docs/mcp-automation.md` + `CLAUDE.md` updated** per Affected surface.
- [x] **AC7 — no green-wash.** Nothing implies superseded rows passed under the new layer; nothing
      presents the new spec as having run; the synthetic-DragEvent prohibition present in both the new
      spec and the rewritten banner. `npm test` untouched (docs-only leg) — suite stays 1973/0/0.

## Out of Scope
- Running any behavior test (the keyed gauntlet is the operator's, owed from F10 — carried, now
  including the re-scoped tab-tearoff re-run + the new spec's first run).
- Any `src/` change.

---
## Post-Completion Checklist
- [x] ACs verified; flight-log leg entry; leg status per lifecycle; flight.md leg checked
- [ ] Commit as the Leg 4 / flight-close commit (with the debrief following)
