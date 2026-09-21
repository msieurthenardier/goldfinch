# Squawk 0093: Mission 21's Flight 2 synopsis states a superseded admissibility rule

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

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

Rewrote the Flight 2 bullet in `missions/21-saving-not-just-filling/mission.md`
(the "Flights" list) to state the rule that actually shipped, verified against
`src/preload/vault-identity-fields.js`'s header comments (LD2, "address IS NEVER
BARE-ADMISSIBLE", LD1) and CLAUDE.md's *Identity items — admissibility* bullet:
a scope admits identity fields only when it contains an admissible **postal**
role AND at least one **non-postal** role, both present; `address` never
qualifies bare, at the anchor or as a field; matching is by alternatives
(conjunctive within, disjunctive across), longest match wins. The old
"(a specific token stands alone, a generic one needs a qualifying prefix)"
phrasing — DD1's superseded round-1 rule — is gone.

The mission file has no existing "(amended: …)"-style correction convention
(checked via `grep -rn "amended:"` across `missions/`; the one hit is an
unrelated flight-log AC note), so the stale phrasing was replaced directly
rather than annotated in place, matching how the rest of the Flights list
already reads as a settled synopsis, not a change log.

## Verification

- `npm run format` — no diff produced beyond the two intended edits (mission.md,
  squawk file); ran clean.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` — 5455 passed, 0 failed, 3 todo (pre-existing), 5458 total.
- Manual re-check: the new bullet's claims trace 1:1 to
  `src/preload/vault-identity-fields.js` lines 80–112 (LD2) and 50–62 ("address
  IS NEVER BARE-ADMISSIBLE") and 34–48 (LD1, alternatives/longest-match), and to
  CLAUDE.md's Password vault pattern, "Identity items — admissibility" bullet.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
