# Squawk 0040: `jars.js` `@ts-ignore` sits above a multi-line import, not before the specifier line it suppresses

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

`src/renderer/pages/jars.js` carries a `// @ts-ignore` above a seven-symbol `import { … } from './jars-page-state.js'` — the exact shape that broke `npm run typecheck` in `vault.js` during Flight 5 (`// @ts-ignore` suppresses only the next line; after Prettier's import expansion the TS2307 anchors on the `} from` line, several lines below). It typechecks today only because that specifier happens to resolve. Move the comment (text unchanged) to the line immediately before `} from './jars-page-state.js';`, matching the Flight 5 fix in `vault.js:15`. Verify with `npm run typecheck` and `npx prettier --check src/renderer/pages/jars.js`.

Source: Flight 5 debrief (Mission 17), recommendation 1a; Developer debrief interview.

## Evidence

- `src/renderer/pages/jars.js` — `// @ts-ignore` above `import {`; specifier line is `} from './jars-page-state.js';`
- `src/renderer/pages/vault.js:15` — the corrected placement (PR #182)
- BACKLOG "Internal pages: flat-served import specifiers are untypeable (TS2307)" — the diagnostic these ignores exist for

## Corrective Action

Inspected every `@ts-ignore` + import pair in `src/renderer/pages/jars.js` (lines 3–37). Thirteen are single-line imports (comment directly above the specifier line) and needed no change. One was multi-line:

- `src/renderer/pages/jars.js:23–31` — before: `// @ts-ignore — serving-path vs disk-path mismatch` sat above `import {` (line 24), five lines above the `} from './jars-page-state.js';` line TS2307 anchors on. After: comment moved (text unchanged) to the line immediately before `} from './jars-page-state.js';`, matching `vault.js:15`.

Checked all other files under `src/renderer/pages/*.js` and `src/renderer/chrome/*.js` for the same pattern (`grep -n -A1 '@ts-ignore'`):

- `src/renderer/pages/settings.js:8,10,12` — three `@ts-ignore` + import pairs, all single-line imports. No change needed.
- `src/renderer/pages/vault.js:3,15,17,19,21` — already carries the corrected placement from Flight 5 (PR #182). No change needed.
- `src/renderer/chrome/tab-controller.js:1170` — `@ts-ignore` above a `window.__goldfinchAutomation = {` object-literal assignment, not an import; unrelated pattern (TS2339 dynamic-property suppression). No change needed.
- No other file under these two directories contains `@ts-ignore`.

Only the comment position changed; no import specifiers, symbols, or line collapsing.

## Verification

- `npm run typecheck` — passes, no errors.
- `npx prettier --check .` — all matched files use Prettier code style.
- `npm run lint` — passes, no errors.
- `timeout 300 npm test` — 3839/3839 pass, 0 fail.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 4)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 4)` on `squawk/turnaround-2026-08-27-4` (PR number recorded on the PR itself)

Batch gates at review: 3843/3843 tests, lint clean, typecheck clean, prettier --check clean.
