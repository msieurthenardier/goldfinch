# Squawk 0204: No guard stops private absolute paths reaching public artifacts

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
The repository is public. Flight logs, audits and leg files across Mission 23 and an earlier sortie recorded absolute scratch-directory paths that embed the operating-system user name; Flight 3 replaced fourteen such lines in seven files with placeholders. Nothing prevents the next one.

## Evidence
- Flight 3 flight log, "Operator rulings at the walk" (the cleanup) and the flight debrief, recommendation 2.

## Corrective Action
*(written at completion)*

## Verification
A unit test scans `missions/**`, `sorties/**`, `squawks/**`, `docs/**` and `tests/behavior/**` for `/home/<name>/` and session-temp path patterns and fails on any hit; neuter-verified once. The crew files gain one line: log session paths as `<session-scratch>` / `<repo>`.
