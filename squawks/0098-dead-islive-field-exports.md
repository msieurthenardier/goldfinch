# Squawk 0098: `isLivePasswordField` / `isLiveCardNumberField` have no production callers

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

Mission 21 Flight 3 Leg 3 (DD9, AC11) changed `fillLoginForm` and `fillCardForm`'s
third parameter from a node target to an integer ordinal. Each of these two
helpers had exactly ONE production caller — inside the fill function whose node
parameter was removed — so both are now exported symbols with no production
consumer. Liveness is structural under the ordinal design: a freshly enumerated
`findAll<Family>Fields(doc)[ordinal]` is live by construction.

Left in place by Leg 3 (AC11c) because removing a still-exported symbol was out of
that leg's scope.

## Evidence

- `src/preload/vault-fill-fields.js` — `isLivePasswordField`, exported
- `src/preload/vault-card-fields.js` — `isLiveCardNumberField`, exported
- Pre-Leg-3 callers: `vault-fill-fields.js:141`, `vault-card-fields.js:498` only.

## Corrective Action

*(written at completion)* — Grep `src/` and `test/` for callers; if none remain
outside their own standalone tests, remove both exports and those tests together.

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Disposition

Deferred to a turnaround — out of M21 F3's path.
