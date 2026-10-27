# Squawk 0165: npm audit high in transitive deps (body-parser, zod, undici) + moderates via the MCP SDK

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-10-26
**Completed**: 2026-10-26

## Report
`npm audit --audit-level=high` exits 1 on `main`, so the Concourse `audit` gate is red. The non-Electron findings (Electron is squawk 0164) are below.

**Runtime path** (`@modelcontextprotocol/sdk` 1.32.1, pinned exact; reach is loopback-only, origin-guarded and keyed):
- `body-parser` 2.3.0 via `express`: **high**, DoS from trailing bytes after a compressed body (GHSA-27r3-jxmh-p828).
- `zod` 4.4.3: **high**, memory exhaustion validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5).
- `hono` 4.13.7 (also via `@hono/node-server`): moderate, `serveStatic` double decode (GHSA-5r4p-p66f-jhc7). Goldfinch does not use `serveStatic`.
- `ip-address` 10.7.2 via `express-rate-limit`: moderate, quadratic Address6 zone-id parsing (GHSA-rxp7-6hxx-x8q5).
- `fast-uri` 3.1.8 via `ajv` (also `app-builder-lib`): moderate and low; scheme spoofing, host confusion, path equivalence (GHSA-w74x-v6f9-j3xg, -wjr9-j795-jxcr, -xhq7-xmqj-769h, -333x-w4r6-6crp).

**Dev only:**
- `undici` 6.29.0 (`electron-builder` → `@electron/rebuild` → `node-gyp`) and 7.30.0 (`electron` → `@electron/get`): **high**, DoS on excessive content-encodings (GHSA-xjj6-f33q-929c), plus moderates (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472).

Every finding has a non-breaking `npm audit fix` (`fixAvailable: true`), and the SDK's dependency ranges already admit the patched versions. Per CLAUDE.md, a high is fixed by bumping the dependency, never by lowering the gate. The SDK stays at 1.32.1; bumping to 1.32.2 is out of scope.

## Evidence
- `npm audit --json` (2026-10-26, `main` at f569d95): 7 vulnerabilities (4 high, 3 moderate). The non-Electron ones are listed above, all `fixAvailable: true`.
- `npm ls` paths are as listed. `src/main/automation/mcp-server.js` imports only `server/index.js`, `server/streamableHttp.js` and `types.js` from the SDK; it does not use express.

## Corrective Action
Lockfile-only `npm audit fix` (no `--force`, no semver-major). `package.json` is byte-identical to its pre-squawk state (only 0164's `electron` 44.9.3 line differs from HEAD); `@modelcontextprotocol/sdk` stays 1.32.1, electron 44.9.3. No source changes. Resolved version deltas in `package-lock.json`:
- Fixes: `body-parser` 2.3.0 -> 2.4.0; `zod` 4.4.3 -> 4.6.7; `undici` 7.30.0 -> 7.30.1 and `node-gyp/node_modules/undici` 6.29.0 -> 6.29.1; `hono` 4.13.7 -> 4.13.14; `ip-address` 10.7.2 -> 10.7.5; `fast-uri` 3.1.8 -> 3.1.9.
- Incidental in-range: `qs` 6.16.0 -> 6.16.1; `body-parser/node_modules/content-type` 2.0.0 -> 2.1.0; `iconv-lite` 0.7.3 hoisted top-level (nested `body-parser`/`raw-body` copies of 0.7.2 removed).

## Verification
- `npm ci` from the updated lockfile succeeds; `npm audit --audit-level=high` exits 0 and reports `found 0 vulnerabilities` (nothing remains, including below the gate).
- `npm ls --all`: body-parser@2.4.0, zod@4.6.7, hono@4.13.14, ip-address@10.7.5, fast-uri@3.1.9, undici@7.30.1 / 6.29.1.
- `npm test` 6055 tests, 6051 pass, 0 fail, 0 cancelled (incl. automation-mcp-server / mcp tool tests); `npm run typecheck`, `npm run lint`, `npm run format:check` clean.
- `npx electron --version` v44.9.3; `npx electron-builder --version` 26.17.0; SDK `server/streamableHttp.js` + `server/index.js` load under system Node (`ok`).
- Live MCP attach smoke: pass, as part of the `third-party-cookie-isolation` run `2026-10-27-02-44-04`. The MCP server was on the refreshed deps: 35 tools across the launch and two relaunches, the same admin key, about 168 calls, and only the expected `appQuit` `fetch failed`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-26 turnaround)
**Verdict**: confirmed, no blocking issues.
- `package.json` changes only the electron exact pin, and the SDK stays at 1.32.1.
- Every lockfile change is attributable to 0164 or 0165, with no semver-major and every package resolved from registry.npmjs.org.
- Independent gates: `npm ci` succeeds; `npm audit --audit-level=high` reports 0 vulnerabilities; Electron v44.9.3 with the feature string present; `npm test` 6055 (6051 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.
- The one wording nit (0164's notes were written before 0165 was applied) was corrected at close-out.
- Live-verified by `third-party-cookie-isolation` run 2026-10-27-02-44-04 (independent Validator, pass).

**Commit**: the `squawk: turnaround 2026-10-26` commit on `squawk/turnaround-2026-10-26`
