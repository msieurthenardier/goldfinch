# Squawk 0164: Electron 44.9.0 → 44.9.3 security patch (eMudhra cert mitigation + Chromium backports)

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-10-26
**Completed**: 2026-10-26

## Report
Electron 44.9.0 is missing two sets of security fixes, both reachable by a hostile web page in a browser:
- **GHSA-jr5w-w6x2-84p9** (high, CVSS 7.4), mitigation for compromised eMudhra intermediate certificates. Fixed in 44.9.1. A site could present a chain through a compromised intermediate and be trusted.
- **44.9.3 backports** ([electron#55149](https://github.com/electron/electron/pull/55149)), roughly 50 ANGLE, Chromium, PDFium, Skia and V8 fixes. They include Blink, GPU and media use-after-frees (SoftwareImageDecodeCache, ElementSMILAnimations, ServiceWorker DataPipeConnector/SimpleBufferManager, CdmPromiseAdapter, BluetoothPairingBlueZ), XMLDocumentParser re-entrancy, an FSA third-party handle block, and "[net] Validate server certificate before generating auth token". The upstream CVE IDs are not yet listed.

The fix is to bump the exact pin to 44.9.3. 44.9.2 has an empty changelog. Electron 45 (a major) is out of scope and needs a separate sortie.

The standard Electron-bump checks apply (precedent 0144, 0150 and 0154):
- the `node:sqlite` store suite via `npm test`;
- `ForceThirdPartyCookieBlockingEnabled` still present in the binary;
- the `third-party-cookie-isolation` behavior test, including its MCP attach smoke.

**Changelog items that touch Goldfinch:**
- The eMudhra mitigation and the auth-token cert validation are in Chromium's network and cert verifier. `cert-trust.js` answers `certificate-error` and `cert-observer.js` only records (`callback(-3)`), so no Goldfinch decision changes. A distrusted eMudhra chain now arrives as an ordinary `certificate-error`, which goes to the interstitial.
- `auth-challenges.js` (`app.on('login')`): with the upstream change, Chromium validates the server cert before it generates an auth token. No Goldfinch code path depends on the old ordering.

## Evidence
- `package.json`: `"electron": "44.9.0"` (exact pin). `npm ls electron` → 44.9.0.
- `npm audit`: `electron` high, GHSA-jr5w-w6x2-84p9, range `>=44.0.0-alpha.1 <44.9.1`, fixAvailable 44.9.3 (not semver-major).
- Electron security advisories published since 2026-09-01: every advisory other than jr5w was already patched at or before 44.5.0.
- Release notes: v44.9.1 (the jr5w note), v44.9.2 (empty), v44.9.3 (electron#55149).

## Corrective Action
Bumped the exact pin `electron` 44.9.0 -> 44.9.3 in `package.json` (no caret) and ran `npm install`. `package-lock.json` changed only for electron (version, resolved, integrity) plus the root mirror entry; 4 insertions, 4 deletions across the lockfile, 1 line in `package.json` (0164 alone; the combined turnaround lockfile diff also carries squawk 0165's refresh). No source changes; `npm audit fix` not run (transitive advisories are squawk 0165).

## Verification
Static checks done (Developer, 2026-10-26):
- Electron resolves to 44.9.3 (`npx electron --version` v44.9.3; the binary was downloaded). Under `ELECTRON_RUN_AS_NODE=1`: `{"chrome":"152.0.7977.167","node":"24.22.0"}`. `ForceThirdPartyCookieBlockingEnabled` present in the binary (`strings | grep -c` = 1).
- `node:sqlite` under Electron's own Node 24.22.0 (in-memory FTS5 create, insert, prefix `MATCH 'hel*'`): `{ c: 1 }`.
- `npm test`: 6055 tests, 6051 pass, 0 fail, 4 todo. `npm run typecheck` clean (exit 0). `npm run lint` clean. `npm run format:check` clean.
- `npm audit --audit-level=high` still exited 1 at this point (before 0165 was applied), as expected, from squawk 0165's transitive findings (body-parser, fast-uri, hono, ip-address, undici, zod); the `electron` entry is gone from `npm audit --json`.
- `git diff --stat`: only `package.json` and `package-lock.json`, plus the squawk files; no source changed. With 0165 applied on top, `npm audit --audit-level=high` reports 0 vulnerabilities.

Live checks done (Flight Director, 2026-10-26): **`third-party-cookie-isolation`: pass**, 14/14 judged, step 9 struck, no regression and no fail-open vs 44.9.0 (`tests/behavior/third-party-cookie-isolation/runs/2026-10-27-02-44-04.md`, independent Validator).
- Fixture ground truth: with isolation on, only the partitioned pair is sent; top site C gets nothing; all five unpartitioned names are sent only after a genuine isolate-off relaunch.
- `ForceThirdPartyCookieBlockingEnabled` in `--enable-features` tracks the configured state on, off, on. The UA is unmodified (`Electron/44.9.3`), and Chromium still reports 152.0.7977.167 (the backports are patches).
- Both relaunches attested: old PID gone +139 / +137 ms, new PID listening +414 / +453 ms, same key, no re-mint.
- **App database on `node:sqlite`:** settings and key hashes persisted across both relaunches.
- **MCP smoke:** 35 tools throughout; the only error is `appQuit`'s expected `fetch failed`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-26 turnaround)
**Verdict**: confirmed, no blocking issues.
- `package.json` changes only the electron exact pin, and the SDK stays at 1.32.1.
- Every lockfile change is attributable to 0164 or 0165, with no semver-major and every package resolved from registry.npmjs.org.
- Independent gates: `npm ci` succeeds; `npm audit --audit-level=high` reports 0 vulnerabilities; Electron v44.9.3 with the feature string present; `npm test` 6055 (6051 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.
- The one wording nit (0164's notes were written before 0165 was applied) was corrected at close-out.
- Live-verified by `third-party-cookie-isolation` run 2026-10-27-02-44-04 (independent Validator, pass).

**Commit**: the `squawk: turnaround 2026-10-26` commit on `squawk/turnaround-2026-10-26`
