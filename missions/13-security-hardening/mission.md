# Mission: Web-Content Security Hardening

**Status**: active

> Architect viability check: **feasible with caveats** (2026-07-24). Caveats incorporated into Open Questions and the Flight 2 charter. Phase-gate progression pre-authorized by operator for autonomous execution (issue #131 directive).

## Outcome

A hostile page loaded in a Goldfinch tab is contained the way the browser's documented threat model promises: a renderer compromise stays inside the OS sandbox, unknown permissions are denied rather than silently granted, the browser chrome can never be used as a side channel to link identities across cookie jars, and the internal IPC surface refuses callers it cannot identify. The audit in [issue #131](https://github.com/msieurthenardier/goldfinch/issues/131) closes with all six findings either fixed or explicitly ruled accepted-with-rationale.

## Context

A full-tree security audit against the Electron threat model (hostile page in a guest tab) produced six findings, verified against v0.11.3 and re-verified against v0.11.4 at mission planning:

1. **Web guests run `sandbox: false`** — a V8/Blink RCE escapes to full user-account privileges. Mechanically forced by `webview-preload.js`'s sibling `require()`s (no bundler exists in the project today).
2. **Permission policy is a deny-list** — anything outside twelve enumerated permissions auto-grants silently, including `openExternal` and every permission future Chromium versions introduce.
3. **Chrome view fetches page-controlled URLs (favicons, media thumbnails/players) in the default session** — a cross-jar linkability side channel through the flagship container-isolation feature. Code path verified by reading; live cookie-bearing request not yet confirmed.
4. **Most chrome-trust IPC channels don't validate the sender** — defense in depth; any future `ipcRenderer` leak escalates immediately to cross-tab control. `tab-navigate`'s `loadURL` arg also skips `isSafeTabUrl`.
5. **No `will-frame-navigate` / `will-redirect` guards; no `web-contents-created` catch-all** — subframes and server redirects bypass the URL-safety predicate; non-guest views have no window-open handler.
6. **Vault-capture `submit` listener lacks the `isTrusted` guard** its sibling handlers use — documented accepted tradeoff, but the update-disposition case is sharper than the comment covers.

The audit also verified several subsystems as strong (MCP automation auth, vault key hierarchy, `goldfinch://` trust model, cert-error posture) — those are out of scope and should not be re-litigated.

**Planning-time corrections to the issue text** (from re-verification at v0.11.4, HEAD `0e8e5f6`):
- Finding 3's primary favicon fetch site is `src/renderer/renderer.js:1285-1292` (payload is `{ wcId, favicons }`, an array); `tab-controller.js:872-875` is the secondary adopt-by-drop site, and `tab-controller.js:167,579` put favicon URLs into move/tear-off payloads.
- Finding 4: `tab-reopen` **does** validate its sender (`register-tab-ipc.js:236`) — remove it from the fix list. The `register-browser-ipc.js` cluster already gates *targets* via `externalContents()`/internal-session checks; the gap is caller identity only.
- The chrome view itself also runs `sandbox: false` (`window-factory.js:172-182`) — same hardening theme as finding 1's trusted-surface counterpart, in scope for the sandbox flight to assess.

## Success Criteria

- [x] A compromised web-guest renderer is contained by the OS sandbox: every web-content view constructs with the sandbox enabled, and a unit pin prevents regression. *(finding 1)*
- [x] The three preload-delivered capabilities — fingerprint farbling, media-panel scanning, and vault fill/capture — all work in the live app after sandboxing, verified against a real page. *(behavior-test-backed)*
- [ ] Permission requests are governed by a positive allowlist: any permission string not explicitly enumerated — including ones that don't exist yet — is denied, and a unit test proves an invented permission denies. The chrome privacy indicator keeps receiving grant/deny events. *(finding 2)*
- [x] No page-controlled URL is ever fetched by the browser chrome outside the owning jar's session; the chrome CSP no longer permits remote image/media origins, and a test pins the CSP. Cross-jar linkage via favicon or media-thumbnail fetches is demonstrated closed against a live cookie-setting server. *(finding 3, behavior-test-backed)*
- [ ] Every chrome-trust IPC channel either verifies its sender is a chrome renderer (or documents why it can't), and `tab-navigate`'s URL argument passes the same safety gate as every other navigation entry point. A test asserts a non-chrome sender is refused on a representative channel. *(finding 4)*
- [ ] Subframe navigations and server-side redirects are subject to the same URL-safety predicate as top-level navigations, and every webContents in the app — chrome, overlays, sheets, DevTools — has a window-open denial handler and a navigation guard. *(finding 5)*
- [ ] The vault-capture path either ignores synthetic (page-dispatched) submit events, or the accepted-tradeoff note explicitly covers the update-disposition case. *(finding 6)*
- [ ] The security posture record (CLAUDE.md architecture notes) reflects the new invariants: sandbox ruling documented next to the existing `contextIsolation` note; no stale claims remain.
- [ ] Full regression net stays green: `npm test`, `npm run lint`, `npm run typecheck` all pass at mission end.

## Stakeholders

- **Browser operator (the user)** — the privacy guarantees marketed by the product (cookie-jar isolation, burner tabs) actually hold against a hostile page; a drive-by renderer exploit no longer means account compromise.
- **Project maintainer** — the audit closes with a recorded disposition per finding; future Electron bumps stop silently widening the permission grant surface.
- **Future auditors/contributors** — invariants are pinned by tests and documented in CLAUDE.md, so the posture is discoverable and regressions are loud.

## Constraints

- **Zero-runtime-dependency identity is preserved.** A bundler (needed to collapse `webview-preload.js`'s sibling requires) may be added as a devDependency and build step only; the shipped app keeps `asar: false` with `src/**` on disk, and `@modelcontextprotocol/sdk` remains the sole runtime dependency.
- **`contextIsolation: false` on web guests stays.** It is a documented, load-bearing requirement (farbling preload must run in the page main world — CLAUDE.md:29). This mission changes the sandbox axis only.
- **No behavior regressions on trusted surfaces.** The trusted-branch `webPreferences` deepEqual test pin (`register-tab-ipc.test.js:194-197`), the `privacy-permission` indicator payload shape, and the internal-session exclusion mechanics must survive.
- **Planning artifacts and code live in goldfinch**, on a flight branch per Git conventions (`flight/{number}-{slug}`, commit subject `flight/{number}: {description}` with `Mission: 13` trailer).
- **Out of scope**: code signing and auto-update (issue #101) — finding 1's reach-users caveat is acknowledged but not solved here; the verified-strong subsystems listed in the audit; any change to the `goldfinch://` internal trust model beyond adding missing guards.

## Environment Requirements

- Local dev: Node ≥22, `npm test` (node --test), lint, typecheck — all headless.
- Live verification: `npm run dev:automation` under WSLg (Wayland), driven over the MCP automation surface (admin mode for chrome-level checks). Behavior tests follow the Witnessed pattern per `.flightops/ARTIFACTS.md`.
- Finding-3 live confirmation needs a local HTTP server that serves a `Set-Cookie` favicon/image (fixture under `tests/behavior/fixtures/`, served via `python3 -m http.server` or equivalent).

## Open Questions

- Does the favicon/media fetch actually carry default-session cookies live? (Flight 1 confirms before fixing; the fix is warranted either way — the fetch itself leaks a per-jar visit signal into the default session.)
- Media *playback* in the panel: streaming through the jar session via main is not free — full-file buffering breaks HTTP Range/seek semantics and is memory-unbounded for video. Flight 1 decides between jar-session proxying, a dedicated ephemeral partition for the chrome, or scoped acceptance for playback specifically; if the choice isn't clear from reading, Flight 1 runs a spike before finalizing legs (Architect flag: this could reshape the chrome's session model, not just add a fetch indirection).
- Can the chrome view itself flip to `sandbox: true` (it's `contextIsolation: true` already), or does its preload block it? Flight 2 assesses.
- Which currently-implicitly-granted permissions does real usage need (`fullscreen`, `pointerLock` likely)? Flight 3 enumerates **empirically** — driving real pages (fullscreen video, pointer-lock content) against an instrumented handler, not by code-reading alone. No code in `src/` currently models these paths; any reliance is purely through silent default-allow (Architect-verified).

## Known Issues

- [ ] **Chrome-view main sandbox flip deferred** — discovered in Flight 2, affects the chrome `WebContentsView` (`window-factory.js:178`, still `sandbox:false`). Flight 2 flipped the web guests + the two overlay preloads (find/menu) to `sandbox:true` but deferred the chrome view: it's a trusted `file://` surface (not a hostile-page host, so far lower value than the web-guest flip), `chrome-preload.js` has two `src/shared` relative requires needing their own bundling, and it reads `process.argv` to gate the automation surface (a sandboxed-preload `argv` regression would fail that gate *closed*). Candidate for a future hardening flight; not required for the finding-1 outcome (web guests are the hostile-content surface).
- [ ] **Vault fill/capture full UI round-trip under sandbox not re-exercised** — discovered in Flight 2. AC5 verified the vault IPC transport + init sendSync work under `sandbox:true` (farbling and media, which share the transport, are proven live), but a full save→fill credential round-trip was not re-run under sandbox. The existing vault behavior specs cover that path; a targeted sandbox run would close the gap fully.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses.

- [x] Flight 1: **Cross-jar fetch isolation** — live-confirm the default-session leak, then route all page-controlled URL fetches (favicons, media thumbnails; decide playback) through the owning jar's session, tighten the chrome CSP to enforce it. *(finding 3 — sequenced first: silent today, contradicts the flagship feature)*
- [x] Flight 2: **Renderer OS sandbox** — introduce a preload bundling step, flip web guests (and assess the chrome view) to `sandbox: true`, live-verify farbling/media-scan/vault-fill, record the ruling in CLAUDE.md. *(finding 1 — biggest raw security delta. Named risk: bundler integration is this repo's first build-time transform — output must land where electron-builder's `files: ["src/**/*"]` + `asar:false` + the internal-page `__dirname` resolver + `dev-launch.mjs` all still resolve it; highest-variance flight. De-risk: `internal-preload.js` already proves the sandboxed-preload pattern live, and `sandbox:true` + `contextIsolation:false` is a supported Electron combination — the sandbox restricts Node API surface, not context isolation.)*
- [ ] Flight 3: **Policy and IPC hardening batch** — permission allowlist inversion, sender validation across chrome-trust channels + `isSafeTabUrl` on `tab-navigate`, `will-frame-navigate`/`will-redirect`/`web-contents-created` guards, vault-capture `isTrusted` guard. *(findings 2, 4, 5, 6 — mechanical, shared risk profile)*

*(No alignment flight: this mission runs autonomously per operator directive; the work is verification-heavy rather than taste-driven.)*
