# Squawk 0167: Electron 44.9.3 → 44.10.0 security patch (FSA blocklist gaps + Chromium 152.0.7977.169)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-28
**Completed**: 2026-10-28

## Report
Electron 44.10.0 (2026-10-27) is the newest 44.x. It carries [electron#55330](https://github.com/electron/electron/pull/55330), which closes File System Access blocklist gaps (`.git/hooks` writes, hypervisor UNC shares), and updates Chromium 152.0.7977.167 → 152.0.7977.169 (#55033) and Node 24.22.0 → 24.22.1 (#55162).

Context: Chrome's October RCE batches. 44.9.3 (squawk 0164) already carries every October `44-x-y` security backport roll-up (#54657, #54666, #54898, #55034, #55149). Chrome's 2026-10-27 stable (156.0.8078.73/.74, 52 fixes, incl. sandbox-escape CVE-2026-118306) is **not** yet backported to `44-x-y` and is not in 44.10.0. A follow-up bump is needed when that roll-up ships; it is out of scope here. Electron 45 (a major) is also out of scope.

Severity is routine: Goldfinch's permission allowlist (`session-runtime.js` `ALLOWED_PERMISSIONS`) does not grant `fileSystem`, so #55330's surface is already refused. The bump is taken for currency and the Chromium patch level.

The standard Electron-bump checks apply (precedent 0144, 0150, 0154, 0164):
- the `node:sqlite` store suite via `npm test` (Node moves 24.22.0 → 24.22.1);
- `ForceThirdPartyCookieBlockingEnabled` still present in the binary;
- the `third-party-cookie-isolation` behavior test, including its MCP attach smoke.

**Changelog items that could touch Goldfinch:** none found. `src/` uses none of `webRequest.onSendHeaders` (#55168), `session.registerPreloadScript` (#55182), `utilityProcess` (#55273) or `protocol.registerSource` (#55177). Linux fixes (#55290 D-Bus crash on a disconnected bus, #55327 X11 paste hang) are benign. The asar fixes (#55176, #55183) don't apply (`asar: false`).

## Evidence
- `package.json`: `"electron": "44.9.3"` (exact pin).
- `npm view electron versions`: 44.10.0 is the newest 44.x; 45.1.0 is latest.
- Release notes: [v44.10.0](https://releases.electronjs.org/release/v44.10.0) (Chromium 152.0.7977.169, Node 24.22.1).
- `gh pr list -R electron/electron --base 44-x-y --label "security 🔒"`: newest security PR is #55330 (merged 2026-10-26); none yet for Chrome's 2026-10-27 release.
- `grep -rn "onSendHeaders\|registerPreloadScript\|utilityProcess\|registerSource" src` → no hits.

## Corrective Action
Bumped the exact pin `electron` 44.9.3 -> 44.10.0 in `package.json` (no caret) and ran `npm install`. `package-lock.json` changed only for electron (version, resolved, integrity) plus the root mirror entry; 4 insertions, 4 deletions in the lockfile, 1 line in `package.json`. No source changes; `npm audit fix` not run. Taken for currency and the Chromium 152.0.7977.169 patch level (the FSA surface is already refused by `ALLOWED_PERMISSIONS`).

## Verification
Static checks done (Developer, 2026-10-28):
- Electron resolves to 44.10.0 (`npx electron --version` v44.10.0; the binary was downloaded). Under `ELECTRON_RUN_AS_NODE=1`: `{"chrome":"152.0.7977.169","node":"24.22.1"}`. `ForceThirdPartyCookieBlockingEnabled` present in the binary (`strings | grep -c` = 1).
- `node:sqlite` under Electron's own Node 24.22.1 (in-memory FTS5 create, insert, prefix `MATCH 'hel*'`): `{ c: 1 }`.
- `npm test` (exit 0): 6055 tests, 6051 pass, 0 fail, 4 todo. `npm run typecheck` exit 0. `npm run lint` exit 0. `npm run format:check` exit 0. `npm audit --audit-level=high` exit 0 (0 vulnerabilities).
- `git diff --stat`: only `package.json` (1 line) and `package-lock.json` (4+/4-), plus this squawk file; no source changed.

Live checks done (Flight Director, 2026-10-28): **`third-party-cookie-isolation`: pass**, 14/14 judged, step 9 struck, no regression and no fail-open vs 44.9.3 (`tests/behavior/third-party-cookie-isolation/runs/2026-10-28-22-10-53.md`, independent Validator).
- Cookie log name-for-name identical to the 44.9.3 baseline: only the partitioned pair with isolation on (including pending-off); nothing on top site C; all five unpartitioned names only after a genuine isolate-off relaunch.
- `ForceThirdPartyCookieBlockingEnabled` in child `--enable-features` tracks configured on, off, on. Running binary: Chromium 152.0.7977.169, Node 24.22.1.
- Both relaunches attested: old PID gone +154 / +130 ms, new PID listening +402 / +380 ms, same key, one mint line.
- **App database on `node:sqlite`:** shields and key hashes persisted across both relaunches.
- **MCP smoke:** 35 tools throughout; the only error is `appQuit`'s expected `fetch failed`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped review)
**Verdict**: confirmed, no blocking or non-blocking issues.
- `package.json` changes only the electron exact pin; every lockfile change is electron 44.10.0 from registry.npmjs.org.
- Independent gates: `npm ci` succeeds; Electron v44.10.0 with Chromium 152.0.7977.169 / Node 24.22.1 and the feature string present; `npm test` 6055 (6051 pass, 0 fail, 4 todo); typecheck, lint and format:check clean; `npm audit --audit-level=high` 0 vulnerabilities.
- Report claims re-checked: no `src/` use of the changed APIs; `ALLOWED_PERMISSIONS` (`src/main/session-runtime.js`) has no file-system permission.
- Live-verified by `third-party-cookie-isolation` run 2026-10-28-22-10-53 (independent Validator, pass).

**Commit**: the `squawk/0167` commit on `squawk/0167-electron-44-10-0-security-patch`
