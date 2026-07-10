# Leg: hat-default-semantics

**Status**: completed
**Flight**: [Default-Jar Semantics](../flight.md)

## Objective

Operator-witnessed acceptance of Flight 2's user-visible semantics: the DD6 dot
policy's look-and-feel on a real migrated profile, new-tab default routing, live
propagation of rename/set-default to open tabs and the picker, and the
Burner-as-default fallback. Interactive — the Flight Director guides; the operator
performs/observes; fixes are applied inline and re-verified. CP4 gate.

## Context

- Everything here is already machine-verified (Leg 3 matrix + behavior test 7/7);
  this leg judges what machines can't: visual feel, and the DD6 posture decision
  (always-dotted vs suppress-current-default — an accepted Adaptation-Criteria
  variation if the operator rejects always-dotted).
- Two-environment split (safety): **real dev profile** for look-and-feel and
  reversible mutations only (rename A→B→A, set-default X→Y→X); **scratch profile**
  for the destructive delete-all/burner-fallback demonstration. The operator's real
  jars are never deleted, and every real-profile mutation is reversed before the
  step closes.
- Apparatus: FD drives mutations through the automation surface (dev:automation +
  chrome-target evaluate), exactly as in Leg 3/behavior test; the operator watches
  the window and reports what they see.

## Verification Steps (guided, one at a time)

1. **Real profile — migrated look-and-feel + DD6 decision.** Operator launches their
   normal dev app. Observe: boot tab lands in the flag-holder jar (legacy `Default`
   on this profile) and now shows a grey dot (new behavior — the legacy jar is a
   normal jar); the container picker lists all migrated jars + the Burner sentinel;
   nothing else feels off. **Decision point**: keep always-dotted (DD6) or request
   the suppress-current-default fallback posture.
2. **Real profile — new-tab routing.** Operator presses Ctrl+T (and opens one tab
   from a link/context menu): both land in the default jar, dot matching.
3. **Real profile — live propagation (reversible).** Operator relaunches with the
   automation recipe; FD drives, operator watches: (a) rename+recolor of one jar —
   open tabs' dots/titles and the picker update without restart; (b) set-default to
   another jar — next Ctrl+T lands there; then FD reverses both mutations and the
   operator confirms restoration.
4. **Scratch profile — burner fallback (destructive, isolated).** FD launches a
   scratch instance; operator watches that window: FD deletes both seed jars → next
   new tab is an evaporating burner tab (orange dot); FD adds a jar → next new tab
   lands in it (auto-claimed flag). Operator confirms the visuals match the
   mission's Burner story.
5. **Sign-off.** Operator states satisfied; any issues found were fixed inline and
   re-verified.

## Acceptance Criteria

- [x] Steps 1-4 confirmed by the operator (visual + behavioral) — step 2 initially
      surfaced two findings (D2 Ctrl+T guest-focus forwarding, D3 link-open jar
      inheritance), both fixed inline and operator-re-verified before proceeding
- [x] DD6 posture decision recorded: **always-dotted kept** ("Keep the dot on all
      tabs")
- [x] Real profile restored to its pre-HAT state (default flag back on `default`,
      Work jar name/color restored, FD-opened demo tab closed; verified via
      post-restore reads)
- [x] Inline fixes verified (suite 1154/1154, typecheck, lint) and committed in the
      flight's HAT commit

## Post-Completion Checklist

- [x] Flight-log entry with per-step outcomes + operator verdicts
- [x] Leg status → `completed`; CP4 checked; flight → `landed`; mission Flights
      list updated; `[COMPLETE:flight]`
