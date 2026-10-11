# Squawk 0145: Cloudflare "Verify you are human" loops forever since the web-guest UA stopped declaring Electron

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: 2026-10-10

## Report
On `https://go.teamsnap.com/login/signin` (any jar, Burner included), Cloudflare's managed challenge ("Performing security verification" → "Verify you are human") never clears. Clicking the checkbox just re-presents the challenge. Real Chrome on the same machine passes it without a click. This started with 0.19.0. It is a regression from squawk 0119 (`f6acb7b`), which strips the `goldfinch/<ver>` and `Electron/<ver>` tokens from every web session's UA. 0119 was itself only preventive: its claude.ai symptom turned out to be cookie isolation.

Repro: open the URL in any Goldfinch tab and click the Turnstile checkbox. It loops.

Fix: revert 0119's UA stripping so web sessions send Electron's default UA again. Keep a regression pin so the strip isn't silently reintroduced.

## Evidence
- Live bisect on WSLg, each build with its own throwaway `XDG_CONFIG_HOME` profile, with a human clicking the Turnstile checkbox:
  - `99c4d34` (0.18.2, Electron 44.4.4, default UA with `Electron/`): **passes**
  - `f6acb7b` (same Electron 44.4.4, tokens stripped): **loops**
- Ruled out on the 0.19.1 install: Shields paused for the site, Shields disabled, third-party cookie isolation off (after Restart now), and a worker-vs-main-thread UA mismatch (they're consistent). The Electron 44.5.x bumps are ruled out by the 44.4.4 pair.
- Likely mechanism (not proven; the bisect is the evidence): a UA claiming plain `Chrome/152` on an Electron runtime fails Cloudflare's consistency check. The runtime gives itself away: `window.chrome` is `{}`, UA-CH brands are Chromium-only, and some prototype hooks don't stringify as native. The honest Electron UA passes.
- `src/main/session-runtime.js:onSessionCreated` — `session.setUserAgent(stripEmbedderTokens(session.getUserAgent()))`. The helper is `src/main/user-agent.js:stripEmbedderTokens`. Pins are `test/unit/user-agent.test.js` and the 0119 block in `test/unit/session-runtime.test.js`. The CLAUDE.md "Cross-cutting facts" web-guest line describes the Chrome-shaped UA.

## Corrective Action
Reverted 0119's UA stripping so every web session sends Electron's default UA unmodified: removed the `stripEmbedderTokens` require and the try/catch `setUserAgent` block from `src/main/session-runtime.js` `onSessionCreated`; deleted `src/main/user-agent.js` and `test/unit/user-agent.test.js`; replaced the 0119 block in `test/unit/session-runtime.test.js` with a 0145 regression pin (no `setUserAgent` on web jar, no-jar/Burner/default, or internal sessions, plus a source-scan pin that no `src/main/**` file contains a `setUserAgent(` call, asserted non-vacuous); updated the CLAUDE.md web-guest clause. `docs/` had no mention of the stripped UA.

Why a full revert rather than a partial strip: the default UA (`Electron/` token present) is the only state the live bisect proved passes. A `goldfinch/`-only strip is untested and would still diverge from the runtime's own identity.

## Verification
- `npm run format`, `npm run format:check` (clean), `npm run lint` (clean), `npm run typecheck` (clean).
- `timeout 900 npm test`: 5877 tests, 5873 pass, 0 fail (remainder skipped).
- Neuter-verify: temporarily inserted `session.setUserAgent("x")` before `applyShields(session)` in `onSessionCreated`; `session-runtime.test.js` went 3 fail (web-jar pin, no-jar pin, source scan; 20 pass), and the internal-session pin stayed green because the internal early return precedes the insertion point, then removed the call (diff confirms only the intended deletions remain).
- Live bisect (Evidence): `99c4d34` (0.18.2, default UA) passes; `f6acb7b` (tokens stripped) loops, same Electron 44.4.4.
- Live after-fix (2026-10-10, this branch, Electron 44.5.1, fresh throwaway `XDG_CONFIG_HOME` profile, WSLg): `https://go.teamsnap.com/login/signin` Cloudflare challenge **passes** (human-clicked; operator-confirmed).
- claude.ai sanity (partial): a signed-out `claude.ai/artifact/*` link renders claude.ai's normal "sign in to view" page — no desktop-app misrouting at the signed-out tier. A signed-in artifact render was not checked.

## Sign-Off
*(written at completion)*
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — two non-blocking artifact wording nits (neuter-verify test list; duplicate Verification heading), both fixed by the Flight Director
**Commit**: the `squawk/0145: restore Electron's default web-guest user agent` commit on `squawk/0145-cloudflare-turnstile-loop-ua-strip`
