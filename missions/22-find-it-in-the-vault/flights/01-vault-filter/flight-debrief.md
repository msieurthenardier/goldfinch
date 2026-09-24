# Flight Debrief: Vault Filter

**Date**: 2026-09-23
**Flight**: [Vault Filter](flight.md)
**Status**: landed
**Duration**: 2026-09-22 - 2026-09-23
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The unlocked `goldfinch://vault` page has one filter field, "Filter items", in the
"Vaults" section. Typing narrows every vault at once by a case-insensitive phrase
over non-secret metadata only.

- **Removal:** non-matching rows, emptied type subsections, and emptied vaults
  disappear.
- **Count:** a visible, screen-reader-announced line reads "N items match" or
  "No items match".
- **Clear:** an inline × control restores the page.
- **Access keys** hide while a query is active (the operator's H3 ruling).
- **Nav:** a nav click on a vault the filter hides clears the filter and jumps to
  that vault.
- **Reset:** any page refresh (save/delete/edit) or lock resets the filter.

The logic lives in a pure matcher (`vault-page-model.js`, `FILTER_FIELDS` pinned to
`vault-item-schema.js`'s `SCHEMA[type].nonSecret` by a drift guard) and a new
injected-deps controller (`vault-filter-controller.js`). `vault.js` gained wiring
only.

- PR #232, 3 commits.
- Behavior test `vault-filter`: 10/10.
- Operator HAT sign-off.

### Mission Criteria Advanced

This single flight carries all eight Mission 22 criteria:
- one field filtering every vault;
- non-matching items removed;
- non-secret-only matching;
- the clear control;
- the refresh reset;
- the lock reset;
- accessibility (AX roles and names verified live; speech check waived at HAT);
- built in the page's existing shape.

Criterion 1 was reworded at HAT to record the access-keys ruling.

## What Went Well

- **The security property is structural, not remembered.** The page never holds
  secrets, the matcher iterates a whitelist, and the drift guard fails the moment a
  non-secret field is added without the filter or a secret field sneaks in. The
  live test proved it end to end: a marker planted only in password, notes, note
  body, and identity email matched nothing.
- **Risk-tiered design review earned its keep.** Leg 1 was tiered high, and review
  caught the `hidden`-attribute collision with `renderUnknownItems` before any code
  existed (it became the `vault-filter-out` class). The flight-level Architect
  caught the unlocked-only gate that didn't exist yet and the late-vault ancestor
  semantics.
- **Hide-don't-rebuild plus register-on-load** handled the async per-vault loads
  cleanly. The `isConnected` stale guard replaced a planned generation token as
  redundant, a good simplification from review.
- **The policy was a one-line condition, not baked into the reconciliation.** When
  HAT overturned the access-keys rule, the change was one predicate in `apply()`
  plus tests. No rework of the mechanism was needed.
- **Mission scoping was tight.** The operator's early rulings (one page-wide field,
  "filter" not "search", no shortcut, no refresh survival) collapsed the riskiest
  design question (keeping focus and the query across `render()`'s full clear)
  before a flight was drafted.
- **Test metrics are steady.** 5682 tests (5678 pass, 0 fail, 0 skipped, 4 todo,
  all pre-existing) in 6.45 s wall-clock, inside Mission 21's 5.2–7.9 s band.
  +28 tests over Mission 21's close: 11 matcher/drift/status tests,
  17 controller tests. The new files run in about 50–60 ms each. No flakes.
- **Debrief recommendations became actions this time.** Two apparatus lessons
  (page-scoped `hasFocus`, the tag-the-node refresh check) landed directly in
  `.flightops/agent-crews/behavior-tests-execution.md` during the flight, and the
  incidental findings became squawks 0103 and 0104 instead of prose.

## What Could Be Improved

### Process

- **A cross-cutting mechanism needs an interaction check, not just its own
  states.** AC10 scoped `aria-live="off"` onto whole vault sections. Its unit
  tests pinned the attribute, but nothing checked the other feature sharing that
  live region, so Access-keys mint/revoke announcements went silent until the
  flight Reviewer reasoned it through (fix cycle 1). An AC that touches a shared
  mechanism (live regions, focus, the render cycle) should list its neighbors and
  assert on them.
- **The behavior-test record is behind the shipped behavior.** HAT H3 changed the
  access-keys rule after the only full `vault-filter` run, and spec steps 5–7 were
  re-authored but not re-run (operator decision: no re-run). This is low risk,
  because the unit tests plus the operator's live spot check cover it. The next run
  of the spec is the first to exercise H3.
- **The file lists missed an always-needed config touch.** Every new ESM page
  controller needs an `eslint.config.mjs` `sourceType: 'module'` entry, and the
  leg's Files Affected list didn't name it.

### Technical

- **The controller shapes are inconsistent.** `vault-filter-controller.js` takes
  its pure functions injected (like `vault-nav-controller.js` and
  `jars-section-controller.js`), which makes it unit-executable against a mock DOM.
  `vault-restore-controller.js` and `vault-browser-import-controller.js` import
  them statically and are only source-scan tested. Two of the three recent
  controllers now favor injection for testability, but CLAUDE.md states no
  preference.
- **`VAULT_PAGE_LINE_BUDGET` is now zero-slack (2153).** That's deliberate and
  pre-authorized, but it departs from this pin's buffer history. Every future
  vault-page line forces an extract-or-remeasure decision.
- **Dev-workflow friction.** Internal-page ES-module edits stayed stale across
  `location.reload()` in a running dev session, which forced a relaunch mid-HAT
  (squawk 0104).

### Documentation

- CLAUDE.md's "Vault page: controller decomposition" bullet was extended
  (`vault-filter-controller.js`, the drift-guard exemplar), but it should state the
  injected-deps preference for future controllers.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD1 hide via the `vault-filter-out` class (`display:none !important`) instead of the `hidden` attribute | `renderUnknownItems` already owns `hidden`, and `!important` beats `.vault-item-row{display:flex}` without per-selector overrides | Yes: a filter or visibility layer over DOM it doesn't own should use its own class |
| DD7 matcher injected into the controller instead of imported | Flat specifiers only resolve through the internal-page map, so an importing controller can't be executed in unit tests | Yes: prefer injected deps for page controllers |
| AC10 scope narrowed in fix cycle 1 (non-type-subsection children re-declare `polite`) | Section-wide `off` silenced Access-keys announcements | Yes: interaction-check cross-cutting mechanisms |
| Generation token dropped; `isConnected` alone | Every render builds fresh sections, so a stale read always targets a disconnected node | No (case-specific) |
| Access keys hide whenever a query is active (HAT H3), not only with a zero-match vault | Operator: access keys are confusing noise while filtering and nobody filters for them | No: an operator UX call |
| × moved inside the box (HAT H1) | Operator look-and-feel preference | No |
| "Home" seeded in Work instead of Personal (behavior test) | One identity per vault, and Personal already had one. Operator data was not modified | Yes: spec preconditions amended; inventory before seeding |
| Checkpoint 7 resolved by operator by-eye | `document.hasFocus()` false on the internal page under automation on WSLg | Yes: crew note landed; budget a by-eye round-trip for focus rows |
| Dev app relaunched mid-HAT | Stale internal-page module (squawk 0104) | No: fix the squawk |

## Key Learnings

- **Small operator-facing UX details are fine to settle at alignment.** The
  operator explicitly prefers this ("it's a small detail to reason about up front"),
  which overrides the Architect's suggestion to ask such questions at planning. What
  made that cheap here was the design: the policy was one predicate. So keep the
  mechanism/policy split, and mark such FD rulings as provisional in the leg.
- **`document.hasFocus()` false readings are page-scoped on this rig**, not only
  on the chrome document. `activeElement` and AX `focused` stay trustworthy, but the
  rendered ring doesn't paint. A focus-asserting row costs one operator by-eye
  confirmation.
- **The tag-the-node check** (set a throwaway `data-*`, act, check that it's gone
  while the id persists) decisively distinguishes a re-render from an in-place
  mutation.
- **An admin key minted with DEV_MINT survives a relaunch without DEV_MINT**, and
  `GOLDFINCH_MCP_PORT` pins the port, so a static MCP entry keeps working across
  relaunches.

## Recommendations

1. **(Important) Add an interaction-check rule for cross-cutting mechanisms** to
   the leg-design review prompt: when an AC changes a shared mechanism (live
   regions, focus management, the render/refresh cycle, the sheet), the leg must
   list every existing feature sharing it and assert that they are unaffected.
2. **(Important) State the injected-deps preference for page controllers** in
   CLAUDE.md's "Vault page: controller decomposition" bullet. Retrofitting the two
   source-scan-only vault controllers is a separate, design-reviewed piece of work
   for a future maintenance flight.
3. **(Minor) Default "new page controller ⇒ `eslint.config.mjs` module entry +
   `internal-page-map.js` route" into leg Files Affected** for internal-page work.
4. **(Minor) Fix squawk 0104** so live HAT fixes on internal pages don't need a
   relaunch.

## Action Items

- [ ] Carry: the next `vault-filter` behavior-test run exercises the re-authored
      steps 5–7 (HAT H3 access-keys rule). The operator declined a pre-merge re-run.
- [ ] Squawk 0103 (vault page still says "the manager"), open.
- [ ] Squawk 0104 (internal-page module edits stale until relaunch), open.
- [x] Recommendation 1: landed as a CLAUDE.md project planning rule, which
      survives plugin syncs, unlike `.flightops/`.
- [ ] Recommendation 2: squawk **0105** (the CLAUDE.md doc edit). The controller
      retrofit goes to a future maintenance flight.
- [ ] Recommendation 3: squawk **0106**.
