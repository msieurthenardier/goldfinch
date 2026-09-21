# Squawk 0097: `setFieldValue` survives as a private copy in `vault-fill-fields.js`

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

Mission 21 Flight 3 Leg 3 (LD1) extracted `vault-card-fields.js`'s private
`setFieldValue` and `setChoiceValue` into a shared `src/preload/field-setters.js`,
consumed by the card and identity families. The **login** family's own private
`setFieldValue` in `vault-fill-fields.js` was deliberately left alone, so the
same four-line setter now exists as one shared definition plus one private copy.

It was left because confirming behavioural identity before merging is its own
small job, and folding it into a fill leg would have widened that leg for no gain.

## Evidence

- `src/preload/vault-fill-fields.js:92` — private `setFieldValue`
- `src/preload/field-setters.js` — the shared definition (from M21 F3 Leg 3)
- Leg 3's design review verified the two bodies byte-identical before the move.

## Corrective Action

*(written at completion)* — Expected: `vault-fill-fields.js` imports
`setFieldValue` from `field-setters.js`; delete the private copy. Login fill tests
must pass unmodified (a pure move).

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Disposition

Deferred to a turnaround — out of M21 F3's path.
