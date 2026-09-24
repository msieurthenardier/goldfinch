# Mission Debrief: Find It in the Vault

**Date**: 2026-09-23
**Mission**: [Find It in the Vault](mission.md)
**Status**: completed
**Duration**: 2026-09-22 - 2026-09-23
**Flights Completed**: 1 of 1

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| One filter field filters every vault | met | "Filter items" in the Vaults section filters every vault. Behavior-test checkpoints 2–3. Access keys hide while filtering (HAT H3; criterion reworded) |
| Non-matching items are removed from the page | met | Rows, emptied subsections, and emptied vaults are removed, and "No items match" is shown in words (checkpoints 3–6) |
| Matching uses only the non-secret fields | met | `FILTER_FIELDS` is drift-guarded to `SCHEMA.nonSecret`, with per-type secret-key negatives. Live: a secret-only marker matched nothing (checkpoint 6) |
| A clear control restores the full page | met | Inline ×, keyboard-operable, returns focus to the box (checkpoint 7, by-eye focus confirmation, HAT H1) |
| A page refresh resets the filter cleanly | met | Tag-the-node proof of a real re-render, and the field and page agree (checkpoint 9, HAT H4) |
| Locking clears the filter | met | The field is absent when locked and empty after unlock (checkpoints 10–11) |
| Accessible | met (speech unverified) | The accessible name and `role="status"` were verified in the live AX tree. The screen-reader speech check was waived at HAT (Known Issue) |
| Built in the page's existing shape | met | Pure matcher, injected-deps controller, thin `vault.js` wiring, exact route, line budget at the landed count (2153) |

### Overall Outcome

Achieved. The operator can type once and see matching items across every vault.
The filter structurally can't match on or reveal a secret. The operator confirmed
that one page-wide filter is the right answer to the original problem. The mission
also cleaned up the vault's name ("Vaults"/"Vault") through its companion squawk
0102. The ship-state behavior test covers everything except the H3 access-keys
rule, which is re-authored in the spec and not yet re-run (accepted).

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 01 Vault Filter | completed | The filter shipped (PR #232). Behavior test 10/10. HAT added the inline clear and hid access keys while filtering. Squawks 0103–0106 logged |

## What Went Well

- **Interview-driven scoping made a small mission genuinely small.** The operator
  pivoted early from per-vault to one page-wide filter and ruled out refresh
  survival, a keyboard shortcut, and "search" wording. The one hard problem
  (focus and query surviving `render()`'s full clear) disappeared before any flight
  design existed, so the mission fit in one flight with two legs.
- **The security property was designed in, then proven twice.** A whitelist
  matcher plus a schema drift guard (unit) and a planted secret-only marker (live)
  make "never matches a secret" a checked fact, not a review promise.
- **Review layers each caught something real.**
  - The mission Architect caught the line-budget squeeze and the render-clear risk.
  - The flight Architect caught the missing unlocked-only gate and the late-vault
    semantics.
  - The leg design review caught the `hidden`-ownership collision.
  - The flight Reviewer caught the silenced Access-keys announcements.

  None of these reached the operator.
- **The level of autonomy was right** (operator: "it was good"). The legs ran
  unattended, and the operator came in only at real human-only moments (unlock, a
  by-eye focus check, and alignment).
- **Alignment is the right venue for small UX calls** (operator: "alignment time is
  best, it's a small detail to reason about up front"). The access-keys rule changed
  cheaply because the policy was a one-line predicate.
- **No friction reported by the operator.** Test growth stayed proportionate:
  +28 tests, 6.45 s wall-clock, no flakes.

## What Could Be Improved

- **Shared-mechanism interactions need an explicit check.** The one real regression
  (a scoped `aria-live="off"` silencing Access-keys) came from changing a mechanism
  another feature shares. It was caught at review, not by the leg's tests. This is
  now a CLAUDE.md planning rule.
- **The spec record lags the shipped behavior.** HAT H3 changed behavior after the
  only full behavior-test run. The operator accepted not re-running it, which is
  recorded as a Known Issue. A future HAT that changes spec-covered behavior should
  at least name the re-run as a carried item, as this one did.
- **Dev-loop friction on internal pages.** Stale ES modules after a reload
  (squawk 0104) forced a relaunch mid-HAT. Until it's fixed, every internal-page HAT
  risks confusing "my fix is wrong" with "my fix isn't loaded".
- **Apparatus setup took detours.** The static `goldfinch-dev` MCP config 401'd, an
  earlier dev instance was left holding the default port, and the run had to re-mint
  keys. It worked out, and the Mission 22 lessons are captured, but the "mint once,
  pin the port" recipe should be the default at flight start.

## Lessons Learned

- **Technical**
  - A visibility layer over DOM it doesn't own should toggle its own class
    (`display:none !important`), not the `hidden` attribute that other code may
    already own.
  - Page controllers that need `src/shared/` functions should take them as
    injected deps. A flat-specifier import resolves only through the internal-page
    map, so such a controller can't be executed in unit tests (squawk 0105).
  - An admin key minted with `DEV_MINT` survives a relaunch without it.
    `GOLDFINCH_MCP_PORT` pins the port, so one static MCP entry keeps working
    across relaunches.
- **Process**
  - Put policy in a single predicate and mark operator-facing FD rulings as
    provisional. Settling them at alignment is then cheap and preferred.
  - `hasFocus()` false readings on this rig are page-scoped. Budget one operator
    by-eye check per focus-asserting row.
- **Domain**
  - The vault page's metadata-only boundary makes read-side features (filter,
    sort, group) safe by construction. Anything that needs secret fields to be
    searchable is a different, main-side, security-reviewed feature.

## Methodology Feedback

- **The hierarchy scaled down well.** A one-flight, two-leg mission with an early
  squawk for adjacent cleanup was the right shape. Adding a flight boundary would
  have been pure overhead.
- **Mission 21's "recommendations become actions" rule worked when applied:**
  - two crew apparatus notes and one CLAUDE.md planning rule landed in-flight;
  - four follow-ups became squawks (0103–0106);
  - two open items became mission Known Issues.

  Keep doing this at every debrief.
- **The squawk path was effective** for the naming fix (0102): logged, completed,
  reviewed, and merged before the flight started.
- **Consider a "live apparatus preflight" step** at flight start for any flight
  whose acceptance is a behavior test: mint the key, pin the port, probe it. That
  would move the setup detours out of the acceptance run.

## Action Items

- [ ] Carry: the next `vault-filter` run exercises the re-authored steps 5–7 (Known Issue).
- [ ] Squawk **0104** (stale internal-page modules in a dev session): prioritize first. It degrades every internal-page HAT.
- [ ] Squawks **0103** ("the manager" copy), **0105** (the injected-deps preference in CLAUDE.md), and **0106** (the eslint entry in the new-controller checklist): batch at the next turnaround.
- [ ] Maintenance-flight candidate: retrofit `vault-restore-controller.js` and `vault-browser-import-controller.js` to injected deps so they're unit-executable. This needs a design review, not a squawk.
- [ ] Watch: `VAULT_PAGE_LINE_BUDGET` is zero-slack (2153). The next vault-page leg plans an extraction up front.
- [ ] Watch: `apply()` runs a full reconciliation per keystroke. Revisit (debounce or incremental updates) if vault item counts grow materially.
- [ ] Still open from Mission 21's debrief: the owner-check retrofit on `vault-fill-human`/`vault-reachable-items`; collapsing the four vault item-type sources; CLAUDE.md compaction (the vault section keeps growing). All are inputs to `/mission-control:routine-maintenance`.
