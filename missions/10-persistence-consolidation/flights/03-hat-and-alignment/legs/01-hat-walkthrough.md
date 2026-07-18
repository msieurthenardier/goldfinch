# Leg: hat-walkthrough

**Status**: in-flight
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Operator-guided walkthrough of Stations A-E (see flight.md — the station
checklist is the verification-step list for this leg), with inline fix
riders under the in-HAT protocol, until the operator is aligned.

## Protocol

One station step at a time: the FD presents the step, the operator
performs and reports, failures are diagnosed and fixed inline
(fix-vs-feature gate called out loud; multi-surface fixes get a
lightweight Developer design-review pass before the implementing spawn).
Progress and dispositions recorded in the flight log as they happen.

## Acceptance Criteria

- [ ] Every station item discharged or explicitly dispositioned by the
      operator (recorded in the flight log)
- [ ] Suite/typecheck/lint green on merged main at close
