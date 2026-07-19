# Leg: hat-and-alignment

**Status**: ready
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

- [ ] **Appears on download**: starting a download surfaces the `#downloads-indicator` in the top bar,
      immediately left of the window controls, with active/animated feedback and (if applicable) a count
      badge. The strip stays draggable around it (`no-drag` only on the button).
- [ ] **Recently-completed state**: when the download finishes, the button reflects a recently-completed
      state; a screen reader announces the state change via the label (not color/animation alone).
- [ ] **Popup opens + lists**: clicking the button opens the popup (a `role="dialog"`) anchored under it,
      listing current + recent downloads with correct filenames.
- [ ] **Open + reveal work**: a completed row's filename **opens the file** in its default app; the folder
      icon **reveals it** in the OS file manager. (These external effects are the human-only checks.)
- [ ] **In-progress rows**: show progress and are not openable (filename is plain text, no open/reveal
      buttons).
- [ ] **Footer**: the "Open downloads page" footer opens `goldfinch://downloads`.
- [ ] **Keyboard + focus**: the popup is fully keyboard-operable — Escape closes, Tab cycles among the
      row/footer buttons; `aria-expanded` on the button flips true/false; focus returns sensibly on close;
      the button is never focused while idle-hidden.
- [ ] **App-scoped**: the indicator is present regardless of the active tab (including internal
      `goldfinch://` tabs) and does not appear in the pinnable toolbar row / pin controls.
- [ ] **Idle policy** (DD5, tunable): after opening + closing the popup with nothing in flight, the button
      hides; the 5-minute idle fallback also hides it. Operator confirms the feel or requests a tune.
- [ ] **Behavior test**: `/behavior-test download-indicator` passes; on pass, flip that spec's
      `Status: draft → active`.
- [ ] **Operator satisfied**: any look-and-feel adjustments requested during the session are applied
      (inline for fixes; via scoped design review for features) and re-verified.

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

- [ ] All operator-judged criteria confirmed (or accepted dispositions recorded in the flight log)
- [ ] `/behavior-test download-indicator` run; run log committed; spec flipped to `active` on pass
- [ ] Any inline fixes committed (new commits, no amend)
- [ ] Update flight-log.md with the HAT session outcome + any tuning decisions
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md; this is the final leg → update flight.md status to `landed`,
      check off the flight in mission.md, commit, and mark the PR ready for review
