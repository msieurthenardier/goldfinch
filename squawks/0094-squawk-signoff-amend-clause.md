# Squawk 0094: Squawks 0090 and 0091 still read "Reviewer: pending" post-merge

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

Squawks 0090 and 0091 were implemented inside Mission 21 Flight 2 Leg 1 and merged
in `016e540`, but their `## Sign-Off` sections still read `**Reviewer**: pending`
and their `**Commit**` lines still read "uncommitted at leg-implementation time".

This was **not** an oversight at write time. Each sign-off carries an explicit
clause that the end-of-flight review "will amend this section if it finds
otherwise" — an *adverse-only* amend. The flight-end review found nothing adverse,
so the amend never fired and the record is permanently pending by construction.

Two halves: (a) back-fill the two records with the actual reviewer verdict and
commit; (b) make the clause unconditional — amend on *any* outcome — so a clean
review does not leave a stale artifact next time.

Found during the Flight 2 debrief (2026-09-20).

## Evidence

`squawks/0090-expiry-fallback-false-positives.md:176-186` and
`squawks/0091-fallback-underscore-prefix-blocks-match.md:129-133` — both read
`**Reviewer**: pending … will amend this section if it finds otherwise`.

The review that should have closed them: PR #226's flight-end Reviewer pass,
merged as `016e540` (2026-09-20), which reported no blocking issues.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*
