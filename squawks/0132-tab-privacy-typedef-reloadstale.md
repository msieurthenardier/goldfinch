# Squawk 0132: tab-controller.js privacy typedef lacks reloadStale

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
HAT-F1 (sortie 02, `ac56929`) added `reloadStale` to `tab.privacy` (`blankPrivacy()`), but the `privacy` shape in the Tab typedef wasn't updated. Typecheck passes only because `jsconfig` is `strict: false`. Add `reloadStale: boolean` so the type is accurate.

## Evidence
`src/renderer/chrome/tab-controller.js:18` — "privacy: { net: any, fp: …, permissions: any[], cookies: any }".

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
