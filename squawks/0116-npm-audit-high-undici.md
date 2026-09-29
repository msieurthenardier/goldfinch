# Squawk 0116: `npm audit --audit-level=high` fails on main (transitive undici)

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
The CI audit gate (`npm audit --audit-level=high`, Concourse `ci/tasks/audit.yml`, run on every push to `main`) exits 1 on `origin/main` (`f01ec72`, v0.18.0): one **high** — `undici` `<=6.28.0 || 7.0.0 - 7.29.0` (advisories incl. GHSA-w293-vg96-wgc3 TLS certificate validation bypass, GHSA-2jfj-6hjv-fm6j cookie disclosure, several DoS) — and one moderate (`ip-address`). Found while verifying squawk 0115; not caused by it.

## Evidence
`npm audit --audit-level=high` against `origin/main`'s `package.json` + `package-lock.json` → exit 1, "2 vulnerabilities (1 moderate, 1 high) … fix available via `npm audit fix`". Paths: `node_modules/undici` (via `electron` → `@electron/get`) and `node_modules/node-gyp/node_modules/undici` (via `electron-builder`). Both are dev/build-time dependencies. CLAUDE.md: "A high in a dev-only dep is fixed by bumping the dep, never by lowering the gate."

## Corrective Action
Lockfile-only `npm audit fix` (no `--force`, audit level unchanged, no ignore/overrides). `package.json` untouched by this step. Only three lockfile entries moved (checked by diff against squawk 0115's lockfile state):

- `undici` (via electron -> @electron/get): 7.29.0 -> 7.30.0
- `node-gyp/node_modules/undici` (via electron-builder): 6.28.0 -> 6.29.0
- `ip-address`: 10.4.0 -> 10.7.2

## Verification

- `npm audit --audit-level=high`: before, exit 1 (1 high, 1 moderate); after, exit 0, "found 0 vulnerabilities" (no residual low/moderate).
- `npm ci` in a scratch copy of package.json + package-lock.json: succeeded, 0 vulnerabilities.
- `npm test`: 5752 tests, 5748 pass, 0 fail, 4 todo.
- `npm run typecheck`, `npm run lint`: clean. `npm run format:check`: all files Prettier-clean.
- `npm run pack`: succeeded (electron 44.4.4, linux-unpacked).

## Sign-Off
**Reviewer**: independent Reviewer agent (batch review scoped to the diff; `npm ci`, `npm audit --audit-level=high` 0 vulnerabilities, `npm test` 5748 pass / 0 fail, lint, typecheck, format:check clean)
**Verdict**: confirmed
**Commit**: the `squawk: turnaround 2026-09-29` commit on `squawk/turnaround-2026-09-29-3`

## Disposition
