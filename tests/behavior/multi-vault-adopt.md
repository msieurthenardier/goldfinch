# Behavior Test: Multi-Vault Adopt — Whole-Profile Restore with Mapping

**Slug**: `multi-vault-adopt`
**Status**: draft
**Created**: 2026-09-02
**Last Run**: never

> Drafted at Flight 3 planning (Mission 18). **Hybrid witnessed**: sheet
> steps are operator-performed and attested; the Executor drives page
> surfaces and reads automation-visible observables only. Finalized
> against shipped surfaces at the flight's `witnessed-runs` leg — exact
> labels/copy below are placeholders until then. This spec IS the
> Flight-1-owed calibration walk (export → wipe → re-adopt), on script.
> Note: under the DD8 blur ruling, credential sheets survive window
> blur — the run-1-era focus-hold protocol is NOT part of this spec.

## Intent

Verifies mission criteria 5 and 6 against the real app: a whole-profile
v2 bundle exported from a populated multi-jar profile is adopted onto a
wiped profile through the single mapping workflow (existing-jar
directive impossible on fresh — new jar, Global, and skip exercised),
the forced recovery rotation surfaces exactly ONE dismiss-locked sheet
(no admin sheet — adopt mints no admin key), the profile lands unlocked
with per-vault outcomes reported, the sever offer card appears
(offered, never forced), and afterward the donor's recovery key opens
nothing while the donor's master password still does — until the sever
is accepted, after which it too is dead. Unit tests pin the store; this
test pins the real IPC/sheet/page composition, the mapping step, and
the on-disk multi-vault end state.

## Preconditions

- Dev app running (`npm run dev:automation`), admin-tier MCP attached.
- Donor profile: global vault + ≥2 jar vaults with items (distinct,
  identifiable item sets per vault); jar names/colors known to the
  operator for label verification.
- Donor recovery key captured (throwaway-provisioned per the
  compromise spec's pattern) to the evidence dir as the "donor
  recovery key"; donor master password held in operator memory only.
- Whole-profile v2 bundle exported and its path recorded; bundle
  byte-scanned for plaintext absence before the run proceeds.
- Profile wipe procedure agreed (userData vaults dir + jar registry),
  with pre-wipe snapshots + second-location hash mirrors.
- Operator present and briefed (natural-language, self-contained cues;
  ack-gates on the reveal).

## Observables Required

- **browser** — mapping modal / completion surface / sever card DOM +
  screenshots of `goldfinch://vault` (admin tier, internal-page
  capture). Sheets NOT observable — presence only via
  `enumerateWindows` `sheetVisible`.
- **filesystem** — `userData/vaults/manager.json`, `*.gfvault`, jar
  registry before/after (manager has NO admin fields post-adopt;
  per-vault files land under destination jar ids) via Bash/Read.
- **operator** — witnessed attestation of sheet contents, single-sheet
  claim, dismiss-locked semantics, decrypted mapping labels.
- **shell** — negative/positive probes via the Electron-free store
  harness: donor recovery key (dead), donor master password (alive
  pre-sever, dead post-sever), absence-of-admin state error.

## Steps

*(Draft — ~9 checkpoints; finalized at the witnessed-runs leg.)*

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | (Setup) Verify preconditions; snapshot donor disk state + bundle hash, mirrored. | (empty) |
| 2 | Wipe profile; relaunch; Executor reads the fresh vault page. | Fresh-profile state: setup CTA + the single restore/import entry present; `isSetUp` false on disk (no manager). |
| 3 | Operator: start the restore workflow, pick the bundle file; enter the bundle secret on the sheet (operator-performed). | Operator attests the secret sheet; Executor's poll shows `sheetVisible` true then false; page returns to the mapping step. |
| 4 | Executor: read the mapping modal DOM. | Decrypted labels visible: one row per bundle vault with source jar name/color and item count — labels match the donor jars (proves decrypt-before-mapping); every row demands an explicit directive; nothing pre-committed to disk (manager still absent). |
| 5 | Operator: direct vault A → NEW jar (accept prefilled name/color), vault B → skip, global → Global; commit. | Mapping accepts; flow proceeds to the forced recovery rotation. |
| 6 | Operator: acknowledge the single dismiss-locked recovery sheet (ack-gate: hold until Executor confirms disk capture). | Operator attests: ONE sheet only — no admin sheet follows. Disk (captured pre-ack): manager written with NO admin fields, at the bundle's managerVersion; new jar exists in the registry; vault A's file under the NEW jar's id; vault B absent; global present. Commit precedes ack. |
| 7 | Executor: read the page post-ack. | Profile unlocked; per-vault outcomes surface shows A landed (destination named), B skipped, global landed; the sever offer card is present and states what it severs. |
| 8 | Executor (shell): probe the adopted profile — donor recovery key; a well-formed dummy admin key; donor master password (operator-witnessed unlock transition, password never disclosed to agents). | Donor recovery key fails (auth); admin probe fails with the no-admin STATE error; donor master password STILL UNLOCKS (sever offered, not forced — the DD4 residual, pre-sever). |
| 9 | Operator: accept the sever offer — the card routes to the existing change-master or recover sheet per the adopt kind (DD7); complete the step-up (donor password or new recovery key) + set a new master password. | Card clears; manager master envelope rewritten (byte-diff), all else untouched; operator-witnessed unlock with the NEW password; donor password now fails (witnessed rejection at the unlock sheet). |

## Out of Scope

- Compromise-mode rotation (covered by `compromise-mode-rotation`).
- Existing-profile transplant and Replace/Merge (store tests + the
  guided HAT leg; a Variant may add it later).
- Interruption safety (fault-injection unit tests).
- v1 single-vault bundles (unit-tested one-row case).

## Variants

- **Sever declined**: adopt completes, card dismissed, donor password
  remains valid across a relaunch — exercised in the guided HAT if not
  run here.
- **Existing-profile transplant** (candidate, post-HAT): map one vault
  into an existing jar with Merge; mergeReport counts verified against
  a constructed collision fixture.
