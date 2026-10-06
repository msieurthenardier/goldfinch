# Squawk 0134: CLAUDE.md unobservable-surfaces list misses three apparatus limits found in sortie 02

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
CLAUDE.md's standing unobservable-surfaces list names only the menu-overlay sheet and the toast layer. Sortie 02 found three more. Add them so future specs don't author impossible steps:
- **Cross-site OOPIF input.** MCP `click`/`pressKey` (`sendInputEvent`) are delivered to the top document and never reach a cross-site out-of-process iframe. No user activation is possible there; `scroll` does reach a same-process or PDF OOPIF.
- **The downloads popup sheet,** named explicitly. It is unobservable via the secret-sheet gate.
- **Wayland popup windows,** whose on-screen appearance and placement can only be checked by eye, because `captureWindow` composites only the browser window.

Add a one-line spec-authoring rule: any step whose action targets one of these is pre-marked `[by-eye]`/HAT or redesigned.

## Evidence
`CLAUDE.md:183` "Standing unobservable-surfaces list"; sortie 02 flight log (Leg 01 AC10 entry); `tests/behavior/web-compat-oauth-popup/runs/2026-10-06-13-24-48.md` step 3; `tests/behavior/download-indicator/runs/2026-10-06-13-24-48.md`.

## Corrective Action
Added three entries (cross-site OOPIF input, downloads popup sheet, Wayland popup/native-window placement) and a one-line spec-authoring rule to the standing unobservable-surfaces list in CLAUDE.md.

## Verification
`npx prettier --write CLAUDE.md` and `npm run format:check` pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
