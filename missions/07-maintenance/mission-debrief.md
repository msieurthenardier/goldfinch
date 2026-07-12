# Mission Debrief: Codebase Health — 2026-07-11 Maintenance

**Date**: 2026-07-11
**Mission**: [Codebase Health — 2026-07-11 Maintenance](mission.md)
**Status**: completed
**Duration**: 2026-07-11 (single day, three flights)
**Flights Completed**: 3 of 3

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1. `src/shared/` on real `import`/`export`; collision class structurally gone; machinery retired | **Met** | 15 dual-export modules + 4 page controllers converted; `renderer-globals.d.ts` 495 → 289 lines; 24 injected eslint globals gone; vm-replay nets repurposed as script-tag contract tests; all 3 hybrid branches deleted. Four CJS-by-design files remain (2 preload-constrained, 2 zero-benefit by ruling), each documented, lint-parse-guarded, and now suite-pinned. Architect verified every claim against the tree at debrief time — all matched. |
| 2. Suite wall-clock under ~1.5s, no coverage loss | **Met** | 5.21s → 958ms at F1 landing; ~1.0–1.2s across all subsequent measurements (run-to-run variance, see Methodology Feedback). Retry-exhaustion semantics fully re-pinned on `node:test` MockTimers; zero production change needed. |
| 3. `jars-clear-data` / `jars-wipe` return `{ok:false, error}` on every failure branch, unit-pinned | **Met** | All 8 failure branches carry branch-discriminable `jars: <op> — <code>` strings, each pinned verbatim. Carry-forward: 2 of 8 strings interpolate dynamic text — history's first `result.error` consumer must prefix-match those branches. |
| 4. CLAUDE.md carries the focus rule, `action:rowId` key, post-ESM DD10(b) checklist | **Met (exceeded)** | F3 widened per its DD1: full shared-module story rewrite (ESM pattern, PRELOAD-REACHABLE + parse-guard pair, flat-served import rule, seam closed-set rule, DD3-as-permanent) plus the F1-carried MockTimers recipe. The doc-debt window F2 opened closed within the mission. |
| 5. All gates green throughout | **Met** | Suite, typecheck, lint held across every leg of all three flights; `npm run a11y` run at F2 (the one flight touching page markup). Final: 1293/1293 (1283 baseline + 2 DD3 pins − 1 bridge test + 9 invariant pins). |

### Overall Outcome

