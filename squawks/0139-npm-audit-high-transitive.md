# Squawk 0139: npm audit high/critical in transitive deps (brace-expansion, http-cache-semantics, proxy-addr)

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
`npm audit --audit-level=high` exits 1 on `main` and on the turnaround branch, so the Concourse `audit` gate is red and a release can't be cut. Three transitive packages are flagged:
- `proxy-addr` 2.0.7 (**critical**: IP spoofing via IPv4-mapped IPv6 trust subnet). It sits on the runtime path `@modelcontextprotocol/sdk` → `express` → `proxy-addr`.
- `http-cache-semantics` 4.2.0 (**high**). Dev path: `electron-builder` → `@electron/get` → `got` → `cacheable-request`.
- `brace-expansion` 5.0.9 (**high**: quadratic-time CPU DoS). Dev path: `electron-builder` → `minimatch`.

Each has a non-breaking `npm audit fix` available. Per CLAUDE.md, a high is fixed by bumping the dependency, never by lowering the gate. Remaining **moderate** findings (`electron-builder` chain, `fast-uri`) need an `electron-builder` semver-major and are below the gate's threshold, so they are out of scope here.

## Evidence
`npm audit --audit-level=high --json` (2026-10-06, turnaround branch with squawk 0138 applied): the three packages above, each with `fixAvailable: true`. `npm ls` paths are as listed.

## Corrective Action
Lockfile-only `npm audit fix` (no `--force`, no semver-major, `package.json` byte-identical to its pre-squawk state, i.e. only 0138's bumps). Resolved version deltas in `package-lock.json`:
- Fixes: `proxy-addr` 2.0.7 -> 2.0.8; `http-cache-semantics` 4.2.0 -> 4.3.0; `brace-expansion` 5.0.9 -> 5.0.12; plus `fast-uri` 3.1.7 -> 3.1.8 (moderate, fixed incidentally).
- electron-builder family (in-range): `electron-builder`/`app-builder-lib`/`dmg-builder`/`electron-builder-squirrel-windows` 26.15.3 -> 26.17.0; `builder-util`/`electron-publish` 26.15.3 -> 26.16.0.
- Other transitive: `@electron/rebuild` 4.0.4 -> 4.2.0; `node-abi` 4.31.0 -> 4.36.0; `picomatch` 4.0.4 -> 4.0.7; `unzipper` 0.12.3 -> 0.12.5 (nested `fs-extra` 11.3.5 -> 11.3.1); `fs-extra` 11.3.5 -> 11.4.1 (in `@electron/universal`, `@electron/windows-sign`); `@peculiar/asn1-schema` 2.8.0 -> 2.10.0; `pkijs` 3.4.0 -> 3.4.1; `pvutils` 1.1.5 -> 1.2.0; `sax` 1.6.0 -> 1.6.1; `@noble/hashes` 2.2.0 -> 1.8.0 (top-level dedupe; nested `pkijs/node_modules/@noble/hashes` 1.4.0 removed).

## Verification
- `npm ci` from the updated lockfile succeeds; `npm audit --audit-level=high` exits 0.
- Remaining: 8 moderate findings, all the `sprintf-js` -> `roarr` -> `global-agent` -> `@electron/get` -> `app-builder-lib` -> `electron-builder`/`dmg-builder`/`electron-builder-squirrel-windows` chain (fix needs an electron-builder semver-major; below gate, out of scope).
- `npm ls`: proxy-addr@2.0.8, http-cache-semantics@4.3.0, brace-expansion@5.0.12 (all deduped).
- `npm run format:check`, `npm run lint`, `npm run typecheck` clean; `npm test` 5845 tests, 0 fail (incl. automation-mcp-server/tools, mcp-client tests).
- `npx electron-builder --version` -> 26.17.0.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
