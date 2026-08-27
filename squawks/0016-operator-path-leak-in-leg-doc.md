# Squawk 0016: Committed leg doc carries the operator's real home path

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

`missions/03-automation-surface/flights/05-settings-key-management/legs/01-port-and-address-backend.md:42` contains the operator's actual `/home/<username>/projects/goldfinch` path in a `cd … && npm test` line. This is a public repository; the house rule is never to commit operator identity or absolute home paths. The other 26 path-shaped hits in the tree are already placeholders (`/home/x/`, `/home/user/`). Replace with `~/projects/goldfinch`. Operator ruling 2026-08-27: **no history rewrite** — clean up the file only; the prior revisions stay as they are.

Source: maintenance report 2026-08-27, finding F33.

## Evidence

- `git grep -n -E "/home/[a-z]+/|/Users/[a-z]+/"` — exactly one non-placeholder hit, the line above (verified by the Inspector tool pass and the Architect).

## Corrective Action

`missions/03-automation-surface/flights/05-settings-key-management/legs/01-port-and-address-backend.md:42` — replaced `` `cd /home/<user>/projects/goldfinch && npm test` `` with `` `cd ~/projects/goldfinch && npm test` ``. No other change made to the line or file.

## Verification

- `git grep -n -E "/home/[a-z]+/|/Users/[a-z]+/"` — 28 hits (28 once this artifact's own placeholder prose is counted — Reviewer correction), all placeholders (`/home/x/`, `/home/user/`) or descriptive text in this squawk itself; the leg-doc line no longer appears.
- `grep -rn "<user>" --exclude-dir=node_modules --exclude-dir=.git .` — 0 hits across tracked content.
- `git diff --stat` — 2 files changed (the leg doc, this squawk artifact), 2 insertions(+), 2 deletions(-).

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developer's reasoning) — one review round, clean on the first pass; one non-blocking correction (grep hit count 27 → 28) applied at close-out
**Verdict**: confirmed
**Commit**: `squawk/0016: scrub operator home path from Mission 3 leg doc` on `squawk/0016-operator-path-leak-in-leg-doc` (PR number recorded on the PR itself)

Reviewer verified: the diff is exactly two files; the leg-doc change is the single substitution on line 42 to `~/projects/goldfinch` (CLAUDE.md's prescribed placeholder form); every remaining `/home/<name>/` hit in the tree is a placeholder; the squawk artifact re-leaks nothing; header and section order match the ARTIFACTS.md squawk format.
