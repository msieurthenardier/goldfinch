# Squawk 0137: dev:automation warns MODULE_TYPELESS_PACKAGE_JSON for src/shared/password-generator.js

**Status**: open
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
