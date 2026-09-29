# Squawk 0115: Dev-dependency minor/patch bump (Dependabot #234)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
Dependabot PR #234 (opened 2026-09-25, grouped `dev-minor-patch`) bumps four dev dependencies: `electron` 44.4.0 → 44.4.4 (patch: DevTools/webview/`ready-to-show` fixes), `eslint` ^10.9.1 → ^10.11.0, `prettier` ^3.9.6 → ^3.9.8, `@types/node` ^26.6.1 → ^26.6.2. The PR's branch predates today's v0.18.0 lockfile changes, so the bump is re-applied on a fresh branch from `main` and #234 is closed in its favour.

## Evidence
`gh pr view 234` — `package.json`/`package-lock.json` only. `electron` is pinned exact in `package.json` (`"electron": "44.4.0"`). Risk: a Prettier bump can reformat code; `renderer.js` is at its zero-headroom line budget (1546, `test/helpers/renderer-line-budget.js`, measured against Prettier output).

## Corrective Action
Applied the four bumps from #234 on this branch via npm: `electron` 44.4.0 -> 44.4.4 (still an exact pin, no caret), `eslint` ^10.9.1 -> ^10.11.0, `prettier` ^3.9.6 -> ^3.9.8, `@types/node` ^26.6.1 -> ^26.6.2. Lockfile delta is exactly those four packages (version/resolved/integrity) plus the root devDependencies specifiers; no transitive or unrelated changes, matching `gh pr diff 234`. `npm run format` (Prettier 3.9.8) reformatted no files. No code changes.

## Verification
- `npm run format`: no source files changed (only package.json / package-lock.json modified).
- `npm test`: 5752 tests, 5748 pass, 0 fail, 4 todo (renderer/bookmarks-bar line-budget pins unaffected).
- `npm run typecheck`: clean. `npm run lint`: clean. `npm run format:check`: clean.
- `npm audit --audit-level=high`: exits 1 with 1 high (`undici` <=6.28.0 / 7.0.0-7.29.0, via `electron` -> `@electron/get` and `electron-builder` -> `node-gyp`) and 1 moderate (`ip-address`). Identical result with the pre-bump lockfile (stash check), so pre-existing and not caused by these bumps; needs a separate squawk.

## Sign-Off
**Reviewer**: independent Reviewer agent (batch review scoped to the diff; `npm ci`, `npm audit --audit-level=high` 0 vulnerabilities, `npm test` 5748 pass / 0 fail, lint, typecheck, format:check clean)
**Verdict**: confirmed
**Commit**: the `squawk: turnaround 2026-09-29` commit on `squawk/turnaround-2026-09-29-3`

## Disposition
