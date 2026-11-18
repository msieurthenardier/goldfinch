# Squawk 0212: Three source-mutation pins lack an "the replace changed something" guard

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
Three mutation-style pins `.replace()` source text and then assert, with no check that the replace hit. A Prettier re-wrap or a source change makes them pass vacuously — the failure CLAUDE.md's *Regex-target mutation pins* rule exists to prevent. Found by routine maintenance 2026-11-18 (finding #8).

## Evidence
- `test/unit/keyboard-rearm.test.js` — direction 1: a three-link literal `.replace` chain on `GOOD`, no guard; direction 2: a two-link chain, no guard.
- `test/unit/sheet-arming.test.js` — `SHEET_SRC.replace(…, '')` followed by `doesNotMatch`.
- Correct pattern: `assertMutated` in `test/unit/move-authority.test.js`.

## Corrective Action
*(written at completion)*

## Verification
Each mutation goes through `assertMutated` (or an equivalent `notEqual`), literal targets become wrap-insensitive regexes, and each guard is neuter-verified.
