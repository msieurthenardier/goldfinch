# Leg: hat-and-verification

**Status**: in-flight
**Flight**: [Jar-Scoped Bookmarks](../flight.md)

## Objective

Operator-guided acceptance of the jar-scoped bookmark behavior with inline fixes, plus the full behavior-spec verification round — the flight's live half, which offline tests structurally cannot carry.

## Context

- Interactive leg — the Flight Director guides; the operator performs. No autonomous implementation cycle. Fixes found here ride the inline HAT protocol (look-and-feel FIXES inline, with a lightweight design-review pass first if a fix spans more than one surface; anything adding new behavior is a FEATURE and gets promoted to a scoped design review — FD calls the line out loud).
- Legs 1–3 are committed (`0ff2c34`, draft PR #148); flight-end review returned zero findings. The suite is green at 3335 — everything below is about the running app.
- Apparatus constraints (inherited, unchanged): the overlay sheet refuses ALL automation at every tier — every sheet interaction is operator-performed; no window-create or hover primitives; animation-absence and stale-frame-absence clauses are operator-observed live.

## Verification Steps

**Environment first** (operator):
1. Launch: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`; agent confirms admin tier via `getChromeTarget` (not mere tab enumeration). `sqlite3` available on the host. Fixtures: two persistent jars (`personal`, `work`), one disposable jar, bar enabled in Settings.

**HAT walkthrough** (one step at a time, FD-guided):
2. Jar swap: bar + star swap contents on tab switches between jars — operator confirms no stale frame and instant reflow.
3. Burner + internal suppression: bar/star absent, `Ctrl+D` inert, page-context item absent; both reflow classes instant, no animation (the flight's flagged "is that a bug?" moment — reflow on every Settings trip is the accepted cost of the operator's suppression rulings; fallback to empty-bar treatment is a recorded diversion if rejected).
4. Jars-page placement sanity-check (L2-DD-E): "Clear bookmarks" sits in the History panel beside "Clear history" — confirm placement reads coherently; confirm dialog copy and success toast are real strings.
5. Popover TOCTOU (L3-DD-E corrected vector): open the star popover in window A, **delete that jar** from the jars page in window B, submit the edit — expect a loud rejection toast, no wrong-jar write.
6. Edit-rejection feedback (DD12a): rename a bookmark to a URL already bookmarked in the same jar — expect the duplicate-url toast, not a silent revert.
7. Suggestions star sizing (DD12b): visual check at row height.

**Behavior-spec round** (via `/behavior-test`, run logs committed):
8. `bookmarks-jar-scoping` (new, 17 steps — graduates `draft` → `active` on first pass).
9. Amended three: `bookmarks-bar` (retargeted checkpoint 12 — the sqlite3 row-injection act-axis is the hard half), `bookmarks-omnibox` (inverted checkpoint 4; **resolve the flagged steps-5/6 drift inline** — they reference a suggestion row the inversion removed), `bookmarks-star-sync` (same-jar checkpoint 9).
10. Adjacent three: `sqlite-store-migration`, `jar-data-controls`, `jar-data-surfaces` — re-run, amend if the fifth data class / schema v3 shifted their prose.
11. Six deferred from Flight 1 landing: `page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay` — closes that open item.

## Acceptance Criteria

- [ ] HAT steps 2–7 accepted by the operator (or divergences dispositioned in the flight log)
- [ ] All specs in steps 8–11 pass, or land with operator-accepted known-issue dispositions recorded beside their run-log paths
- [ ] `bookmarks-omnibox` steps-5/6 drift resolved
- [ ] Flight log carries the full HAT record; suite still green after any inline fixes

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md; flight to `landed`; check off flight in mission.md
- [ ] Commit artifacts (+ any inline fixes, each in its own commit per the behavior-test no-amend rule); mark PR #148 ready for review
