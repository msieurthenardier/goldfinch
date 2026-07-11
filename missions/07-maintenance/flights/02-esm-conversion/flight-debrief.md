# Flight Debrief: ESM Conversion of src/shared/

**Date**: 2026-07-11
**Flight**: [ESM Conversion of src/shared/](flight.md)
**Status**: landed
**Duration**: 2026-07-11 (single day)
**Legs Completed**: 6 of 6 (3 planned → 6 as-built: +1 divert, +2 sweep
partitioning)

## Outcome Assessment

### Objectives Achieved

Fully. `src/shared/` is real ESM — 15 dual-export modules and all four
page controllers on `import`/`export`; the top-level-const collision
class that caused three real-boot-only bugs across M06 is structurally
impossible, not merely guarded. The compensating machinery is retired by
construction: `renderer-globals.d.ts` 495 → 289 lines (exactly as
designed), 24 injected eslint globals gone, vm replay retired with the
nets repurposed as script-tag contract tests, all three hybrid
require-or-global branches deleted. Four CJS-by-design files remain
(2 preload-constrained, 2 zero-benefit), each documented and
lint-parse-guarded. Net code delta −194 lines excluding artifacts.
Trust-model files (`url-safety.js`, `internal-page.js`) verified
byte-identical minus export syntax.

### Mission Criteria Advanced

Criterion 1 (ESM + collision class gone + machinery retired) — met, with
the recorded CJS-quartet annotation. Criterion 5 (gates green
throughout) — held across all six legs including `npm run a11y`.

## What Went Well

- **DD1, the pilot gate, was the best call of the flight.** The pilot's
  live boot caught the preload-require(esm) blocker with a 3-module
  blast radius; the divert criterion fired exactly as written, the
  Developer stopped without workarounds (the fix was outside its file
  set), the FD swept the failure class (exactly two preload→shared
  edges), and the operator ruled the split. One extra leg was the whole
  cost of a defect no probe had covered.
- **Worktree-probe design reviews were the flight's highest-leverage
  mechanism.** Every leg review applied the full leg in an isolated
  worktree and reported empirically proven findings: 6+ would-have-
  blocked defects were caught pre-implementation (the jar-data-classes
  mini vm-replay, the chrome net's in-test transitional guard, 6×
  TS2307 on flat-served imports, the a11y-audit's 11 seam entries, the
  eslint later-wins re-bind that would have silently deleted the parse
  guard on the preload-constrained files). Zero second review cycles;
  zero implementation-time surprises after leg 1; end-of-flight review
  confirmed first-pass with only stale-comment findings.
- **The machinery being retired guarded its own retirement.** The
  pilot's self-derived net rework meant the nets flagged every
  converted-but-unretagged window mid-leg (1284/1285 transients) and
  needed near-zero changes in later legs — leg 3 ran them
  byte-unchanged.
- **DD3 outlived the flight**: the transitional defer rule held through
  six legs with zero order inversions and was promoted to a permanent
  all-documents pin (menu-overlay.html's classic `menu-controller.js`
  is where it now binds).
- **Flight 1's fast suite paid off exactly as its debrief predicted** —
  this flight ran the full suite dozens of times (per-module during
  sweeps) at ~1s each.
- **The seam ruling turned an implicit contract explicit**: "classic
  top-level functions are page globals" became a closed, consumer-tagged
  18-entry surface (dogfooding / behavior-spec / a11y-audit).

## What Could Be Improved

### Process

- **Probe design needs an execution-environment inventory.** The probe
  matrix covered three of four require surfaces (main, `node --test`,
  page scripts per scheme) — nobody enumerated "which environments
  execute a require() that can reach src/shared/", which would have
  surfaced the preload-renderer surface in minutes (five preload files,
  two shared edges). The gap was method, not effort: probes were driven
  by known consumers rather than an exhaustive environment checklist.
- **File classification by shape is the wrong inventory axis.**
  `automation-dev.js` was classified "plain CJS, no page consumer" and
  fell out of the pilot's input inventory — but require-graph
  reachability (chrome-preload → automation-dev → burner), not file
  shape, is what determined convertibility.
- **Comment/header sweeps need explicit file lists like code steps.**
  The only cross-leg leakage in six legs: leg 5's header-update pass
  missed 4 stale comments, caught at end-of-flight review
  (non-blocking, fixed pre-commit).

### Technical

- **The seam's closed set is comment-enforced only.** Removing an entry
  a behavior spec or `scripts/a11y-audit.mjs` still drives surfaces only
  at a live run, not in the suite.
- **The preload-graph-ESM-free invariant is AC-history, not a standing
  test.** The lint parse guard covers `export` syntax appearing IN the
  four CJS files, but not a new `require()` edge from them to a
  converted module — the exact leg-1 blocker class.
- Six `// @ts-ignore` flat-served imports type as `any`
  (backlog-noted; parity with the old ambient typing, no regression).
