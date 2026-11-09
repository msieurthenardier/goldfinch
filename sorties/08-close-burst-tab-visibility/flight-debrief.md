# Flight Debrief: Close-Burst Tab Visibility

**Date**: 2026-11-08
**Flight**: [Close-Burst Tab Visibility](flight.md) (Sortie 08, standalone)
**Status**: landed
**Duration**: 2026-11-08 (operator report, charter, design, execution, HAT sign-off; PR #285 ready) — single day
**Legs Completed**: 2 of 2 (`pointer-close-activation`, `hat-and-alignment`)
**Plugin version**: mission-control 1.2.3

## Outcome Assessment

### Objectives Achieved
Every pointer close (✕ click or middle-click) now ends with the tab under the cursor active — one activation per close, no hover switching, every other close path unchanged (`closeTab(id, { pointer })`, `tabIdAtPoint`, `tab-controller.js`). The HAT surfaced two squeezed-strip defects that broke the click-click-click run, both fixed inline and reviewed: the sliding-in neighbour now takes the closed tab's frozen width (DD9), and the tab ✕ is right-aligned at every width (`.tab .tab-close { margin-left: auto }`, source-scan pinned). Operator sign-off at H7.

### Charter Criteria (sortie — this debrief stands in for a mission debrief)

| Criterion | Status | Notes |
|---|---|---|
| After every ✕/middle-click close, the tab under the cursor becomes active (page, highlight, address bar match), one switch per close | met | Unit-pinned (exactly one `tabSetActive`, `tabClose` first); live smoke (leg 01); HAT H1/H2/H4/H5. In squeezed strips this only held after DD9 + the right-aligned ✕ (HAT fixes). |
| Moving the mouse along the strip never changes the active tab | met | Grep-AC (no hover-family listener) + HAT H3 by eye. |
| No tab under the cursor → active tab chosen exactly as today | met | Unit cases 5/10/11; HAT H4 (pill/gap branch). |
| Existing close behavior otherwise unchanged (mid-strip freeze, #97, keyboard/menu/automation) | met, with one amendment | Keyboard close unchanged (H6). The width freeze was deliberately amended at HAT (DD9, operator-approved): the right neighbour inherits the closed tab's width. #97 carve-out unchanged. |

### Checkpoints
- [x] Unit tests / typecheck / lint / format:check green (npm test 6348: 6344 pass, 0 fail, 4 todo)
- [x] Live smoke exercised every apparatus primitive (leg 01)
- [ ] `pointer-close-shows-tab` run + `tab-reorder` Step 9 run — **deferred** (operator ruling): the MCP apparatus releases the freeze on every view swap unless the real pointer is parked over the strip (see Key Learnings). Spec stays `draft` with that precondition.
- [x] HAT H1–H7 passed (operator)

## What Went Well
- **Fast, contained delivery.** Report → charter → design → two legs → sign-off in one day; renderer-only, `renderer.js` untouched (1504/1505), seam unchanged, no main-side or IPC change. The DD6 scope fence held exactly.
- **The charter interview did its job twice.** The operator narrowed hover-to-activate to close-only activation during design ("it should really only show the adjacent tab"), deleting a whole burst-lifecycle state machine (timers, leave/blur handling) before any code — the issue-#97 class of wedge never had a place to live.
- **Design reviews were cheap and precise.** The flight Architect confirmed `clickCount: 1` on MCP clicks (the `e.detail > 0` guard is live under automation), traced main's `tab-close` (no conflicting activation), and caught a vacuous spec step; the leg design review caught `.parent` vs `parentNode`, `closest` on event targets, and the missing #97/single-tab unit cases.
- **Listener-driven unit tests.** Driving the real `click`/`auxclick` listeners with hand-built events (not `FakeElement.click()`, which passes no event) made the `detail`, coordinate and button-filter logic genuinely tested; the reviewer confirmed every new assertion fails on revert.
- **HAT found what nothing else could, and was cheap to iterate.** Distinct-color fixture pages (served from the scratchpad, opened over admin MCP) made "which page is shown" unambiguous; an MCP repro + a capture-phase event logger on `#tabs` turned "it's awkward" into measured geometry within minutes.

## What Could Be Improved

### Process
- **Geometry premise not measured before HAT.** DD2 recorded the active-floor interaction as a "minor, pathological-count" trade-off — analysed by reasoning, against a stale number (64px; the real floor is 78px), and without noticing that "under the cursor" equals "the adjacent tab" only when widths are uniform. That hidden second claim conflicted with the operator's own ruling. The operator's view (asked at debrief): "HAT caught it; fine" — the HAT is the acceptance net for rendered geometry here, and the cost (two inline fixes, two Developer + Reviewer cycles, two app restarts) was accepted. Recorded as a learning, not a process change.
- **HAT step wording.** "Middle-click the body" was read as "click the middle of the tab". Say "middle mouse button (wheel click)".
- **Live smoke on a noisy profile.** The leg 01 smoke ran on 18 tabs, many restored heavy dev-profile pages (capture timeouts), with uniform widths — so it could not hit the 57–77px band. Clean fixture strips at several tab counts would have exercised more.

### Technical
- `closeTab` now has two modes (pointer opt-in at two sites). A future close path must choose deliberately; no guard enforces it beyond the CLAUDE.md bullet and AC6-style greps.
- The close-run contract now spans `freezeTabWidths(closingId)` (DD9), the `.tab.active` 78px floor, the `@container` stages and the ✕ alignment rule, across `tab-controller.js` and `styles.css`, with no single testable geometry model; unit tests use static fake rects. A future tab-sizing change can silently break the run — a geometry-dependent AC must be checked live.
- Accepted limitations (operator, debrief: "leave as is"): the first tab in a run grows to the 78px floor (tabs to its right shift once); narrow background tabs (≤56px) show no ✕, so a run there starts with a middle-click or by activating a tab.
- **Test metrics**: 6348 tests / 26 suites, 6344 pass, 0 fail, 0 skipped, 4 todo (the known `[known-unsolved]` save-moment corpus cases), runner 8.16 s (wall 8.4 s), no flakes on the run. This flight added ~15 tests in files that run in ~0.1 s combined; the +1.7 s over sortie 07 (6.5 s) tracks `vault-compromise-rotate` (3.07 s vs 2.36 s, untouched) — host noise, the same pattern sortie 03 saw (7.94 s → 6.43 s). Re-measure on a quiet host before calling a new band. The sortie-06 real-timer leak stays fixed (`save-prompt-manager` 0.08 s).

### Documentation
- The apparatus fact (below) is recorded in the flight log and the spec precondition, but not yet in CLAUDE.md's standing unobservable-surfaces list or `docs/dev-testing.md`.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Charter narrowed during design (hover switching dropped; every pointer close participates) | Operator rulings once the #97 and dwell questions surfaced | Yes — keep the sortie charter amendable in design with the change logged |
| DD9 added at HAT, amending the "freeze unchanged" constraint | Neighbour frozen at its own (narrower) width didn't reach the cursor; the point resolved the tab after it | No (specific) — but see Key Learnings on geometry premises |
| `.tab-close` right-aligned at HAT | ✕ offset varied with content in the 57–77px band | No |
| Behavior-spec run deferred | MCP pointer/leave apparatus limit | Yes — hover/leave-dependent spec rows need the parked-pointer precondition or a direct freeze-state read |
| Squawks 0177/0178 logged rather than fixed | Out of charter (keyboard close; default-menu accelerator) | Yes (standard out-of-scope rule) |

## Key Learnings
- **"Under the cursor" is a geometry claim.** Any AC of the form "X lands under the pointer" must be checked against rendered rects at the widths where elements differ (active floor vs background tabs, title-hidden band, favicon present/absent), not only at the default comfortable width. H1 passed on equal-width tabs and masked both defects.
- **Apparatus fact — MCP clicks don't move the real pointer.** `click` (`sendInputEvent`) synthesizes events without moving the OS cursor. When `tab-set-active` swaps the guest view, WSLg/Wayland re-delivers leave/enter at the REAL pointer position (logged: `click@354,23`, then `mouseleave@862,682` ~16 ms later), so `#tabstrip` `mouseleave` releases the DD5 freeze. Pre-existing for active-tab pointer closes; since sortie 08 every pointer close swaps views, so every automated pointer close is affected. Consequences: hover/leave-dependent spec rows can false-fail OR false-pass under MCP. Mitigations: park the real pointer over the target element (operator), or assert the freeze directly via chrome `evaluate` of the remaining tabs' `style.flex` rather than relying on pointer state.
- **Dev-launch shutdown gotcha.** `pkill -f scripts/dev-launch.mjs` also matches the invoking shell's own command line (exit 144); kill the Electron main PID directly.
- **Reusable pattern**: close-time resolution via `elementFromPoint` → `closest('.tab')` → `tabs.has` check, fail-closed to the old path; and source-scan CSS pins for layout invariants (`tab-close-css-pin.test.js`).

## Methodology Observations
- **Flight design review accepted a geometry trade-off by reasoning, not measurement** (`/mission-control:sortie` → flight Phase 5b Architect review; plugin 1.2.3). The review prompt asks for scenario traces "with probes (grep, node -e), not reasoning", but layout-dependent premises can't be probed that way; the Architect classed the active-floor interaction as a minor pathological-count trade-off, and the FD accepted it into DD2. Expected: a premise touching the core scenario is measured (here: live rects at several tab counts) or explicitly deferred to HAT as an open premise rather than recorded as "accepted". Cost: two DD-level fixes found at HAT (DD9, the ✕ alignment), two extra Developer+Reviewer cycles, two app restarts. The operator judged the HAT catch acceptable, so this is one data point, not a verdict.
- **Agentic-workflow commits before the HAT leg** (`/mission-control:agentic-workflow` Phase 2d then 2b HAT; plugin 1.2.3). Leg 01 was reviewed, committed and PR'd before the HAT, so the HAT's two fixes landed in a separate commit with their own inline reviews. Worked fine here; recorded only because the "single review + commit at flight end" framing doesn't describe flights whose HAT changes code.
- **Sortie charter gate vs design-time amendment** (`/mission-control:sortie` Phase 2 → Phase 4; plugin 1.2.3). The charter was explicitly agreed, then amended during flight design (crew interview) and again at HAT. The skill has no named step for a post-agreement charter amendment; the FD logged each in the flight log and annotated the charter. No cost observed; noting that the "agreed before design" gate is in practice "agreed, then refined by design".

## Recommendations
1. **Document the MCP pointer apparatus fact where spec authors look**: add a line to CLAUDE.md's standing unobservable-surfaces list (hover/leave-dependent state under MCP `click` → parked real pointer, a direct `style.flex`/state read, or `[by-eye]`), plus a "trace pointer events on an element" `evaluate` recipe in `docs/dev-testing.md`. (Squawk candidate.)
2. **Run `pointer-close-shows-tab` and `tab-reorder` Step 9 once** with the operator's pointer parked over the strip, then promote the spec to `active` — or re-author its freeze rows to assert `style.flex` directly so they don't depend on pointer state.
3. **Complete squawks 0177 and 0178 together** (same close path; 0177 must keep the sortie-08 pointer branch intact and reconcile the duplicate fallback in `tab-moved-away`; 0178 needs a by-hand repro first and may escalate to a sortie if the fix is an application menu).
4. **For future tab-strip layout work, verify geometry premises live at band edges** (default, 57–77px, ≤56px; with/without favicon; active vs background) before locking DDs that claim "under the cursor".

## Action Items
- [ ] Debrief action (operator: keep here, not a squawk): document the MCP real-pointer / view-swap `mouseleave` apparatus fact (CLAUDE.md unobservable-surfaces list + `docs/dev-testing.md` pointer-trace recipe)
- [ ] Run `pointer-close-shows-tab` (parked pointer) and promote to `active`; run re-authored `tab-reorder` Step 9
- [ ] Squawks 0177 + 0178 (open) — next turnaround
- [ ] Re-measure `npm test` wall-clock on a quiet host
