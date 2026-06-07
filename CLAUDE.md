# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Goldfinch — an Electron desktop browser with a media panel (scan/play/download page media) and a privacy panel (Shields + cookie-jar identities).

## Commands

- `npm start` — run the app
- `npm run dev:debug` — run with remote debugging on `:9222` (`--no-sandbox`, WSL/headless friendly)
- `npm run dist` — build installers (electron-builder); `npm run pack` for an unpacked `--dir` build
- `npm test` — runs `node --test` over `test/unit/**`. Unit suite covers the pure security/privacy helpers (`src/shared/url-safety.js`, `src/main/download-path.js`, `jars.js` validation + `isSafeColor`, `trackers.js`, `shields.js`). **For real-environment / UI behavior, drive the running app over CDP**: start `dev:debug`, then connect to `http://127.0.0.1:9222` and `Runtime.evaluate` against the page target (the renderer) or the `webview` target (page content). The Playwright MCP can also attach via `.mcp.json`. See `tests/behavior/` for behavior-test specs.
- `npm run lint` — ESLint over the whole repo (`eslint.config.mjs`; flat config).
- `npm run typecheck` — `tsc --noEmit -p jsconfig.json`; checks all `// @ts-check` files.
- `npm run a11y` — axe-core accessibility audit (`scripts/a11y-audit.mjs`). Attaches to the running app's renderer over CDP at `:9222` (requires `npm run dev:debug`), drives the chrome into each state (base chrome → media panel → privacy panel → lightbox), injects axe-core, and fails on any violation. Accepts `--rules=`, `--tags=`, and `--url=` (the media fixture to load; defaults to `http://127.0.0.1:8000/` — serve `tests/behavior/fixtures/a11y-media/` via `python3 -m http.server`). **Gate convention**: `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` runs only the WCAG 2.1 A/AA conformance rules (what the verify-leg sweep gates on); axe's full default set additionally flags best-practice *advisories* (e.g. `region`, the documented app-shell exception) that are not conformance failures. `nested-interactive` is **always** disabled (the tab strip's `role="tab"` wrapping a focusable close `<button>` is an accepted APG tab/close pattern). This gate is **real-environment / verify-only — NOT part of headless CI** (it needs the live GUI at `:9222`).

## Architecture

Three processes; understand the boundary before editing.

- **Main** (`src/main/`): `main.js` owns the BrowserWindow, downloads, the combined `webRequest` pipeline, the privacy aggregate, and all IPC. `shields.js` = persisted Shields config + tracking-param stripping; `jars.js` = container definitions; `trackers.js` = registrable-domain (eTLD+1) + tracker classification.
- **Preloads** (`src/preload/`): `chrome-preload.js` exposes `window.goldfinch.*` (contextBridge) to the UI. `webview-preload.js` is injected into every page and runs in the page's **main world** (media scanner + fingerprint detect/farble).
- **Renderer** (`src/renderer/`): `index.html` / `renderer.js` / `styles.css` — the browser chrome. Each tab is a `<webview>`. Holds the media panel, docked music player, privacy panel, Shields toggles, the jar/container picker (the `▾` menu), and the **⋮ overflow (kebab) menu** at the right of the toolbar (Settings placeholder + Exit; Exit fires the `app-quit` IPC → `app.quit()`, the only all-platform quit path — distinct from `window-close`, whose `window-all-closed` darwin guard does not quit on macOS). The tab strip is an ARIA `tablist`/`tab` roving-tabindex widget (ArrowLeft/Right + Home/End navigate and activate; Delete/Backspace closes the focused tab); its keyboard/screen-reader contract is pinned by the `tab-keyboard-operability` behavior test (`/behavior-test tab-keyboard-operability`), and accessibility across all chrome states is regression-gated by `npm run a11y` (see Commands). Both popup menus (the `▾` container picker and the ⋮ kebab) register with a shared `menuController` that owns open/close, outside/blur dismissal, and mutual-exclusion; each registers its own APG `role="menu"`/`menuitem` roving-tabindex keyboard nav (Arrow/Home/End/Escape/Tab) via the shared `focusItem` helper.

Key cross-cutting facts:
- **Shields apply to every jar via `app.on('session-created')`** in main. Each container/burner/default tab is a session partition; new jars inherit block/strip/isolate/downloads automatically. There is **one `webRequest` listener per event per session** — recording and enforcement share it (`applyShields`).
- **Webviews run with `contextIsolation:false`** (set in `will-attach-webview`), so the preload is in the page main world — required for fingerprint farbling. `nodeIntegration` stays off; preload internals stay module-scoped.
- **`asar:false`** in the build config so the webview preload loads from disk in packaged apps.
- Per-tab privacy/shield data flows: main aggregates → `privacy-net` IPC → renderer; preload fingerprint counts → `sendToHost` → renderer. Farble config is fetched **synchronously at page load** (`shields-farble`), so toggling farble needs a reload.
- Persisted state lives in `userData`: `shields.json`, `containers.json` (not in the repo).
- **Frameless window** (`main.js`, `new BrowserWindow`), branched on `process.platform`: `frame:false` on win/linux (custom window controls), `titleBarStyle:'hidden'` + `trafficLightPosition` on macOS (native traffic lights); `minWidth:900`/`minHeight:600` preserved. Custom minimize/maximize-restore/close controls live in the tab strip's reserved `#window-controls` zone, wired via `window.goldfinch` → `ipcMain` (`window-minimize` / `window-toggle-maximize` / `window-close`; `window-is-maximized`). The maximize button's `aria-label` + `data-state` stay in sync by forwarding main's `maximize`/`unmaximize` events over IPC (`window-maximized-change`) — the observable read path the behavior test consumes. Close calls `mainWindow.close()` (**not** `app.quit()`), riding the existing `closed → window-all-closed → app.quit()` chain.
- **Chrome drag regions** (`-webkit-app-region`): `#tabstrip` is `drag`; the pill, tabs, and window-control buttons are `no-drag`; a `#tabstrip-drag` spacer guarantees a grab area. The strip lays out as tabs → golden `#newtab-pill` (`+`/`▾`, hugging the tabs) → `#tabstrip-drag` → `#window-controls`. `chrome-preload.js` also exposes `platform`; the renderer tags `<html>` with a `platform-{platform}` class for platform-specific CSS (macOS-only inset; non-darwin frameless border).

## Patterns

### `src/shared/` dual-export predicate

Pure predicate modules in `src/shared/` export themselves for both execution contexts in a single file. Example: `url-safety.js` defines `isSafeTabUrl` and `isSafePosterUrl`, then at the bottom:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isSafeTabUrl, isSafePosterUrl }; // main process + test runner (require)
} else {
  globalThis.isSafeTabUrl = isSafeTabUrl;             // renderer (nodeIntegration:false, loaded via <script>)
  globalThis.isSafePosterUrl = isSafePosterUrl;
}
```

The renderer loads the file via `<script src="...url-safety.js">`, which sets the functions as globals. The main process and unit tests use `require()`. The unit tests therefore run against the exact same code the app uses — no stubs or duplicates.

### Two-point hostile-URL security boundary

Hostile URL injection is blocked at two independent enforcement points, both using `isSafeTabUrl`:

1. **`createTab` gate** (`src/renderer/renderer.js`) — rejects any URL that isn't `http:`, `https:`, or `about:blank` before a `<webview>` is created.
2. **`will-navigate` guard** (`src/main/main.js`) — `contents.on('will-navigate', …)` calls `e.preventDefault()` on the same predicate, blocking navigation that bypasses the renderer gate (e.g. via `window.open` or `<a target=_blank>`).

The shared predicate ensures both gates stay in sync automatically.

## Release / CI

The two workflows are **supply-chain hardened** (mission `01-maintenance`, Flight 4). Preserve these invariants when editing them:

- **All `uses:` are pinned to full commit SHAs** with a trailing `# vX.Y.Z` comment — never mutable `@vN` tags. When bumping an action, **including accepting a Dependabot PR**, resolve the new version's commit SHA and pin to that (Dependabot proposes mutable tags; applying them verbatim un-pins the action and regresses the hardening). Dependabot (`.github/dependabot.yml`) surfaces both npm and github-actions updates as PRs.
- **Least privilege**: both workflows set top-level `permissions: contents: read`; only the `release` and `update-readme` jobs escalate to `contents: write` per-job. Don't widen the top-level scope.
- **`ci.yml`**: lightweight Linux build-check on PRs — `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`. A high in a *dev-only* dep is fixed by bumping the dep, never by lowering the gate (triage policy is commented at the audit step).

