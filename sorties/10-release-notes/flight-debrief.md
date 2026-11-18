# Flight Debrief: Release notes — hand-written notes on every release page

**Date**: 2026-11-18
**Flight**: [Release notes](flight.md)
**Status**: landed
**Duration**: 2026-11-17 (chartered) – 2026-11-18 (landed)
**Legs Completed**: 2 of 2
**Plugin version**: mission-control 1.2.3 (1.2.4 available, not installed)

Inputs: the flight log in full; a Developer interview (Sonnet, read-only, ran the suite); an Architect design review (Sonnet, read-only). The human interview was skipped: the charter answers, every approval and every outward-action authorisation are recorded verbatim in the log.

## Outcome Assessment

### Charter criteria

| Criterion | Result | Note |
| --- | --- | --- |
| A release with a notes file publishes with its title and text; a candidate borrows its target's file; no file or a malformed one falls back without failing | **Met** | Live: `v0.19.18-rc.1` (run 44316344225) published with the candidate title and opening line, no warning. Fallback and malformed paths: executed against a stub `gh` under the runner's shell flags |
| `npm test` fails when the package version has no notes file, or a title does not start with its version | **Met** | Neuter check (file removed → red); the 0.19.18 bump stayed green because the file was written first, as designed |
| v0.19.16 and v0.19.17 carry operator-approved notes | **Met** | Approved word for word; edited with the workflow's own splitter; live bodies equal the files; assets and `latest` unchanged. **v0.19.15 added by operator decision** |
| Proven on a real release candidate before the next stable release | **Met** | `v0.19.18-rc.1`: all six jobs green, prerelease, immutable, five assets |

The walk's verdicts, verbatim: "approved" (v0.19.16), "approved as written" (v0.19.17), "as written" (v0.19.15), "approved" (v0.19.18), "go ahead" (commit, push, tag), "go ahead" (the three edits).

Not proven live: the draft re-edit branch (a re-run of `create-release` while its release is still a draft); the step-summary line, which GitHub's API does not expose (the notes path was inferred from the title and the absence of a warning).

### Value delivered

The page Goldfinch's update notice opens now says what changed and what to do first, from v0.19.15 on. That includes the vault-conversion warning, which v0.19.15 shipped without. Writing the notes is now part of release-prep, enforced by a test, and the workflow's notes logic is the first workflow shell in this repository executed end to end in a unit test under the runner's own flags.

## What Went Well

- **The design was premise-checked where it was doubted.** The contents-API read (raw file and a clean 404) and editable immutable releases were probed before the design was locked. The one decision that mattered most, keeping the splitter as inline workflow shell so the write-token job runs no project code, was made before chartering and never challenged.
- **Three review passes earned their cost.** Six high-severity errors were caught before any code was written; none reached the code review, which confirmed with nothing blocking.
- **The real step is what the tests run.** The step's `run:` block is extracted, dedented and executed as `bash --noprofile --norc -eo pipefail` against a stub `gh` asserted first on `PATH`, which serves only the one expected file path. The neuter "use the validation step's `core`" therefore really fails. Four neuter checks were run, each turning a test red.
- **One source for both paths.** The hand edits of the three published releases used the workflow's own `split_release_notes`, extracted and run locally. The live bodies equal the files.
- **Scoping caught before anything was published.** The Flight 3 draft described three releases' work; the leg mapped each feature's first file to its release (`git log --diff-filter=A`) and the notes were split accordingly.

## What Could Be Improved

### Process

- **The design asserted neighbouring mechanisms from memory** *(important)*. All six high findings were the same kind of error. In each case the design stated how an existing thing behaves without reading or running it:
  - **Read by name, not definition:** the validation step's `core` (it keeps `-rc.1`; its definition was one line away, `build.yml:68`).
  - **Git:** `git commit -a` (it skips a new file).
  - **A proxy where the real rule existed:** "tag differs from `v${base}`" (wrong for `+build`; the correct rule was already in the validation step).
  - **The runner:** `shell: bash` runs with `-eo pipefail`.
  - **The `gh` tool:** `gh release view <tag>` may not see drafts.
  - **A rule never run against the document's own examples:** the `~/` path rule rejected the macOS data folder.

  Each was caught by a reviewer who ran a probe. The premises the Flight Director doubted were probed; the ones it didn't doubt were not. A 10-line bash probe of the design's own snippets against the four tag shapes would have caught three of the six at authoring time.
