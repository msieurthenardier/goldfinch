# Squawk 0006: `search-engine-upgrade` step 2 asserts a new-tab premise that squawk 0005 already disproves

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-24
**Completed**: 2026-08-25

## Report

`tests/behavior/search-engine-upgrade.md` step 2 expects the first new tab after launch to open on the configured home page ("The tab opens on `https://fixture.example.net` — new-tab behavior unchanged"). On every build — pre-flight and Flight 1 alike — the first Ctrl+T in a window opened at launch goes to the hardcoded Google fallback until a `settings-changed` broadcast lands (squawk 0005, on file the day the spec was drafted). The row therefore fails on a pre-existing, deferred defect rather than measuring upgrade neutrality. Re-author it to pin steady-state new-tab behavior (after a broadcast), or mark it as a post-squawk-0005 row, so the spec's first-run record isn't a permanent known-issue fail. Found at the M16 F1 flight debrief (2026-08-24).

## Evidence

- `tests/behavior/search-engine-upgrade.md` — step 2 row, Expected Result as quoted above.
- `tests/behavior/search-engine-upgrade/runs/2026-08-24-23-17-56.md` — checkpoint 2 FAIL; supplementary Ctrl+T after the step-5 settings write opened `https://fixture.example.net`; Orchestrator differential on `c8563f3` reproduced the identical first-tab miss.
- `squawks/0005-home-page-cache-never-boot-seeded.md` — "In any window opened after launch, Ctrl+T … open the hardcoded `HOMEPAGE` constant (Google) … until some unrelated `settings-changed` broadcast happens to land in that window."
- Flight artifact DD4 (`missions/16-search-and-startup-choice/flights/01-search-engine-preference/flight.md`) — the corrected text documenting the same gap, dated 2026-08-11, the spec's authoring date.

## Corrective Action

No re-authoring. Flight 2 leg 1 fixed the underlying defect (squawk 0005), which made the row true as written — DD5 of the flight predicted this and the FD chose a re-run over a rewrite so the spec keeps asserting the user-facing behavior ("new-tab behavior unchanged") rather than a steady-state workaround.


## Verification
Re-run `/behavior-test search-engine-upgrade` on a fresh fixture: the re-authored row passes on the Flight 1 build without relying on squawk 0005 being fixed.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — Mission 16 Flight 2 flight-end review, one round, 2026-08-25
**Verdict**: confirmed
**Commit**: `flight/02: The Welcome Surface — viewless welcome tab, search handoff, unset-by-default` on `flight/02-welcome-surface` (the flight-end commit; PR number recorded in the flight debrief)

Reviewer independently ran the suite (3763/3763, ~3.3 s), typecheck and lint clean, and traced the corrective action against the diff. Closed without re-authoring: `search-engine-upgrade` re-run 2026-08-25 passed 5/5 with step 2 as written (was 4/5) once squawk 0005 was fixed — the row's premise is true on the Flight 2 build.
