# Squawk 0019: `jar-data-ipc.js` cookie-shape assumption pinned to Electron 42 was never re-checked after the 43 bump

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

A comment in `jar-data-ipc.js` states the jar-data wipe logic is "contingent on Electron 42's Cookie shape … re-check this assumption on any Electron version bump." Electron 43.2.0 merged on 2026-07-24 (PR #125) and nothing records the re-check. Verify the `Cookie` object shape on Electron 43 (specifically whether a CHIPS/partitioned-cookie field now exists and would need to be included in the wipe) and update the comment either way. If drift is found, escalate — jar isolation depends on it.

Source: maintenance report 2026-08-27, finding F32.

## Evidence

- `src/main/jar-data-ipc.js:324-326` — the self-flagged re-check comment
- `package.json` — `"electron": "^43.2.0"`; `git log --grep 43.2.0` → PR #125, 2026-07-24

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
