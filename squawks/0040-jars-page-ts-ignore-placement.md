# Squawk 0040: `jars.js` `@ts-ignore` sits above a multi-line import, not before the specifier line it suppresses

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

`src/renderer/pages/jars.js` carries a `// @ts-ignore` above a seven-symbol `import { … } from './jars-page-state.js'` — the exact shape that broke `npm run typecheck` in `vault.js` during Flight 5 (`// @ts-ignore` suppresses only the next line; after Prettier's import expansion the TS2307 anchors on the `} from` line, several lines below). It typechecks today only because that specifier happens to resolve. Move the comment (text unchanged) to the line immediately before `} from './jars-page-state.js';`, matching the Flight 5 fix in `vault.js:15`. Verify with `npm run typecheck` and `npx prettier --check src/renderer/pages/jars.js`.

Source: Flight 5 debrief (Mission 17), recommendation 1a; Developer debrief interview.

## Evidence

- `src/renderer/pages/jars.js` — `// @ts-ignore` above `import {`; specifier line is `} from './jars-page-state.js';`
- `src/renderer/pages/vault.js:15` — the corrected placement (PR #182)
- BACKLOG "Internal pages: flat-served import specifiers are untypeable (TS2307)" — the diagnostic these ignores exist for

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
