# Squawk 0226: Two release-workflow invariant pins can be satisfied by the wrong text

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
Two pins added in Mission 24 Flight 1 can pass when they should fail:

1. **The fuse-check pin finds its step with a substring.** It uses `jobs.build.indexOf('Check Electron fuses')`, so a comment mentioning that name earlier in the job body would satisfy it. It should find the step by its step header (`- name: Check Electron fuses`), for example with the file's existing `stepOf` helper.
2. **The `upload` pin can be defeated by `always()`.** It requires `needs.build.result == 'success'` and forbids `!=`. But an added `always()` in `upload`'s `if:`, combined with the success test through `||`, could let `upload` run when a build entry failed. The pin should forbid `always()` (and a `||` that bypasses the success test) in that condition.

Test-only hardening; there is no workflow change.

## Evidence
- `test/unit/release-workflow-invariants.test.js`: the fuse-check and `upload`-condition tests (Mission 24 Flight 1, leg `release-runs-audit`).
- `missions/24-maintenance/flights/01-release-integrity/flight-debrief.md`, *Technical*; flight review non-blocking note 3.

## Corrective Action
Test-only, in `test/unit/release-workflow-invariants.test.js`. The fuse pin now orders steps by real `- name:` headers (`buildStepNames`), so a comment cannot satisfy it. The upload pin uses `uploadIfFault`, a parenthesis-aware check: a top-level `||` is refused and a top-level build-success conjunct is required. `always()` itself is not forbidden, because the real condition is `always() && needs.build.result == 'success' && (...)`, which is safe; the hole was `||`. A permanent mutation test covers both bypasses with applied-checks.

## Verification
The permanent mutation test (applied-check guarded) shows each pin red: the fuse step replaced by a comment carrying its name (`stepOf` throws, step index -1), and `always() || needs.build.result == 'success'` plus `always() && (… || true)` (`uploadIfFault` non-null). The real file passes both pins. `.github/` has no diff. `npm test` (7380 pass, 0 fail), lint, typecheck and format:check are green.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The fuse-step order is read from real `- name:` headers only. The deviation from "forbid `always()`" (the real `upload` condition begins `always() &&`) closes the hole the squawk describes: a top-level `||` is refused and a top-level `needs.build.result == 'success'` conjunct is required; an `||` inside a nested group is allowed; odd spacing fails closed. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`
