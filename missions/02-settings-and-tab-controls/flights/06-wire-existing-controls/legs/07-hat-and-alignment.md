# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Guided HAT of the live wired controls — the settings Shields toggles + the home-page control — feel/alignment
pass with inline fixes for anything the operator flags.

## Outcome
**PASS** (operator-confirmed). The Flight Director drove the running app on `:9222`; the operator judged the
feel. Functionality was sound; the findings were **styling/alignment** of the Flight-6 form controls (the
Flight-5 shell was styled, but the new controls shipped as raw browser defaults). All fixed inline
(style-only / copy; offline gates stayed 211/211 throughout) and re-verified by screenshot:

1. **Form controls unstyled** → brand-matched `settings.css` pass: restyled the Shields fieldset, the
   checkboxes, and the home-page input + Save button to the dark/gold brand.
2. **"Same switch toggles"** → restyled the native checkboxes as the panel's **gold pill switches**
   (`appearance:none` mirroring `styles.css` `.switch`; kept native-checkbox semantics + a11y).
3. **Panel model: label-left / toggle-right; Shields as parent; drop the border box** → each row
   `justify-content:space-between` (label left, pill right); **Shields** is a bold parent with a separator,
   the four strategies indented children; the fieldset's visual border removed (element kept + `legend`
   made SR-only for grouping).
4. **Save button un-bolded** → removed `font-weight:600`.
5. **Copy correction** (operator-flagged): the "Per-site exceptions are managed from the Shields panel" note
   was inaccurate (the toggles are global / lock-step regardless of site) → changed to "These are global
   Shields defaults, applied to every site."

**Future need recorded** (out of scope, operator): real **per-site Shields overrides — more-strict-only** —
added to the mission Known Issues for a future flight.

## Confirmed live
- Settings Shields toggles render as the panel's gold pill switches (label-left/toggle-right; Shields parent
  + indented children; no border box); home-page input + (un-bold) gold Save.
- Two-way Shields sync, home-page persist/validate/take-effect — all confirmed in leg 6 + re-felt here.

---

## Post-Completion Checklist
- [x] Guided HAT performed; subjective feel accepted
- [x] All flagged issues fixed inline (style/copy) + re-verified (screenshots)
- [x] Offline gates green after fixes (211/211)
- [x] Future per-site-overrides need recorded in the mission Known Issues
- [x] Flight log updated; status `completed`; flight lands
