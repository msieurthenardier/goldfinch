# Flight Debrief: Manage-Jars Page Panels

**Date**: 2026-07-13
**Flight**: [Manage-Jars Page Panels](flight.md)
**Status**: landed
**Duration**: 2026-07-12 (single-day flight)
**Legs Completed**: 3 of 3 (`panel-model-and-count-ipc`, `panels-relayout`, `verify-integration`)

## Outcome Assessment

### Objectives Achieved

Reorganized `goldfinch://jars` into per-data-class regions (History / Cookies /
Other site data) per jar, with per-region confirms, a live history visit count
(the first `history-changed` consumer + the new `history-count` IPC twin), hash
deep-links, and the pure `src/shared/jar-panel-model.js` taxonomy module. 8/8
live rendered-pixel probes passed on the real app with **zero product defects and
zero fix cycles**. `jars.js` grew 1,389 → 1,671 (+282), under the DD2 ~1,800-line
controller-split trigger.

> **Superseded-mechanism note.** The collapsible-disclosure *presentation* this
> flight shipped was replaced by a per-jar tab strip in Flight 06 (HAT finding H4).
> The assessment below is on this flight's own terms; the reversal is analyzed as a
> design-loop outcome, not a defect.

### Mission Criteria Advanced

- **"The manage-jars page presents each jar's data in collapsible panels with
  left-nav anchors; panels expand/collapse independently and anchors jump to the
  right jar/section"** — satisfied this flight (all 8 probes). Flight 06 later
  changed the presentation to a tab strip (one region visible at a time), which the
  operator accepted as the preferred shape via HAT; the underlying per-data-class
  organization and left-nav anchoring persist.
- Seeded the history-count surface (`history-count` twin, first `history-changed`
  consumer) reused unchanged by every later flight.

## What Went Well

- **Separating taxonomy from mechanism behind a pure model was the flight's best
  call.** `jar-panel-model.js` (deep-frozen `JAR_PANELS`, zero imports, fail-closed
  `panelForDataClass`) survived the Flight 06 presentation rewrite *byte-intact* —
  the tab strip still builds from `JAR_PANELS` and still routes clear-buttons via
  `panelForDataClass`. The part that got replaced was presentation; the part
  extracted as a durable model was structure. Textbook "abstract the stable axis."
- **The `history-count` IPC twin and its invalidation-signal subscription** carried
  forward unchanged (Flight 06 only moved the count from a button label to a tab
  badge, fed by the same two `fetchHistoryCount` writers). The re-query-never-trust-
  payload shape is the reference for future `*-changed` consumers.
- **The confirm machinery got cleaner, not just relocated:** four ad-hoc refs
  (`dataConfirmArea`/`dataConfirmOpenKey`/`deleteArea`/`deleteConfirmOpen`) collapsed
  into a uniform per-region map keyed on `(action, rowId)`, and delete folded into
  `DATA_ACTIONS` as a normal `silentSuccess` entry — a bespoke code path removed.
- **A single front-loaded Architect review bought a zero-defect implementation** by
  catching the "single confirm area vs. renders-inside-the-owning-panel"
  contradiction and the missing count initial-fetch path before any code was written.
- **The double-hyphen composite id (`jar-<id>--<panel>`)** — a genuinely non-obvious
  collision-avoidance pin (a `slug()`-minted id ending in a panel token can't collide
  because `slug()` never emits `--`). Flight 06 explicitly preserved it.

## What Could Be Improved

### Process

- **Default-collapsed-everything (DD4) was the losing assumption.** HAT found
  operators wanted one always-visible primary region per jar (tabs, History
  default-selected), not all-collapsed. Future "long list of jars/items" surfaces
  should treat *default-visible-primary-content* as the more likely operator
  preference than *default-collapsed*.

### Technical

- **No committed behavioral regression net for a large stateful internal-page
  controller.** By design (M06 F4 DD9, internal session excluded from the
  a11y/behavior harness) the entire relayout — toggle handler, per-region confirm
  diff, count wiring, hash deep-link, focus preservation — is verified only by
  typecheck + the script-tag contract test + lint, plus leg-3 live probes whose
  evidence lives uncommitted in `/tmp`. A subtle regression (e.g. `render()` touching
  `panelOpen`) would pass every gate. Flight 06 mooted this for *panels* by replacing
  the block, but the *pattern* — a growing stateful controller with no committed
  behavioral net — persists into the tab implementation.
- **Pair the line-count trigger with an "extract testable pure logic" trigger.** The
  DD2 ~1,800-line instinct is right; predicates like `regionForAction` and the
  toggle-decision logic could be pure-extracted and unit-pinned without a DOM.

### Documentation

- The CLAUDE.md paragraph this flight landed (panel structure + double-hyphen scheme
  + count invariant) is now **stale post-Flight-06** (it describes panels, not tabs).
  The mission debrief should confirm Flight 06 refreshed it.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `buildDataControlsBlock` → generic `buildRegionControls` | Design-review-authorized builder reshape, fenced off from the DD2 controller split | No (one-off); yes to fencing builder reshapes away from the split trigger |
| Probe-7 apparatus: `tabNavigate` evaluate instead of the `navigate` MCP tool | The `navigate` tool refuses `goldfinch://` by design (`isSafeTabUrl`) | Yes — record as a reusable apparatus fact: admin MCP `navigate` can't target internal scheme |
| One redundant `.jar-panel scroll-margin-top` CSS rule left in | Duplicate of the section-level rule; deferred to HAT polish | No — was swept away when F06 replaced the CSS block |

## Key Learnings

- **Separate taxonomy from mechanism behind a pure model.** When a flight introduces
  a UI structure that groups domain concepts, extract the grouping as a pure,
  dependency-free, unit-tested model and let the DOM layer consume it. It is the
  reason a full presentation rewrite (F06) cost so little.
- **A named quantitative growth trigger that later fires on schedule is strong
  evidence of good forward design.** DD2's ~1,800-line trigger fired *exactly* at
  Flight 06 leg 3 (jars.js hit 1,827), and the pre-agreed extraction fallback ran
  cleanly instead of an in-the-moment judgment call.
- **When a mission explicitly schedules a HAT/vibe pass, treat mid-mission
  presentation mechanics as provisional** and resist deep investment (persistence,
  animation polish). This flight did exactly that — it routed panel-default/persist to
  HAT as open question R5 rather than over-building it — and was rewarded when H4
  superseded the whole mechanism. The reversal was foreseen as a possibility and
  pre-authorized as HAT territory; only its *direction* was unknown. That is the
  design loop working as intended.

## Recommendations

1. **Promote the taxonomy-behind-a-pure-model pattern** as standing guidance for any
   "reorganize a page" flight.
2. **Standardize named quantitative growth triggers** (concrete line/threshold + a
   pre-agreed extraction fallback) for controller/module growth.
3. **Consider a committed structural net for the jars-page controller family** — even
   a narrow eval-observable assertion (active-tab `aria-selected`, which *is* readable)
   would catch structural regressions the operator currently re-walks each flight.
4. **Document the double-hyphen composite-id and invalidation-signal-subscription
   idioms once** in a house-patterns note (both were re-derived at review).

## Action Items

- [ ] Confirm (in the mission debrief) that Flight 06 refreshed the now-stale
      CLAUDE.md jars-panel paragraph to describe tabs, not panels.
- [ ] Add a house-patterns note: double-hyphen composite ids + invalidation-signal
      subscription + the reusable `navigate`-refuses-`goldfinch://` apparatus fact.
- [ ] Evaluate a narrow committed structural assertion for the jars-page controller
      (active-tab state) to reduce per-flight HAT re-walking.
