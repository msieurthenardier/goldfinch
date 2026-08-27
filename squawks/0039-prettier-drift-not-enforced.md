# Squawk 0039: Prettier drift on 315 files; `prettier --check` not enforced in CI

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

`npx prettier --check .` flags 315 files (289 `.js`, 8 yml, 6 html, 5 mjs, 5 css, 2 ts); `ci/tasks/lint.yml` only mirrors ESLint, so the formatter has drifted into a decorative script. Operator ruling 2026-08-27: **enforce**. Two steps in one squawk: (1) a single formatting-only commit (`npm run format`), then (2) add `npx prettier --check .` to the CI lint task (`ci/tasks/lint.yml`, and `.github/workflows/ci.yml` if it runs lint) so drift fails the build. Watch item for the Developer: 17 unit-test files read source text (grep-shape structural pins, e.g. `test/unit/search-engines.test.js`, `homepage-literal-scan.test.js`); reformatting can move or rewrap the lines they match. Run the suite after formatting; if a pin breaks, fix the pin's matcher — not the formatting — and if more than a handful break, stop and escalate rather than hand-editing pins. Review `.prettierignore` first so generated files (the preload bundle) and vendored data stay excluded.

Source: maintenance report 2026-08-27, finding F41; operator decision 2026-08-27.

## Evidence

- `npx prettier --check .` (2026-08-27) — 315 files
- `ci/tasks/lint.yml` — ESLint only; `.prettierrc`, `.prettierignore` present at repo root

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
