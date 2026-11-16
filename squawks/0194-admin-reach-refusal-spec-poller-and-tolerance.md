# Squawk 0194: admin-reach-refusal: the step 6 poller reads the wrong line, and step 8 states no wall-clock tolerance

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: —

## Report
From the Validator of the spec's fourth run (Mission 23 Flight 2). Step 6 asks the run to poll the trace for the call's decision line; a poller keyed on the channel name latches onto the earlier `busy` line for the same channel (step 4a), so the timeout line's arrival is never timed and the call's settle time has to stand in. Step 8 gives only an approximate '4 s + 60 s' while the host's wall clock can run several seconds ahead of the monotonic clock, so a correct run sits just outside step 6's stated band. Steps 3 and 6 also record the wall clock only in the spec's wording.

## Evidence
- `tests/behavior/admin-reach-refusal.md` — steps 3, 6, 8.
- `tests/behavior/admin-reach-refusal/runs/2026-11-16-03-02-52.md` — the Validator's spec-quality findings.

## Corrective Action
*(written at completion)*

## Verification
Step 6 tells the run to wait for a line containing both the channel and `decision=timeout` (or a line count); steps 3, 6, 7 and 8 require both clocks and judge on the monotonic one, with the wall-clock figure recorded; step 8 states its tolerance.

## Sign-Off
*(written at completion)*
