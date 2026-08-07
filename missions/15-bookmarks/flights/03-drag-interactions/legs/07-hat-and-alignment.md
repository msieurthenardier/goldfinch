# Leg: hat-and-alignment

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Operator-verify the flight's rendered behaviour and the claims no automated instrument in this repo can reach, fixing what surfaces.

## Context

Six legs landed and passed a flight-end code review with zero findings (commit `4bdd9f6`). What remains is precisely what the suite structurally cannot judge.

**This repo has no jsdom/happy-dom harness** — every layout number in a renderer unit test is asserted by the test author, not derived by a layout engine (Flight 2 debrief). So *where things visually land* is unverified by construction, not by omission.

Three items also carry forward from earlier legs because only a human can settle them:

- **DD1e** — `vaultInput.value` is cleared on **open**, not close (`menu-overlay.js:618` and `:668`), so a typed master password may survive in the property after a vault sheet closes. Expected safe for both admitted read ops; expected is not measured.
- **DD1c** — `captureWindow` must omit the sheet layer under a live `vault-unlock`.
- **leg 4's `dropEffect`** — shipped without setting it in the guest's `dragover`. Session 3's sheet probe recorded 2 drops with `preventDefault()` alone, so this is a *confirm*, not an expected failure — but `tab-controller.js:499` calls it MANDATORY for the tab drag, and only a physical gesture settles which applies.

## Verification Steps

Run one at a time; the Flight Director presents, the operator performs and reports.

| # | Step | What it settles |
|---|---|---|
| 1 | Drag a bookmark to a new position in the bar; watch the indicator, then release | Leg 3 end to end; **does it land where the indicator drew** |
| 2 | Restart the app; re-check the bar | Order + icons persist across a reorder path never exercised before |
| 3 | Drag a bookmark onto an ordinary web page | Leg 4; **and the `dropEffect` question** |
| 4 | Drag a bookmark onto a page with its own drop zone | DD5 page-wins, live |
| 5 | Drag a bookmark toward the chevron and hover | Leg 5a spring-loading |
| 6 | Continue into the overflow panel; watch the indicator; release | Leg 5a drop position, and the **ruled semantics** |
| 7 | Judge what happened to the bar | **Boundary displacement** — correct, but will read as surprising |
| 8 | Drag an overflow row out onto the bar | Leg 5b, the direction that never existed before |
| 9 | Open a vault sheet, close it, then read the sheet under an admitted menuType | **DD1e** residue |
| 10 | `captureWindow` with a live `vault-unlock` on screen | **DD1c** |

## Acceptance Criteria

- [ ] Each step above performed by the operator and its result recorded in the flight log
- [ ] Failures diagnosed and fixed inline; the failing step re-verified before moving on
- [ ] Fix-vs-feature gate honoured: a mid-HAT request that adds **new behaviour** is promoted to a scoped design review, not ridden inline. Multi-surface "cosmetic" fixes take a lightweight review pass first
- [ ] Mission criterion 6 checked off **only if** it is genuinely met — it is behavior-test-backed by the mission's own wording, so note the `bookmarks-drag` spec's status rather than silently substituting HAT for it
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green after any fixes

## Notes

**The `bookmarks-drag` behavior spec needs amending before it can run.** It was drafted at flight planning against an interaction that has since changed materially — spring-loading, the ruled drop semantics, the sheet indicator, and the withdrawn-then-reinstated axis-(b) verdict. Amending it is real work, not a checkbox, and it is deliberately *not* folded into this leg.

---

## Post-Completion Checklist

- [ ] All steps verified
- [ ] Flight log updated with the HAT record
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Commit code + artifacts (this leg commits; the flight's batched commit already landed)
