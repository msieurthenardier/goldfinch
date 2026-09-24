# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Vault Filter](../flight.md)

## Objective

Walk the operator through the shipped vault filter on the live dev app and tune
its look, placement, copy, and feel until the operator is satisfied.

## Context

- Leg 1 landed and the `vault-filter` behavior test passes (10/10).
- Flight DD3: visual DDs pin constraints only, so this leg settles the actual
  appearance.
- DD9's frozen hooks (`#vault-filter`, `#vault-filter-clear`,
  `#vault-filter-status`, `vault-filter-out`) are read by the behavior spec.
  Changing them means re-authoring the spec deliberately.
- Fix-vs-feature gate: look-and-feel fixes go inline. A request that adds
  behavior goes through a scoped design review first.
- Carried items to cover:
  - the screen-reader spot check (DD5 and the review residual: a collapsed
    vault re-showing may re-announce its title or access keys);
  - the Access-keys-hides-with-empty-vault ruling (the operator may revisit it);
  - one refresh-while-filtered walk.

## Inputs

- A dev app running on the flight branch (admin automation on port 49708), with
  the vault unlocked. Test items from the behavior-test run are present.

## Outputs

- Any look-and-feel fixes, committed. Operator sign-off.

## Acceptance Criteria

- [x] **H1 (first look)**: The operator opens the vault page and judges the filter
      field's placement under the "Vaults" heading, its width, label, clear (×)
      control, and count line.
- [x] **H2 (feel)**: The operator types a few queries and clears. Filtering
      feels immediate. Rows, groups, and vaults disappear and reappear without
      jank or layout jumps that bother them.
- [x] **H3 (no-match + access keys)**: The operator reviews the "No items match"
      state. The operator confirms or overturns the ruling that a jar vault with
      no item matches also hides its Access keys.
- [x] **H4 (nav + refresh)**: The operator clicks a hidden vault in the left nav
      while filtering. Then the operator saves an item while filtering and sees
      the filter reset, and finds both acceptable.
- [x] **H5 (screen reader, optional)**: If a screen reader is available, typing
      announces only the count line, and a vault reappearing after a clear doesn't
      re-read its name or access keys noisily. If none is available, record the
      check as waived.
- [x] **H6 (sign-off)**: The operator is satisfied, or every requested change has
      landed and been re-verified.

## Verification Steps

Guided one step at a time by the Flight Director. Each step is confirmed by the
operator in conversation and recorded in the flight log.

## Files Affected

- Likely `src/renderer/pages/vault.css`, possibly copy in
  `src/renderer/pages/vault-filter-controller.js` or `src/shared/vault-page-model.js`.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight:
  - [x] Update flight.md status to `landed`
  - [x] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts)
