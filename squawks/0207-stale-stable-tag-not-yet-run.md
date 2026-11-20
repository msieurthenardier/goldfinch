# Squawk 0207: The docs still say a stable tag on `main` has never passed the stable-tag check

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
CLAUDE.md and `docs/RELEASING.md` say the stable-tag check has never run for a stable tag on a `main` commit ("the next real release is its first run"). It has, twice: v0.19.16 and v0.19.17 both logged `answer='identical'` and published. The stale line misled Sortie 10's debrief Architect, which repeated it as fact.

## Evidence
- CLAUDE.md, *Cutting a release*: "**a stable tag on a `main` commit passing that check has not run yet** (the next real release is its first)".
- `docs/RELEASING.md:66-68`: "**Still not exercised:** a stable tag on a `main` commit passing the check; the next real release is its first run."
- Release runs: v0.19.16 `compare main...567a2a5…: attempt 1: rc=0 answer='identical'`; v0.19.17 `compare main...f397351…: attempt 1: rc=0 answer='identical'` (run 44230141659).

## Corrective Action
Replaced the two stale sentences. `CLAUDE.md` *Cutting a release*: "has not run yet (the next real release is its first)" now says the check has since passed for stable tags on squash commits of `main` (v0.19.16, v0.19.17, both `answer='identical'`, published). `docs/RELEASING.md` (compare-check paragraph): "**Still not exercised:** ..." replaced with the same fact; the dated 2026-11-17 acceptance-walk record is kept.

## Verification
Both passages state that the check has passed on v0.19.16 and v0.19.17 (stable tags on squash commits of `main`); no remaining "not exercised" / "has not run yet" claim about it (`grep -n "has not run yet\|next real release is its first" CLAUDE.md docs/RELEASING.md` finds nothing).

Ran: the grep (no hits for either phrase; no other "not exercised"/"not yet run"/"Still not" claim in either file); `timeout 300 npm test` (7455 tests, 7450 pass, 0 fail, 5 skipped); `npm run lint` clean; `npm run typecheck` clean; `npm run format:check` clean. Prettier was run only on the three changed files; the tree-wide `npm run format` was not run because it would rewrite other squawks' uncommitted files.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. CLAUDE.md and `docs/RELEASING.md` both say the check passed for v0.19.16 and v0.19.17 (`answer='identical'`); the dated 2026-11-17 record is kept; no other 'not run yet' / 'still not exercised' claim remains in CLAUDE.md or `docs/`. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
