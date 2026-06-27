# Leg: hat-and-alignment

**Status**: ready
**Flight**: [Conveniences & Event-Seam Re-architecture](../flight.md)
**Type**: interactive HAT *(optional — operator opted in; DD5)*

## Objective

A guided, on-screen human acceptance pass closing the flight: confirm the find bar, menu freeze/restore
on web *and* internal tabs, panel-resizes-guest, and geometry on resize/maximize all behave correctly on
the live surface; fix any issues inline; re-check the two carried WSLg known issues.

## Type

**Interactive leg** — no autonomous agents. The Flight Director guides the operator through each
verification step one at a time, waits for the operator to perform it and report, fixes issues inline
(spawning a Developer only if code changes are needed), re-verifies the step, then proceeds.

## Prerequisites

- App running (`npm run dev:automation` or a normal `npm start` — the HAT is human-driven on screen).
- Leg 4 behavior corpus complete (the HAT confirms on-screen what the Witnessed runs asserted via the
  apparatus).

## Verification steps (guided, one at a time)

1. **Find bar (web tab).** Open a content-rich web page; `Ctrl+F`; type a term with several matches.
   Expect: the bar renders above the guest, the live count updates, ↑/↓ step the active match, `Esc`
   closes and clears. (Confirms the find bar — untouched by Leg 1, but the SC4 human counterpart.)
2. **Menu freeze/restore on a WEB tab.** Open the kebab (⋮) and the container (▾) menus over the web
   guest. Expect: the menu renders above a frozen still; on dismiss the live guest restores at correct
   bounds (scroll to confirm it's live, not the still). Watch for the carried WSLg menu-open blip —
   record, don't fail, if it's a sub-frame blip on an otherwise-correct cycle.
3. **Menu freeze/restore on an INTERNAL tab.** Switch to `goldfinch://settings` (kebab → Settings) and
   to `goldfinch://downloads` (kebab → Downloads). Open the kebab/container menus while on each internal
   tab. Expect: menus render **above** the frozen still (the F3 occlusion regression class — now fixed);
   restore correct. (Exercises the Leg-2 uniform active-view tracking on internal tabs.)
4. **Switch internal → brand-new tab (Leg-2 behavior delta).** While on an internal tab, open a new
   tab. Expect: no flash/black-band of the outgoing internal view during the switch (the not-ready
   window now hides it uniformly).
5. **Panel-resizes-guest.** Open/close the media panel and the privacy panel on a web tab AND on an
   internal tab. Expect: the active view reflows to the region beside the panel — no overlap, gap, or
   clipping — and restores on close.
6. **Geometry on resize/maximize.** Resize the window and toggle maximize/restore. Expect: the active
   view tracks the slot; re-check the carried **maximize ~2/3-screen** WSLg known issue — record its
   current state.

## Acceptance Criteria

- [ ] All six steps pass on screen (or carry an operator-accepted WSLg-class known issue with
  disposition recorded).
- [ ] The two carried WSLg known issues (internal-tab menu-open blip; maximize ~2/3 screen) re-checked
  and their current state recorded in the flight log.
- [ ] Any issue found during the HAT fixed inline and re-verified, or recorded as an accepted known
  issue.

## Notes

- macOS remains unverified (DD6 / carry-forward DD9) — the macOS landing gate is Flight 6.
- Inline fixes that touch code go through a Developer spawn + re-verify, then fold into the flight's
  final commit.

---

## Post-Completion Checklist

- [ ] All steps verified (or dispositioned)
- [ ] Two carried WSLg known issues re-checked + recorded
- [ ] Update flight-log.md with the HAT outcome
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] If final leg: flight → `landed`, merge flight branch → mission branch (local), check off flight in
  mission.md
