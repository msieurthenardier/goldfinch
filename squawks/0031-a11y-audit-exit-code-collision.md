# Squawk 0031: `npm run a11y` exits 1 for both "apparatus not configured" and "violations found"

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Mission 09's debrief flagged that `scripts/a11y-audit.mjs` uses exit code 1 for setup failures (`fail()`) and for real axe violations, so "not run" can be misread as green-or-red by a caller. Unchanged since. Reserve a distinct non-1 exit (e.g. 2) for `fail()` so the two outcomes are distinguishable; update the script's usage text.

Source: maintenance report 2026-08-27, finding F44 (known, M09).

## Evidence

- `scripts/a11y-audit.mjs:99-101` — `fail()` → `process.exit(1)`, used at `:160, :184, :188, :233, :319`
- `scripts/a11y-audit.mjs:572` — "new violations found" branch → `process.exit(1)`

## Corrective Action

`scripts/a11y-audit.mjs`'s three `process.exit(...)` sites are now distinct:

- **`0`** — clean: no NEW violations (`main()`'s report branch, was already `0`, unchanged).
- **`1`** — NEW violations found (`main()`'s report branch, was already `1`, unchanged) — reserved for a real red run.
- **`2`** — apparatus/setup failure, via `fail()` (was `1`, now `2`). Every `fail()` call site is a setup/apparatus problem, not a violation:
  - `:160` `getChromeWcId` — `getChromeTarget` didn't return a wcId (admin key/launch issue)
  - `:184` `getGuestWcId` — `enumerateTabs` failed
  - `:188` `getGuestWcId` — no guest tab matched `--target`
  - `:233` `findSheetWcId` — `enumerateWindows` didn't find the sheet's wcId
  - `:319` `main()` — `connectAutomation()` threw (app not running / surface not bound)
  - `main().catch(...)` at the bottom of the file also routes any otherwise-uncaught error through `fail()`, so it too exits `2`.

Documented the mapping in the script's header (new "Exit codes" block after the `Usage:` section) and in `docs/dev-testing.md`'s *a11y audit* section (new "Exit codes" bullet). No other consumer describes the exit code: `docs/mcp-automation.md` and `CLAUDE.md`'s `## Commands` reference the script but never state exit-code semantics, so neither needed a change. `ci/tasks/*.yml` has no `a11y` job (the script is verify-only, explicitly not part of headless CI per its own header) — no CI consumer to update.

## Verification

- `node --check scripts/a11y-audit.mjs` — passes.
- `timeout 180 npm test` — 3794/3794 passing (0 fail), including the new pin.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- New source-pin test `test/unit/a11y-audit-exit-codes.test.js`: the script exports nothing importable (a `main()`-invoking entry-point script), so, following the static-parse house style already used on this same file by `test/unit/seam-contract.test.js`, the test statically parses `scripts/a11y-audit.mjs`'s source and asserts `fail()`'s body exits `2` and that the three `process.exit(...)` call sites appear in source order as `2, 0, 1` (fail, clean, violations) — locking the mapping against a future silent re-collision.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
