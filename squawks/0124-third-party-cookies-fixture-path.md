# Squawk 0124: third-party-cookies fixture: give /a/set-fp cookies Path=/

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
`/a/set-fp` sets `a_none`/`a_lax`/`a_strict` with no `Path` attribute, so they default to path `/a` and never apply to `/favicon.ico` or other root paths. This made a sortie 02 favicon observation misleading: it looked as if favicon fetches carried no cookies. Add `Path=/` so first-party assertions at any path are meaningful.

## Evidence
`tests/behavior/fixtures/third-party-cookies/serve.mjs:146` — "`a_none=1; SameSite=None; Secure; ${MAX_AGE}`" (no Path); sortie 02 flight log, DD10(b) correction entry.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
