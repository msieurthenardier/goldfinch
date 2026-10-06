# Squawk 0138: Re-apply the dev-minor-patch dependency bumps (Dependabot #245) with verification

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
Dependabot PR #245 ("bump the dev-minor-patch group with 4 updates") was merged to `main` without the project's verification, then reverted (PR from `revert/245-dev-minor-patch`). Re-apply the same four bumps through the normal squawk flow:
- `electron` 44.4.4 → 44.5.0
- `@modelcontextprotocol/sdk` 1.30.0 → 1.31.0 (keep the exact pin)
- `prettier` ^3.9.8 → ^3.9.9
- `@types/node` ^26.6.2 → ^26.6.3

Why each needs more than CI:
- **Electron:** sortie 02's native isolation depends on the Chromium feature name `ForceThirdPartyCookieBlockingEnabled`, which fails open silently if dropped. Even on a minor bump, re-run `third-party-cookie-isolation` (the CLAUDE.md Electron-bump rule, applied conservatively) and the `node:sqlite` store suite.
- **MCP SDK:** the sole sanctioned runtime dependency, imported only in `mcp-server.js`. 1.31.0 changes OAuth credential storage (`issuer`), which shouldn't affect the loopback server, but needs an automation smoke test.
- **Prettier:** may reformat files. `npm run format:check` must stay green, and the zero-headroom `RENDERER_LINE_BUDGET` (1546) must not move.

## Evidence
- Merged commit `6f9b027` (#245): `package.json` and `package-lock.json` only. No workflow `uses:` changes, so the SHA-pinning rule isn't implicated.
- Reverted by `revert/245-dev-minor-patch`.

## Corrective Action
Re-applied #245's exact delta (`git show 6f9b027 -- package.json package-lock.json | git apply`; the turnaround had not touched either file): `electron` 44.4.4 -> 44.5.0 (exact), `@modelcontextprotocol/sdk` 1.30.0 -> 1.31.0 (exact pin, no caret), `prettier` ^3.9.8 -> ^3.9.9, `@types/node` ^26.6.2 -> ^26.6.3. `npm ci` clean. No source changes.

## Verification
Static checks done (Developer, 2026-10-06):
- Electron resolves to 44.5.0 (`npx electron --version` v44.5.0; Chromium 152.0.7977.130). `ForceThirdPartyCookieBlockingEnabled` still present in the binary (`strings | grep -c` = 1). Note `npm ci` did not fetch the binary; `npx electron` downloaded it.
- `npm run format:check` green on prettier 3.9.9, no files reformatted; line budgets untouched.
- `npm run lint` and `npm run typecheck` clean. `npm test`: 5845 tests, 5841 pass, 0 fail, 4 todo.
- MCP SDK 1.31.0: the three subpath requires used by `mcp-server.js` resolve; server tests pass; no deprecation warnings seen.
- `npm audit --audit-level=high` STILL EXITS 1, but is pre-existing and not caused by the bumps: remaining highs are transitive `brace-expansion` (high), `http-cache-semantics` (high), `proxy-addr` (critical), all with a non-breaking `npm audit fix` available. The baseline had the same three plus `@modelcontextprotocol/sdk` (high), which 1.31.0 fixes. Needs a separate squawk (lockfile-only `npm audit fix`).
Pending live checks (Flight Director): `third-party-cookie-isolation` behavior test on 44.5.0 and an MCP attach smoke test. Original required list:
- `npm ci`; then `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`;
- `npm audit --audit-level=high`;
- `/mission-control:behavior-test third-party-cookie-isolation` on the new Electron;
- an MCP attach smoke test (`tools/list`, `enumerateTabs`, `evaluate`).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
