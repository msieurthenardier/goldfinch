# Squawk 0108: Saving an empty home page on Settings shows a TypeError instead of "Cleared"

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report

On `goldfinch://settings`, emptying the home-page field and clicking **Save** shows
`Not saved: Error invoking remote method 'internal-settings-set': TypeError: invalid value for "homePage"`.
The end state the user wanted (no home page → new tabs open the welcome page) is what they get, so the
error is wrong/alarming. An empty Save should behave like **Clear** and show the Clear confirmation.

Repro (as reported): with a home page set, Settings → **Clear** (succeeds, home page is unset) → **Save**
on the now-empty field → error. The Clear already did the job; the Save error is spurious. Emptying the
field by hand and clicking Save hits the same path — but there the store is NOT cleared (rejected write).

## Evidence

- `src/renderer/pages/settings.js` Save handler — `settingsSet('homePage', normalizeHomePageInput(input.value))`;
  `normalizeHomePageInput('')` returns `''` (`src/shared/search-engines.js:normalizeHomePageInput`).
- `src/main/settings-store.js` validator — `homePage: (v) => v === null || (typeof v === 'string' && isSafeTabUrl(v) …)`:
  `''` is never valid (unset sentinel is `null`), so `set()` throws.
- The Clear handler in the same file already writes `null` and shows
  `'Cleared — new tabs will open the welcome page until you set one.'`

## Corrective Action

`src/renderer/pages/settings.js` home-page controller: factored the Clear action into `clearHome()` (writes `homePage: null`, sets `input.value = ''`, shows the Clear confirmation). The Clear button now uses it, and the Save handler calls it when `normalizeHomePageInput(input.value) === ''` instead of sending `''` to the store (whose validator only accepts `null` as unset). Store validator, IPC handlers and `normalizeHomePageInput` unchanged.

## Verification

- Added source-scan pin test in `test/unit/settings-page-shared-scripts.test.js` (wrap-insensitive regexes, with mutation check).
- `npx prettier --write`, `timeout 600 npm test`, `npm run typecheck`, `npm run lint` — all pass (5679 pass, 0 fail; typecheck and lint clean).

## Sign-Off

**Reviewer**: Reviewer agent (independent, batch review — turnaround 2026-09-29)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-29 (branch `squawk/turnaround-2026-09-29`)

## Disposition
