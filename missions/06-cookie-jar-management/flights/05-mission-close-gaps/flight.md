# Flight: Mission-Close Gaps

**Status**: completed
**Mission**: [Cookie Jar Management](../../mission.md)

## Contributing to Criteria

- [x] Exactly one jar is the default at all times (criterion 5 — picker surface
      parity: the default marker is currently absent from the container picker)
- [x] Automation stakeholder guarantee — jar deletion degrades automation access
      verifiably (mission Open Questions named this scenario; never live-tested)

---

## Pre-Flight

### Objective

Close the two gaps the mission-close audit (2026-07-10, post-Flight-4) found
surviving from the tentative "Flight 5: Chrome integration" scope, so Mission 06
can be debriefed complete. Everything else in that tentative scope was audited as
already covered by Flights 1–4 (evidence recorded in the audit and the mission
debrief). This flight is deliberately minimal: one small renderer feature + one
behavior test.

### Open Questions

*(none — scope fixed by the audit and operator ruling)*

### Design Decisions

**DD1 — Picker default marker rides the existing model/data path**: extend
`buildContainerModel(containers)` to `buildContainerModel(containers, defaultId)`
and mark the flag-holding row (Burner's row when `defaultId` is null, matching the
jars-page semantics). Presentation must respect the sheet's textContent-only
constraint (labels are DATA; no markup in labels). The exact visual (label suffix
vs. sheet-side rendering of a flag field) is the implementing leg's call, reviewed
at design review.
- Rationale: the model builder is unit-tested, shared, and already carries
  per-item data (color); the renderer already holds `defaultId` at the single
  call site (renderer.js `openContainerPicker`).
- Trade-off: if sheet-side rendering is chosen, menu-overlay.js gains a small
  presentation branch.

**DD2 — Automation degradation verified live, not just unit**: a new behavior
test `jar-key-revocation-on-delete` drives a real MCP session against a keyed
jar, deletes the jar from the jars page (the real user path), and asserts the
next MCP request fails authentication (401 per DD5 of the automation design:
live sessions are not torn down; per-request re-validation rejects). Spec
authored at design time per the project's behavior-test conventions.
- Rationale: the mechanism (`revokeJarKey` in the delete composition) is
  unit-tested but has zero live witness; the mission's own Open Questions and
  two behavior specs' Out-of-Scope notes name exactly this gap.

### Prerequisites

- [x] Flights 1–4 merged (v0.7.0 on main)
- [x] Behavior-test apparatus operational (goldfinch MCP; two fresh-stage runs
      in Flight 4)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined (unit tests for the model change; behavior
      test for revocation; suite/typecheck/lint gates)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 extends the container-menu model + its unit tests and threads `defaultId`
through the one call site; presentation lands wherever design review agrees.
Leg 2 authors and runs the `jar-key-revocation-on-delete` behavior spec. Single
review + commit at the end (agentic-workflow deferred-review protocol).

### Checkpoints

- [x] CP1: picker shows the default marker, live-consistent with the jars page
      (moves when the flag moves; Burner marked when `defaultId` null); unit
      tests extended; suite/typecheck/lint green
- [x] CP2: `jar-key-revocation-on-delete` passes on a fresh stage

### Adaptation Criteria

**Divert if**: the sheet's rendering constraints make any marker presentation
unsafe (CSP/textContent violations) — would need a menu-overlay design pass.

**Acceptable variations**: marker presentation (label suffix, dot restyle,
sheet-side flag) per design review; behavior-spec step composition.

### Legs

- [x] `picker-default-marker` — DD1: model + call site + unit tests + presentation
- [x] `verify-key-revocation` — DD2: author + run the behavior spec

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- Unit: extended `container-menu.test.js` truth table (marker on holder, Burner
  fallback, no marker elsewhere, absent/None defaultId shapes).
- Behavior: `/behavior-test jar-key-revocation-on-delete` fresh-stage run.
- Existing gates: full suite, typecheck, lint.