The mission delivered exactly its charter, plus enforcement it grew for
itself along the way: the history-support mission now starts on real ESM
footing with a ~1s suite, a symmetric jar data-channel contract, current
pattern documentation, and two standing invariant tests (preload-graph
ESM-free, evaluate-seam contract) that pin the mission's own hardest-won
findings. The Architect's tree-verified assessment: architecture improved
cleanly and measurably, with no offsetting regression found. The outcome
was still the right goal at the end — every piece was chosen for the
history mission's benefit, and that mission's surface (new shared modules,
new internal page, write-heavy store) lands directly on what this mission
reworked.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1. Suite & Contract Hygiene | completed | Suite 5.0s → 958ms via MockTimers (zero production change — the flight spec's conditional clock seam proved unnecessary at leg design); all 8 jar-handler failure branches carry pinned `error` strings. PR #70. |
| 2. ESM Conversion of `src/shared/` | completed | 3 planned → 6 as-built legs (+1 operator-ruled divert, +2 sweep partitioning). Collision defect class structurally impossible; compensating machinery retired; net −194 lines. The pilot gate caught the mission's only real blocker (preload-require(esm)) with a 3-module blast radius. PR #71. |
| 3. Doc Promotions | completed | CLAUDE.md rewritten for the post-ESM world (four promotions + DD1 rewrite); two boot-free invariant tests landed as operator-ruled ride-alongs, discharging F2's debrief Recs 1–3 and F1's MockTimers action item within the mission. PR #72. |

## What Went Well

- **The pilot gate (F2 DD1) was the mission's best structural call.** The
  one defect no probe covered — Electron's preload-context `require()` has
  no `require(esm)` — surfaced in a 3-module pilot instead of a 15-module
  sweep. The divert protocol executed as written: the Developer stopped
  without workarounds, the FD swept the failure class (exactly two
  preload→shared edges), the operator ruled the split. Cost: one extra
  leg. The catch was then converted into a permanent structural invariant
  — quartet rule + eslint parse-guard + a standing suite pin — rather than
  left as a one-off fix.
- **Empirical design review was the highest-leverage mechanism, 3-for-3
  across flights.** Reviewers probed in scratch dirs and worktrees rather
  than opining: F1's reviewer executed the tick/drain recipes against the
  unmodified engine; F2's worktree reviews caught 6+ would-have-blocked
  defects pre-implementation; F3's reviews caught both of its leg-spec
  defects (detector false negative, wrong literal count) the same way.
  The correlation held exactly: probed surfaces produced zero
  implementation surprises; the mission's only block came from the one
  unprobed surface.
- **The debrief-to-flight feedback loop closed inside the mission.**
  F1's MockTimers recommendation and F2's Recs 1–3 (doc rewrite scope,
  both invariant tests) all landed in F3 rather than joining a backlog.
  The Architect found no discharged-in-name-only items: every action item
  from the mission's own debriefs either landed or is a named,
  trigger-gated carry-forward.
- **The deferred-review workflow is validated.** Three flights covered
  the favorable case (F1: two disjoint legs), the genuine stress test
  (F2: six legs, shared files, a mid-flight divert — one 4-comment
  leakage as the total cost), and a docs+tests flight (F3: zero review
  findings). Operator verdict at this debrief: worked well, keep it.
  Escalation calibration also confirmed right — both operator rulings
  (divert split, ride-along tests) were genuinely operator calls, and
  nothing else should have escalated.
- **Citation-audit discipline held across all leg designs** (36 + 21
  citations verified at F1/F3 design time; F2's reviews re-derived
  inventories wholesale). Implementing agents across the mission reported
  zero improvisation gaps from stale references.
- **Flight sequencing compounded as designed**: F1's fast suite made
  F2's dozens of per-module gate runs cheap; F2 landing before F3 meant
  the doc rewrite described what exists. Both orderings were deliberate
  and both paid off.

## What Could Be Improved

- **Probe design needs an execution-environment inventory, not a
  consumer-driven probe list.** The feasibility probes covered main
  require, `node --test` require, and page scripts per scheme — nobody
  enumerated "which environments execute a `require()` that can reach
  `src/shared/`," which would have surfaced the preload-renderer surface
  in minutes. The gap was method, not effort. (See Methodology Feedback.)
- **Maintenance-report figures are leads, not inventories.** The report
  said 19 shared modules / 37 dual-export sites; design-time re-derivation
  found 15 dual-export modules / 18 sites. Harmless this mission *only*
  because F2's pre-execution review re-derived everything — that
  re-derivation should be standing practice for report-seeded flights,
  not luck.
- **Single-run suite timing invites false trend-reading.** F3's debrief
  measured 1174.9ms on its required single run vs ~971ms at landing and
  F1/F2 multi-run means of ~1036–1043ms — pure variance (F1 documented a
  >150ms spread on unchanged code), but only the multi-run priors made
  that diagnosable. (See Methodology Feedback.)
- **Count-based acceptance criteria were the mission's recurring leg-spec
  defect class.** Both F3 design-review catches were wrong-count/
  wrong-pattern errors in the draft. A designer self-check — re-derive
  every literal count in an AC from the tree before requesting review —
  would make review a confirmation rather than the discovery mechanism.
- **Closed sets now have dual sources of truth.** `SEAM_COUNT = 18` in
  the seam test alongside CLAUDE.md's prose; nothing cross-enforces an
  inconsistent bump. Accepted trade-off (named in F3's debrief and both
  test headers), small blast radius — the next seam-touching flight
  budgets the dual update.

## Lessons Learned

- **Platform-boundary refactors need per-execution-context probes** —
  main require / preload-renderer require / page script per scheme / test
  runner / vm replay / evaluate. One unprobed row cost exactly one
  blocked leg.
- **"Hedge conditionally, resolve empirically" is the right maintenance
  spec shape**: state the fallback, require leg design to verify the
  cheaper path first (F1's clock seam and F2's plain-CJS rulings both
  resolved this way).
- **Platform-empirical findings outrank same-name probes on adjacent
  platforms**: vanilla Node 22 `require()` loading ESM transparently does
  not reopen the Electron-42-empirical preload constraint. Don't soften
  documented constraints on the weaker evidence.
- **Two-tier static extraction generalizes**: when a consumer drives
  identifiers both directly (call sites) and indirectly (data tables), a
  single-pattern extraction silently covers a fraction of the surface —
  probe recovered counts against a hand count before trusting a static
  contract test (a naive regex covered 6/11 of the a11y-audit surface).
- **Transitional bridges + per-leg live boots** carried a 19-file,
  4-document, 4-controller migration with zero runtime regressions; the
  retiring machinery guarded its own retirement (the vm nets flagged
  every converted-but-unretagged window mid-flight). Reusable for any
  incremental module-system migration.
- **"Docs first, then pin what the docs claim" is a sound split** — F3
  leg 2's tests took their targets directly from leg 1's rewritten prose.
  Its one residue: the docs don't name their pins (carried as an action
  item for the next CLAUDE.md touch).

