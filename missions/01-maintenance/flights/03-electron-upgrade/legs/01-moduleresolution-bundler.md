# Leg: moduleResolution-bundler

**Status**: completed
**Flight**: [Dependency Currency — Electron Major Upgrade](../flight.md)

## Objective
Resolve the `jsconfig` `moduleResolution` debt (Flight 2 debrief) **before** the Electron bump: switch `"node"` → `"bundler"` and drop `ignoreDeprecations:"6.0"`, so any type error after the bump is attributable to the Electron API change, not the resolution change.

## Context
- Flight DD "moduleResolution → bundler, FIRST". TS6 hard-deprecates `moduleResolution:"node"` (the `ignoreDeprecations:"6.0"` suppresses it). `"bundler"` is the durable mode for this ES2022/CJS-via-require, `noEmit`+`checkJs` checker setup.
- **Design review verified live**: `moduleResolution:"bundler"` + `module:"commonjs"` + `noEmit:true` + `checkJs:true` → `tsc --noEmit` reports **0 errors** against the current `src/**`. (The "bundler requires module:esnext" rule applies only to *emit*; this is a checker.)
- No Electron change in this leg — isolates the resolution switch.

## Inputs
- `jsconfig.json` (current: `moduleResolution:"node"`, `ignoreDeprecations:"6.0"`, `checkJs:true`).

## Outputs
- `jsconfig.json` — `moduleResolution:"bundler"`, `ignoreDeprecations` removed.

## Acceptance Criteria
- [ ] `jsconfig.json` `compilerOptions.moduleResolution` is `"bundler"`.
- [ ] The `"ignoreDeprecations": "6.0"` line is removed.
- [ ] No other `jsconfig` option changes (`module:"commonjs"`, `checkJs:true`, `lib`, `types`, `include` all unchanged).
- [ ] `npm run typecheck` → **exit 0, 0 errors** (the resolution switch alone is clean; Electron-33 types still resolve under `bundler`).
- [ ] `npm test` (147 pass) and `npm run lint` (exit 0) unaffected.

## Verification Steps
- `npm run typecheck` → exit 0.
- `grep -n "moduleResolution\|ignoreDeprecations" jsconfig.json` → `"bundler"`; no `ignoreDeprecations`.
- `npm test` → 147 pass; `npm run lint` → exit 0.

## Implementation Guidance
1. In `jsconfig.json`: change `"moduleResolution": "node"` → `"moduleResolution": "bundler"`; delete the `"ignoreDeprecations": "6.0"` line (mind the trailing comma on the preceding line so the JSON stays valid).
2. Run `npm run typecheck` — must be 0 errors. If it isn't, STOP and report (unexpected — the combo was pre-verified).
3. Run `npm test` + `npm run lint` to confirm no collateral effect.

## Edge Cases
- **JSON validity**: removing the last property line requires the preceding line to not have a trailing comma. Verify the file parses.
- **No Electron change**: this leg must not touch `package.json` deps — that's Leg 2.

## Files Affected
- `jsconfig.json` — `moduleResolution:"bundler"`, drop `ignoreDeprecations`

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests/typecheck/lint green
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 1 of 4)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
