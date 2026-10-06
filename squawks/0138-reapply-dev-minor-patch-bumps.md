# Squawk 0138: Re-apply the dev-minor-patch dependency bumps (Dependabot #245) with verification

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

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
*(written at completion)*

## Verification
*(written at completion)*. Required:
- `npm ci`; then `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`;
- `npm audit --audit-level=high`;
- `/mission-control:behavior-test third-party-cookie-isolation` on the new Electron;
- an MCP attach smoke test (`tools/list`, `enumerateTabs`, `evaluate`).

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
