# Leg: electron-upgrade

**Status**: completed
**Flight**: [Dependency Currency — Electron Major Upgrade](../flight.md)

## Objective
Upgrade Electron **33.4.11 → 42.3.3** (9 majors) and `electron-builder 25.1.8 → 26.8.1`, using `npm run typecheck` as the type-level regression net and the running app (CDP) as the runtime smoke gate; fix any type/runtime breakage; clear the security advisories.

## Context
- Flight DD "Upgrade path — direct to latest (42)" + "electron-builder bump". The app is **entirely built on `<webview>`** with `contextIsolation:false`, `session.webRequest` shields wiring, `setWindowOpenHandler`, `will-attach-webview`, `setPermissionRequestHandler`, and the preload IPC (`sendToHost`, `sendSync`).
- Design review (live) checked the 34–42 breaking-change surface against actual usage: `<webview>` tag, `contextIsolation:false` for webviews, `will-attach-webview`, `session.webRequest.*`, `setWindowOpenHandler`, `sendToHost` are all **still valid in E42**. The one real deprecation is **`ipcRenderer.sendSync`** (the farble handshake).
- Prerequisite: Leg 1 (`jsconfig` on `"bundler"`) landed — type errors after the bump are now attributable to the Electron API change.

## Inputs
- `package.json` (deps + the `build` block), `src/main/main.js`, `src/preload/webview-preload.js`, the `.d.ts` typedefs (`session-augments.d.ts`, `renderer-globals.d.ts`), `src/renderer/renderer.js` (the `Electron.WebviewTag` casts).

## Outputs
- `package.json`/`package-lock.json` — `electron ^42.3.3`, `electron-builder ^26.8.1` (+ any new peer deps the bump requires).
- Type-annotation/`.d.ts` fixes for any changed `WebviewTag`/`Session`/IPC signatures (only if typecheck surfaces them).
- Runtime fixes in `main.js`/preloads (only if the app breaks on E42).

## Acceptance Criteria
- [ ] `package.json` declares `electron ^42.3.3` and `electron-builder ^26.8.1`; `npm install` succeeds and `node -e "require('electron/package.json').version"` reports a 42.x version.
- [ ] `npm run typecheck` → **0 errors** on the Electron-42 types (any changed `WebviewTag`/`Session`/IPC signature is fixed at the cast/typedef site — these are the regression net, not suppressed).
- [ ] `npm test` (147 pass) and `npm run lint` (exit 0) stay green.
- [ ] The app **launches** on E42 via `npm run dev:debug` and the renderer `page` + at least one `webview` guest target are reachable via CDP at `:9222`; no crash/white-screen in the launch log.
- [ ] **`sendSync` decision recorded**: launch the app and check the console. If `ipcRenderer.sendSync` (farble handshake, `webview-preload.js:231`) only logs a **deprecation warning but still returns the config** (farbling works) → **keep it** (migrating to async would break the document-start timing that the fingerprint hooks depend on); optionally suppress the warning. Only if `sendSync` is **removed/throws** → implement a timing-preserving fix (see Edge Cases) — and if that's non-trivial, flag a divert. Record which path was taken in the flight log.
- [ ] **Audit checkpoint**: `npm audit --audit-level=high` → **0 highs** (the bumps clear the electron CVEs + the tar-via-electron-builder chain). Report the actual audit summary. (If highs unexpectedly remain, report them — Leg 4 will adjust the gate policy.)
- [ ] **Builder check**: `npx electron-builder --linux --dir` completes (packaging works under eb26 with the current `build` block — oneClick:false, asar:false, identity:null, nsis).

## Verification Steps
- `npm run typecheck` → 0; `npm test` → 147; `npm run lint` → 0.
- `node -e "require('electron/package.json').version"` → 42.x.
- Launch `npm run dev:debug` (background); `curl :9222/json` shows a `page` + a `webview`; tail the launch log for errors/crashes and for any `sendSync`/other deprecation warnings.
- `npm audit --audit-level=high` → 0 highs (capture summary).
- `npx electron-builder --linux --dir` → exits 0.

## Implementation Guidance
1. **Bump deps**: edit `package.json` devDependencies — `electron` → `^42.3.3`, `electron-builder` → `^26.8.1`. `npm install` (large electron download — allow time). If npm reports a required peer dep (e.g. for eb26), install it.
2. **Typecheck-fix**: `npm run typecheck`. For each error, fix at the source — most likely at `renderer.js` `Electron.WebviewTag` casts, `session-augments.d.ts` (if `Session` shape changed), or `renderer-globals.d.ts`. Use real annotations; honor the flight's ≤5 `@ts-expect-error` budget only for genuinely untypable spots.
3. **Launch + smoke**: `npm run dev:debug` in the background; confirm via CDP the renderer + a webview exist; navigate a tab (`createTab('https://example.com/')` via Runtime.evaluate) and confirm it renders. Tail the log for crashes/warnings.
4. **`sendSync` check** (per the AC) — keep if it works-with-warning; timing-preserving fix only if broken.
5. **Runtime-fix**: if the webview/session/shields/downloads wiring broke (e.g. a `webRequest` callback shape change, a `will-attach-webview` arg change), fix in `main.js`/preloads. Re-run the smoke check.
6. **Audit + builder checkpoints** (per AC). Stop the background app when done.
7. Update `CLAUDE.md`/`README` only if the Electron version is referenced there in a way that's now stale (the tag/version is the build source of truth; the README DOWNLOADS block is auto-managed — don't touch it).

## Edge Cases
- **`sendSync` removed (timing-preserving fix)**: the farble handshake is synchronous so the fingerprint hooks install *before* page scripts read `navigator`/canvas. An async `invoke` would arrive too late. If `sendSync` is gone, options (in order of preference): (a) precompute the farble config in `main.js` and inject it via the `webview` `preload` args / a `did-attach-webview` push so it's available synchronously at document-start; (b) install hooks unconditionally at document-start and reconfigure them when the async config arrives (accepting a tiny window); (c) flag a divert if neither cleanly preserves the security property. **Do not silently switch to async** — that degrades the farble guarantee.
- **eb26 peer deps**: eb26 may split out `@electron/notarize`/squirrel deps — but `identity:null` + `nsis` (not squirrel) means none should be required; install only if npm errors.
- **Large npm install**: electron 42 is a big binary download; the install may take a while — not a failure.
- **Chromium console noise**: E42 may log new security warnings (CSP/insecure-content) that are pre-existing/cosmetic — distinguish those from actual errors.

## Files Affected
- `package.json` / `package-lock.json` — electron 42, electron-builder 26
- `src/renderer/renderer.js` / `src/main/session-augments.d.ts` / `src/renderer/renderer-globals.d.ts` — only if typecheck surfaces API changes
- `src/main/main.js` / `src/preload/webview-preload.js` — only if runtime breaks (incl. a sendSync fix)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] typecheck/test/lint green; app launches on E42; audit 0 highs; builder packages
- [ ] Update flight-log.md with leg progress entry (incl. the sendSync decision + any runtime fixes + audit summary)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 2 of 4)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
