# Squawk 0194: admin-reach-refusal: the step 6 poller reads the wrong line, and step 8 states no wall-clock tolerance

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: 2026-11-18

## Report
From the Validator of the spec's fourth run (Mission 23 Flight 2). Step 6 asks the run to poll the trace for the call's decision line; a poller keyed on the channel name latches onto the earlier `busy` line for the same channel (step 4a), so the timeout line's arrival is never timed and the call's settle time has to stand in. Step 8 gives only an approximate '4 s + 60 s' while the host's wall clock can run several seconds ahead of the monotonic clock, so a correct run sits just outside step 6's stated band. Steps 3 and 6 also record the wall clock only in the spec's wording.

## Evidence
- `tests/behavior/admin-reach-refusal.md` — steps 3, 6, 8.
- `tests/behavior/admin-reach-refusal/runs/2026-11-16-03-02-52.md` — the Validator's spec-quality findings.

## Corrective Action
Edited `tests/behavior/admin-reach-refusal.md` (Mission 24 Flight 2 leg 5, part A):
- Step 6: the trace poller keys on the channel AND `decision=timeout` (or the first matching line after the trace file's byte offset recorded in step 3), never the channel name alone; the timeout line's first-seen time is recorded.
- Steps 3, 6 and 7: start and settle are recorded on the monotonic clock of the calling process (`performance.now()`), wall clock alongside for information only; the 60-66 s band is judged on the monotonic figure and a wall-clock overshoot is named as not a failure.
- Step 8: the page stores `__firedAt` inside the armed timer and `__settledAt` at the settle; the band is stated precisely as 60-66 s from `__firedAt` to `__settledAt`, and the arm-to-decision wall-clock skew is named as not a failure.
- Also added steps 12-13, the step 9 allowance, preconditions and by-eye entries for this flight's gate changes.

## Verification
Spec diff read against the above on 2026-11-18 (not yet run live; part B of the leg is the live run). Step 6 tells the run to wait for a line containing both the channel and `decision=timeout` (or a line count); steps 3, 6, 7 and 8 require both clocks and judge on the monotonic one, with the wall-clock figure recorded; step 8 states its tolerance.

## Sign-Off
- Reviewer: flight-review Reviewer agent (Sonnet)
- Verdict: confirmed
- Commit: flight/02 commit (Mission 24) — see `git log --grep 'Squawks: 0194'`
