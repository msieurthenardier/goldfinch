# Squawk 0137: dev:automation warns MODULE_TYPELESS_PACKAGE_JSON for src/shared/password-generator.js

**Status**: escalated
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
Every `npm run dev:automation` launch prints a Node warning that `src/shared/password-generator.js` has no module type and doesn't parse as CommonJS, so Node reparses it as ESM at a performance cost. The warning also appears in the packaged app's output. Resolve it the way the other `src/shared/` ESM modules are handled. Check `package.json`/module type conventions and CLAUDE.md's `src/shared/` ESM rules (the CJS-by-design quartet is the only CJS exception).

## Evidence
Launch log: "(node:1044732) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/src/shared/password-generator.js is not specified and it doesn't parse as CommonJS." Pre-existing; first noted in sortie 02 Leg 01's Developer report.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:

## Disposition
**Escalated** (2026-10-06, turnaround): fails squawk criterion 2 (no design decisions).

**Root cause:** main `require()`s the typeless-ESM `src/shared/password-policy.js` (`src/main/main.js:49`, `register-browser-ipc.js`), which statically imports `./password-generator.js`. On Node 22.22, the require-ESM path silently detects the first file, but the nested import is reparsed and warns. The same mechanism applies to `launch-urls.js` → `url-safety.js` (masked in real launches by load order), so this is not specific to one file. Reproduce: `node -e "require('./src/shared/password-policy.js')"`.

**Options**, each a module-format layout decision:
1. `src/shared/package.json` `{"type":"module"}`, with the CJS-by-design quartet renamed to `.cjs` (touches requires, `eslint.config.mjs` bindings, `internal-page-map.js`, tests and the CLAUDE.md quartet rule).
2. Nest the CJS quartet under a `{"type":"commonjs"}` directory.
3. Merge or twin the generator, which only hides this instance.
4. Suppress the warning (not a fix; a global hook).

The Developer recommends option 1. → **Sortie candidate:** "`src/shared/` module-type declaration". No code was changed.

