# Flight Log: ESM Conversion of src/shared/

**Flight**: [ESM Conversion of src/shared/](flight.md)

## Summary

*(not started)*

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### Pre-execution design review (2026-07-11, before any leg work)

Operator-requested review of the flight spec against the tree at `1ffaeda`
before invoking /agentic-workflow. Reviewer (Developer, Sonnet) re-derived
the full conversion inventory and ran three isolated empirical probes.
**Assessment: approve with changes** — feasibility and the pilot-gate
strategy confirmed sound, but three HIGH findings would have failed the
pilot's own CP1 gate as originally scoped:

1. The vm-replay nets and the eslint `sourceType: 'commonjs'` per-glob
   binding break on the FIRST converted file (both empirically reproduced
   in a worktree) — machinery adaptation must ride every converting leg,
   not wait for leg 5 (now DD4).
2. Main-process require(esm) was outside the original probe coverage while
   7 of 15 dual-export modules are required by main (several at module
   load, pre-`app.ready`). Closed empirically: Electron 42.4.0 main-process
   require of `export`-syntax modules verified by isolated probe; made an
   explicit pilot acceptance criterion (DD2/CP1).
3. Partial-page conversion inverts classic-vs-module execution order;
   `renderer.js` tolerates it only by an unstated invariant — now guarded
   by the transitional defer rule (DD3).

Also corrected: hybrid set is container-menu/jar-page-model/
automation-indicator-model (NOT automation-dev, which is plain CJS);
pilot widened to include jar-page-model.js so order-survival is proven on
BOTH load paths; downloads.html has no shared scripts (dropped from retag
list); menu-overlay.html added (loads safe-color.js); audit-paging.js
activeLog/activeLogOf export-name mismatch identified; menu-controller.js
explicitly carved out (DD6 — d.ts slims, doesn't retire); counts fixed
(26 eslint globals, 18 typeof-module sites vs the report's 32/37). Flight
spec rewritten accordingly while still `ready` (pre-in-flight, updatable
per ARTIFACTS.md). The maintenance report itself left untouched —
inspection snapshot; corrections live here and in the flight spec.
