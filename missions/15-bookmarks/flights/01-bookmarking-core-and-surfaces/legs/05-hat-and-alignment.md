# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Bookmarking Core and Surfaces](../flight.md)

## Objective

Operator-led guided HAT: visually validate the bookmarking surfaces, run the flight's behavior tests (which include the operator-assisted steps no agent can perform), execute the two drag-spike operator procedures, and fix look-and-feel issues inline until the operator is satisfied.

## Context

- Interactive leg — no autonomous implementation. The Flight Director guides one step at a time; fixes ride the inline protocol (look-and-feel FIXES only; anything adding new behavior is a FEATURE and gets a scoped design review first — FD's call, made out loud; multi-surface "cosmetic" fixes get a lightweight design-review pass before implementation).
- Legs 1-4 committed (7dbf08b); draft PR #145 open. Fixes land as new commits on the flight branch.
- Environment: `npm run dev:automation` (WSLg — Wayland default); operator present for multi-window, relaunch, DB-corruption, and drag-procedure steps.

## Session Plan (steps presented one at a time)

1. **Warm-up feel pass** (operator drives, FD cues): star fill/unfill feel; popover anchoring under the star — including the known y-clamp behavior (popover may hug the sheet's top edge rather than pixel-anchor); rename/URL-edit/remove round-trips; Ctrl+D; page-context items on web vs internal pages.
2. **Bar feel pass**: settings merged section reads right; toggle + Ctrl+Shift+B; **instant** (non-animated) reflow judgment in both windows; icons vs monograms; tooltips; middle-click background-open focus behavior; overflow collapse + per-row right-click edit; the duplicate-url silent-close case (watch item from leg 2 — is the minimal presentation acceptable?).
3. **Behavior tests** (Witnessed runs, operator assists where marked): `/behavior-test bookmarks-star-sync`, `/behavior-test bookmarks-bar`, `/behavior-test bookmarks-omnibox`.
4. **Affected-spec re-runs**: `page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay` (draft specs graduate to active on first pass).
5. **Drag-spike operator procedures** (from the flight log Decisions — ~2 min each): (a) chrome-DOM → guest-surface drag delivery, (b) chrome ↔ sheet drag delivery. Verdicts feed Flight 2's go/no-go; a WSLg verdict is provisional pending native-platform confirmation (mission open question).
6. **Sign-off**: operator declares satisfied (or lists remaining items → fix loop).

## Acceptance Criteria

- [x] Operator has exercised every step above; all reported issues fixed and re-verified, or explicitly accepted with disposition recorded in the flight log
- [x] Three bookmarks behavior specs pass (or land with operator-accepted known-issue dispositions recorded alongside run-log paths)
- [~] Affected existing specs: DEFERRED by operator decision to a follow-up verification session (leg-3 edited their text; no code contradiction known). The three NEW bookmarks specs graduated draft→active on their passing runs.
- [x] Drag-spike operator verdicts recorded in the flight log (feeds Flight 2)
- [x] Operator sign-off recorded (2026-07-30: "we can land the flight now")

---

## Post-Completion Checklist

- [x] Flight log updated (HAT findings, fix commits, spec run-log references, drag verdicts, sign-off)
- [x] Leg status → completed; checked off in flight.md
- [x] Flight status → landed; flight checked off in mission.md; PR marked ready for review
- [x] `[COMPLETE:flight]`
