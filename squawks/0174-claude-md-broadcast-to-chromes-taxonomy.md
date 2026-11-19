# Squawk 0174: CLAUDE.md routing taxonomy doesn't name `broadcastToChromes`

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: 2026-11-19

## Report
Sortie 07 added a chrome-only broadcast helper, `broadcastToChromes` (`src/main/broadcasts.js`
`createBroadcasters`). It sends to every live chrome but not to internal pages or guests, and is
used for `vault-automation-held`. CLAUDE.md's "Main↔chrome routing has three classes" bullet
names only `broadcastToChromeAndInternal` for class (2). A future author classifying a new send
site won't know the chrome-only variant exists, and may reach for the internal-inclusive helper
or hand-roll a `registry.records()` loop.

## Evidence
- `CLAUDE.md` Architecture → Main: "(2) broadcast fan-out (`broadcastToChromeAndInternal`: all
  chromes + internal-session contents, once)".
- `src/main/broadcasts.js` `broadcastToChromes` (unit-tested in `test/unit/broadcasts.test.js`).
- `sorties/07-automation-honors-vault-lock/flight-debrief.md`: Documentation.

## Corrective Action
CLAUDE.md Architecture -> Main routing bullet, class (2): now names both helpers from `src/main/broadcasts.js` and when each applies. Grep of `src/main/**` found one `broadcastToChromes(` call site, `main.js:722` (`vault-automation-held`).

## Verification
CLAUDE.md diff review. The class-(2) text names both helpers and when each applies.
`npm run format:check` passes.

Ran: `npm run format` and `npm run format:check` (results below).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the third 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The class-(2) text names `broadcastToChromeAndInternal` and `broadcastToChromes` and when each applies; `broadcastToChromes` has one call site (`main.js`, `vault-automation-held`), so "today `vault-automation-held` only" holds. Gates at review: `npm test` 7,390 tests (7,385 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-c`
