# Squawk 0217: Three CLAUDE.md claims no longer match the code literally

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
The docs-vs-code check (routine maintenance 2026-11-18, finding #33; 42 claims checked) found three wording mismatches:
1. *Formatting is Prettier's* calls both line budgets "zero-headroom"; `bookmarks-bar.js` is 1,076 lines against 1,100 (and the test's own "measured 1047" comment is stale). Only `renderer.js` is at budget.
2. *Launch switches*: "`removeSwitch(` appears nowhere else in `src/main/**`" — `main.js` also has the injected-dep wrapper.
3. *Commands*: `npm test` runs "`test/unit/**`"; the script globs `test/unit/*.test.js`.

## Evidence
- `wc -l src/renderer/chrome/bookmarks-bar.js` → 1076; `test/unit/seam-contract.test.js` budget comment.
- `src/main/main.js` — `removeSwitch: (name) => app.commandLine.removeSwitch(name)`; `src/main/launch-switches.js` — the call.
- `package.json` `scripts.test`.

## Corrective Action
*(written at completion)*

## Verification
Each sentence matches the code; `launch-switches-placement.test.js` still passes; the seam-contract comment states the current count.
