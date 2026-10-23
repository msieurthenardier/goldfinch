# Squawk 0154: Apply the dev-minor-patch dependency bumps (Dependabot #261) with verification

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

## Report
Dependabot PR #261 bumps Electron again. Per squawk 0138, an Electron bump is applied through the squawk flow with project verification, as 0144 and 0150 were:
- `electron` 44.7.1 → 44.9.0 (exact pin; Chromium 152.0.7977.149 → 152.0.7977.167, Node 24.21.0 → 24.22.0)
- `eslint` ^10.12.0 → ^10.13.0

The standard Electron-bump checks apply:
- the `node:sqlite` store suite via `npm test` (the main process's Node also moves to 24.22.0);
- `ForceThirdPartyCookieBlockingEnabled` still present in the binary;
- the `third-party-cookie-isolation` behavior test;
- an MCP attach smoke.

`eslint`: `npm run lint` must stay clean.

**Changelog items that touch Goldfinch:**
- **electron#55048, "link-opened windows not using the opener's session and `webPreferences`" (44.9.0).** Our popup allow path (`guest-wiring.js`, `setWindowOpenHandler` → `action: 'allow'` with `overrideBrowserWindowOptions.webPreferences`, NO partition key) relies on the popup inheriting the opener's jar. That premise was spike-verified, per the DD1d comment there. A named-target link (`<a target="name">`, `disposition: 'new-window'` with a non-`_blank` `frameName`) qualifies as a popup, which is exactly the link-opened surface this fix changes. *(Correction at completion: this premise was wrong. Link clicks, including an operator's real shift+click, arrive as `foreground-tab` and open an ordinary tab, as the `qualifiesAsPopupRequest` comment says. So the electron#55048 surface is not reachable from links in Goldfinch; see Verification.)* Re-run `popup-jar-inheritance` and check that:
  - popups from a container jar, and from Burner, land in the opener's jar;
  - the preload (farble) and `sandbox` / `contextIsolation:false` / `plugins` posture still apply;
  - both `window.open` and named-target-link openers behave this way.
- **electron#55046, "`setCertificateVerifyProc` occasionally not being applied to a request issued concurrently with the first request to a host" (44.9.0).** `cert-observer.js` installs on every web session's verify proc and only records (callback is always `-3`). The fix may change how many verdicts it records, but no decision depends on that. Run `tls-trust-surface` as the check.
- 44.8.0: `net.fetch` / `session.fetch` now recover after a Network Service restart. That's a positive change for `favicon-fetch.js` and `media-proxy-handler.js`; no action needed. Linux `Notification` action buttons and the macOS app shims don't apply to us.

## Evidence
- PR #261 (`dependabot/npm_and_yarn/dev-minor-patch-fb4c540eaf`) changes only `package.json` and `package-lock.json`. Its `package.json` diff keeps the exact Electron pin (`"electron": "44.9.0"`).
- `src/main/guest-wiring.js` `qualifiesAsPopupRequest`: `disposition === 'new-window' && (features || (frameName && frameName !== '_blank'))`. The allow branch comment reads "NO partition key: the popup's session is automatically the opener's jar (spike-verified; partition overrides are silently ignored)".
- `src/main/cert-observer.js`: "installed on every web session's `setCertificateVerifyProc`".
- Electron release notes v44.8.0 and v44.9.0. Precedent: squawks 0138, 0144 and 0150.

## Corrective Action
Applied #261's exact delta (`gh pr diff 261 | git apply`, `--check` clean; `package.json` + `package-lock.json` only): `electron` 44.7.1 -> 44.9.0 (exact pin, no caret), `eslint` ^10.12.0 -> ^10.13.0. `npm ci` clean. No source changes; no Prettier reformat was needed.

## Verification
Static checks done (Developer, 2026-10-22):
- Electron resolves to 44.9.0 (`npx electron --version` v44.9.0; `npx electron` downloaded the binary). Under `ELECTRON_RUN_AS_NODE=1`: `{"chrome":"152.0.7977.167","node":"24.22.0"}`. `ForceThirdPartyCookieBlockingEnabled` present in the binary (`strings | grep -c` = 1).
- `node:sqlite` under Electron's own Node 24.22.0 (in-memory FTS5 create, insert, prefix `MATCH 'hel*'`): `{ c: 1 }`.
- `npm test`: 5978 tests, 5974 pass, 0 fail, 4 todo (includes the `node:sqlite` store suite on system Node). `npm run typecheck` clean (exit 0). `npm run lint` clean under eslint v10.13.0, no output beyond the command banner. `npm run format:check` clean ("All matched files use Prettier code style!").
- `npm audit --audit-level=high` exits 0.
- `git diff --stat`: only `package.json` and `package-lock.json` (10 insertions, 10 deletions), plus this squawk file; no source changed.

Re-verified by the Flight Director (2026-10-22): v44.9.0, the feature string (1), `npm test` 5978 / 5974 / 0 fail / 4 todo, lint clean.

Live checks done (Flight Director, 2026-10-22). Three parallel batched runs, each on its own scratch instance and ports, each judged by an independent Validator:
- **`third-party-cookie-isolation`: pass.** 14/14 judged, step 9 struck, no regression against 44.7.1 (`tests/behavior/third-party-cookie-isolation/runs/2026-10-23-00-18-01.md`).
  - Both relaunches attested and timed: old PID gone +156 / +137 ms, new PID listening +454 / +452 ms, same key.
  - `ForceThirdPartyCookieBlockingEnabled` in `--enable-features` exactly when isolation is configured on.
  - **App database on Node 24.22.0 `node:sqlite`:** settings and jars persisted across both relaunches.
  - **MCP smoke:** 35 tools; the same admin key across launch plus two relaunches; 183 calls tallied, with only the expected `appQuit` `fetch failed`.
- **`popup-jar-inheritance`: pass, 5/5** (`tests/behavior/popup-jar-inheritance/runs/2026-10-23-00-18-01.md`). Step 5 passed with a spec-wording note: the viewless welcome boot tab is invisible to `enumerateTabs`.
- **`web-compat-oauth-popup`: 7 pass + step 3 by-eye clause not observed** (`tests/behavior/web-compat-oauth-popup/runs/2026-10-23-00-18-01.md`). The real-popup OAuth round trip works end to end on 44.9.0. The electron#55048 supplement:
  - named-target link clicks (synthetic, MCP, synthetic-shift, and the **operator's real shift+click**) all open ordinary tabs in the opener's jar (a fresh burner from Burner), so the fix's surface is unreachable from links;
  - `window.open(url, name, features)` popups from `work` and from Burner keep the opener's session (cookie marker), the preload (canvas-fingerprint hash identical to the opener's per-jar seed), `typeof require === 'undefined'` and a live opener.
- **`tls-trust-surface`, operator-approved automatable subset: 8/8 judged rows pass** (`tests/behavior/tls-trust-surface/runs/2026-10-23-00-18-01.md`). Trusted, proceed, keyboard and by-eye rows were not run, and NSS was untouched.
  - **electron#55046 probe:** 18 concurrent fetches to a never-contacted untrusted host all failed the handshake (-202), and nothing leaked through as trusted. The observer only records (`callback(-3)`), so the fix cannot change a trust outcome. Per-request observer coverage and mixed-trust races remain unproven without the NSS-anchored trusted fixture.
  - **Follow-up:** `captureWindow` returned `chrome window unavailable` once during the run. The Flight Director's re-check on 44.9.0 shows it is not tied to the secret sheet (3/3 captures succeeded with the card up); it is an intermittent first-capture null that fails closed, and whether it predates 44.9.0 is not established.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no issues.
- The PR #261 delta matches exactly (`git apply --check -R`), and the Electron pin stays exact.
- The lockfile is confined to electron and eslint plus the root mirror.
- Independently re-checked: the feature string and `node:sqlite` FTS5 under Electron's Node 24.22.0.
- Gates: `npm test` 5978 (5974 pass, 0 fail, 4 todo); typecheck, lint, format:check and audit clean.
- The changelog analysis is consistent with `guest-wiring.js` and `cert-observer.js`.
- Live-verified by the four behavior-test runs above (independent Validators) and the operator's shift+click check.

**Commit**: the `squawk/0154` commit on `squawk/0154-dev-minor-patch` (supersedes Dependabot #261)
