# Flight Log: MCP-Compatible Local Server + Transport

**Flight**: [MCP-Compatible Local Server + Transport](flight.md)

## Summary
Flight `ready` (planned 2026-06-13). Spec drafted + architect-validated (two review cycles → approve);
operator-approved. Awaiting execution via `/agentic-workflow`. MCP impl decision: **official MCP SDK**
(operator go/no-go — Goldfinch's deliberate first runtime dependency). Transport: Streamable-HTTP over
loopback `127.0.0.1:7777`. 7 legs.

---

## Reconnaissance Report

Source artifact: the **Flight 2 debrief** action items (the upstream artifact enumerating follow-ups
that touch this flight's scope). Verified against current code 2026-06-13.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Fix the `captureScreenshot` opts-spread footgun before the API solidifies | **confirmed-live** | `src/main/automation/engine.js:66` still reads `observe.captureScreenshot(wcId, { ...deps(), ...opts })` | Address in this flight (`observe-tools` leg, DD7) — the MCP transport exposes the engine API |
| Run the genuine DevTools-conflict test over the loopback transport (no `--remote-debugging-port`) | **confirmed-live** (deferred verification, not code debt) | The apparatus did not exist until this flight; Flight-2 flight-log Deviations records the confound | Addressed in DD10 + the `verify-integration` leg |
| Draft the Witnessed behavior-test specs during Flight-3 planning (not Flight 6) | **confirmed-live** (operator decision 2026-06-13) | No `tests/behavior/` specs exist yet for these surfaces | Addressed in DD9 + the `behavior-test-specs` leg |
| Carry the `backendNodeId`/`frameId` stale-on-detach caveat as a design constraint | **confirmed-live** (constraint, not code change) | Documented in `observe.js` `readAxTree` JSDoc | Addressed in DD8 (action-by-a11y-handle out of scope; tool docs note the caveat) |
| Standardize operational-condition→return vs error→throw; transport decides refusal mapping | **confirmed-live** (design contract) | Flight-2 flight-log Decisions (the return-refusal reconciliation) | Addressed in DD6 (refusal→result, throws→`isError`) |

All five Flight-2 debrief action items that touch this flight's scope are confirmed-live and folded into
the flight's Design Decisions / legs. No items auto-retired.

---

## Leg Progress

_None yet._

---

## Flight Director Notes
_Orchestration decisions will be recorded here during execution._

---

## Decisions
_Runtime decisions not in the original plan will be recorded here._

---

## Deviations
_Departures from the planned approach will be recorded here._

---

## Anomalies
_Unexpected issues will be recorded here._

---

## Session Notes
_Chronological notes from work sessions will be recorded here._
