# Squawk 0204: No guard stops private absolute paths reaching public artifacts

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
The repository is public. Flight logs, audits and leg files across Mission 23 and an earlier sortie recorded absolute scratch-directory paths that embed the operating-system user name; Flight 3 replaced fourteen such lines in seven files with placeholders. Nothing prevents the next one.

## Evidence
- Flight 3 flight log, "Operator rulings at the walk" (the cleanup) and the flight debrief, recommendation 2.

## Corrective Action
Added `test/unit/path-hygiene.test.js`: scans every `git ls-files` file under `missions/`, `sorties/`, `squawks/`, `docs/`, `tests/behavior/` for `/home/<name>/`, `/Users/<name>/` (also matches `/mnt/c/Users/...`), `C:\\Users\\<name>\\` and `/tmp/claude-<digits>/`, reporting file:line, with a files-read floor and pattern self-tests. Replaced the 7 existing hits with placeholders (`/home/<user>/`, `<home>/`) in `missions/03-automation-surface/flights/08-production-gating-and-isolation/legs/01-dev-profile-isolation.md`, `squawks/0016-operator-path-leak-in-leg-doc.md` and `tests/behavior/admin-reach-refusal/runs/2026-11-19-00-25-54.md`. Added one `Paths in artifacts` line to the Developer entry in `.flightops/agent-crews/leg-execution.md` and the Executor entry in `.flightops/agent-crews/behavior-tests-execution.md`.

## Verification
A unit test scans `missions/**`, `sorties/**`, `squawks/**`, `docs/**` and `tests/behavior/**` for `/home/<name>/` and session-temp path patterns and fails on any hit; neuter-verified once. The crew files gain one line: log session paths as `<session-scratch>` / `<repo>`.

Ran: `node --test test/unit/path-hygiene.test.js` first run found 7 hits (fail), after cleanup 3 pass / 0 fail. Neuter-verified: a planted home-directory path line in `docs/RELEASING.md` failed the test with file:line, then was reverted.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eighth 2026-11-19 turnaround)
**Verdict**: confirmed. The scan covers tracked files only, has a read floor and pattern self-tests, and does not flag placeholders or the generic behavior-test evidence path; re-neutered by the Reviewer with a planted home path in `docs/RELEASING.md` (red, file:line reported). Seven existing lines in three artifacts were reworded to placeholders with their meaning kept; the crew files each gained one line. The pattern is deliberately stricter than the squawk's wording: any `/home/<name>/` is a hit, including one-letter placeholder examples. One low note fixed at close-out: squawk 0016's 2026-08-27 grep counts no longer reproduce after its examples were reworded, so a dated note now says so. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-h`
