# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Goldfinch — an Electron desktop browser with a media panel (scan/play/download page media) and a privacy panel (Shields + cookie-jar identities).

## Commands

- `npm start` — run the app
- `npm run dev:debug` — run with remote debugging on `:9222` (`--no-sandbox`, WSL/headless friendly)
- `npm run dist` — build installers (electron-builder); `npm run pack` for an unpacked `--dir` build
- No test suite and no linter. **Verify changes by driving the running app over CDP**: start `dev:debug`, then connect to `http://127.0.0.1:9222` and `Runtime.evaluate` against the page target (the renderer) or the `webview` target (page content). The Playwright MCP can also attach via `.mcp.json`.

## Architecture

Three processes; understand the boundary before editing.

- **Main** (`src/main/`): `main.js` owns the BrowserWindow, downloads, the combined `webRequest` pipeline, the privacy aggregate, and all IPC. `shields.js` = persisted Shields config + tracking-param stripping; `jars.js` = container definitions; `trackers.js` = registrable-domain (eTLD+1) + tracker classification.
- **Preloads** (`src/preload/`): `chrome-preload.js` exposes `window.goldfinch.*` (contextBridge) to the UI. `webview-preload.js` is injected into every page and runs in the page's **main world** (media scanner + fingerprint detect/farble).
- **Renderer** (`src/renderer/`): `index.html` / `renderer.js` / `styles.css` — the browser chrome. Each tab is a `<webview>`. Holds the media panel, docked music player, privacy panel, Shields toggles, and the jar/container picker.

Key cross-cutting facts:
- **Shields apply to every jar via `app.on('session-created')`** in main. Each container/burner/default tab is a session partition; new jars inherit block/strip/isolate/downloads automatically. There is **one `webRequest` listener per event per session** — recording and enforcement share it (`applyShields`).
- **Webviews run with `contextIsolation:false`** (set in `will-attach-webview`), so the preload is in the page main world — required for fingerprint farbling. `nodeIntegration` stays off; preload internals stay module-scoped.
- **`asar:false`** in the build config so the webview preload loads from disk in packaged apps.
- Per-tab privacy/shield data flows: main aggregates → `privacy-net` IPC → renderer; preload fingerprint counts → `sendToHost` → renderer. Farble config is fetched **synchronously at page load** (`shields-farble`), so toggling farble needs a reload.
- Persisted state lives in `userData`: `shields.json`, `containers.json` (not in the repo).

## Release / CI

- `.github/workflows/build.yml`: pushing a `v*` tag builds Win/macOS/Linux installers, publishes a Release, and **auto-commits updated README download links** to `main` (`scripts/update-readme.mjs`, between `<!-- DOWNLOADS:START/END -->` markers). The **git tag is the source of truth for the version** — it syncs `package.json` at build time.
- `ci.yml`: lightweight Linux build-check on PRs.
- Cutting a release: bump `package.json`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
- App icon: `build/icon.png`. Note `goldfinch-*.png` at repo root and `.claude/settings.local.json` are gitignored.

## Flight Operations

This project uses [Flight Control](https://github.com/msieurthenardier/mission-control).

**Before any mission/flight/leg work, read these files in order:**
1. `.flightops/README.md` — What the flightops directory contains
2. `.flightops/FLIGHT_OPERATIONS.md` — **The workflow you MUST follow**
3. `.flightops/ARTIFACTS.md` — Where all artifacts are stored
4. `.flightops/agent-crews/` — Project crew definitions for each phase (read the relevant crew file)