## Methodology Feedback

Mission-control-side items, for the methodology repo:

1. **Flight-debrief skill: replace single-run test metrics with 3–5
   runs.** The skill's Developer-interview instruction ("run the full
   test suite once") produced F3's ambiguous 1174.9ms reading; F1/F2's
   voluntary multi-run means were what made it diagnosable as variance.
   Report mean and range.
2. **Standardize empirical design review for sweep- and maintenance-class
   flights**: reviewers execute the leg's recipes/extractions in a scratch
   worktree and report probe-proven findings, not analytical opinions.
   3-for-3 across this mission's flights; every pre-implementation defect
   caught, zero false blocks, zero second review cycles.
3. **Add an execution-environment probe inventory to platform-boundary
   flight design**: enumerate every environment that executes the code
   class under change before probing feasibility. The mission's only
   blocked leg traces to this gap exactly.
4. **The deferred-review workflow (per-leg design review, single
   end-of-flight code review + commit) graduates from trial to default**
   for agentic flight execution — validated across the favorable case,
   the stress case, and the docs case, with operator confirmation at this
   debrief.
5. **Report-seeded flights re-derive inventories at design time** —
   maintenance-report numbers are treated as leads; the flight's first
   design pass re-counts against the tree.

## Action Items

- [ ] **History mission planning opens with the SQLite-substrate
      decision** (`node:sqlite` vs vendored `better-sqlite3`; zero-dep
      identity at stake) — deferred by design from this cycle
      (maintenance report §Deferred by Design)
- [ ] History planning carries the contract notes: first `result.error`
      consumer prefix-matches the `unknown-class` / `session-failure`
      branches; `handleRemove`'s bare `{ok:false}` is the trigger-gated
      third sibling if the contract family is revisited
- [ ] History design: run the execution-environment probe inventory
      proactively (new internal page crosses main/preload/renderer the
      same way jars did); re-read the four-gate internal-page pattern
      before design review; new main-side wiring lands as a
      `registerXIpc`-style extraction to keep the `main.js` line-count
      watch quiet
- [ ] Next CLAUDE.md touch: add the enforcement cross-references
      ("pinned by `test/unit/seam-contract.test.js`" at the seam rule,
      incl. the `SEAM_COUNT` dual-update obligation; "pinned by
      `test/unit/preload-graph-esm-free.test.js`" at the quartet
      paragraph) — from F3's debrief
- [ ] Mission-control: apply Methodology Feedback items 1–5 (flight-debrief
      skill multi-run metrics; empirical design review, environment
      inventory, and inventory re-derivation as standing guidance;
      deferred-review workflow as default)
- [ ] Next full-category maintenance sweep after the history mission —
      this cycle was ledger-scoped; categories 1–10 unrefreshed since
      2026-06-05 (report Rec 3)
- [ ] Future-cycle candidate: `menu-controller.js` ESM conversion (last
      classic script, last two injected globals, DD3's only live binding,
      residual d.ts block) — F2 debrief Rec 5
