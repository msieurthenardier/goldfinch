# Squawk 0207: The docs still say a stable tag on `main` has never passed the stable-tag check

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
CLAUDE.md and `docs/RELEASING.md` say the stable-tag check has never run for a stable tag on a `main` commit ("the next real release is its first run"). It has, twice: v0.19.16 and v0.19.17 both logged `answer='identical'` and published. The stale line misled Sortie 10's debrief Architect, which repeated it as fact.

## Evidence
- CLAUDE.md, *Cutting a release*: "**a stable tag on a `main` commit passing that check has not run yet** (the next real release is its first)".
- `docs/RELEASING.md:66-68`: "**Still not exercised:** a stable tag on a `main` commit passing the check; the next real release is its first run."
- Release runs: v0.19.16 `compare main...567a2a5…: attempt 1: rc=0 answer='identical'`; v0.19.17 `compare main...f397351…: attempt 1: rc=0 answer='identical'` (run 44230141659).

## Corrective Action
*(written at completion)*

## Verification
Both passages state that the check has passed on v0.19.16 and v0.19.17 (stable tags on squash commits of `main`); no remaining "not exercised" / "has not run yet" claim about it (`grep -n "has not run yet\|next real release is its first" CLAUDE.md docs/RELEASING.md` finds nothing).