- Nothing pins `menu-controller.js`'s document-order-before-
  `menu-overlay.js` (defer preserves order, but the relative order
  itself is unasserted and menu-overlay.js reads its globals).

### Documentation

- **CLAUDE.md actively misdescribes `src/shared/` until Flight 3
  lands**: only the DD10(b) subsection got the pointer; the
  "dual-export predicate" and "recurring module shapes" sections still
  describe the retired world. Flight 3's rewrite should cover: the ESM
  pattern, the PRELOAD-REACHABLE constraint + parse-guard pair, the
  flat-served import rule, the seam closed-set rule, DD3-as-permanent,
  and Flight 1's carried MockTimers recipe.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| +1 leg: preload-edge-split (operator-ruled divert) | Renderer-side preload require has no require(esm); probe matrix missed that surface | Yes — the divert protocol itself worked exactly as designed; standardize the execution-environment probe inventory that would have prevented it |
| Sweep split 1 → 3 legs (internal / chrome / controllers) | Cross-surface safe-color forced 4-document retags; bridge retirement + seam needed its own leg | Yes — "fix partition after the pilot" was an explicit Acceptable Variation and keyed on real structure |
| 18-entry renderer evaluate seam | Module scope hides top-level functions from evaluate; behavior specs + a11y audit drive 16 entries by name | Yes — deliberate assignments from module scope are not the collision class; the closed set + consumer tags are the pattern |
| `// @ts-ignore` on 6 flat-served imports | INTERNAL_PAGES flat map vs disk layout impedance; disk-true specifiers 404 at boot | Accepted as-is; backlog-noted for a typing cycle |
| eslint `ignores` on the src/shared module block | Flat-config later-wins silently re-binds the CJS quartet to module, deleting the parse guard | Yes — "guard the guard": verify override precedence with `--print-config`, not by green lint alone |

## Key Learnings

- **Empirical design review beats analytical design review for
  mechanical sweeps.** Five of six legs were "approve with changes"
  where the changes were probe-proven, not opined — and the one leg
  whose defect no review caught (the pilot) failed in a surface no
  probe covered. The correlation is exact: probed surfaces produced
  zero implementation surprises; the unprobed surface produced the
  flight's only block.
- **Platform-boundary refactors need per-execution-context probes**:
  main require / preload-renderer require / page script per scheme /
  test runner / vm replay / evaluate. One row unprobed = one blocked
  leg, precisely.
- **Transitional bridges + per-leg live boots** carried a 19-file,
  4-document, 4-controller conversion across six legs with zero runtime
  regressions. The pattern (convert-with-bridge → retag → retire bridge
  when the last classic consumer converts) is reusable for any
  incremental module-system migration.
- **Suite metrics**: 1284/1284 @ ~1036ms (runner line; 3 runs, zero
  flakes), vs F1's 1283 @ ~1043ms mean and M06 F5's 1283 @ ~5.03s.
  require(esm) across 15 modules + the contract-test rewrite cost zero
  measurable suite time; count delta = +2 DD3 pins (leg 1), −1 bridge
  test (leg 5), moved auto-mint cases neutral.

## Recommendations

1. **Flight 3: widen the CLAUDE.md rewrite scope** beyond DD10(b) to
   every section describing the retired dual-export world (see
   Documentation above) — the doc-debt window is open until then.
2. **Promote the require-cache one-liner into a permanent unit test**
   (require `automation-dev` + `internal-page`, assert no ESM lands in
   `require.cache`) — cheap, suite-pins the flight's own blocker class.
3. **Add a static seam-contract test**: cross-check the 18 seam names
   against the identifiers `scripts/a11y-audit.mjs` drives (both
   statically parseable), so closed-set drift fails in CI rather than
   at a live audit.
4. **Adopt the worktree-probe design review and the
   execution-environment probe inventory as standing methodology** for
   sweep-class flights (methodology-level; carry to the mission
   debrief).
5. **Queue menu-controller.js conversion as a follow-on cycle
   candidate**: it retires the last classic script, the residual d.ts
   block, the last two injected globals, and DD3's only live binding
   case.

## Action Items

- [ ] Flight 3 leg design: CLAUDE.md scope per Recommendation 1 (+ the
      MockTimers recipe from F1's debrief)
- [ ] Next planning conversation: the preload-graph unit test (Rec 2)
      and the seam-contract test (Rec 3) — small enough to ride Flight 3
      or the next maintenance cycle
- [ ] Backlog (already noted in BACKLOG.md): flat-served import typing;
      the operator's renderer crash-resilience seed (rode this flight's
      commit; observability leg is a cheap early candidate)
- [ ] Carry to mission debrief: worktree-probe reviews + environment
      inventory as methodology recommendations; deferred-review workflow
      verdict (held under 6 legs, shared files, and a mid-flight divert
      — its genuine stress test — with one 4-comment leakage as the only
      cost); maintenance-report numeric imprecision was harmless ONLY
      because the pre-execution review re-derived the inventory —
      "re-derive inventory at pilot/design time" should be standing
      practice for report-seeded flights
