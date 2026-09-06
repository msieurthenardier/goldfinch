# Behavior Test: Multi-Vault Adopt — Whole-Profile Restore with Mapping

**Slug**: `multi-vault-adopt`
**Status**: active
**Created**: 2026-09-02
**Last Run**: never

> **Hybrid witnessed** (Flight 3, Mission 18). Sheet steps are
> operator-performed and attested; the Executor drives page surfaces
> and reads automation-visible observables only. Finalized 2026-09-05
> against the shipped surfaces from the Flight-3 guided HAT (leg 4) and
> the bundle-identity-opacity leg (leg 5). This spec IS the
> Flight-1-owed calibration walk (export → wipe → re-adopt), on script.
> Under the DD8 blur ruling, credential sheets survive window blur —
> the old focus-hold / memorize-then-relay protocol is NOT part of this
> spec.

## Intent

Verifies mission criteria 4, 5, and 6 against the real app: a
whole-profile v2 bundle exported from a populated multi-jar profile is
**opaque** (no jar name legible before the secret — criterion 4), and
is adopted onto a wiped profile through the single mapping workflow
(existing-jar, new-jar, and Global directives all exercised — criteria
5/7), where the forced recovery rotation surfaces exactly ONE
dismiss-locked sheet (no admin sheet — adopt mints no admin, criterion
6), the profile lands unlocked with per-vault outcomes reported, and
the sever offer card appears (offered, never forced — criterion 8) and,
when accepted, actually severs the donor's master access. Unit tests
pin the store; this test pins the real IPC/sheet/page composition, the
opacity of the on-disk bundle, the mapping step, and the multi-vault
end state.

## Preconditions

- Dev app running (`npm run dev:automation`; under WSLg add
  `-- --disable-gpu --ozone-platform=x11` per the flight log's
  environment anomaly). Admin-tier MCP attached and RE-AUTHORIZED
  (tokens expire — confirm `enumerateTabs` works before the run).
- **Donor profile**: global vault + ≥2 jar vaults **with items**
  (distinct, identifiable item sets per vault); jar names/colors known
  to the operator for label verification. A jar has no vault file until
  an item is saved into it.
- **Seeded-jar awareness**: a wiped vault profile is NOT an empty jar
  registry — goldfinch re-seeds default browsing containers (Personal,
  Work) on boot. The adopt therefore maps onto a profile that already
  has those containers; this is the realistic fresh-adopt state and is
  deliberately exercised (existing-container directive).
- Donor recovery key captured (throwaway-provisioned) to the evidence
  dir as the "donor recovery key"; donor master password held in
  operator memory only.
- **Whole-profile v2 bundle exported from the CURRENT (opacity-fixed)
  build** and its path recorded.
- Profile wipe procedure agreed (userData `vaults/` dir + the
  `store='jars'` row in `app.db`), with pre-wipe snapshots + hash
  mirrors. Wipe with the app STOPPED (`pkill -9`, verify no process,
  verify the jars row stays 0) — a live/zombie app re-seeds after a
  SQL delete.

## Observables Required

- **browser** — mapping modal / completion surface / sever card DOM +
  screenshots of `goldfinch://vault` (admin tier, internal-page
  capture). Sheets NOT observable — presence only via
  `enumerateWindows` `sheetVisible` + operator attestation.
- **filesystem** — `userData/vaults/manager.json`, `*.gfvault`, the
  `store='jars'` app.db row before/after via Bash/Read; the exported
  bundle file for the opacity byte-scan.
- **operator** — witnessed attestation of sheet contents, single-sheet
  claim, dismiss-locked semantics, decrypted mapping labels.
- **shell** — negative/positive probes via the Electron-free store
  harness; master-envelope fingerprint comparison for the sever.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | (Setup) Verify preconditions; snapshot donor disk state; record the bundle path. | (empty) |
| 2 | **Opacity scan**: byte-scan the exported bundle file for each donor jar's NAME and for any item plaintext. | No jar name, color, or item plaintext appears anywhere in the serialized bundle; entries are keyed by opaque handles; no plaintext `sourceId`/`vaultId` (criterion 4). |
| 3 | Wipe profile (app stopped); relaunch; Executor reads the fresh vault page. | Not-set-up state: setup CTA + the single restore/import entry; `isSetUp` false on disk (no manager.json). Seeded Personal/Work containers present in the jar registry. |
| 4 | Operator: start the restore workflow, pick the bundle; enter the donor master password on the sheet (operator-performed, secretKind=master). | Operator attests the secret sheet survives window blur (DD8); Executor's poll shows `sheetVisible` true then false; page advances to the mapping step. |
| 5 | Executor: read the mapping modal DOM ("Choose destinations"). | One row per bundle vault with the DECRYPTED source jar name/color + item count — labels match the donor jars (proves decrypt-before-mapping AND that the labels came from ciphertext, not a plaintext id). Every row has a visible, changeable directive; nothing committed to disk yet (manager still absent). |
| 6 | Operator: direct the donor "Personal" jar → **existing** Personal container (prefilled by name-match); one other jar → **new jar** (accept prefilled name/color dot); global → **Global**; commit. | Mapping accepts; flow proceeds to the forced recovery rotation. |
| 7 | Operator: acknowledge the single dismiss-locked recovery sheet (ack-gate: hold until Executor confirms disk capture). | Operator attests: ONE sheet only — no admin sheet follows. Disk (captured pre-ack): manager written at v2 with **NO admin fields** (`adminPublicKeyB64` absent, mrk slots master+recovery only); the donor "Personal" vault landed under the existing `personal` container's id (no duplicate `personal-1`); the new jar exists; global present. |
| 8 | Executor: read the page post-ack. | Profile unlocked; the per-vault outcome surface NAMES each vault's fate (e.g. "Personal → Personal: restored", "…: restored", "Global → Global: restored") — never a raw handle; the sever offer card is present at the top of Settings as an info panel, stating it severs the previous owner's master password. |
| 9 | Executor (shell): probe the adopted profile — donor recovery key; the donor master password (operator-witnessed unlock, password never disclosed to agents). | Donor recovery key fails (adopt force-rotated recovery); donor master password STILL UNLOCKS (the DD4 residual, pre-sever). |
| 10 | Operator: accept the sever card → the existing change-master sheet (master-kind adopt, DD7); confirm with the donor password, set a NEW master password. Then lock and attempt the donor password. | Card clears; manager master-envelope fingerprint changes (donor envelope re-wrapped, byte-diff); operator-witnessed: the NEW password unlocks, the donor password now FAILS — donor master access severed (criterion 8), and it survives a cold restart. |

## Out of Scope

- Compromise-mode rotation (covered by `compromise-mode-rotation`; its
  recovery-branch variant runs on-script in the same session per the
  flight's leg 6).
- Existing-profile transplant Replace/Merge counts (store tests + the
  guided HAT exercised these; a Variant may add a constructed-collision
  case).
- Interruption safety (fault-injection unit tests).
- v1 single-vault bundles (unit-tested legacy path).

## Variants

- **Sever declined**: adopt completes, card dismissed, donor password
  remains valid across a relaunch.
- **Existing-profile transplant** (candidate): map one vault into an
  existing jar with Merge against a constructed collision fixture;
  mergeReport counts verified on the completion surface.
