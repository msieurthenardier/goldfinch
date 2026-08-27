# Squawk 0037: Electron pinned with a caret range on the security-critical Chromium

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

`package.json` declares `"electron": "^43.2.0"`. The lockfile pins the installed version, so builds are reproducible today, but the caret means a fresh `npm install` without the lockfile — or a lockfile regeneration — can silently move Chromium. Dependabot already delivers Electron bumps as standalone PRs gated on behavior-test runs; an exact pin makes the declared range match that policy. Change to `"43.2.0"` (exact, as `@modelcontextprotocol/sdk` already is) and confirm `npm ls electron` and the suite are unchanged.

Source: maintenance report 2026-08-27, finding F10m.

## Evidence

- `package.json` devDependencies — `"electron": "^43.2.0"` vs `"@modelcontextprotocol/sdk": "1.29.0"`
- `.github/dependabot.yml` — majors arrive standalone with a behavior-test gate comment

## Corrective Action

The squawk's premise had drifted from the branch: `package.json` no longer declared `"electron": "^43.2.0"` by the time this was worked. Commit `b47e5cb` ("build(deps): bump the dev-minor-patch group across 1 directory with 7 updates (#164)"), a merged Dependabot bump already in this branch's history, had moved the declared range to `"electron": "^43.4.1"`, with `package-lock.json` matching (`packages[""].devDependencies.electron` = `^43.4.1`, `packages["node_modules/electron"].version` = `43.4.1`). The lockfile and the merged Dependabot bump define the current version, so the fix pins to that current target — `43.4.1` — rather than the squawk's originally-reported `43.2.0`, which is no longer what either file declares or resolves to.

Changes made:
- `package.json`: `"electron": "^43.4.1"` → `"electron": "43.4.1"` (caret dropped, exact pin, matching how `@modelcontextprotocol/sdk` is pinned).
- `package-lock.json`: `packages[""].devDependencies.electron` updated by hand from `"^43.4.1"` to `"43.4.1"` to match. The resolved `packages["node_modules/electron"]` entry already recorded `43.4.1` and needed no change.

Operator note: the local `node_modules/electron` install is still `43.2.0` (never resynced to the lockfile after commit `b47e5cb` landed). That's a pre-existing local-environment staleness issue, not something this squawk fixes — it resolves whenever the operator next runs `npm install`.

## Verification

- `git diff --stat` shows exactly `package.json`, `package-lock.json`, and this squawk artifact changed (other files in the tree are other squawks' uncommitted work, untouched).
- `grep -n '"electron"' package.json package-lock.json` → both show `"electron": "43.4.1"` (package-lock.json's `node_modules/electron` bin-path line, `"electron": "cli.js"`, is unrelated and unchanged).
- `node -e "console.log(require('./package-lock.json').packages[''].devDependencies.electron)"` → `43.4.1`.
- `npm run lint` → clean, no errors.
- `npm test` not run (nothing under test changes, per instructions). `npm install` not run (per instructions; local `node_modules` staleness is a separate operator action, noted above).
- `npm ls electron` still reports `electron@43.2.0 invalid: "43.4.1" from the root project` — expected given the local install is unsynced; this is the pre-existing operator-environment condition described above, not a regression from this change.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round; a first Developer attempt stopped on a stale premise (the range had already moved to ^43.4.1 via Dependabot) and was re-run with the corrected version; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
