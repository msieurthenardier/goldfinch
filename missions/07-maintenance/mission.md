# Mission: Codebase Health — 2026-07-11 Maintenance

**Status**: active

## Outcome

Resolve the codebase health issues identified in maintenance report
[2026-07-11](../../maintenance/2026-07-11.md), so the history-support mission
starts on ESM footing with a fast suite, a symmetric IPC result contract, and
current pattern documentation.

## Context

Second maintenance cycle, operator-scoped to the Mission-06 debrief's debt
ledger. The keystone item — ES-module conversion for `src/shared/` — was
carried across three mission debriefs as an assumed-risky change; this cycle's
inspection proved it viable empirically (isolated Electron 42 probes covering
both production load paths and the CJS test runner). The next mission (history
support) adds more shared modules and a new internal page directly onto the
defect surface this mission removes.

## Success Criteria

- [ ] `src/shared/` modules use real `import`/`export`; consuming pages load
      them as module scripts; the collision defect class is structurally gone
      (vm-replay nets retired or repurposed; `renderer-globals.d.ts` ambient
      shared-global declares and the eslint shared-globals block removed)
- [ ] Full unit suite wall-clock under ~1.5s (from ~5.2s) via timer mocks in
      `automation-find.test.js`, with no loss of retry-logic coverage
- [ ] `jars-clear-data` and `jars-wipe` return `{ok:false, error}` uniformly
      on every failure branch, unit-pinned
- [ ] CLAUDE.md carries the uniform focus rule, the `action:rowId`
      confirm-transition key, and a DD10(b) checklist rewritten for the
      post-ESM world
- [ ] All existing gates stay green throughout (suite, typecheck, lint,
      `npm run a11y` where UI pages are touched)

## Stakeholders

Maintenance mission — the stakeholder is the next mission's crew. N/A beyond
that.

## Constraints

- Read the maintenance report's finding details before designing each flight's
  legs; the Inspector's probe evidence and the Architect's pilot-gate ruling
  are load-bearing inputs.
- The ESM sweep is GATED on its pilot leg landing green (Architect ruling).
- No scope growth: trigger-gated carried debt (report §Known Debt) stays
  untripped unless a trigger fires mid-mission.

## Environment Requirements

- Local dev toolchain (Node 22+, Electron 42) — no GUI-interactive HAT
  planned; the ESM pilot's live verification needs an app boot (real chrome +
  internal pages), scriptable.

## Open Questions

N/A — the maintenance report resolves the feasibility questions; the pilot leg
is the remaining empirical gate.

## Known Issues

*(none yet)*

## Flights

- [x] Flight 1: Suite & contract hygiene — timer mocks + `{ok:false, error}`
      standardization (2 legs, no dependencies) — landed 2026-07-11; suite
      5.0s → 958ms, both data channels error-bearing on every failure branch
- [x] Flight 2: ESM conversion of `src/shared/` — pilot leg gating the full
      sweep + machinery retirement (~4-5 legs) — landed 2026-07-11 as 6
      legs (preload-require(esm) divert + split sweep); `src/shared/` on
      real ESM, collision machinery retired, code delta −194
- [x] Flight 3: Doc promotions — the three CLAUDE.md pattern notes, written
      post-ESM — now includes the MockTimers recipe as a fourth edit
      (Flight 1 debrief action item), the widened shared-module rewrite
      (Flight 2 debrief Rec 1), and two ride-along invariant tests
      (Flight 2 debrief Recs 2–3, operator-ruled 2026-07-11) — 2 legs —
      landed 2026-07-11; CLAUDE.md rewritten for the post-ESM world, suite
      1293/1293 with the two new invariant pins
