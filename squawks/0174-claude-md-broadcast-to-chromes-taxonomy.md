# Squawk 0174: CLAUDE.md routing taxonomy doesn't name `broadcastToChromes`

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: —

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
*(written at completion)*

## Verification
CLAUDE.md diff review. The class-(2) text names both helpers and when each applies.
`npm run format:check` passes.

## Sign-Off
*(written at completion)*
