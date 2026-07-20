# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Top-Bar Download Indicator + Downloads Popup](../flight.md)

> **Interactive leg.** This is a guided **HAT (human acceptance test)** + alignment session — NOT an
> autonomous implementation leg. The Flight Director walks the operator through the verification steps one
> at a time, fixes issues inline (spawning a Developer for code changes), and tunes the HAT-tunable knobs
> until the operator is satisfied. The fix-vs-feature gate applies: look-and-feel fixes ride the inline
> protocol; a mid-HAT request that adds new behavior is promoted to a scoped design review first.

## Objective

Confirm, in the real running app, that the top-bar download indicator and its popup behave per the
mission's success criteria and the operator's judgment — and tune the subjective knobs DD5 left open
(idle timeout, badge semantics, active/recent visual treatment) to the operator's taste.

## Context

- Legs 1-3 landed and committed (indicator button + accumulator, chrome-trust open/reveal by id, the
  sheet-hosted popup). Headless gates (`npm test`, `typecheck`, `lint`) and the live `npm run a11y` sweep
  all passed at flight-end review.
- The observable UI lives in the chrome (button) and the menu-overlay sheet (popup); the external effects
  of open/reveal (launching an app / file manager) are only verifiable by a human — this leg's remit.
- The `download-indicator` behavior test (`tests/behavior/download-indicator.md`, status `draft`) is the
  re-runnable script for the UI-observable flow; this leg activates it on a passing run.

## Acceptance Criteria (operator-judged verification steps)

- [x] **Appears on download**: operator confirmed the `#downloads-indicator` surfaces in the top bar on a
      live download.
- [x] **Recently-completed state**: confirmed — after the recent-persistence HAT fix, the button reflects
      and holds the recently-completed state (label-announced).
- [x] **Popup opens + lists**: confirmed — clicking the button opens the `role="dialog"` popup listing the
      download with the correct filename.
- [x] **Open + reveal work**: operator confirmed a completed row opens the file and the folder icon reveals
      it in the OS file manager (the human-only external-effect checks).
- [x] **In-progress rows**: confirmed — progress shown (now a live-updating bar), filename is plain text,
      not openable.
- [x] **Footer**: confirmed — "Open downloads page" opens `goldfinch://downloads`.
- [x] **Keyboard + focus**: confirmed — Escape closes, Tab cycles; `aria-expanded` flips; focus retained
      across live repaints; button not focused while idle-hidden.
- [x] **App-scoped**: confirmed present on internal `goldfinch://` tabs; not in the pinnable toolbar row.
- [x] **Idle policy** (DD5): tuned during HAT to Chrome-like persistence (persists after viewing until the
      5-min idle timeout); operator confirmed the feel.
- [~] **Behavior test**: **DEFERRED** — the Witnessed `download-indicator` run needs an admin-scoped MCP
      key (`getChromeTarget` reads the chrome + sheet), which was not available in the run session (jar key
      only; admin mints only under `GOLDFINCH_AUTOMATION_ADMIN`). All its assertions were instead
      operator-verified by hand this session. Spec stays `draft`; run it once an admin MCP key is
      configured, then flip `draft → active`. Disposition recorded in the flight log.
- [x] **Operator satisfied**: two alignment gaps raised mid-HAT (recent-persistence FIX; live popup
      progress FEATURE via scoped design review) — both implemented, reviewed, and operator-re-confirmed.

## Verification Steps

Run the app (`npm run dev`, or `npm run dev:automation` for the behavior test). The Flight Director
presents each acceptance-criterion check one at a time, waits for the operator's result, and fixes/tunes
inline before moving on. External-effect checks (open file / reveal in folder) and the subjective
visual/idle tuning are the heart of this leg; the DOM-observable flow is corroborated by
`/behavior-test download-indicator`.

## Knobs available to tune (DD5 — HAT-earmarked)

- Recent-list cap (default 25) and the 5-minute idle-timeout duration.
- Badge semantics (active count vs. recent count; hidden-at-zero).
- Active/recent visual treatment (animation, accent, reduced-motion fallback).
- Acknowledge behavior (currently on popup close).

## Files Affected

- Potentially any of the Leg 1-3 files, if the operator requests fixes/tuning during the session.
- `tests/behavior/download-indicator.md` — `Status: draft → active` on a passing run.

---

## Post-Completion Checklist

- [x] All operator-judged criteria confirmed (behavior-test disposition recorded in the flight log)
- [~] `/behavior-test download-indicator` — DEFERRED (admin MCP apparatus unavailable in-session); spec
      stays `draft`, all assertions manually operator-verified. Run + flip to `active` once admin key set.
- [x] Two HAT changes made (recent-persistence fix + live popup progress) — committed with the flight
      (new commit on the branch, no amend)
- [x] Update flight-log.md with the HAT session outcome + tuning decisions (DD2 & DD5 revisions recorded)
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md; final leg → flight.md status `landed`, flight checked off in
      mission.md, committed, PR #107 marked ready for review
