# Squawk 0043: CLAUDE.md doesn't document the two idioms Flight 5 established — regex-target mutation pins and cast-to-local before chains

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Two patterns emerged in Flight 5 and will recur, but neither is written down: (1) **regex-target mutation pins** — a source-text `.replace()` pin whose target is a wrap-insensitive regex (`\s+` between tokens, a captured-indent replacer, bounded non-greedy lookaheads when scanning a dispatch table) rather than an exact literal, still guarded by `assertMutated` and neuter-verified (`test/unit/move-authority.test.js`, `tab-drag-invariants.test.js` `CALL_SITE_RE`, `sheet-automation-gate-invariant.test.js`); (2) **cast-to-local before a multi-line chain** — `const anyErr = /** @type {any} */ (err);` rather than an inline cast inside a boolean/argument chain, because the formatter can re-attach the comment (`src/main/app-db.js:124`). Add one bullet each to CLAUDE.md's structural-test conventions (next to the neuter-check / positive-control rules) and typing notes, citing those files.

Source: Flight 5 debrief (Mission 17), recommendation 3.

## Evidence

- `grep -n -E 'captured-indent|cast-to-local|anyErr' CLAUDE.md` → no hits
- Flight 5 flight log per-pin table — the twelve conversions

## Corrective Action

Added two bullets to `CLAUDE.md`'s `## Patterns` section, matching the surrounding bullets' dense, file-and-flight-citing style.

1. Next to the **Grep-AC convention** bullet in `### src/shared/ ESM modules` (the section's other structural/grep test-convention note):

   > - **Regex-target mutation pins (Flight 5, M17).** When a source-text pin's `.replace()` target would be an exact multi-line literal, use a wrap-insensitive regex instead (`\s+`/`\s*` between tokens, metacharacters escaped) with a captured-indent replacer function, so a Prettier re-wrap can't silently stale the anchor — keep `assertMutated` guarding every mutation (a no-op `.replace()` "discharges" vacuously). A dispatch-table scan additionally needs a bounded non-greedy lookahead so the match can't cross into the NEXT entry. Exemplars: `test/unit/move-authority.test.js` (captured-indent replacer), `test/unit/tab-drag-invariants.test.js`'s `CALL_SITE_RE` (wrap-insensitive call-site anchor), `test/unit/sheet-automation-gate-invariant.test.js` (bounded negative-lookahead scan, `(?:(?!\n\s*\w+:)[\s\S])*?`). Every re-target from an exact-literal pin to a regex-target one is neuter-verified.

2. Right after the **Formatting is Prettier's (M17 F5)** bullet in `### Password vault`:

   > - **Cast-to-local before a chain (Flight 5, M17).** Never place an inline `/** @type {any} */ (x)` cast inside a multi-line boolean chain, argument list, or ternary — the formatter attaches the comment to whatever group it reprints, not necessarily the cast's own expression. Bind it to a local first: `const anyX = /** @type {any} */ (x);` (`src/main/app-db.js:124`'s `isCorruptionErrcode`, `src/renderer/pages/settings.js` — squawk 0041). `// @ts-ignore` covers only the NEXT line, so on a multi-line import it goes immediately before the `} from '…'` line, not above the whole `import` statement (`src/renderer/pages/vault.js:15`, `jars.js` — squawk 0040).

Both idioms were verified against the actual cited source before writing: `move-authority.test.js`'s captured-indent `.replace()` (lines 104–109), `tab-drag-invariants.test.js`'s `CALL_SITE_RE` wrap-insensitive anchor (line 535), `sheet-automation-gate-invariant.test.js`'s bounded negative-lookahead scan (line 269), `app-db.js:124`'s `const anyErr = /** @type {any} */ (err);`, `settings.js:928`'s `const anyE = /** @type {any} */ (e);` inside a boolean chain, and `vault.js:15`'s `// @ts-ignore` immediately preceding a `} from '...'` line. No other CLAUDE.md content changed; no source files touched.

## Verification

- `npm run lint` — clean (no errors).
- `npm run typecheck` — clean (`tsc --noEmit`, no errors).
- `npx prettier --check .` — "All matched files use Prettier code style!" (CLAUDE.md itself is excluded from Prettier per `.prettierignore`/`*.md`, per project convention; this run confirms nothing else in the tree moved).
- `git status --short` confirms only `CLAUDE.md` and this squawk file were newly modified — squawks 0040–0042's pre-existing uncommitted changes (`jars.js`, `settings.js`, `test/unit/ci-format-gate.test.js`, their artifacts) are untouched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 4)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 4)` on `squawk/turnaround-2026-08-27-4` (PR number recorded on the PR itself)

Batch gates at review: 3843/3843 tests, lint clean, typecheck clean, prettier --check clean.
