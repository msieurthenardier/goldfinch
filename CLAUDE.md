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
- `npm run a11y` — axe-core accessibility audit (`scripts/a11y-audit.mjs`). Attaches to the running app's renderer over CDP at `:9222` (requires `npm run dev:debug`), drives the chrome into each state (base chrome → media panel → privacy panel → lightbox), injects axe-core, and **diffs each violation node against a curated `ACCEPTED` allowlist** (`{ id, selector, reason }`, optional state) baked into `scripts/a11y-audit.mjs` (DD7) — it fails only on NEW `(rule id, node-selector)` findings, not on any pre-accepted violation. Accepts `--rules=`, `--tags=`, and `--url=` (the media fixture to load; defaults to `http://127.0.0.1:8000/` — serve `tests/behavior/fixtures/a11y-media/` via `python3 -m http.server`). A `--target=<url-substring>` **guest mode** audits an already-loaded `<webview>` guest (e.g. `--target=goldfinch://settings`) instead of the chrome — picking the guest target by URL substring and skipping the chrome state-drivers. **Gate convention**: `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` runs only the WCAG 2.1 A/AA conformance rules (what the verify-leg sweep gates on); axe's full default set additionally flags best-practice *advisories* (e.g. `region`, the documented app-shell exception) that are not conformance failures. `nested-interactive` is **always** disabled (the tab strip's `role="tab"` wrapping a focusable close `<button>` is an accepted APG tab/close pattern). This gate is **real-environment / verify-only — NOT part of headless CI** (it needs the live GUI at `:9222`).

## Architecture

Three processes; understand the boundary before editing.

- **Main** (`src/main/`): `main.js` owns the BrowserWindow, downloads, the combined `webRequest` pipeline, the privacy aggregate, and all IPC. `shields.js` = persisted Shields config + tracking-param stripping; `jars.js` = container definitions; `trackers.js` = registrable-domain (eTLD+1) + tracker classification.
- **Preloads** (`src/preload/`): `chrome-preload.js` exposes `window.goldfinch.*` (contextBridge) to the UI. `webview-preload.js` is injected into every page and runs in the page's **main world** (media scanner + fingerprint detect/farble). `internal-preload.js` is a third, distinct preload for trusted `goldfinch://` internal pages — it runs **context-isolated** (opposite of `webview-preload.js`) and exposes a deliberately minimal `window.goldfinchInternal` (currently just `{ version: 1 }`; Flight 6 grows it into the Settings/Shields IPC bridge). Keep it separate from both `webview-preload.js` and the chrome `window.goldfinch`.
- **Renderer** (`src/renderer/`): `index.html` / `renderer.js` / `styles.css` — the browser chrome. Each tab is a `<webview>`. Holds the media panel, docked music player, privacy panel, Shields toggles, the jar/container picker (the `▾` menu), and the **⋮ overflow (kebab) menu** at the right of the toolbar (Settings + Exit; **Settings** opens the internal `goldfinch://settings` page via `createTab(..., { trusted: true })` — a stub today, see the internal-page security model below; Exit fires the `app-quit` IPC → `app.quit()`, the only all-platform quit path — distinct from `window-close`, whose `window-all-closed` darwin guard does not quit on macOS). The tab strip is an ARIA `tablist`/`tab` roving-tabindex widget (ArrowLeft/Right + Home/End navigate and activate; Delete/Backspace closes the focused tab); its keyboard/screen-reader contract is pinned by the `tab-keyboard-operability` behavior test (`/behavior-test tab-keyboard-operability`), and accessibility across all chrome states is regression-gated by `npm run a11y` (see Commands). Both popup menus (the `▾` container picker and the ⋮ kebab) register with a shared `menuController` that owns open/close, outside/blur dismissal, and mutual-exclusion; each registers its own APG `role="menu"`/`menuitem` roving-tabindex keyboard nav (Arrow/Home/End/Escape/Tab) via the shared `focusItem` helper.

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

### Internal `goldfinch://` pages — the trusted-embedder security model

Goldfinch's own chrome pages (currently just the **Settings** stub) are served from a privileged `goldfinch://` scheme, **not** from a web origin. This is a genuinely separate, privileged trust domain from web-content tabs — treat it as security-critical.

- **Scheme + session.** `goldfinch` is registered privileged (`{ standard: true, secure: true }`) at **module load** in `main.js` (before `app.ready`, which `registerSchemesAsPrivileged` requires). `standard: true` is load-bearing — it gives the scheme real origin/host semantics (`new URL('goldfinch://settings').host === 'settings'`) and lets it enforce CSP. Pages are served from a **dedicated in-memory internal session** (`session.fromPartition(INTERNAL_PARTITION)`) whose `protocol.handle('goldfinch', …)` is registered **session-scoped** — the global `protocol` would bind the default session and the internal webview wouldn't see it. (DD2/DD3)
- **`goldfinch-internal` partition is single-sourced.** The partition string lives **only** in `src/shared/internal-page.js` (`INTERNAL_PARTITION`), required by both the main process (session + handler) and the renderer (the trusted webview's `partition` attribute, surfaced via `window.goldfinch.internalPartition`). It must match byte-for-byte or the internal session serves nothing. No `persist:` prefix — the stub is static, nothing to persist.
- **CSP is set IN the response, not via `onHeadersReceived`.** `handleInternal` stamps the strict CSP (`default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`) directly on the `Response` headers. **Custom-protocol responses bypass the `webRequest`/`onHeadersReceived` pipeline**, so that hook would silently never fire — do not move CSP there. The CSP value lives in the `INTERNAL_CSP` constant in `main.js`; do not relax it without a security review.
- **Subresource-serving model.** `INTERNAL_PAGES` is a **host → pathname → absolute-file-path** map (e.g. `settings: { '/': …settings.html, '/settings.css': …settings.css, '/settings.js': …settings.js }`). `main.js` builds absolute paths with `path.join(__dirname, …)` and passes the map to `createResolver(INTERNAL_PAGES)` at startup (imported from `src/main/internal-assets.js`). `handleInternal` calls the returned `resolve(host, pathname)` per request; a `null` return is a 404. This is **traversal-proof by design**: the resolved `file` is taken directly from the map value — no path arithmetic is ever performed on `url.pathname`. Content-type is derived by `contentTypeFor(file)` (keyed on the map entry's *file extension*, never the raw URL). `internal-assets.js` is `__dirname`-free and Electron-free so it can be unit-tested with a synthetic map (see `test/unit/internal-assets.test.js`). When adding a new subresource to an existing internal page, add an explicit `pathname → file` entry to that host's sub-map in `INTERNAL_PAGES`; never introduce a directory passthrough.
- **The four gates.** Internal pages open **only** through the trusted path, defended in depth:
  1. **Provenance flag** — `createTab(url, container, { trusted: true })` in the renderer. Trust is the **call site**, never inferred from the URL. The only trusted call site is the kebab → Settings handler.
  2. **`isInternalPageUrl` allowlist** — the trusted branch validates the URL with `isInternalPageUrl` (canonical `goldfinch://settings` root only); the untrusted branch uses `isSafeTabUrl`, which **rejects** `goldfinch://`. The page-reachable `onOpenTab` IPC route calls `createTab(url)` with **no** trusted flag, so web content reaching `createTab` can never select the internal branch.
  3. **Session-aware `will-navigate`** — the guard in `main.js` branches on `contents.session.__goldfinchInternal`: the internal session may navigate only within `isInternalPageUrl`; every web-origin webview keeps the stricter `isSafeTabUrl` rule (which still rejects `goldfinch://`).
  4. **Internal-session-only handler** — the `protocol.handle` lives on the internal session alone, so web-origin tabs literally have no handler for `goldfinch://`.
- **NEVER widen `isSafeTabUrl` to admit `goldfinch://`.** That predicate guards untrusted web content; widening it would let any page open/navigate to internal chrome. Internal pages get in **only** via the trusted `createTab` path above. Net effect: web content cannot navigate to, open, embed, or `fetch` the scheme.
- **The internal webview runs context-isolated + sandboxed.** `will-attach-webview` branches on `params.partition === INTERNAL_PARTITION` to set `contextIsolation: true` (opposite of web webviews, which run `contextIsolation:false` for farbling) with the minimal `internal-preload.js`. The internal session is **excluded** from the web-content wirings (`applyShields`, download handler) — primarily via a module-scoped `creatingInternalSession` flag read inside the synchronous `session-created` hook, with a post-creation `__goldfinchInternal` marker as belt-and-suspenders.

- **Address-bar chip + read-only address bar.** `updateAddressChip(tab)` (in `renderer.js`) is called from every address-sync site (`activateTab`, `did-navigate`, `did-navigate-in-page`). It sets `els.addressChip` to `data-state="internal"` and makes the address `<input>` `readOnly` when the active URL matches `isInternalPageUrl`; `data-state="web"` (with host label) for `http(s)` tabs; neutral default for blank/new tabs. The `#address-chip` element (`index.html`) also acts as the trigger for the **site-info popup** (`#site-info-popup`), registered with `menuController` without an `items` getter (the controller's roving-tabindex contract no-ops when `!entry.items`); the popup's own `keydown` handler covers Escape/Tab dismissal.
- **Internal-tab navigation lock (UX-only — `navigate()` in `renderer.js`).** When `navigate(input)` is called while `isInternalTab(tab)` is true, any non-internal URL is rerouted to `createTab(url)` (a new normal tab, web branch) and the internal tab is left untouched. The `readOnly` address bar prevents direct user entry, but this lock is belt-and-suspenders for programmatic callers. **⚠️ This is a UX-only guard, not a security boundary.** The critical security work — an origin-check on the `window.goldfinchInternal` IPC bridge to ensure web content loaded in a normal webview cannot call internal bridge APIs — remains a **Flight-6 TODO**. Do NOT assume internal pages are fully isolated from web-origin code until that bridge origin-check lands.

When adding an internal page (Flight 5+): add a `host → pathname → file` entry tree to `INTERNAL_PAGES`, extend `isInternalPageUrl`'s allowlist, and open it via the trusted `createTab` path — never by relaxing the web gates.

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
