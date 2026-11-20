# Squawk 0200: The home-page Save button is 2 px shorter than Clear beside it

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
In Settings → Startup & appearance, `#home-page-save` renders 28 px tall beside the 30 px `#home-page-clear`. Mission 23 Flight 3 aligned every `.settings-btn` primary with the secondary variant by giving it a transparent 1 px border; `#home-page-save` has its own rule and was not included.

## Evidence
- `src/renderer/pages/settings.css` — the `#home-page-save` rules; `.settings-btn` now carries `border: 1px solid transparent`.
- Flight 3 flight log, "Leg 12 review fixes" (measured 28 px vs 30 px).

## Corrective Action
Cause: `#home-page-save` (settings.css) declared `border: none`, so its box was 14px line + 12px padding = 28px. `#home-page-clear` carries `.settings-btn` + `--secondary`, whose 1px border adds 2px = 30px. `settings.html` gives Save no class, so it never picked up the Flight 3 `.settings-btn` transparent border.
Fix: `#home-page-save` now has `border: 1px solid transparent` (same value as `.settings-btn`), in `src/renderer/pages/settings.css`. Both buttons are `inline-block` with `vertical-align: middle`, so equal height gives the same top edge. Checked other selectors: `#home-page-save` appears only in settings.css (rule, :hover, :focus-visible), settings.html, settings.js (by id, no style) and a vault.css comment; `.settings-btn` / `--secondary` rules untouched. Pin: `test/unit/settings-save-button-border-pin.test.js`.

Follow-up (live check: heights 30/30 but tops 170.5 vs 169.5): `#home-page-save` had `vertical-align: middle`, `#home-page-clear` (via `.settings-btn`) set none and sat on the baseline. Added `vertical-align: middle` to the `#home-page-clear` rule only (not `.settings-btn`, which other buttons use). Chosen over removing it from Save because the row's text input `#home-page-input` is also `vertical-align: middle`, so all three share one alignment. The pin test now asserts Save, Clear and the input resolve to the same vertical-align (throws if a rule or declaration is missing).

## Verification
Both buttons measure the same height and top edge (`getBoundingClientRect()` on the live page).

Ran: pin test (1 pass; neuter to `border: none` fails). Live measurement left to the Flight Director.

Live result before the follow-up fix: heights 30/30, tops 170.5 vs 169.5. Re-measure live after the vertical-align fix is left to the Flight Director.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the sixth 2026-11-19 turnaround)
**Verdict**: confirmed. The first live measure found equal heights (30/30) but tops 1 px apart (Save `vertical-align: middle`, Clear on the baseline); a fix gave `#home-page-clear` `vertical-align: middle` and the pin test now also covers vertical-align (neuter-verified), re-confirmed by the Reviewer. **Live after the fix**: Save, Clear and the home-page input all top 169.5, height 30. Gates at re-review: `npm test` 7,430 tests (7,425 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-f`
