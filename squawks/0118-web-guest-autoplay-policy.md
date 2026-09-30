# Squawk 0118: Web guests start AudioContexts running with no user activation

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
GitHub #168 (gap 3). Web guests set no `autoplayPolicy`, so Electron's default `no-user-gesture-required` applies. A page's `new AudioContext()` goes straight to `running` on an idle page, with no click or keypress. Chrome desktop holds it `suspended` until the user activates the document. AliExpress's `collina.js`/`fireyejs.js` rely on this: they run a gain-0 `oscillator → analyser → ScriptProcessor → destination` graph that reads fingerprint samples before the user touches the page, and keeps the OS output stream open (the multipoint Bluetooth hijack) even from a background tab.

Fix (operator ruling 2026-09-29, Chrome parity): set `autoplayPolicy: 'document-user-activation-required'` on **both** web-guest `webPreferences` sites: the web branch of `tab-create` and the popup `overrideBrowserWindowOptions` (popups mirror the web-guest posture by the existing parity ruling). The internal branch stays unchanged. The value must be `document-user-activation-required`: the #168 spike showed that `user-gesture-required` gates top-frame Web Audio not at all (Blink applies it to Web Audio only in cross-origin iframes).

Out of scope, belonging to the #147 fingerprinting mission: read-site coverage (byte/time-domain reads, ScriptProcessor, AudioWorklet, OfflineAudioContext), silent-graph detection, privacy-panel relabel, and the silent-audio tab icon.

## Evidence
- `src/main/register-tab-ipc.js` `tab-create` web branch `webPreferencesObj` (`plugins: true`, no `autoplayPolicy`); `grep -rn autoplayPolicy src/` is empty.
- `src/main/guest-wiring.js` `setWindowOpenHandler` → `overrideBrowserWindowOptions.webPreferences` (the popup posture, same keys, no `autoplayPolicy`).
- #168 comments (2026-08-25): fixture repro, where `ctx.state` was `running` with `userActivation.hasBeenActive === false` for all three read modes. In the spike with `document-user-activation-required`, `ctx.state` was `suspended`, with 0 ScriptProcessor frames and 0 reads on an idle page, and a gesture-less `resume()` stayed pending.

## Corrective Action
Added `autoplayPolicy: 'document-user-activation-required'` to the web-branch `webPreferences` in `src/main/register-tab-ipc.js` (`tab-create`) and to the popup `overrideBrowserWindowOptions.webPreferences` in `src/main/guest-wiring.js`. The internal branch is unchanged. Tests pin the key at both sites, and the internal branch is asserted to carry no such key. CLAUDE.md's web-guest line gained a clause noting the policy.

## Verification
Neuter-verified: removing the key from register-tab-ipc.js turned register-tab-ipc.test.js red (1 fail), and removing it from guest-wiring.js turned guest-wiring.test.js red (2 fail). Both were restored. `npm run format:check`, `lint`, `typecheck` and `npm test` results are in the Developer hand-off. A live AudioContext re-check is left to the operator in the PR test plan, because the dev automation server was unavailable this session. The #168 spike (2026-08-25) already verified this exact setting live.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no issues. All other `WebContentsView` construction sites are internal or chrome views (exempt).
**Commit**: the `squawk/0118: web guests start AudioContexts suspended until user activation` commit on `squawk/0118-web-guest-autoplay-policy`
