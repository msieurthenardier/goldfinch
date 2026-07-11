# Leg: hat-jar-data-controls

**Status**: completed
**Flight**: [Per-Jar Data Controls](../flight.md)

## Objective

Operator acceptance of the page-DOM half of the flight (DD9's HAT-owned
remainder): the settings-style relayout, instant-apply editing under the uniform
focus rule, the confirm-everything data controls with visible wipe-reload, the
read-only Burner section — plus the two F3 carry-forward paths with zero live
witness (`reconcileUi` cross-surface race; create/confirm Escape paths) and the
flight review's two presentation questions (CP5).

## Context

- The Flight Director guides; the operator performs and judges. Fixes happen
  inline (Developer agent spawned if code changes are needed), then the step
  re-verifies. **Mini-leg promotion gate in force (F3 debrief Rec 1)**: an
  operator-specced FEATURE arising mid-HAT is promoted to a scoped design review
  before implementation — only look-and-feel FIXES ride the inline protocol. The
  fix-vs-feature line is the FD's call, made out loud.
- Machine gates already green: suite 1269/1269 + two behavior runs (7/7 new spec,
  5/5 regression re-run) on committed baselines `13c6329` + `8fcd43c`.
- Safety: the HAT runs on the operator's own dev profile. Destructive actions
  (delete, wipe, clears) are exercised ONLY against jars created during the HAT
  ("HatOne", "HatTwo") — never against the operator's real jars.
- The jars page deliberately has NO open-dedupe (F3 `openDownloads` parity) — two
  jars-page tabs can be open at once, which is exactly how the cross-surface race
  is exercised live (step 6).

## Guided Steps (operator performs; FD tracks pass/fail per step)

1. **Layout + entry points.** Launch your dev build (normal profile). Open the
   jars page from the kebab ("Cookie jars") and confirm the picker's "Manage
   jars…" route works too. Verify: left nav lists every jar (color dot + name +
   Default marker) plus Burner and the "+ New jar" button; right side shows one
   always-expanded section per jar (header dot/name/Default pill, name input,
   swatch grid, Make default on non-holders, data-controls row, delete); the
   description paragraph sits under the title; the Burner section is read-only
   (hint text, no controls); clicking nav links scrolls to sections and the
   in-view section highlights in the nav (scroll-spy).
2. **Create from the sidebar.** "+ New jar" opens the create panel (focus lands
   in the name field). Create "HatOne" with a non-default swatch. Verify it
   appears live: new nav entry, new section, picker entry — no reload. Then
   create "HatTwo" (any color).
3. **Instant-apply editing.** In HatOne's section: type a new name and press
   Enter → commits (nav, section header, picker all update live). Rename again
   and just click elsewhere (blur) → commits. Type whitespace-only → blur →
   reverts, no commit. Type something, press Escape while still in the field →
   reverts and blurs (nothing else closes). Click a different swatch → recolors
   instantly everywhere (dot, nav, picker). END the sequence by renaming the jar
   back to "HatOne" (later steps refer to it by that label).
4. **Focus preservation (DD6's hard requirement).** Click into HatOne's name
   field and leave the caret mid-text. Without leaving the page, use the tab
   strip's container picker's "New Jar" row to quick-create a jar ("HatRace") —
   note this also opens a new tab in that jar (expected side effect); a
   broadcast re-render hits the open page. Verify: your caret/focus in HatOne's
   field survived untouched, and the new jar appeared in nav + sections. Repeat
   with the create panel open and text typed (name the second jar "HatRace2" —
   it gets cleaned up in step 7); the panel and its typed text must survive the
   broadcast.
5. **Data controls, confirm-everything.** In HatOne: click "Clear cookies" → a
   confirm appears below the button row (focus lands on its Confirm button);
   Cancel works; re-open and Confirm → success note appears in the section
   (NOT red). With the cookies confirm open, click "New identity" on the SAME
   jar → the confirm SWAPS to the wipe copy. Escape dismisses it. Also weigh
   the flight review's two presentation questions: (a) a success note from an
   action you swapped away from still paints the shared status line — keep or
   change? (b) an action that FAILS after you swapped away is silent by spec —
   acceptable?
6. **Wipe reloads the jar's tabs + cross-surface race.** Open two web tabs in
   HatTwo (any sites). On the jars page, wipe HatTwo (confirm) → both HatTwo
   tabs visibly reload; other tabs untouched. Then the race: open the jars page
   in a SECOND tab; in page A open HatRace's delete confirm; in page B delete
   HatRace → page A's confirm collapses silently (no error, no stale editor).
   **REQUIRED (verifies a pre-HAT fix)**: focus HatOne's name in page A
   (don't type), rename HatOne from page B, then blur page A's input → it must
   sync to page B's new name, NOT commit the stale one back (the design review
   caught `commitOrRevertName` doing exactly that; fixed pre-HAT with a dirty
   flag — this step is the fix's live witness). Rename back to "HatOne" after.
7. **Delete + presentation sweep.** Delete ALL remaining HAT jars (HatOne,
   HatTwo, HatRace2, plus any quick-create leftovers) from their sections.
   Crib notes: deleting HatTwo also CLOSES its open tabs (the F3
   tabs-close-on-delete behavior — expected, not a bug); the delete control is
   currently a full-size "Delete jar…" text danger button (leg 2 left
   presentation operator-adjustable — sections have room, so judge whether it
   reads right); confirm copy is verbatim from F3. Confirm everything propagates
   (nav, picker). Final eyeball: anything about the new layout that reads wrong
   (spacing, scroll behavior, nav highlight)?

## Acceptance Criteria

- [ ] All guided steps operator-passed (fixes applied inline and re-verified
      where needed; any mid-HAT feature promoted per the gate)
- [ ] The two F3 zero-witness paths (reconcileUi race; create/confirm Escape)
      exercised live and passed
- [ ] The flight-review presentation questions answered (rulings recorded in the
      flight log)
- [ ] Operator sign-off recorded

## Verification Steps

Operator judgment per step, tracked in the flight log's HAT record.

## Citation Audit

Procedural/HAT leg. Behavioral premises verified at leg 4's runs (wipe-reload
chain live-proven; sweep filter). Page premises verified by the flight review
against `13c6329`. The no-dedupe two-tab premise: `openJarsPage()` unconditionally
creates (F3 design; unchanged this flight — verified in the flight review's
delete-confirm regression diff). All OK.

---

## Post-Completion Checklist

- [ ] All steps passed and sign-off given
- [ ] Flight log HAT record complete (findings, rulings, fixes)
- [ ] Leg status `completed`; flight → `landed`; flight checked off in mission.md
- [ ] Final commit (HAT fixes + artifacts)
