# Squawk 0181: The chrome is pushed an unbounded address after a very long in-page navigation

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found during Mission 23 Flight 1's `prompts-and-bounds` leg. A page calling `history.pushState` with a 400,000-character address makes main push the whole string to the chrome, which puts it in the tab's state and the address field. History recording is bounded (8,192 characters) but this push is not. No stall was measured in the behavior test (the three calls returned within 18 ms), so this is a bound for robustness, not a demonstrated problem.

## Evidence
- `src/main/guest-wiring.js` — the `tab-did-navigate-in-page` (and `tab-did-navigate`) sends pass `displayUrl(url)` with no length limit.
- Behavior-test run `tests/behavior/address-and-history-bounds/runs/2026-11-14-06-00-24.md`: address field length 400,021 after the long push.

## Corrective Action
Added `capDisplayUrl` / `addressForChrome` / `ADDRESS_DISPLAY_MAX_CHARS` (8192, the history recorder's `ADDRESS_MAX_CHARS` value; the recorder is unchanged) in `src/shared/display-url.js`. `addressForChrome` is `displayUrl` then a cut to 8,192 units ending in `\u2026`, never splitting a surrogate pair. Applied only to the copy sent to the chrome: `guest-wiring.js` `tab-did-navigate` and `tab-did-navigate-in-page`, `crashForChrome`, and `move-tab-payload.js` `buildAdoptPayload`. Left unbounded on purpose: `failureForChrome` (the load-failure push, both sites). Retry's `restoreRecordedCredentials` (`tab-entry-url.js`) accepts the chrome's address only when `displayUrl(recorded) === requested`, so a cut display copy would make Retry navigate to the cut address for a very long failed address. History, snapshot, closed-tab capture, navigation and reload still use the real address. Open point for the operator: a bounded address in the chrome means Enter on the unedited field, or bookmarking that page, uses the cut address (the squawk's own stop condition); this applies only above 8,192 characters.

## Verification
Cap the display address main pushes (for example at the history cap) in the one helper in `src/shared/display-url.js`, so every push site gets it; the real URL in main is untouched. Unit: a long address is cut for display and `renderer.js` is not edited. If the cap would change what the chrome navigates to on Enter, stop — that is a behaviour question for the operator.

Ran: `node --test` on `display-url.test.js` + `guest-wiring.test.js` 128 pass / 0 fail; `npm test` 7477 pass / 0 fail; `npm run lint`, `npm run typecheck`, `npm run format:check` clean. New tests: `capDisplayUrl` under/at/over the limit, surrogate pair at the cut, 400,000-character input gives length 8192; `addressForChrome` and `crashForChrome` cut while `failureForChrome` does not; a `guest-wiring` test where a 400,000-character in-page navigation pushes an 8,192-character address while the history recorder is handed the real one. Neuter-verified: dropping the cap from `addressForChrome` failed 2 tests; removing the surrogate guard failed 1.
At review: documented the cap, the failure-push exception and the third accepted behaviour in `CLAUDE.md` ("Credentials never reach the address bar" paragraph).


## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eleventh 2026-11-19 turnaround)
**Verdict**: confirmed after one fix round. The medium finding (CLAUDE.md did not document the cap or the accepted Enter/bookmark behaviour) was fixed in the "Credentials never reach the address bar" paragraph and re-reviewed. The load-failure push is deliberately uncut so Retry's exact display-form match holds; the cut never splits a surrogate pair. Neuter: removing the cap fails three tests. Live (dev mode): after `pushState` of a 400,000-character path the address field held 8,192 characters ending in `…`, the page kept its real 400,023-character address, and the tab stayed responsive. Gates at review: `npm test` 7,485 tests (7,480 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-k`
