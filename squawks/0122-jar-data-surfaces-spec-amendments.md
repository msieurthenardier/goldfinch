# Squawk 0122: jar-data-surfaces spec: make the retention premise reachable and pin DD8

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
On a fresh isolated profile, step 6's aged-data premise can't be reached, so the sweep is a no-op and the step proves little. DD8's per-row delete of a partition duplicate is also never exercised. Amend the spec as the Validator recommended:
- backdate `history.db` visits and `cookie_seen.first_seen_ms` in the isolated profile while the app is closed, then sweep, which makes retention removal, DD8's retention clause and the repaint observable;
- correct the rationale: `cookie_seen` is stamped at set time;
- refresh both panels after the step-6 re-seed;
- require positive evidence that the sweep ran;
- add a DD8 per-row delete of one `js_part` duplicate;
- adopt the isolated-profile pattern in the preconditions;
- fix the DD7 wording against the reveal rider (e07e21a).

## Evidence
`tests/behavior/jar-data-surfaces/runs/2026-10-06-13-24-48.md` (Orchestrator Notes, items 1–7).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
