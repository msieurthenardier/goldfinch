# Squawk 0016: Committed leg doc carries the operator's real home path

**Status**: open
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-08-27
**Completed**: —

## Report

`missions/03-automation-surface/flights/05-settings-key-management/legs/01-port-and-address-backend.md:42` contains the operator's actual `/home/<username>/projects/goldfinch` path in a `cd … && npm test` line. This is a public repository; the house rule is never to commit operator identity or absolute home paths. The other 26 path-shaped hits in the tree are already placeholders (`/home/x/`, `/home/user/`). Replace with `~/projects/goldfinch`. Operator ruling 2026-08-27: **no history rewrite** — clean up the file only; the prior revisions stay as they are.

Source: maintenance report 2026-08-27, finding F33.

## Evidence

- `git grep -n -E "/home/[a-z]+/|/Users/[a-z]+/"` — exactly one non-placeholder hit, the line above (verified by the Inspector tool pass and the Architect).

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