- **The charter named two releases without asking which releases the content spanned** *(minor)*. Found at leg design; v0.19.15 joined by operator decision.
- **The second leg-design review was skipped** because every change was the reviewer's own prescription. It held this time, but at planning the second pass found a new high in the first fix, so that reasoning is weaker for changes to decision logic than for mechanical edits.

### Technical

- **The workflow shell is now substantial**: +139 lines in `create-release`, including a 35-line byte-level parser with 14 reason words, GNU-sed dependent. Its executing tests run on Linux only (skipped elsewhere with a stated reason).
- **The test file grew by about 400 lines**, most of it text pins. A Prettier-style reformat of `build.yml` can trip pins unhelpfully, as Flight 3's debrief already noted.
- **The `jq` expression test is skipped where `jq` is absent** (this host). The Flight Director probed the same expression read-only through `gh`'s built-in jq and the candidate run confirmed `none` on the runner, so only `draft` stays unproven live.
- **A second path-hygiene list**: the narrow `docs/releases/` check duplicates the intent of open squawk 0204, which should absorb it.
- **A 200-release window** on the state read. A tag older than the window reads `none`, so the create fails loudly; it never edits.
- **Every `\r` is stripped** from a notes body, as documented.

### Documentation

`docs/releases/README.md`, `docs/RELEASING.md` and CLAUDE.md describe the new step. Found stale during the debrief: CLAUDE.md (*Cutting a release*, "a stable tag on a `main` commit passing that check has not run yet") and `docs/RELEASING.md:68` ("the next real release is its first run"). v0.19.16 and v0.19.17 both passed that check (`answer='identical'`). The Architect's own report repeated the stale claim, which shows the cost.

## Test metrics

`npm test`: **7,323 tests — 7,319 pass, 0 fail, 0 skipped, 4 todo** (the same four known-unsolved capture cases); no flake. Runner 8.96 s, wall 9.28 s. Against Sortie 09 (7,305 tests, runner 9.2 s, wall 9.6 s): **+18 tests, flat** (within host variance). Against Mission 23 Flight 3 (7,254, wall 10.0 s): +69 tests, wall −0.7 s.

The two touched files run 33 tests in about 1.6 s. `release-workflow-invariants.test.js` alone takes 1.3–1.7 s over three runs; the cost is process spawning, since each executing scenario runs bash with many `sed`/`tr`/`grep` children. It is the suite's second bash-spawning file after Flight 3's `stable-tag-check.test.js` (~0.9 s). Not a regression, but more scenarios should share one temp harness rather than each spawning afresh.

## Deviations and Lessons Learned

| Deviation | Why | Lesson |
| --- | --- | --- |
| Splitter is inline shell, not a node script | `create-release` holds the write token and must run no project code | Ask which permissions a job holds before choosing what runs in it |
| `base` separate from `core`; candidate decided by the validation step's rule | `core` keeps the prerelease suffix; `+build` is stable | Read a variable's definition, not its name; reuse the existing rule rather than a proxy |
| Every notes command guarded; tests run with `-eo pipefail` | `shell: bash` runs that way on GitHub | Test workflow shell under the runner's exact flags |
| Release state from `gh release list` | `gh release view <tag>` may not resolve drafts | Prefer a read whose behaviour on every state is known |
| `git add` of the notes file in the cut sequence | `git commit -a` skips untracked files | Walk the documented command sequence against a new file |
| v0.19.15 notes added | Its release carried the vault conversion; the source draft spanned three releases | Map content to releases before chartering a backfill |
| New summary wordings and reason words | Branches the leg did not name | A closed set pinned by tests should be listed exhaustively in the leg |