### Cutting a release (`build.yml`, triggered on `v*` tag push)

1. Bump `package.json` (`npm version patch --no-git-tag-version`) in a `release: vX.Y.Z` commit on `main`.
2. `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`.

What the tag triggers — and the gating to know:
- **Strict semver is enforced.** The `release` job validates `vMAJOR.MINOR.PATCH[-prerelease][+build]` and refuses to publish a non-semver `v*` tag (`vtest`, `v1`, …). A malformed tag also fails earlier at the build job's `npm version` step. The **git tag is the source of truth for the version** — it syncs `package.json` at build time.
- **Stable vs prerelease.** A prerelease tag (`v1.2.3-rc.1`) publishes as a GitHub **prerelease** (does *not* move `latest`) and **does not touch `main`**. Only a **stable** tag runs the `update-readme` job, which regenerates the README download links (`scripts/update-readme.mjs`, between `<!-- DOWNLOADS:START/END -->`) and commits them to `main` as `github-actions[bot]`.
- **Recovery / rollback**: `gh release delete vX.Y.Z --yes --cleanup-tag` (removes the release, its assets, and the tag), then fix and re-tag.
- **App icon**: `build/icon.png`. `goldfinch-*.png` at repo root and `.claude/settings.local.json` are gitignored.

## Flight Operations

This project uses [Flight Control](https://github.com/msieurthenardier/mission-control).

**Before any mission/flight/leg work, read these files in order:**
1. `.flightops/README.md` — What the flightops directory contains
2. `.flightops/FLIGHT_OPERATIONS.md` — **The workflow you MUST follow**
3. `.flightops/ARTIFACTS.md` — Where all artifacts are stored
4. `.flightops/agent-crews/` — Project crew definitions for each phase (read the relevant crew file)
