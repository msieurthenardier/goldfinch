# Squawk 0109: Setting an empty home page on the welcome surface shows "Enter a valid address."

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report

Sibling of squawk 0108 on the welcome surface (chrome-owned viewless tab). Clicking **Set** in the
home-page block with an empty field shows `Enter a valid address.` The empty field already means "no home
page" (the welcome page), so an empty Set should write the unset sentinel and confirm, matching the
Settings page after 0108 — not report a validation error.

Repro: open a new tab with no home page set (welcome surface) → leave the home-page field empty → Set.

## Evidence

- `src/renderer/chrome/welcome-controller.js:submitHome` — `normalizeHomePageInput(homeInput.value)` yields
  `''`, sent via `welcomeSetPreference({ key: 'homePage', value })` → `chrome-welcome-set`.
- `src/main/settings-store.js` validator rejects `''` (unset sentinel is `null`), so the handler returns
  `{ ok: false }` and the else-branch writes `'Enter a valid address.'`.
- Constraint: `#welcome-*` DOM ids are a frozen contract (`search-engines.test.js`) — status text only.

## Corrective Action

`welcome-controller.js` `submitHome`: an empty (post-`normalizeHomePageInput`) value is now sent as `null`
(the store's unset sentinel) instead of `''`. On success, a `homeClearedTab` (the welcome record where the Set happened, not a factory-wide boolean) is set; `render()` derives the
status from state (`Saved — ...` when home is set, `Home page cleared — new tabs will open this welcome page.`
when unset and just cleared, else blank) so `settle()`/`render()` and a late `settings-changed` broadcast can't
blank the message. It is compared by identity in `render()`, reset in `hide()` and when `show()` picks a different record, so later welcome tabs never show it. No DOM id/class changes; store validator, IPC handler and `normalizeHomePageInput` untouched.

## Verification

- New `test/unit/welcome-empty-home-set.test.js` (source-scan pins + neuter checks, incl. per-record scoping/reset).
- `npm test` 5682 pass / 0 fail; `npm run typecheck` and `npm run lint` clean; prettier applied.
- Live app not exercised.

## Sign-Off

**Reviewer**: Reviewer agent (independent, batch review — turnaround 2026-09-29)
**Verdict**: confirmed (after one fix cycle: cleared-message scoped to the welcome record)
**Commit**: squawk: turnaround 2026-09-29 (branch `squawk/turnaround-2026-09-29`)

## Disposition
