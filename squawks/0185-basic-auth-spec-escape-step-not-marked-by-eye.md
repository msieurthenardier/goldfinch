# Squawk 0185: The basic-auth spec's Escape step is not marked by-eye, and its last-run line says "never"

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found in Mission 23 Flight 2's `electron-45` leg. `web-compat-basic-auth` step 3 says "Press Escape on the sheet". The sign-in card is a sheet menu type automation can neither read nor send input to, so a script cannot perform the step: an automation `pressKey` Escape leaves the card up (measured on Electron 44.10.0 and 45.3.2 — not a regression). The spec's one recorded run (2026-07-28) passed the step because the operator pressed the key. The step carries no `[by-eye]` mark, which led a leg criterion to be written against it. Separately, the spec's `Last Run` line reads `never` although that run log exists.

## Evidence
- `tests/behavior/web-compat-basic-auth.md` — step 3; `**Last Run**: never`.
- `tests/behavior/web-compat-basic-auth/runs/2026-07-28-19-58-55.md` — "HAT mode — operator performed Esc, credential typing, sheet reading".
- `CLAUDE.md` → *Standing unobservable-surfaces list* (`auth-*` sheets).
- Flight log, `missions/23-security-review-remediation/flights/02-vault-and-automation-boundary/flight-log.md`, leg `electron-45`.

## Corrective Action
In `tests/behavior/web-compat-basic-auth.md`: steps 1-4 now mark the card-targeting actions `[by-eye]` (step 2's a11y clause too) and state the automation half (`enumerateWindows()` `sheetVisible`, field confirmed in `src/main/automation/mcp-tools.js`; step 3 names dismissal by navigating away or closing the tab, and notes automation `pressKey` Escape leaves the card up); step 6's sheet-closes clause uses `sheetVisible`. Observables list updated (human/HAT entry; `captureWindow` replaced by `sheetVisible`). `Last Run` now names the 2026-07-28 run.

## Verification
Step 3 (and any other step whose action targets the card) is pre-marked `[by-eye]` / HAT with the automation-observable half stated (`enumerateWindows().sheetVisible`; dismissal by navigating away or closing the tab). `Last Run` names the 2026-07-28 run.

Ran: `npx prettier --check` on the spec and this squawk (pass). Spec-only change; no src/ or test changes, so the full suite was not re-run.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Steps 1-4's card reads and inputs are `[by-eye]`, each with `enumerateWindows()` `sheetVisible` as the automation half (a real field, `mcp-tools.js`); step 3's dismissal is the operator's Escape, or navigating away or closing the tab; `Last Run` names the 2026-07-28 run. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
