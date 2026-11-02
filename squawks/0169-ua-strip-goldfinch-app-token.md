# Squawk 0169: Web-guest UA carries a near-unique `goldfinch/<ver>` token

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-02
**Completed**: 2026-11-02

## Report
Every web session sends Electron's default UA. That UA includes the app's name and version token, `goldfinch/0.19.9`. Goldfinch's install base is tiny, so the token is close to a unique identifier, and the version number narrows it further. It is a fingerprinting leak, and Shields' farbling can't cover it. The operator's concern is that one token only.

Fix: remove ONLY the `goldfinch/<ver>` token from every web session's UA. Keep `Electron/<ver>` and the rest of the string byte-identical. On Linux, Electron 44.10.0, the target is:

```
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36
```

Do NOT remove `Electron/` or spoof a plain-Chrome UA. Squawk 0145's live bisect proved that loops Cloudflare's managed challenge. 0145 explicitly flagged a goldfinch-only strip as untested, and this squawk is that test.

## Evidence
- Default UA, from launching the bundled Electron 44.10.0 (`app.userAgentFallback`): `… (KHTML, like Gecko) <appName>/<appVer> Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36`. The app name is `goldfinch` (`package.json` `name`, no `productName`), the version is `0.19.9`, and `src/main` has no `app.setName`.
- `src/main/session-runtime.js:onSessionCreated`: web sessions get no `setUserAgent` (0145 revert). The internal session returns early at `isCreatingInternalSession()`.
- `test/unit/session-runtime.test.js`: four squawk-0145 tests, including the source-scan pin `no src/main file contains a setUserAgent( call`. These must be reworked, not deleted.
- `CLAUDE.md` Cross-cutting facts, the web-guest line: "web sessions send Electron's default UA unmodified …".

## Corrective Action
- New pure helper `src/main/user-agent.js` `stripAppToken(ua, appName, appVersion)`: escapes regex metacharacters, removes exactly `<name>/<ver>` plus one separating space as a whole token, no-op when absent or on bad input, refuses to act when the app name is `Electron`/`Chrome`.
- `session-runtime.js` `onSessionCreated`: after the internal early return, try/caught `session.setUserAgent(stripAppToken(session.getUserAgent(), getAppName(), getAppVersion()))` (only when the result differs). `main.js` injects `getAppName: () => app.getName()` / `getAppVersion: () => app.getVersion()`. This is the only `setUserAgent(` site in `src/main`.
- Tests: new `test/unit/user-agent.test.js` (8 tests: Linux/Win/mac, absent, idempotent, metachars, Electron/Chrome safety, embedded tokens, edge positions). The four 0145 tests in `session-runtime.test.js` were reworked into 0169 form (jar and no-jar get the stripped UA with `Electron/` and `Chrome/` kept; the internal session never gets `setUserAgent`; the throw is isolated; the source scan allows exactly `[['session-runtime.js', 1]]`).
- CLAUDE.md web-guest clause updated.

Original scope:
1. In `onSessionCreated`, after the internal early return, one narrow `session.setUserAgent(…)` on every web session (jar, Burner, default) that removes exactly the `<app.getName()>/<app.getVersion()>` token (and its single separating space). It must be a no-op when the token is absent, never touch `Electron/` or `Chrome/`, and be try/caught like 0119's was. The token-removal helper stays pure and unit-testable (injected name/version, not a hardcoded literal).
2. Rework the 0145 pins: allow exactly ONE `setUserAgent(` site in `src/main/**` (the `onSessionCreated` one). Assert the resulting UA still contains `Electron/` and `Chrome/` and lacks the app token, and that the internal session never gets `setUserAgent`. Neuter-verify: removing the strip, or widening it to remove `Electron/`, must go red.
3. Update the CLAUDE.md web-guest clause: web sessions send Electron's default UA minus the `goldfinch/<ver>` app token, and the `Electron/` token stays (cite 0145 + 0169).

## Verification
- format:check, lint and typecheck clean. `npm test`: 6064 tests, 6060 pass, 0 fail (remaining 4 not failures, presumably skips).
- Neuter-verify (user-agent + session-runtime suites, 32 pass baseline): removing the strip gave 3 failures; widening it to also strip `Electron/` gave 5 failures; restored, 32 pass, 0 fail.
- Live UA check (dev mode, `dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, env-key script): a jar tab (`personal`) on https://example.com. `navigator.userAgent` in the main thread and in a Blob-URL dedicated Worker are identical and equal the target: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36`. A Burner tab was NOT live-checked (a jar key cannot open one, and no admin key was minted); the no-jar path is covered by the unit test only.
- **[HAT] Live Cloudflare gate**: **PASSED** (2026-11-02, operator-confirmed). Dev build of this branch (`npm start`) on a fresh throwaway `XDG_CONFIG_HOME` profile (third-party cookie isolation on, the default), WSLg; a human clicked the Turnstile checkbox on `https://go.teamsnap.com/login/signin` and the challenge cleared. That confirms a goldfinch-only strip, with `Electron/` kept, stays clear of the 0145 regression.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — no blocking or non-blocking issues. Two follow-ups were suggested, out of scope for this squawk: a packaged-build UA check (`build.productName` is `Goldfinch`, so the packaged token is `Goldfinch/<ver>`; the helper reads `app.getName()` at runtime, which should match) and a live admin-key check of the Burner and default sessions.
**Commit**: the `squawk/0169: strip the goldfinch/<ver> app token from the web-guest UA` commit on `squawk/0169-ua-strip-goldfinch-app-token`
