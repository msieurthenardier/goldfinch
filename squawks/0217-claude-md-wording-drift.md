# Squawk 0217: Three CLAUDE.md claims no longer match the code literally

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
The docs-vs-code check (routine maintenance 2026-11-18, finding #33; 42 claims checked) found three wording mismatches:
1. *Formatting is Prettier's* calls both line budgets "zero-headroom"; `bookmarks-bar.js` is 1,076 lines against 1,100 (and the test's own "measured 1047" comment is stale). Only `renderer.js` is at budget.
2. *Launch switches*: "`removeSwitch(` appears nowhere else in `src/main/**`" — `main.js` also has the injected-dep wrapper.
3. *Commands*: `npm test` runs "`test/unit/**`"; the script globs `test/unit/*.test.js`.

## Evidence
- `wc -l src/renderer/chrome/bookmarks-bar.js` → 1076; `test/unit/seam-contract.test.js` budget comment.
- `src/main/main.js` — `removeSwitch: (name) => app.commandLine.removeSwitch(name)`; `src/main/launch-switches.js` — the call.
- `package.json` `scripts.test`.

## Corrective Action
*(written at completion)*

- Review fix: `seam-contract.test.js` budget comment reworded so the numbers agree (set at 1100 when the file measured 1047, 53 headroom; 1077 as of this squawk, 23 headroom).

## Verification
Each sentence matches the code; `launch-switches-placement.test.js` still passes; the seam-contract comment states the current count.

## Corrective Action
- `CLAUDE.md` *Commands*: `npm test` now states `test/unit/*.test.js` (top-level only; `package.json` `scripts.test`).
- `CLAUDE.md` *Launch switches*: `removeSwitch(` is called in exactly two files, `launch-switches.js` (`applyLaunchSwitches`) and `main.js` (the dep wrapper); matches the pin in `launch-switches-placement.test.js` ("removeSwitch( appears only in the main.js block…" asserts `['launch-switches.js:1','main.js:1']`).
- `CLAUDE.md` *Formatting is Prettier's*: dropped "zero-headroom" from the pair; `RENDERER_LINE_BUDGET` marked zero headroom (1448 = 1448 by `split(/\r?\n/).length`), `BOOKMARKS_BAR_LINE_BUDGET` noted as 1077 lines, with headroom. Budget values unchanged.
- `test/unit/seam-contract.test.js` comment: "measures 1047" -> "measures 1077 (as of squawk 0217)".

## Verification
Each sentence matches the code; launch-switches-placement and seam-contract pass; comment states current count.
Ran: targeted tests 16 pass / 0 fail; `npm test` 7384 pass / 0 fail; lint clean; typecheck clean; `npm run format` then `format:check` clean. Counts measured with `split(/\r?\n/).length`: renderer.js 1448, bookmarks-bar.js 1077.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the third 2026-11-19 turnaround)
**Verdict**: confirmed. All three sentences match the code (`renderer.js` 1,448 of 1,448; `bookmarks-bar.js` 1,077 of 1,100; `removeSwitch(` in exactly `launch-switches.js` and `main.js`, as the placement test pins; `test/unit/*.test.js`). One review nit — the `BOOKMARKS_BAR_LINE_BUDGET` comment's "measured + 53" no longer added up to 1,100 after the count changed — was fixed in a second Developer pass and re-confirmed. Gates at review: `npm test` 7,390 tests (7,385 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-c`
