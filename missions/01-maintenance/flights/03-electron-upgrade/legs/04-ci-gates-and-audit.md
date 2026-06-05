# Leg: ci-gates-and-audit

**Status**: completed
**Flight**: [Dependency Currency — Electron Major Upgrade](../flight.md)

## Objective
Operationalize the quality floor in CI (F21 + Flight-2-debrief carry-forward): add `npm test`, `npm run typecheck`, `npm run lint`, and `npm audit --audit-level=high` to `ci.yml` so every PR is gated on the suites the codebase now has, before the package step.

## Context
- F21 (maintenance report): `ci.yml` has no dependency-audit step. Flight 2 debrief: the test/typecheck/lint gates exist but aren't enforced in CI — recommended for Flight 4, pulled forward here since we're editing `ci.yml` anyway.
- Current `ci.yml` (`.github/workflows/ci.yml`): on PR to `main`, `actions/checkout@v4` → `actions/setup-node@v4` (node 20, npm cache) → `npm ci` → `npx electron-builder --linux --dir`. The gates slot between install and package.
- Leg 2 confirmed `npm audit --audit-level=high` → **0 highs** post-upgrade, so the `high` gate won't red the build.

## Inputs
- `.github/workflows/ci.yml`.

## Outputs
- `.github/workflows/ci.yml` — four new steps (test, typecheck, lint, audit) inserted after "Install dependencies" and before "Package".

## Acceptance Criteria
- [ ] `ci.yml` runs, in order after `npm ci`: `npm test` → `npm run typecheck` → `npm run lint` → `npm audit --audit-level=high` → the existing `npx electron-builder --linux --dir`.
- [ ] Each is a distinct, named step (so a failure is attributable). The audit step uses `--audit-level=high` (Leg 2 verified 0 highs; if a future high appears it fails the build — the intended F21 behavior).
- [ ] The YAML is valid (parses) and the existing structure (triggers, concurrency, node 20 + npm cache, the package step) is unchanged.
- [ ] Locally, all four commands already pass on the upgraded tree (`npm test` 147, `npm run typecheck` 0, `npm run lint` 0, `npm audit --audit-level=high` 0 highs) — confirm before finalizing so the first CI run is green.
- [ ] (Verified at flight end) the PR's CI run exercises the new steps green.

## Verification Steps
- `npx js-yaml .github/workflows/ci.yml` or a YAML lint → parses (or visual check of indentation).
- Locally run the four commands → all green (matches what CI will do).
- `grep -n "npm test\|npm run typecheck\|npm run lint\|npm audit\|electron-builder" .github/workflows/ci.yml` → all present, in order, audit before package.

## Implementation Guidance
1. In `.github/workflows/ci.yml`, after the `Install dependencies` step (`run: npm ci`) and before `Package (no installers)`, insert four steps:
   ```yaml
   - name: Unit tests
     run: npm test
   - name: Type check
     run: npm run typecheck
   - name: Lint
     run: npm run lint
   - name: Dependency audit
     run: npm audit --audit-level=high
   ```
   Match the existing indentation (steps are list items under `steps:`).
2. Leave triggers, `concurrency`, `setup-node` (node 20 + npm cache), and the package step unchanged.
3. Run the four commands locally to confirm green before finalizing.

## Edge Cases
- **Audit gate policy**: Leg 2 verified 0 highs, so `--audit-level=high` is safe. If a future transitive high appears, the build fails (intended F21 behavior) — the fix is to update the dep, not loosen the gate. (If highs had remained post-bump, the fallback was `--audit-level=critical` + documented residuals — not needed here.)
- **`npm ci` installs devDeps**: yes (default), so eslint/typescript/prettier are available for the gates.
- **Node 20 in CI vs Node 22 dev**: `tsc`/`eslint`/`node --test` all run fine on Node 20 (engines floor is `>=20`).
- **CI-only verification**: the actual green run happens when the flight PR opens — the local pre-check is the proxy.

## Files Affected
- `.github/workflows/ci.yml` — add test/typecheck/lint/audit steps

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (local pre-check green; CI run verified at flight end)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Final leg → flight-level review + commit by the Flight Director next
