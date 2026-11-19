# Squawk 0210: Six deliberate bare chrome sends in `guest-wiring.js` are unpinned and contradict CLAUDE.md

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
CLAUDE.md says there is "no bare `chromeForTab(wcId)?.send` in `guest-wiring.js`", but six exist outside `wireTabViewEvents`. They are deliberately unqueued (keystroke / right-click / page-initiated sends whose replay after a chrome boot would act on stale input), so the code is right and the wording and pin are not. Found by routine maintenance 2026-11-18 (finding #22).

## Evidence
- `src/main/guest-wiring.js` — `handleChromeShortcut` (`chrome-shortcut-action`), `wireGuestContents` (`open-tab`, `open-find`, `open-downloads`, `devtools-state-changed`, `page-context-menu`).
- `test/unit/guest-wiring.test.js` — the zero-bare-send pin scans `wireTabViewEvents` only.
- CLAUDE.md *Chrome recovery* bullet: "no bare `chromeForTab(wcId)?.send` in `guest-wiring.js`".

## Corrective Action
- `test/unit/guest-wiring.test.js`: new whole-file source-scan test (`squawk 0210 source-scan: ...`) using a wrap-insensitive regex over `chromeForTab(...)?.send('<channel>'`; asserts the sorted channel set is exactly the six deliberate ones, and that no bare send lacks a literal channel. The existing `wireTabViewEvents`-only pin is kept.
- `CLAUDE.md` *Chrome recovery* bullet: the "no bare ..." clause now names the six deliberate unqueued sends and why.
- Real set verified in code: exactly six `chromeForTab(...)?.send` sites (`chrome-shortcut-action` in `handleChromeShortcut`; `open-tab`, `open-find`, `open-downloads`, `devtools-state-changed`, `page-context-menu` in `wireGuestContents`). Not pinned (not `chromeForTab(...)?.send` form): the `chrome?.send` local-variable sends in the F6 focus path (`chrome-shortcut-action`) and the popup `open-tab`, same channels.

## Verification
The pin covers the whole file with the six sends listed by channel as deliberate exceptions (a seventh bare send fails it; neuter-verified), and CLAUDE.md names the exception.

Ran: `node --test test/unit/guest-wiring.test.js` 119 pass / 0 fail; neuter: added a seventh bare `chromeForTab(contents.id)?.send('zzz')` to `src/main/guest-wiring.js`, the new test failed (118 pass / 1 fail), reverted (file restored byte-identical). `npm test` 7384 pass / 0 fail; `npm run lint`, `npm run typecheck`, `npm run format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the third 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The whole-file pin lists exactly the six channels in `guest-wiring.js`; the Reviewer's own neuter checks (a seventh literal send, a wrapped literal send, a wrapped send with a non-literal channel) each failed the test and were restored. Gates at review: `npm test` 7,390 tests (7,385 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-c`
