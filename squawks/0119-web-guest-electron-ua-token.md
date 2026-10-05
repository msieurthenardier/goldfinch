# Squawk 0119: Web guests send Electron's default user agent, so sites that sniff for Electron misidentify Goldfinch

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-01
**Completed**: 2026-10-01

## Report
Web guests send Electron's default user agent, which includes the app token and the Electron token: `… (KHTML, like Gecko) goldfinch/0.18.2 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36`. Sites that sniff for `Electron/` misidentify Goldfinch as an embedded app shell. claude.ai, for example, treats any user agent containing `" Electron/"` as its own desktop app (`X-Frame-Platform: desktop`, expects `window.claudeAppBindings`). Other sites block embedded logins on that token. Goldfinch is a general-purpose browser and should present a Chrome-shaped user agent. This is a preventive fix.

**Not the cause of the claude.ai artifact notice.** The original report blamed the user agent for "This browser isn't supported" on `claude.ai/artifact/*`. A live check disproved that: with this fix applied the notice remains. The real cause is Shields' third-party cookie isolation stripping `Cookie`/`Set-Cookie` on the artifact frame (`*.frame.claudeusercontent.com`). The artifact renders with isolation off and fails again with it on. That needs a design call and is carried as a sortie.

Fix: an Electron-free pure helper removes the `goldfinch/<ver>` and `Electron/<ver>` tokens, and the space before each, from a user-agent string. Everything else stays as it is. Apply it in `session-runtime.js` `onSessionCreated` to every **web** session, after the internal-session early return and before the jar lookup, so Burner and the default session are covered too: `session.setUserAgent(stripEmbedderTokens(session.getUserAgent()))`. The internal session is left alone.

Out of scope (a design call, so a sortie if wanted): spoofing a `"Google Chrome"` brand in User-Agent Client Hints (`navigator.userAgentData` / `Sec-CH-UA`).

## Evidence
- `grep -rni 'useragent' src/` is empty, so nothing ever sets the user agent.
- Live probe in a default-jar tab via `evaluate`: `navigator.userAgent` is as quoted above. Brands are `[Not?A_Brand 24, Chromium 152]`.
- claude.ai bundle (`shared-common-mcp-msg-5-*.js`): `return e.includes(" Electron/")?"desktop":…` feeds `X-Frame-Platform`. Its real unsupported-browser banner (`shared-3-*.js` `$O`) skips Electron user agents and only runs on `/new`, so it isn't the cause.
- `src/main/session-runtime.js:onSessionCreated` is the shared per-session hook for every web session (`applyShields`, cert observer, downloads, spellcheck).

## Corrective Action
- New `src/main/user-agent.js` (`// @ts-check`, CJS, Electron-free, pure): `stripEmbedderTokens(ua)` splits on single spaces and drops only tokens matching `/^(?:goldfinch|electron)\/\S+$/i` (app name and `Electron` matched case-insensitively; no version hardcoded). Every other token is left byte-identical, and nothing new is joined in, so no double space is ever introduced. Non-string or empty input comes back unchanged. The function is idempotent. Lookalikes (`goldfinchy/…`, `NotElectron/…`, a bare `Electron`) are kept.
- `src/main/session-runtime.js` `onSessionCreated`: right after the `isCreatingInternalSession()` early return, and so before `applyShields`, the cert observer, downloads, spellcheck and the jar-lookup early return, it runs `session.setUserAgent(stripEmbedderTokens(session.getUserAgent()))`. That covers every web session (jar, Burner, default). The internal session is never touched. The call is wrapped in try/catch and logs `[user-agent] strip failed:` through the injected `logger`, so a failure in it can never skip the Shields/cert/download wiring. It is set on the session before any guest navigates, so both the `User-Agent` header and `navigator.userAgent` follow it.
- Why this fix: claude.ai, and any other site that sniffs `" Electron/"`, then sees an ordinary Chrome UA. The change touches no interface, schema or settings. UA-CH brands are deliberately left alone (out of scope, see above).
- CLAUDE.md: a one-clause note on the "Cross-cutting facts" web-guest line.

## Verification
- `test/unit/user-agent.test.js` (new). The real Electron 44 Windows UA becomes exactly `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36`. Also covered: Linux and macOS variants (including a prerelease app version), a case-insensitive `Goldfinch/`, a trailing embedder token, no double spaces, idempotence, an already clean UA left unchanged, lookalikes kept, and non-string/empty passthrough.
- `test/unit/session-runtime.test.js`: the `fakeSession` fake gained `getUserAgent`/`setUserAgent`, recorded in a separate `userAgentSets` array so the exact-shape `log`/`counts` assertions are untouched. New tests: a web session gets the stripped UA; a no-jar session (Burner/default) gets the stripped UA; the internal session gets no `setUserAgent`; a throwing `getUserAgent` is fail-soft, with Shields, the cert verify-proc and downloads still wired and the error logged.
- Neuter-verify: replacing the `setUserAgent(...)` call with a no-op turned 3 tests red (web session, no-jar session, fail-soft log assertion; 13 pass / 3 fail). Restoring it gave 16/16 green.
- `npm run format` then `npm run format:check`: clean. `npm run lint`: clean. `npm run typecheck`: clean. `npm test`: 5769 tests, 5765 pass, 0 fail.
- Live (2026-10-01, dev instance on this branch, signed in to claude.ai): in a `personal`-jar tab, `navigator.userAgent` was `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36`, with no `goldfinch/` or `Electron/` token. The claude.ai artifact notice persisted, and the Shields isolation toggle was confirmed as its actual cause (see Report).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues. A non-blocking note: the code comment's "default session" means the `persist:goldfinch` default jar. Coverage was confirmed for jar, Burner, default-jar and popup (opener session) sessions; the internal session is untouched.
**Commit**: the `squawk/0119: strip Electron and app tokens from the web-guest user agent` commit on `squawk/0119-web-guest-electron-ua-token`
