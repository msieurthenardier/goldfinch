# Squawk 0043: CLAUDE.md doesn't document the two idioms Flight 5 established — regex-target mutation pins and cast-to-local before chains

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Two patterns emerged in Flight 5 and will recur, but neither is written down: (1) **regex-target mutation pins** — a source-text `.replace()` pin whose target is a wrap-insensitive regex (`\s+` between tokens, a captured-indent replacer, bounded non-greedy lookaheads when scanning a dispatch table) rather than an exact literal, still guarded by `assertMutated` and neuter-verified (`test/unit/move-authority.test.js`, `tab-drag-invariants.test.js` `CALL_SITE_RE`, `sheet-automation-gate-invariant.test.js`); (2) **cast-to-local before a multi-line chain** — `const anyErr = /** @type {any} */ (err);` rather than an inline cast inside a boolean/argument chain, because the formatter can re-attach the comment (`src/main/app-db.js:124`). Add one bullet each to CLAUDE.md's structural-test conventions (next to the neuter-check / positive-control rules) and typing notes, citing those files.

Source: Flight 5 debrief (Mission 17), recommendation 3.

## Evidence

- `grep -n -E 'captured-indent|cast-to-local|anyErr' CLAUDE.md` → no hits
- Flight 5 flight log per-pin table — the twelve conversions

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
