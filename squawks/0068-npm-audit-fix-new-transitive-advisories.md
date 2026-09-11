# Squawk 0068: npm audit fix — clear new high transitive advisories (CI gate red)

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-09-11
**Completed**: 2026-09-11

## Report

`npm audit --audit-level=high` — the `ci.yml` PR gate (`.github/workflows/ci.yml:60`,
`ci/tasks/audit.yml:23`) — reports 5 vulnerabilities on the v0.16.0 dependency
tree (3 high: `@xmldom/xmldom`, `fast-uri`, `js-yaml`; 2 moderate: `hono`, `qs`).
These are **newly-published advisories** (2026-dated GHSA/CVE ids, e.g.
CVE-2026-39408 against `hono`) against transitive deps that were clean when main
last passed CI — they appeared in the advisory database since, with no code
change here. Surfaced during the 2026-09-11 squawk turnaround (while landing the
dependabot dev-dep bump, squawk 0067): every PR's CI audit step now fails on a
pre-existing tree, which would block the turnaround PR. Grounding: the CI gate is
red repo-wide until cleared. Distinct from 0067 (that bump is `@types/node`/
`eslint`/`globals` only; these advisories trace to `@modelcontextprotocol/sdk`
and `electron-builder` transitively).

## Evidence

- `npm audit --audit-level=high` on v0.16.0: 3 high, all `fixAvailable: true`
  (non-forcing — no `--force`, no top-level bump required).
- `.github/workflows/ci.yml:60` / `ci/tasks/audit.yml:23` — the gate;
  CLAUDE.md Release/CI: "fixed by bumping the offending dependency, never by
  lowering `--audit-level` or deleting this step."

## Corrective Action

Ran `npm audit fix` (non-forcing). It updated ONLY `package-lock.json`
(transitive dep resolutions to patched versions; +183/-55 lines);
`package.json` is untouched by this fix (its only diff is squawk 0067's three
devDependency range bumps). No top-level dependency pin changed —
`@modelcontextprotocol/sdk` stays exact-pinned, `electron-builder`'s range
unchanged; the fix resolves patched transitive versions within the existing
ranges. The gate is not lowered and the audit step is not deleted — the
CLAUDE.md-prescribed remediation.

## Verification

- `npm audit --audit-level=high`: **found 0 vulnerabilities** (was 3 high + 2
  moderate).
- Full green bar with the updated lockfile: `npm test` 4433/4433 pass;
  `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` clean.
- `git diff --stat`: `package-lock.json` only for this fix; `package.json` diff
  is 0067's three lines, no top-level change from the audit fix.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-11 (Squawks: 0064, 0065, 0066, 0067, 0068)
