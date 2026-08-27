# Squawk 0029: `BACKLOG.md` carries three entries superseded by shipped work or tracked issues

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Three BACKLOG.md seeds no longer describe reality: (1) "Electron major bump: 42 → 43" (`:264-283`) still frames the bump as deferred — it merged 2026-07-24 (PR #125); (2) "Internal-page keyboard focus" (`:286-304`) is superseded by GitHub issue #174, which absorbs it and the M08 debrief's H8 item; (3) "Renderer crash / sleep-resume resilience" (`:186-244`) is duplicated by issue #133, which has newer acceptance criteria and file:line cites. Retire (1); reduce (2) and (3) to one-line pointers naming the canonical issue.

Source: maintenance report 2026-08-27, findings F36 and F57.

## Evidence

- `package.json` — `"electron": "^43.2.0"`; `BACKLOG.md:264-283` — "deliberately deferred … next full-category maintenance sweep"
- Issues #174 (filed 2026-08-26) and #133 (2026-07-24) — see maintenance report §Issue Triage

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
