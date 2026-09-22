# Leg: hat-and-alignment

**Status**: ready
**Flight**: [The In-Field Affordance](../flight.md)

## Objective

The operator verifies the flight live, on a dev build, one step at a time with the
Flight Director:
- the badge;
- generation on sign-up;
- rotation to an UPDATED item;
- the toolbar lock click;
- a hand reproduction and diagnosis of squawk 0100 (moved here from Leg 1).

Issues are fixed inline under the HAT protocol (fix-vs-feature gate; multi-surface
fixes get a lightweight design-review pass first).

## Context

- DD12: the vault sheets are unobservable to automation, so every assertion here is
  operator-observed. Read paths: the vault page (item saved/updated), the page's own
  fields (via DevTools: the value length and new === confirm), and the badge by eye.
- Squawk 0100: two automation passes could not reproduce it (kebab and page-context are
  redacted from capture by design). DD11's divert gate applies: a bounded fix lands
  inline; a sheet/window lifecycle redesign diverts to its own flight.
- Setup: `npm run dev:automation` (dev profile). The vault must be set up with at least
  one saved login for the rotation step. Test pages: local HTML served or loaded as
  `file://` is not eligible (the badge needs a persistent-jar web origin). Use a local
  `http://127.0.0.1` static server over `test/fixtures/save-moment/password-roles/`.

## Verification Steps (operator; one at a time)

1. **Badge, locked.** Lock the vault. Focus a login field on a sign-in fixture: the badge
   shows the goldfinch mark with an amber closed lock overlay, legible at in-field size.
   Repeat on a dark-background field. Then check the card and identity fixtures.
2. **Badge, unlocked.** Unlock: the same mark with a green open overlay. The mark itself
   is unchanged.
3. **Toolbar lock click.** Locked: clicking the toolbar lock raises the unlock sheet.
   Unlocking there does NOT pop a fill picker. Unlocked: clicking opens
   `goldfinch://vault`. Right-click still offers "Lock now". Enter/Space on the focused
   indicator behaves the same as a click.
4. **Generate on sign-up (unlocked).** On `signup-new-password-marked` (served), click the
   badge on the new-password field: the picker's first row is "Generate strong
   password". Choose it: the new and confirm fields fill with the same ~20-char value
   (check in DevTools). Submit: the save offer appears. Save it, then find the item in
   the vault page with that password.
5. **Generate while locked.** Lock, then click the badge on a new-password field: the
   picker shows Generate + "Unlock to fill a saved login", with no unlock prompt first.
   Generate fills with no unlock. Submit: the unlock-to-save path appears, and the item
   saves after unlock. Separately, choosing "Unlock to fill a saved login" raises
   unlock, then the full picker (Generate row still first).
6. **Rotation to an UPDATED item.** With a saved login for the fixture origin, open
   `change-password-three-marked` (or the no-username variant). Fill current (use the
   saved password), Generate for new, and submit: the offer is an UPDATE, not a new
   item. After saving, the vault page shows the SAME item with the new password and its
   username intact.
7. **Constraints.** On a fixture with `maxlength="12"` and `passwordrules="required: lower; required: digit; allowed: upper"`
   (the operator may edit in DevTools), Generate produces ≤ 12 chars with no symbols.
   With `maxlength="6"` there is no Generate row.
8. **Squawk 0100 repro.** Open `goldfinch://vault` in a tab, close it, load a web page in
   the same window, then click the kebab and right-click the page. Also try variants:
   another internal page, closing while active vs in the background, unlock/setup
   clicked on the vault page just before closing, and home page set vs unset. If it
   reproduces, the FD instruments and diagnoses with the operator reporting what they
   see. Fix inline if bounded; divert per DD11 if not. If it cannot be reproduced after
   the variants, record that and leave 0100 open/deferred with the evidence.
9. **Regression spot-check.** An ordinary sign-in submit still offers save/update exactly
   as before. A card checkout still offers a card save.

## Acceptance Criteria

- [ ] Steps 1–7 and 9 pass, or their failures are fixed inline and re-verified.
- [ ] Step 8 dispositioned: fixed with a unit pin, diverted, or recorded as not
      reproducible with evidence.
- [ ] Badge approved by the operator (DD9), or iterated until it is.
- [ ] Any fix commits reference this leg; the flight log records each step's outcome.

---

## Post-Completion Checklist

- [ ] Flight log updated per step
- [ ] Leg status → `completed`, checked off in flight.md
- [ ] Flight → `landed`, checked off in mission.md
