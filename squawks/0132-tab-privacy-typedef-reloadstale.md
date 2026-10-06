# Squawk 0132: tab-controller.js privacy typedef lacks reloadStale

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
HAT-F1 (sortie 02, `ac56929`) added `reloadStale` to `tab.privacy` (`blankPrivacy()`), but the `privacy` shape in the Tab typedef wasn't updated. Typecheck passes only because `jsconfig` is `strict: false`. Add `reloadStale: boolean` so the type is accurate.

## Evidence
`src/renderer/chrome/tab-controller.js:18` — "privacy: { net: any, fp: …, permissions: any[], cookies: any }".

## Corrective Action
Added `reloadStale: boolean` to the `privacy` shape of the Tab typedef in `src/renderer/chrome/tab-controller.js` and in the duplicate typedef in `src/renderer/renderer.js`. Type-only; no behavior change.

## Verification
Grep confirmed no other typedef describes the privacy shape. prettier, format:check, lint, typecheck run clean (see handoff).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
