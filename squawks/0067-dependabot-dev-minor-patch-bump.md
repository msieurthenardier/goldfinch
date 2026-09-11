# Squawk 0067: Dependabot dev-minor-patch bump (@types/node, eslint, globals)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-11
**Completed**: 2026-09-11

## Report

Dependabot opened PR #205 (`dependabot/npm_and_yarn/dev-minor-patch-b1b772b548`)
bumping three **dev** dependencies as a group:

- `@types/node` `^26.2.0` → `^26.4.1`
- `eslint` `^10.9.0` → `^10.9.1` (a no-loss-of-precision false-positive bug fix)
- `globals` `^17.11.0` → `^17.12.0`

All minor/patch, dev-only, no production/runtime dependency touched. Applied on
the turnaround branch and PR #205 superseded.

**SHA-pinning does NOT apply here**: CLAUDE.md's hardening rule ("resolve the
new version's commit SHA and pin") governs GitHub Actions `uses:` refs in
`.github/workflows`, which are mutable tags. These are npm packages
(package.json / package-lock.json), version-range pins verified by the lockfile
integrity hashes — not workflow action refs.

## Evidence

- PR #205 body (the three grouped updates + versions).
- `package.json` devDependencies (current `^26.2.0` / `^10.9.0` / `^17.11.0`).
- CLAUDE.md Release/CI: `npm audit --audit-level=high` is the gate; a dev-only
  bump is fixed by bumping, never by lowering the gate.

## Corrective Action

Bumped the three ranges in `package.json` `devDependencies` exactly as
specified: `@types/node` `^26.2.0` → `^26.4.1`, `eslint` `^10.9.0` →
`^10.9.1`, `globals` `^17.11.0` → `^17.12.0`. Ran `npm install` to
regenerate `package-lock.json`. Under `^` semver, npm resolved to the
latest versions satisfying each new range: `@types/node@26.5.1`,
`eslint@10.10.0`, `globals@17.12.0`. `package.json`'s `dependencies`
block (`@modelcontextprotocol/sdk@1.30.0`, exact-pinned) is untouched;
`git diff package.json` confirms only the three devDependency lines
changed. `package-lock.json`'s diff is confined to those three
packages and their own transitive dev-tooling deps (notably eslint's
`flat-cache`/`file-entry-cache` cache-layer chain: `cacheable`, `keyv`,
`hookified`, `qified`, `hashery`, `@keyv/*`, `@cacheable/*`) — no
runtime/production dependency changed.

## Verification

- `git diff package.json`: only the three devDependency range bumps —
  no runtime `dependencies` entry touched.
- `npm audit --audit-level=high`: **not clean** — 5 vulnerabilities (2
  moderate, 3 high: `@xmldom/xmldom`, `fast-uri`, `hono`, `js-yaml`,
  `qs`). Verified **pre-existing and unrelated to this bump**: stashed
  this squawk's changes, re-ran `npm audit --audit-level=high` against
  the unmodified turnaround baseline (v0.16.0), and got byte-identical
  output (same 5 advisories, same severities); popped the stash back
  afterward with no loss. `npm ls` traces every flagged package to
  `@modelcontextprotocol/sdk@1.30.0` (the pinned runtime dep, via
  `@hono/node-server`/`ajv`/`express`) and `electron-builder@26.15.3`
  (via `app-builder-lib`/`plist`) — neither touched by this squawk, and
  bumping either is out of this squawk's confined scope (a
  dev-minor-patch bump of `@types/node`/`eslint`/`globals` only). Not a
  regression introduced here; flagging for separate handling (a future
  squawk/flight bumping `electron-builder` and/or
  `@modelcontextprotocol/sdk`).
- Full green bar (run once across all four squawks' combined changes):
  `npm test` 4433/4433 pass; `npm run typecheck` clean; `npm run lint`
  clean (exercised under the bumped `eslint@10.10.0`); `npm run format`
  made no changes; `npm run format:check` clean.
- PR #205 supersession is a repo-hosting action outside this working
  tree's scope — left for the Flight Director / repo maintainer to
  close at commit/merge time.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-11 (Squawks: 0064, 0065, 0066, 0067, 0068)
