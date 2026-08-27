# Flight Debrief: Prettier Adoption

**Date**: 2026-08-27
**Flight**: [Prettier Adoption](flight.md)
**Status**: landed
**Duration**: 2026-08-27 — 2026-08-27 (planned, reviewed, flown, and debriefed in one day; escalated from squawk 0039 the same morning)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The whole tree is Prettier-formatted under the existing `.prettierrc` (319 files, PR #182 `339e808`), `prettier --check .` is a CI gate in both the Concourse lint task and a new GitHub Actions "Format check" step (PR #184 `e108969`), the `renderer.js` line budget is re-based 1650 → 1827 by the pin's own metric with zero headroom as before, the twelve source-text pins the reformat broke were re-targeted without weakening — every one neuter-verified, four independently by the Reviewer — and `.git-blame-ignore-revs` records the reformat with its real squash sha (verified: `renderer.js:19` blames to its 2026-07-29 origin). Squawk 0039 is closed out; the operator's "enforce" ruling is met.

### Mission Criteria Advanced

Mission 17 criterion 7 (Prettier enforced; budgets re-based and still guarding growth) — met. Criterion 8 (all gates green throughout) — held: 3839/3839, lint, typecheck, `prettier --check` at both landings.

## What Went Well

- **The revert-safe measurement spike settled the design question before any code was committed.** Option (a) "tune `.prettierrc` toward house style" — the operator's first pick — was disproven with numbers in twenty minutes (`printWidth` 100–160 and five other options, all leaving `renderer.js` at 1774–1871 lines), so the flight was designed around the truth rather than discovering it in Leg 1. Two Architect review cycles then corrected the spike's own measurement errors (metric, base commit) before they could cost a leg.
- **DD4's two-PR shape earned its cost.** Leg 2 wrote the *real* squash sha into `.git-blame-ignore-revs`; no placeholder, no follow-up squawk. The mid-flight re-base of the flight branch was mechanical.
- **DD3's rule — "re-target the matcher, never the assertion, and neuter-verify every one" — is what made a 17k-insertion diff reviewable.** The per-pin table (twelve rows: title · shape · change · neuter result) let the Reviewer sample four across the shapes and confirm the rest by reading. The regex-target + captured-indent replacer idiom that emerged (`move-authority.test.js`, `tab-drag-invariants.test.js` `CALL_SITE_RE`) is readable, commented on *why*, and still guarded by `assertMutated`.
- **The Developer stopped at the right boundary.** When `typecheck` broke on two displaced typing comments, the Leg 1 Developer did not quietly hand-edit source (AC5 forbade it); it landed AC1–AC5, left AC6 unchecked, and wrote a root-cause Deviation with three disposition options. The Flight Director ruled in one note; the operator confirmed at this debrief that rulings of that kind are welcome ("keep ruling on things like that").
- **Gates stayed flat.** 3839/3839 at base, after Leg 1, after Leg 2, and at this debrief; wall-clock 3064 ms (13 suites), 0 skip/todo/flake.

## What Could Be Improved

### Process

- **The spike's gate list was incomplete — it ran `prettier --check` and `npm test` but not `npm run typecheck`.** In a `// @ts-check` JavaScript codebase, `/** @type {any} */` casts and `// @ts-ignore` are checker-meaningful comments that Prettier's parser treats as prose; their displacement was predictable *in kind* even if not in which two sites. Both surprises this flight had came from that one omission. *(Critical — would have made the AC6 block a planned exception instead of a mid-leg stop.)*
- **Two planning-time numbers were stale at handoff.** The baseline test count (3792) was measured on the batch-3 turnaround branch before PRs #177–#179 merged 47 tests; DD2's 1829 was measured at `f142f90`, two merges before the flight's base. Both were caught by the Developer re-measuring, but a leg should never inherit a baseline the flight plan didn't re-verify at its actual base commit. *(Important.)*
- **The maintenance sweep offered option (a) without a tunability check.** F41 and the squawk-0039 escalation framed "tune `.prettierrc` toward house style" as a coequal option to "accept and re-base"; a ten-minute trial at one `printWidth` — exactly what this flight's spike did, just earlier — would have shown Prettier has no knob for one-line function bodies and spared the escalation round-trip and one operator decision that had to be re-asked. *(Important; methodology.)*
- **DD3 predicted the wrong shape for three pins.** All three `tab-drag-invariants` pins were called shape 2 (absence-window re-anchor); they needed shapes 1 and 3. The fixes were right and the mis-prediction cost nothing, but the Recon Report should classify per pin, not per file. *(Minor.)*

### Technical

- **The reformat's one real readability cost is `renderer.js`'s delegator block**: ~20 one-line delegators are now three lines each, so scanning that block takes three times the scroll for the same information. Accepted by DD1 and confirmed by the operator at this debrief ("accept the output as-is"). If it ever grates, the fix is an extraction (a `delegates.js` seam module), never a compaction — the CLAUDE.md bullet says so.
- **Latent typing-comment fragility remains.** `grep -c '/** @type {any} */' src/` → 151 occurrences; 49 already use the safe cast-to-local binding, **102 are inline**. Most are single-argument casts that cannot straddle a reflow boundary, but at least one is the exact `vault.js` shape: `src/renderer/pages/jars.js` has a `// @ts-ignore` above a multi-line import (7 symbols) rather than immediately before its `} from` line — it typechecks today only because that specifier resolves. The Deviation's option (c) (audit the idiom tree-wide) was never executed.
- **No test pins the CI gate.** `format:check` in `package.json` and its two CI invocations are config, verified once by hand; a future edit could drop the gate silently. A source-pin in the house style is cheap.
- **Non-deterministic first `prettier --write` pass.** The first `npm run format` left five files still flagged by `--check`; a second pass on those five was clean (Prettier 3.9.6 / Node 22). Harmless for CI (`--check` only reads) but worth knowing: run `format` twice before trusting `--check` locally after a big change.

### Documentation

- CLAUDE.md now carries the scripts, the blame-ignore config line, and a Patterns bullet on formatting and budgets (Leg 2). Two idioms this flight established are **not yet written down**: the regex-target + captured-indent replacer for source-text mutation pins, and cast-to-local before a multi-line boolean chain. Both will recur.

## Test Metrics

| Point | Tests | Wall-clock | Notes |
|---|---|---|---|
| Maintenance sweep 2026-08-27 (base `f142f90`) | 3792 | 3327–3381 ms | `bookmarks-bar.test.js` 2095 ms |
| After turnaround PRs #177–#179 (`c6cacc4`) | 3839 | — | +47 tests; `bookmarks-bar.test.js` ~105 ms after squawk 0024 |
| Leg 1 landed (`339e808`) | 3839 | — | 0 fail/skip/todo |
| This debrief (`e108969`) | 3839 | **3064 ms** (13 suites) | 0 fail/skip/todo, no flake; ≈0.80 ms/test vs 0.87 at the sweep |

Top-10 slowest files (per-process, incl. ~130 ms startup): `vault-page-model` 1376 ms, `vault-context` 1333 (flat vs 1341), `automation-mcp-server` 979, `vault-crypto` 940 (real scrypt), `settings-store` 772 (down from ~868), `vault-store` 675, `navigation-controller` 645 (flat), `downloads-store` 611, `jars` 484, `vault-capture` 476. **The reformat was timing-neutral**, as DD1 claimed; the M16 "+18 %" watch item (already disproven at the sweep) shows no drift.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Two hand edits to source under AC5 "Prettier output only" (`app-db.js` cast bound to a local; `vault.js` `@ts-ignore` moved before `} from`) | Prettier displaced checker-meaningful comments; `typecheck` failed; FD ruled "no hand-*formatting*" is AC5's intent | Yes — as a leg-design rule: a mechanical-transform leg must name `typecheck` in its gates and pre-authorize "typing-comment repositions" as correctness edits |
| Baseline 3792 → 3839; DD2 1829 → 1827 | Planning numbers measured on the wrong commits | Yes — re-measure every numeric baseline at the leg's actual base commit before marking it `ready` |
| Per-leg PR + merge instead of the flight-end single commit | DD4: the blame-ignore sha must be real | Situational — the right shape whenever a later leg must reference an earlier leg's merged sha |
| Reformat touched 319 files, not 318 | `eslint.config.mjs` uncounted in the log | No — reporting only |
| `tab-drag-invariants` pins fixed as shapes 1/3, not the predicted shape 2 | Recon classified per file | Yes — classify pins individually in the Recon Report |
| Concourse task run deferred to the operator | Local Concourse at `127.0.0.1:8080` timed out | No — environment; the first Concourse run of `lint.yml` on `main` closes it |

## Key Learnings

1. **A formatter is a semantic change in a checked-JS codebase.** Comments that carry type meaning (`@type` casts, `@ts-ignore`) move with the formatter's idea of comment attachment, not the checker's. Any whole-tree mechanical transform must gate on `typecheck`, not just tests, and should expect this class of breakage.
2. **Measure before offering options.** "Tune the config" was offered twice (sweep, escalation) without a trial; one trial disposed of it. A design option that rests on a tool's tunability is an empirical premise — verify it at the point the option is written, not at flight design.
3. **Pin re-targeting is safe only with a neuter check per pin.** Twelve regex conversions, twelve red-then-green records, four re-run independently — that discipline is the entire reason a 17k-insertion diff could be trusted. The regex+captured-indent replacer and bounded non-greedy lookahead (`sheet-automation-gate-invariant`) are the house shapes now.
4. **Numbers in a flight plan have a base commit.** Every measured figure (test count, line count) should carry the sha it was measured at, and the leg re-measures at its own base.
5. **The Flight Director's ruling boundary held.** The Developer's stop-and-report on AC6 plus a one-note FD ruling was faster and cleaner than either an aborted leg or a quiet edit — and the operator ratified the pattern.

## Recommendations

1. **Audit typing-comment placement tree-wide** (the Deviation's option (c)): fix `jars.js`'s `@ts-ignore` now; then bind the inline `/** @type {any} */` casts that sit inside multi-line boolean/argument constructs to locals. Squawk-sized as two items.
2. **Pin the CI gate** with a source-scan test: `package.json` has `format:check`, and both `ci/tasks/lint.yml` and `.github/workflows/ci.yml` invoke it. Squawk-sized.
3. **Document the two idioms** in CLAUDE.md's structural-test / typing conventions: regex-target mutation pins with captured-indent replacers; cast-to-local before chains. Squawk-sized.
4. **Operator**: run the Concourse lint task once on `main` (or push anything) to exercise the new step; watch Dependabot PR #183 — it is the gate's first real customer and will show whether Dependabot's `package.json` rewrite is Prettier-shaped.
5. **Methodology (mission-control)**: see below.

## Methodology Feedback

For mission-control, from one flight of evidence:

1. `/flight` Phase 1b Reconnaissance and `/agentic-workflow` 2a risk checks: **a whole-tree mechanical transform (formatter, codemod, rename) must list every project gate — including the type checker — in its spike and its leg gates**; tests + the transform's own check are not sufficient evidence of "nothing broke". Name "checker-meaningful comments displaced by the transform" as a known hazard class.
2. `/routine-maintenance` Architect assessment and `/squawk` escalation: **an option that rests on a tool being tunable is an empirical premise — run the cheapest possible trial before presenting it as a choice** (this flight's spike took twenty minutes and would have removed one escalation round-trip and one operator decision).
3. `/flight` and `/agentic-workflow` leg design: **every numeric baseline in a plan carries the commit it was measured at, and the leg re-measures at its own base before `ready`.**
4. `/agentic-workflow` 2b: codify the pattern this flight used — a Developer that hits a leg-AC conflict lands what it can, leaves the conflicting AC unchecked, writes a root-cause Deviation with options, and stops; the Flight Director rules in the log. Faster than an abort, safer than a quiet edit, and operator-ratified here.

## Action Items

- [ ] Squawk **0040**: `src/renderer/pages/jars.js` — move the `@ts-ignore` to the line before `} from` (same shape as the `vault.js` fix) *(recommendation 1a)*
- [ ] Squawk **0041**: audit the 102 inline `/** @type {any} */` casts and the ~25 `@ts-ignore`/`@ts-expect-error` sites; bind those inside multi-line constructs to locals *(recommendation 1b)*
- [ ] Squawk **0042**: source-pin test for the CI format gate (`format:check` in `package.json` + both CI definitions) *(recommendation 2)*
- [ ] Squawk **0043**: CLAUDE.md — document the regex-target mutation-pin idiom and the cast-to-local idiom *(recommendation 3)*
- [ ] Operator: exercise the Concourse lint task on `main`; watch Dependabot PR #183 through the new gate *(recommendation 4)*
- [ ] Mission-control: methodology items 1–4 above → skill edits, reviewed with the operator
- [x] Flight 5 → `completed` (this debrief, 2026-08-27)
