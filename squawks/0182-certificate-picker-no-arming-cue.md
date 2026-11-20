# Squawk 0182: The client-certificate picker gives no visual cue while it is ignoring input

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found during Mission 23 Flight 1's `prompts-and-bounds` leg. The certificate picker ignores activation for 500 ms after it opens, like the vault picker, but unlike the vault picker it does not dim its rows during that time, so an early click simply appears to do nothing. Not walked at the HAT (group 2 was not walked).

## Evidence
- `src/renderer/menu-overlay.js` — the vault picker adds and removes the `vault-picker-arming` class around its delay; the certificate picker's open handler has no equivalent.
- `src/renderer/menu-overlay.css` — `#sheet-vault-picker.vault-picker-arming .cm-item` is the only arming style.

## Corrective Action
The certificate picker now has its own copy of the vault picker's cosmetic arming cue (mirrored, not shared, so the vault picker's class name, helper names and existing source-scan pins are untouched). `src/renderer/menu-overlay.js`: `startCertPickerArming` / `clearCertPickerArming` add and remove `cert-picker-arming` on `certPickerNode`, with one timer for the delay; `startCertPickerArming(armingDelay)` is called in the `cert-picker` init branch before `menuController.open`, using the same `armingDelayFor(menuType)` value passed to `report.begin` (so every init, including a same-type replace, re-arms; `startCertPickerArming` clears the previous timer first). `certPickerEntry`'s new `onClose` calls `clearCertPickerArming`, which covers close and the `closeAll()` scrub. `src/renderer/menu-overlay.css`: `#sheet-cert-picker.cert-picker-arming .cm-item:not(.cert-picker-cancel)` gets `opacity: 0.55`, as the vault rule; the "Continue without a certificate" row stays full strength because it is a dismissal that arming never delays. The delay, `createSheetReport`'s gate and the opt-in table are unchanged.

## Verification
Give the certificate picker the same one-class cue for the delay taken from `src/shared/sheet-arming.js`. Cosmetic only — the gate itself is a timestamp in the shared sender and must not be touched. By eye (the sheet is not observable to automation); a source-scan pin in the style of `sheet-arming.test.js`.

## Verification results
`test/unit/sheet-arming.test.js` gained 3 tests (18 total, all pass): the shipped helper source run against a fake node and timers (class added on start with the 500 ms table delay, removed when the timer fires, re-init cancels the earlier timer and re-applies, zero delay applies nothing, clear removes it), plus a source scan of the init order, the `onClose` clear and the CSS rule (it throws if a target block is missing). Neuter-verified: removing the `startCertPickerArming(armingDelay)` call, the `classList.add`, and the `onClose` clear each turned the file red (1, 2 and 1 failures); restored. `npm test` 7480 pass / 0 fail; `npm run lint`, `npm run typecheck` and `npm run format:check` clean. Not observable live by automation: the `cert-picker` menuType is not in `AUTOMATABLE_MENU_TYPES`, and raising it needs a TLS server that requests a client certificate. The dimming is a by-eye item.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eleventh 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The cue is set from the same delay passed to `report.begin`, re-armed on re-init (earlier timer cleared) and cleared on close and scrub; excluding the "Continue without a certificate" row from the dimming is justified (a dismissal is never delayed). Neuter: removing the start call fails a test. Not checked live: the `cert-picker` sheet is unobservable to automation and needs a server requesting a client certificate. **By-eye check still owed by the operator.** Gates at review: `npm test` 7,485 tests (7,480 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-k`
