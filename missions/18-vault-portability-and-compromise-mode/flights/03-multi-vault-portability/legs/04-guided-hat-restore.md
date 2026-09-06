# Leg: guided-hat-restore

**Status**: completed
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Operator-guided walk of the whole portability surface with inline
fixes: export → wipe → fresh adopt with mapping → probes → selective
transplant (Replace + Merge) → sever offer both ways → lifetime and
blur spot-checks. Interactive leg — no autonomous crew; the Flight
Director guides one step at a time, fixes ride the HAT protocol
(fix-vs-feature gate; multi-surface fixes get a lightweight design
pass first).

## Operator veto points (flagged at planning)

- Export modal is now whole-profile only (leg 3 ruling 7)
- `vault-unlock` sits in the blur-survival allowlist (DD8)

## Verification Steps

1. **Setup**: pre-wipe backup of the dev profile (vaults dir + app-db)
   taken and verified; app running under `npm run dev:automation`;
   profile state confirmed (global + ≥2 jar vaults with items).
2. **Blur contract**: half-type a master password into the unlock
   sheet, app-switch away and back — state survives; a non-vault sheet
   still blur-dismisses.
3. **Whole-profile export**: one bundle, secretless build; result
   states carried vaults; byte-scan shows no jar names/items.
4. **Wipe + relaunch**: fresh-profile page state (setup CTA + restore
   entry).
5. **Fresh adopt with mapping**: pick bundle → secret sheet →
   decrypted labels (names/colors/counts match donor) → directives:
   one vault → NEW jar, one → skip, global → Global → commit →
   exactly ONE dismiss-locked recovery sheet (no admin sheet) →
   per-vault outcomes + sever card; profile unlocked.
6. **Probes**: donor recovery key fails; donor master password still
   unlocks (pre-sever residual).
7. **Selective transplant**: re-run restore on the now-set-up profile;
   map one vault into an EXISTING jar with Merge (mergeReport counts
   sane), exercise Replace on another; skip the rest.
8. **Held-bundle lifetime spot-check**: cancel mid-mapping and resume
   from pick; trigger a forced modal close and use the resume
   affordance.
9. **Sever offer**: decline first (dismiss; donor password still
   works after relaunch of the card's absence — session state); adopt
   again or use the standing card to ACCEPT — routes to the correct
   existing sheet for the adopt kind; donor password dead after.
10. **Wrap**: operator satisfied; issues fixed inline and logged;
    veto points ruled.

## Notes

- Restore the pre-wipe backup afterwards only if the operator wants
  the original profile back (the adopted profile IS the original's
  content).
- Behavior-spec finalization details (exact copy/labels) feed leg 5.

---

## Post-Completion Checklist

- [x] All steps walked, operator satisfied
- [x] Inline fixes reviewed per HAT protocol (consolidated
      independent review of the 11-fix diff — [HANDOFF:confirmed])
      and committed
- [x] Flight log updated (per-step results, fixes, veto rulings)
- [x] Leg status → `completed`

## Debrief carry-forward (non-blocking review notes)

- `buildColorSwatchGrid`'s document `pointerdown` listener isn't
  explicitly removed if the mapping modal is dismissed while a swatch
  grid is expanded; self-heals on the next document click. Cosmetic.
- `refresh()` now fires one `hasVault` IPC per persistent jar (new
  fan-out, previously zero) to build the presence map — fine at
  realistic jar counts, non-secret; note if jar counts grow large.
- The bundle plaintext-`sourceId` leak → leg 5 (`bundle-identity-
  opacity`); HAT fix 11's completion display uses raw sourceId as a
  post-authorization label and must rekey off the decrypted name once
  leg 5 makes the id opaque.
