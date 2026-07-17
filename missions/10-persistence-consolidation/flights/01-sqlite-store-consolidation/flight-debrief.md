# Flight Debrief: SQLite Store Consolidation

**Date**: 2026-07-17
**Flight**: [SQLite Store Consolidation](flight.md)
**Status**: landed
**Duration**: 2026-07-17 (single day, autonomous execution)
**Legs Completed**: 3 of 3

## Outcome Assessment

### Objectives Achieved

Everything the flight set out to do shipped, with unusually high plan-to-code
fidelity (Architect: "no gaps found between what was designed and what
shipped"). All five JSON stores persist via `app.db` document rows behind the
new Electron-free `app-db.js`; one-time migration with `.migrated` renames;
shields lifted to house discipline (a debt CLOSED, not deferred); boot seam
reshaped; docs and BACKLOG current; DD1 re-affirmed. The live behavior gate
(`sqlite-store-migration`, 6/6 PASS on the real rig) retired the real
migration risk rather than asserting it from code shape — including the
corrupt-DB quarantine path and DD6's branch-dependent legacy reseed, observed
live exactly as designed.

### Mission Criteria Advanced

Criteria 1 (five surfaces on the substrate, no-loss migration), 2
(corrupt/missing DB never bricks boot), 3 (store discipline incl. shields), 7
(DD1 re-affirmed + docs), 8 (codec seam survives) — all checked at the flight
level, live-verified where observable.

## What Went Well

- **The risk-tiered design reviews earned their keep.** Both High findings in
  leg 2's review were real: the 59-test `jar-ipc.test.js` blast radius, and
  the DD10/pre-load-mutation conflict in shields. Leg 1's High finding —
  doc-store resolution must sit OUTSIDE the stores' never-throw catch-all —
  was the single most consequential catch of the flight (without it,
  mis-ordered boot silently degrades to defaults).
- **Honest interim-state accounting.** Leg 1 shipped a known-wrong dev-mode
  `appDb.open` ordering deliberately (minimal-diff interim), recorded it in
  the flight log Decisions, and leg 2 fixed it permanently. Nothing hidden,
  nothing reached main.
- **The behavior-test crew held the security line better than the FD.** The
  Executor refused the FD's first admin-key mechanism with a correct argv-
  exposure analysis, and the final mechanism (one-shot Node script over the
  project's own `scripts/lib/mcp-client.mjs`, key as function argument only)
  is strictly better than both proposals it replaced. The refusal-accepted
  loop is the Witnessed pattern working.
- **Paired before/after sha256 captures** made the negative claims
  ("migration is one-time", "never re-imported") directly verifiable — the
  right template for filesystem behavior tests (Validator's calibration).

## What Could Be Improved

### Process

- **Interim wiring choices need a dev/prod ordering audit at leg design.**
  DD7 described production ordering correctly but didn't audit the dev-mode
  `setPath` redirect against leg 1's interim wiring shape. Caught and fixed
  in-flight; the category ("minimal-diff interim wiring gets an explicit
  dev/prod path check") is the lesson.
- **DD language should name its own degenerate cases.** The "v1 array
  validating to zero survivors" migration sub-case was resolved by a sound
  implementation-time ruling — a different failure mode than
  design-review-caught gaps, worth distinguishing: novel edge → recorded
  Decision (as done), but a spec that enumerates its degenerate inputs
  avoids the mid-leg ruling entirely.
- **Key-redaction regexes are not a mechanism.** The FD leaked the
  jar-scoped bearer key into its own transcript via a redaction regex that
  missed a leading-underscore token — the exact failure class M09 F10's
  debrief codified ("never print a key-bearing stream"). Rotation is
  HAT-scoped. Rule going forward: never print a key-bearing stream even
  "redacted"; extract fields with jq/node instead.

### Technical

- **Suite timing tax is now structural.** Wall ~1.36s (F11) → ~1.92s (+41%
  for +2.2% tests). Cause: every converted store suite now pays a real
  synchronous SQLite open/bootstrap per test (`appDb.open(newTmpDir)`
  pattern); the fs-heavy cluster widened from two suites to the whole
  persistence family (~3.3s own-time sequential). `jar-ipc.test.js` (~650ms)
  is a new top-3 tail member purely from onboarding the pattern.
  Recommendation below.
- The `main.js`/`renderer.js` god-file debt (six-flights-unactioned at M09
  F9) was not worsened (wiring lines only) but not reduced — re-flag at
  mission debrief.

### Documentation

- CLAUDE.md's new App-database section and store rewrites verified accurate
  against shipped code (reviewer-confirmed). No gaps identified.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD10 refined at leg-2 design review (not-loaded no-op / loaded errors propagate) | Original wording under-specified an existing behavioral dependency (~9 pre-load test sites) | Yes — check mutation-before-load contracts when adding error propagation |
| Leg-1 interim `appDb.open` before dev redirect | Minimal-diff interim; leg 2 owned the reshape | The audit habit, yes; the interim itself was fine |
| v1-empty-array migration sub-case ruled at implementation | Spec didn't enumerate the degenerate input | Record-as-Decision pattern: yes |
| Behavior-test admin-key mechanism replaced twice mid-run | argv-exposure analysis by the Executor; SDK-client mechanism adopted | Yes — documented in spec header + run log as the sanctioned pattern |
| PR #96 left DRAFT, unmerged | `gh pr ready`/`merge` classifier-blocked this session | No — operator promotes/merges at HAT; F2 stacks on the branch |

## Key Learnings

- "Row resolution outside the never-throw catch-all" is now a **named house
  idiom** for Electron-free stores — load-bearing precedent, not a one-off.
- The substrate supports incremental schema evolution (`user_version`
  ladder) but Flight 1 never exercised a v1→v2 migration — the first flight
  to add a table walks that path untested.
- **The doc-per-row `documents` shape is the wrong home for high-cardinality
  bookkeeping.** If Flight 2's retention spike needs per-origin last-activity
  metadata, that's a different workload shape: a new `app.db` table (schema
  v2) or a history.db-style row-per-record pattern — do NOT default to the
  document seam (Architect's most concrete forward guidance).
- Facts F2 inherits without re-derivation: all five stores row-backed and
  stable; jars `retentionDays` persists unaffected; quarantine/reseed is a
  live-verified settled property; the widened node:sqlite tax is standing
  (don't re-litigate).

## Recommendations

1. **[Important] Adopt an in-memory/shared-fixture option for store suites**
   whose tests don't assert on real file-family behavior (`:memory:` or one
   shared app-db per file where the require-order reasoning permits — e.g.
   `jar-ipc.test.js`'s per-harness open/close), reserving `mkdtempSync` +
   real files for WAL/quarantine assertions. Target: hold the persistence
   cluster near ~3s own-time as stores/tests grow.
2. **[Important] Flight 2's retention premise-audit must include the storage
   shape decision** (new v2 table vs history.db pattern vs none) alongside
   the mechanism spike — the doc-per-row seam is not the default answer.
3. **[Important] HAT flight scope (accumulating list)**: promote + merge PR
   #96 (and F2's stacked PR); rotate/re-mint automation keys and update the
   session MCP registration (FD transcript leak); operator walkthrough of
   the jars page surfaces once F2 lands.
4. **[Minor] Harden the key-hygiene rule** in methodology practice: never
   print a key-bearing stream even with a redaction regex; extract
   non-secret fields explicitly.
5. **[Minor] When touching behavior specs in this family**, fold in the
   run-learned apparatus notes (openTab-vs-internal-pages; the
   mcp-client.mjs admin mechanism) rather than rediscovering them.

## Action Items

- [ ] HAT flight: promote + merge PR #96; rotate automation keys (transcript
      leak); re-register session MCP entry.
- [ ] Flight 2 design: storage-shape decision inside the retention spike;
      treat F1 facts as premises.
- [ ] Consider the suite-timing recommendation when F2 adds tests to the
      persistence cluster.
- [ ] Mission debrief: re-flag the main.js/renderer.js module-split debt
      (not worsened, not reduced).

## Test Suite Metrics (this debrief's run)

2017 pass / 0 fail / 0 skipped, 13 suites, wall ~1.92s (single run, no
flakes observed). Deltas vs F11 (1973, ~1.36s) and F9 (1948, ~1.22s):
+44 tests reconciling exactly to leg accounting; +41% wall attributed to the
per-test SQLite open cost across the widened persistence cluster (~3.3s
own-time sequential; slowest: automation-mcp-server ~900ms unchanged,
downloads-store ~650ms, jar-ipc ~650ms new to the tail, settings-store
~460ms, jars ~445ms, history-store ~410ms, app-db ~130ms new).
session-restore-wiring flat at ~158ms — the tail shift is additive, not a
regression of existing suites.
