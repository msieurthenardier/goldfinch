# Squawk 0144: Apply the dev-minor-patch dependency bumps (Dependabot #250) with verification

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: 2026-10-10

## Report
Dependabot PR #250 ("bump the dev-minor-patch group with 6 updates") bumps Electron and the MCP SDK. Squawk 0138 established that this pair needs project verification before merging (#245 was reverted for skipping it). Apply the same delta through the squawk flow, ahead of the 0.19.1 patch release:
- `electron` 44.5.0 → 44.5.1 (exact)
- `@modelcontextprotocol/sdk` 1.31.0 → 1.32.1 (keep the exact pin)
- `@types/node` ^26.6.3 → ^26.6.4
- `axe-core` ^4.13.0 → ^4.14.0
- `eslint` ^10.11.0 → ^10.12.0
- `globals` ^17.12.0 → ^17.13.0

What each bump needs beyond CI:
- **Electron**: the CLAUDE.md Electron-bump rule. Re-run the `node:sqlite` store suite (part of `npm test`), check that `ForceThirdPartyCookieBlockingEnabled` is still in the binary (native third-party cookie isolation fails open if the name is dropped), and run the `third-party-cookie-isolation` behavior test.
- **MCP SDK**: the sole runtime dependency, imported only in `mcp-server.js`; needs an attach smoke check.
- **eslint/globals**: lint must stay clean.
- **axe-core**: feeds the verify-only `npm run a11y`; not a gate.

Operator ruling (2026-10-10): the Sortie 03 `hard-reload` physical default-menu check (checkpoint 15, trial 8) is **not re-run** for this patch-level Electron bump.

## Evidence
- PR #250 (`dependabot/npm_and_yarn/dev-minor-patch-403452f256`) changes only `package.json` and `package-lock.json`. Its `package.json` diff keeps both exact pins (`"electron": "44.5.1"`, `"@modelcontextprotocol/sdk": "1.32.1"`).
- Precedent: squawk 0138 (the reverted #245, re-applied with verification).

## Corrective Action
Applied #250's exact delta (`gh pr diff 250 | git apply`, `--check` clean; `package.json` + `package-lock.json` only): `electron` 44.5.0 -> 44.5.1 (exact), `@modelcontextprotocol/sdk` 1.31.0 -> 1.32.1 (exact pin, no caret), `@types/node` ^26.6.3 -> ^26.6.4, `axe-core` ^4.13.0 -> ^4.14.0, `eslint` ^10.11.0 -> ^10.12.0, `globals` ^17.12.0 -> ^17.13.0. `npm ci` clean. No source changes.

## Verification
Static checks done (Developer, 2026-10-10):
- Electron resolves to 44.5.1 (`npx electron --version` v44.5.1; Chromium 152.0.7977.130; `npm ci` did not fetch the binary, `npx electron` downloaded it). `ForceThirdPartyCookieBlockingEnabled` present in the binary (`strings | grep -c` = 1).
- `npm test`: 5885 tests, 5881 pass, 0 fail, 4 todo (includes the `node:sqlite` store suite and mcp-server / automation-mcp-* tests). `npm run typecheck`, `npm run lint` (eslint 10.12.0) and `npm run format:check` clean.
- `npm audit --audit-level=high` exits 0 (only moderates remain, all under electron-builder).
- MCP SDK 1.32.1: the three subpath requires in `mcp-server.js` (`server/index.js`, `server/streamableHttp.js`, `types.js`) resolve.
- `git diff --stat`: only `package.json` and `package-lock.json` (plus this squawk file); no source changed, so `RENDERER_LINE_BUDGET` (1546) and other line budgets are untouched.
Live checks done (Flight Director, 2026-10-10):
- `third-party-cookie-isolation` behavior test on 44.5.1: **pass**. 14/14 judged steps, step 9 struck, Version appendix pass, no regression against the 44.5.0 baseline (`tests/behavior/third-party-cookie-isolation/runs/2026-10-10-22-00-00.md`):
  - running electron 44.5.1 / Chromium 152.0.7977.130;
  - `ForceThirdPartyCookieBlockingEnabled` in `--enable-features` exactly when isolation is configured on;
  - cookie shapes identical to the baseline;
  - both relaunches attested.
- MCP attach smoke on SDK 1.32.1: covered by that run. `tools/list` returned 35 tools, and the same admin key authenticated across launch plus two app-driven relaunches. `evaluate`, `openTab`, `reload`, `click`, `captureWindow` and `appQuit` were exercised with no `isError`.
Hard-reload physical DD7 re-run: not re-run (operator ruling).
`npm run a11y` (axe-core 4.14.0) is verify-only and was not run.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues. The PR #250 delta matches exactly (`git apply --check -R`) and the exact pins are preserved. The Reviewer re-ran the gates: `npm test` 5885 tests (5881 pass, 0 fail, 4 todo); typecheck, lint, format:check and audit clean; feature name present in the 44.5.1 binary. Live-verified by the `third-party-cookie-isolation` run 2026-10-10-22-00-00 (pass).
**Commit**: the `squawk/0144` commit on `squawk/0144-dev-minor-patch` (supersedes Dependabot #250)