## Key Learnings

1. **Probe the premises you don't doubt.** Before locking a design that cites how existing code, a runner, a tool or a VCS behaves, run a minimal probe of each claim. For workflow shell, run every snippet over the full input matrix: here, the tag shapes `X.Y.Z`, `-rc.N`, `-alpha-N`, `+build` and `-rc.N+build`.
2. **Executing workflow shell in tests is the standard.** Extract the named step or function, assert exactly one definition, run it under the runner's flags against a stub CLI asserted first on `PATH`, and serve only the expected inputs so that neuters fail.
3. **One source feeds the automated path and the manual remedy.**

## Methodology Observations

Recorded against mission-control **1.2.3**.

1. **sortie — the vehicle fit.** One outcome, one decision cluster, one leg plus a walk; the charter was never reinterpreted. Its one gap was scoping: the backfill's release list was set before the content was mapped to releases. The operator widened it at the walk, an outward-facing change approved word for word, not scope creep.
2. **flight / sortie design — premise audits cover only doubted premises.** The flight skill asks for "a DD that rests on an empirical premise" to be verified. The Flight Director verified the two it saw as empirical. The six it treated as known facts (a variable's meaning, `git commit -a`, runner shell flags, `gh` draft lookup, a tag-shape rule, a path rule) were each wrong, and each cost a review-and-fix cycle (two Architect passes and one leg-design pass, all with highs). The second Architect pass caught its error by running a 10-line probe; the probe belongs at authoring time. A prompt to probe *every* claim about existing behaviour, not only the ones flagged empirical, would have saved at least one cycle.
3. **agentic-workflow — skipping the second leg-design pass.** The skill allows skipping it when changes are minor. The Flight Director skipped it for prescriptive but non-mechanical changes. No harm here, but at planning a prescribed fix carried a new high (the `+build` proxy). Recorded for the sweep: whether "the reviewer's own prescription" is a sound reason to skip.
4. **agentic-workflow — HAT legs with outward-facing actions.** The walk's steps were public writes (a tag that is spent once pushed, edits to published release pages). The one-step-at-a-time protocol and per-action authorisation worked; the skill's HAT guidance assumes local verification and says nothing about irreversible outward steps.

## Recommendations

1. **Add a project planning rule** *(important)*: "Every design claim about how existing code, the CI runner, `git` or a CLI behaves is probed before the design is locked, not only the claims flagged as empirical; workflow shell is probed over the full input matrix." Candidate for CLAUDE.md's *Project-specific planning rules*.
2. **Fix the stale stable-tag sentence** in CLAUDE.md and `docs/RELEASING.md`: the check has run, and passed, on v0.19.16 and v0.19.17 *(squawk 0207)*.
3. **At the stable v0.19.18 tag**, read the `create-release` log (no `##[warning]`) and the release title. It is the first stable release to use a notes file.
4. **Prove the draft re-edit branch** the next time a release run fails after `create-release`, or deliberately on a throwaway candidate, before relying on it.
5. **Test hygiene** *(minor)*: make the `jq` skip reason visible; add a drift guard that the splitter's reason words in `build.yml` equal the set the tests know; have squawk 0204's shared scan absorb the `docs/releases/` patterns.

## Action Items

- [x] Stale "stable tag on `main` has not run yet" in CLAUDE.md and `docs/RELEASING.md` — squawk 0207.
- [x] Reason-word drift guard between `build.yml`'s splitter and `release-workflow-invariants.test.js` — squawk 0208.
- [x] The `jq` expression test passes vacuously when `jq` is absent (it returns early rather than skipping) — squawk 0209.
- [ ] Planning rule (Recommendation 1) — for the operator to adopt into CLAUDE.md.
- [ ] Watch the stable v0.19.18 run (Recommendation 3) — Flight Director, at the tag.

Maintenance check: a mission has completed since the last maintenance report (2026-08-27), so no routine-maintenance recommendation is due from this sortie.
