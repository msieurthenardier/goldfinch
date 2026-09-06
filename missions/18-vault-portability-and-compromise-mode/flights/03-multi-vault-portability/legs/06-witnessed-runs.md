# Leg: witnessed-runs

**Status**: completed

## Disposition (operator ruling, 2026-09-06)

Operator chose a **live smoke of the opacity-fixed build** over the
full two-agent witnessed ceremony (MCP re-auth + flaky WSLg). The
smoke PASSED end-to-end:
- **Criterion 4 (opacity) proven on real bytes**: a whole-profile
  export from the committed opacity build byte-scanned clean — no jar
  name (`personal`/`test`/`work`/`Personal`/…), no color hex, no
  plaintext `sourceId`; every entry `{entryHandle, identity(ct),
  vault}`; the embedded `vault.vaultId` == the opaque entryHandle (the
  second leak closed on real bytes).
- **Round-trip through the real UI**: wipe → adopt; the OPAQUE bundle's
  labels DECRYPTED back to real names/colors at the mapping step
  (Personal/green prefilled to the existing container, test/yellow to
  new jar); ONE dismiss-locked recovery sheet, no admin sheet;
  per-vault outcomes named; sever card shown.
- **On-disk end state**: manager v2 with NO admin (criterion 6),
  personal landed under the existing `personal` container (no dup),
  jars personal/work/test.

The full `/behavior-test` witnessed run + the compromise
recovery-branch variant are DEFERRED (apparatus/env); the specs are
`active` and CI/re-run-ready. Two smoke-driven copy/style polish items
(destination label "no vault yet" → "no secrets yet"; export notice
prominence) → HAT fix 12.
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Close the flight with formal witnessed acceptance: run the finalized
`multi-vault-adopt` hybrid-witnessed behavior test against the
opacity-fixed build, run the compromise recovery-branch variant
on-script, and verify the docs tell the new truth.

## Context

- Interactive/behavior leg — no autonomous crew for the runs
  themselves; `/behavior-test` orchestrates its own Executor +
  Validator, with the operator performing the sheet steps.
- The `multi-vault-adopt` spec (`tests/behavior/multi-vault-adopt.md`)
  was finalized 2026-09-05 against the leg-4 HAT surfaces and leg-5
  opacity format. Its step 2 is the criterion-4 opacity gate.
- Criterion 6's acceptance is this test (flight Verification).
- The compromise recovery-branch variant is the Flight-2 debrief's
  on-script item (`tests/behavior/compromise-mode-rotation.md`
  Variants).

## Acceptance Criteria

- [ ] Apparatus probe passes: dev app running (WSLg flags as needed),
      admin MCP re-authorized, internal-page capture confirmed before
      the run.
- [ ] `/behavior-test multi-vault-adopt` runs; all checkpoints PASS
      (or any FAIL/INCONCLUSIVE is triaged — fixed + re-run, or
      recorded as an operator-accepted known issue with rationale).
      Run log committed at the configured location.
- [ ] The opacity gate (spec step 2) passes on a REAL exported bundle
      — no jar name/item plaintext, opaque handles.
- [ ] The compromise recovery-branch variant runs on-script; run log
      committed.
- [ ] Docs verified telling the new truth: `docs/vault.md` portability
      workflow (pick → secret → mapping → outcomes → sever) + the
      threat-model donor-password bullet (donor master alive until
      sever, dead after); opaque-bundle guarantee; CLAUDE.md if
      counts/commands changed.

## Verification Steps

- Pre-run: `enumerateTabs` via the MCP returns (auth OK);
  internal-page capture returns an image.
- `/behavior-test multi-vault-adopt` → run log with per-checkpoint
  verdicts.
- `/behavior-test compromise-mode-rotation` (recovery-branch variant)
  → run log.
- `grep`/read `docs/vault.md` for the workflow + threat-model bullet;
  confirm accurate against shipped behavior.

## Notes

- Fixture + apparatus setup is operator-performed (see the spec's
  Preconditions). The environment is WSLg-flaky (GPU crashes on idle);
  relaunch as needed — not a product signal.
- If the witnessed RUN cannot complete for environmental reasons, the
  spec is `active` and CI/re-run-ready; the operator decides whether
  to land the flight on the HAT's live validation (leg 4) + unit/
  security coverage with the witnessed run deferred, or to hold.

---

## Post-Completion Checklist

- [x] Behavior runs: disposition recorded — live smoke passed
      (criterion 4 opacity on real bytes + UI round-trip + on-disk
      no-admin manager); full two-agent witnessed run DEFERRED, specs
      `active`/CI-ready (operator ruling)
- [x] Run logs: n/a for the deferred witnessed run; smoke evidence in
      the leg Disposition + flight log
- [x] Docs verified (docs/vault.md portability + threat model +
      opaque-bundle guarantee; updated across legs 3-5)
- [x] Flight log updated
- [x] Leg status → `completed`; flight → `landed`
