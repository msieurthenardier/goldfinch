# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Optional guided human acceptance test: the operator opens Settings, feels the flow, reloads, and
confirms the Flight-4 stub is acceptable before landing.

## Outcome (2026-06-07)
**Operator approved — landed.** The operator opened **⋮ → Settings** (and cross-checked against Chrome's
internal-page behavior), confirmed `goldfinch://settings` opens and renders "Settings / Coming soon"
cleanly and reloads stably. No tweaks requested to the Flight-4 stub.

**Design input raised during the HAT (captured, not a Flight-4 change)**: comparing to Chrome's internal
pages (the "Chrome" address-bar chip + cross-process swap on navigating away from `chrome://`), the
operator noted Goldfinch's internal tab does not switch contexts when navigated to a web URL — matching
the leg-6 latent finding. Recorded as a mission Known Issue with the layered Chrome-model fix
(origin-check the bridge before Flight 6 IPC; swap-or-lock internal-tab navigation; an internal-page
identity chip for Flight 5). Out of scope for Flight 4 (the bridge is inert `{version:1}`).

## Acceptance Criteria
- [x] Operator opened Settings via the kebab and confirmed the stub renders.
- [x] Reload keeps the tab on `goldfinch://settings`.
- [x] Operator approved landing; any HAT-surfaced design inputs captured for later flights.

---

## Post-Completion Checklist
- [x] HAT performed + approved
- [x] Design inputs captured (mission Known Issues)
- [x] Status `completed`
- [x] Checked off in flight.md
