# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Guided human acceptance test: the **operator is the ground-truth oracle** for observation
*faithfulness* — the screenshot shows the real page (incl. whole-window chrome+guest), the DOM/a11y
reads match the visible controls, and a backgrounded tab is correctly foregrounded (non-blank). Run the
**primary live conflict test** (DevTools open → clean a11y refusal, DD8), and tune output shape /
ergonomics with the operator.

## Context

- **Why a HAT, not more units.** Unit tests prove orchestration; the smoke (Leg 5) proves the ops
  return live data via machine reads. Only a human can confirm the screenshot/DOM/a11y actually
  *correspond to what's on screen* (faithfulness) and judge whether the raw output shape is usable.
- **DD8 primary live conflict test.** Opening **DevTools** on a tab is the reliable second-CDP-client
  trigger: an in-process `readAxTree` on that contents must then **return the
  `{automation:'debugger-unavailable',…}` refusal** — cleanly, no crash/hang. This is the
  authoritative live verification of the refusal path (the Leg-5 cdp-driver attempt is only
  opportunistic — the slots may not contend).
- **Alignment.** Per the mission, raw output is the v1 choice (DD4); this HAT is where the operator
  eyeballs whether the raw a11y array / DOM string are workable for an agent or whether a Flight-9
  projection is worth prioritizing — recorded, not built here.
- Interactive leg: **no autonomous agent execution.** The FD presents one step; the operator performs
  it and reports; the FD fixes inline (spawning a Developer if code changes are needed) and re-verifies
  before moving on.

## Inputs
- Leg 5 smoke passed (ops return live data); `npm run dev:debug` running with the GUI visible.
- `scripts/cdp-driver.mjs eval` apparatus + `window.goldfinch.automationDevInvoke`.
- The operator at the live browser.

## Acceptance Criteria
- [ ] **Faithfulness — screenshot**: a `captureScreenshot(guestWcId)` PNG, viewed by the operator,
  shows the **actual** foregrounded page content (not blank, not a stale/other tab).
- [ ] **Faithfulness — whole window**: a `captureWindow()` PNG shows the real window — chrome (tab strip
  / toolbar) **and** the composited guest.
- [ ] **Faithfulness — DOM**: `readDom(guestWcId).html`/`title` correspond to the controls/text the
  operator sees on the page.
- [ ] **Faithfulness — a11y**: `readAxTree(guestWcId)` nodes correspond to the visible roles/names the
  operator can point to (spot-check a few landmark/control nodes). [a11y]
- [ ] **Foreground correctness**: starting from a **backgrounded** target tab, an observe op brings it
  to front and returns a non-blank/faithful result (the foreground-to-act contract, visibly).
- [ ] **DD8 primary live conflict**: operator opens **DevTools** on a tab; a subsequent
  `readAxTree` on that tab **returns** `{automation:'debugger-unavailable', reason:'attach-failed', …}`
  — cleanly, no crash, no hang. Closing DevTools and re-reading succeeds again.
- [ ] **Alignment recorded**: operator's read on output-shape ergonomics (raw a11y/DOM usable? is a
  Flight-9 projection a priority?) captured in the flight log — **not** built here.
- [ ] Any issue the operator surfaces is fixed inline (Developer if code) and re-verified before the
  leg lands.

## Verification Steps (operator-guided, one at a time)
1. With `dev:debug` running and a guest navigated to a known page, FD requests
   `captureScreenshot(<guestWcId>)`; operator views the PNG → confirms it matches the page.
2. `captureWindow()`; operator confirms chrome + guest both present.
3. `readDom(<guestWcId>)`; operator confirms url/title/markup match.
4. `readAxTree(<guestWcId>)`; operator spot-checks a few nodes against visible controls.
5. Background the target tab (switch to another), then re-run an observe op on the original `wcId`;
   operator confirms it foregrounds and the result is non-blank/faithful.
6. **DevTools conflict**: operator opens DevTools (F12 / menu) on the target tab; FD requests
   `readAxTree(<thatWcId>)`; operator confirms a clean `debugger-unavailable` refusal (no crash/hang).
   Operator closes DevTools; FD re-requests `readAxTree`; confirms it succeeds again.
7. **Alignment chat**: operator comments on output-shape usability; FD records it.

## Edge Cases
- **Screenshot faithful but slightly stale** (paint-settle too short) → tune `{delayMs}`; if structural,
  Divert (render-strategy question). Re-verify.
- **DevTools refusal not clean** (crash/hang/leak) → blocking; fix the `readAxTree` lifecycle and
  re-verify (the whole point of DD7/DD8).
- **Operator finds raw output unusable** → record as a Flight-9 alignment input; do **not** build a
  projection in this flight (DD4 — raw is the v1 choice).

## Files Affected
- None expected (HAT) — unless the operator surfaces a fix, which is a new commit + its tests.

---

## Post-Completion Checklist
- [ ] All faithfulness ACs confirmed by the operator
- [ ] DD8 DevTools clean-refusal confirmed live (open → refuse, close → succeed)
- [ ] Alignment notes captured in the flight log
- [ ] Any inline fix committed (new commit) + draft PR updated
- [ ] Set this leg's status to `completed` and check it off in flight.md
- [ ] **Final leg** → update flight.md status to `landed`, check off the flight in mission.md
