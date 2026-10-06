# Squawk 0124: third-party-cookies fixture: give /a/set-fp cookies Path=/

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
`/a/set-fp` sets `a_none`/`a_lax`/`a_strict` with no `Path` attribute, so they default to path `/a` and never apply to `/favicon.ico` or other root paths. This made a sortie 02 favicon observation misleading: it looked as if favicon fetches carried no cookies. Add `Path=/` so first-party assertions at any path are meaningful.

## Evidence
`tests/behavior/fixtures/third-party-cookies/serve.mjs:146` — "`a_none=1; SameSite=None; Secure; ${MAX_AGE}`" (no Path); sortie 02 flight log, DD10(b) correction entry.

## Corrective Action
In `serve.mjs`, added explicit `Path=/` to every `Set-Cookie` header lacking it: `a_none`/`a_lax`/`a_strict` (`/a/set-fp`), `b_fp` (`/b/set-fp`), `b_3p_unpart` (`/b/frame`). `__Host-b_part` already had `Path=/`. Names, SameSite/Secure/Partitioned/Max-Age and the log schema are unchanged. The `js_unpart`/`js_part` `document.cookie` writes in the frame script are not Set-Cookie headers and were left alone (default path `/b`). README notes the Path=/ rule.

## Verification
Fixture started on port 48460; `curl -sk -D -`:
```
/a/set-fp: a_none=1; SameSite=None; Secure; Path=/; Max-Age=3600
           a_lax=1; SameSite=Lax; Path=/; Max-Age=3600
           a_strict=1; SameSite=Strict; Path=/; Max-Age=3600
/b/set-fp: b_fp=1; SameSite=None; Secure; Path=/; Max-Age=3600
/b/frame:  b_3p_unpart=1; SameSite=None; Secure; Path=/; Max-Age=3600
           __Host-b_part=1; Secure; Path=/; SameSite=None; Partitioned; Max-Age=3600
```
Fixture stopped. prettier, format:check, lint run (see handoff).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
