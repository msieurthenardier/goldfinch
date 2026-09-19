# Leg: hat-and-alignment

**Status**: in-flight
**Flight**: [The Save Moment](../flight.md)

## Objective

Close Flight 1's outstanding live acceptance: watch the broadened trigger raise a
real save offer on a real page, confirm a gesture leading nowhere raises none, and
run DD6's extractor cross-check — none of which could run headlessly.

## Context

Leg 5 landed with live verification unmet: the dev sandbox's compositor is broken
(synthetic input and screenshots fail with GPU/DRM errors while `evaluate` works).
That is a rig limitation, not an app defect — synthetic input drives the operator's
installed build fine. The operator performs these steps by hand.

**The dev launch is profile-isolated**, so it starts with no vault. Setting one up
is part of the walk, not a detour.

## Acceptance Criteria

- [ ] A password typed into a form whose submit control sits **outside every form**
      raises a save offer. *(The motivating shape. Nothing else matters as much.)*
- [ ] An ordinary login form still raises a save offer — no regression from the
      removed `submit` listener.
- [ ] A trusted click that leads nowhere (a non-submitting button) raises **no**
      offer.
- [ ] A card entered on a real submit-less checkout raises a card save offer.
- [ ] Filling from the vault and re-submitting unchanged raises no spurious offer
      (the unchanged-credential path still drops).
- [ ] DD6's extractor cross-check: a committed fixture's detection in the real
      browser matches the headless extractor.
- [ ] One state the operator is not looking at — a second window or a background
      tab — behaves correctly.

## Out of Scope

- Anything requiring a code change beyond an inline fix. A request that adds NEW
  behaviour is a feature, goes to a scoped design review, and does not ride the
  inline-fix path.

---

## Post-Completion Checklist

- [ ] All steps walked with the operator
- [ ] Findings and any inline fixes recorded in flight-log.md
- [ ] Leg status `completed`; Leg 5's live-acceptance criteria updated
- [ ] Flight 1 checkbox checked in flight.md; PR marked ready if the operator agrees
