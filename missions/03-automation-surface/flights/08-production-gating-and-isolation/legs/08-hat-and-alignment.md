# Leg: hat-and-alignment

**Status**: ready
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Guided human acceptance test (HAT) of the F8 production posture on the installed/packaged binary, iterating on any defects inline, plus running the authored Activity-viewer behavior spec if ready.

## Context
- **DD8b** (interactive — human-driven). The HAT caught real defects in F6 and F7; F8 moves a security boundary and has cross-instance behavior unit tests can't reach. The Flight Director guides the operator one step at a time; failures are fixed inline (spawning a Developer for code changes), then re-verified.
- This leg does **not** spawn autonomous implementation agents — the human performs the verification; the FD coordinates and fixes.

## Acceptance Criteria (operator-confirmed, one step at a time)
- [ ] **Installed toggle-binds:** on the installed binary, flipping the Settings Automation toggle ON binds the surface (an MCP client / curl connects); OFF unbinds it and the chrome indicator clears. No `--automation-dev` needed.
- [ ] **Admin env on production:** launching the installed binary with `GOLDFINCH_AUTOMATION_ADMIN` set surfaces the admin key control; minting + admin auth work; without the env the admin tier is invisible.
- [ ] **Two coexisting instances + port fallback:** two installed instances launched back-to-back both bind (different ports), surfaced in each Settings live-address.
- [ ] **Dev-profile isolation:** a dev launch does not touch the installed `~/.config/goldfinch` (operator confirms their real jars/cookies/history are untouched after a dev session).
- [ ] **Human-only enable:** there is no way to turn the surface on except the human toggle (minting a key does not enable; the operator confirms the toggle is the only enable affordance).
- [ ] **DD9 key-gen gating (if not run in leg 7):** `/behavior-test automation-key-gating` passes.
- [ ] **Activity-viewer behavior spec (DD8c):** `tests/behavior/settings-activity-viewer.md` exists (status `draft`); run it via `/behavior-test settings-activity-viewer` here if ready, or carry to F9 (record the disposition).

## Verification Steps
- The FD presents each step; the operator performs it and reports the result; the FD proceeds or fixes inline.
- Any failure → diagnose, fix in a new commit (spawning a Developer if code changes are needed), re-verify that step before moving on.

## Files Affected
- None unless a HAT defect requires a fix (new commit, then re-verify).

---

## Post-Completion Checklist
- [ ] All HAT steps pass (or defects fixed + re-verified)
- [ ] Activity-viewer spec run or its carry-to-F9 disposition recorded
- [ ] Update flight-log.md with the HAT outcomes
- [ ] Set this leg's status to `completed`; check off in flight.md
- [ ] Flight landing: flight.md status → `landed`; check off the flight in mission.md; mark PR ready for review; `[COMPLETE:flight]`
