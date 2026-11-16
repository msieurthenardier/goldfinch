# Squawk 0185: The basic-auth spec's Escape step is not marked by-eye, and its last-run line says "never"

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found in Mission 23 Flight 2's `electron-45` leg. `web-compat-basic-auth` step 3 says "Press Escape on the sheet". The sign-in card is a sheet menu type automation can neither read nor send input to, so a script cannot perform the step: an automation `pressKey` Escape leaves the card up (measured on Electron 44.10.0 and 45.3.2 — not a regression). The spec's one recorded run (2026-07-28) passed the step because the operator pressed the key. The step carries no `[by-eye]` mark, which led a leg criterion to be written against it. Separately, the spec's `Last Run` line reads `never` although that run log exists.

## Evidence
- `tests/behavior/web-compat-basic-auth.md` — step 3; `**Last Run**: never`.
- `tests/behavior/web-compat-basic-auth/runs/2026-07-28-19-58-55.md` — "HAT mode — operator performed Esc, credential typing, sheet reading".
- `CLAUDE.md` → *Standing unobservable-surfaces list* (`auth-*` sheets).
- Flight log, `missions/23-security-review-remediation/flights/02-vault-and-automation-boundary/flight-log.md`, leg `electron-45`.

## Corrective Action
*(written at completion)*

## Verification
Step 3 (and any other step whose action targets the card) is pre-marked `[by-eye]` / HAT with the automation-observable half stated (`enumerateWindows().sheetVisible`; dismissal by navigating away or closing the tab). `Last Run` names the 2026-07-28 run.

## Sign-Off
*(written at completion)*
