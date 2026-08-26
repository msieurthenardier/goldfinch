# Squawk 0015: Welcome behavior specs — hygiene items from the Mission 16 Flight 3 gate runs

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: —

## Report

Four small spec-quality items surfaced by the Validators on the Flight 3 gate runs; none affected a verdict, each is a one-line edit:
- `tests/behavior/welcome-first-launch.md` rows 4 and 6 fold a follow-on action ("A subsequent Ctrl+T …") into the Expected Result cell — split each into its own row so an Executor cannot stop at the immediate post-action state.
- `tests/behavior/welcome-first-launch.md` rows 2 and 7 carry `[mixed-frame]` but are filesystem-only — drop the tag (or add a token browser check).
- `tests/behavior/welcome-first-launch.md` row 3 asserts an empty bookmarks bar is visible — on the dark chrome it has no visual signature; pre-seed one bookmark in the fixture so the bar is visible by content.
- `tests/behavior/welcome-home-first.md` row 2 says "a saved confirmation beneath it" — name the element (`#welcome-home-status`) so the check is exact.

## Evidence

- `tests/behavior/welcome-first-launch/runs/2026-08-26-02-10-54.md`, `tests/behavior/welcome-home-first/runs/2026-08-26-02-00-25.md` — Validator closing summaries.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — the next run of each spec judges the edited rows without the noted ambiguity)*

## Sign-Off

*(written at completion)*
