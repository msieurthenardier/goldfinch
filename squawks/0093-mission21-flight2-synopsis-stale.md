# Squawk 0093: Mission 21's Flight 2 synopsis states a superseded admissibility rule

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

`missions/21-saving-not-just-filling/mission.md`'s Flight 2 entry describes DD1's
**round-1, superseded** admissibility rule rather than the scope-anchor rule that
actually shipped. A reader starting from the mission artifact gets the wrong
plausibility rule for the one family with no structural anchor and no Luhn
analogue — the mission's own stated load-bearing decision.

Found during the Flight 2 debrief (2026-09-20).

## Evidence

`missions/21-saving-not-just-filling/mission.md:320-327` — the Flight 2 bullet
reads "the admissibility boundary (a specific token stands alone, a generic one
needs a qualifying prefix)".

What shipped (correct in `flight.md`, `flight-log.md` and CLAUDE.md's *Identity
items — admissibility* bullet): a scope is an identity context only if it contains
an admissible **postal** role AND at least one **non-postal** role; `address` is
never bare-admissible; matching is alternatives-with-longest-match, not a flat
token set.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*
