# Leg: Restore Mapping Feel Pass

**Status**: completed
**Flight**: [Alignment — Vault Flows Prototyping](../flight.md)
**Type**: interactive (alignment) — no autonomous implementation cycle

## Objective

Prototype the multi-vault restore mapping step in the vault page's modal
idiom (per the mission ruling: mapping lives on the page) with stubbed
bundle data, so the operator can feel the workflow. **No binding rulings**
(DD3): output is non-binding observations feeding Flight 3 design. Then run
flight teardown.

## Acceptance Criteria

- [ ] AC1: A stubbed mapping step is clickable: a fake multi-vault bundle
      (global + several jar vaults with fake names) presented as rows, each
      offering destination existing-jar select / create-new-jar (inline
      name+color) / skip; a collision indicator on at least one row; a
      Restore commit leading to a stubbed per-vault outcome summary
- [ ] AC2: The sheet moment (bundle secret) is represented in sequence
      (stub notice or real import sheet skipped past) so the
      decrypt-before-mapping inversion is felt, not elided
- [ ] AC3: Operator observations recorded in the flight log (non-binding)
- [ ] AC4: Teardown complete (CP4): `scratch/m18-alignment` deleted,
      `goldfinch-dev` profile wiped, mission open questions updated with
      the flight's rulings

## Verification

Flight log carries the observations; branch and dev-profile state verified
gone; mission artifact reflects rulings R1–R9.
